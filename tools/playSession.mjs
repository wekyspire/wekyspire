// playSession：headless 对局引擎（文本界面）。
//
// 会话 = tmp/playtests/<名>.json { seed, actions: [] }。每次调用把全部动作确定性
// 重放一遍（战斗种子由 run 种子派生、奖励走 run rng，同种子同动作序列必同局），
// 新动作成功后才入档——中途战斗状态无需序列化。
//
// 本模块是**引擎**（无 CLI 副作用），两个消费者：
//   tools/headlessPlay.mjs —— 一次性 CLI（一个动作一个进程，agent 用）
//   tools/broadcast.mjs    —— 直播守护进程（内存态常驻 + 只对新动作开流）
// 二者共用同一份 exec/render，输出不漂移。
//
// 寻址约定（2026-09 子代理防呆强化）：
//   - 打牌/选牌一律「编号+卡名」双重确认：编号定位、卡名校验，不匹配报错并提示实际卡名；
//   - 不用 uniqueID（其含随机后缀）；
//   - 抽牌是顺序抽（牌库顶=数组 index 0）：战斗中 `lib` 可查抽牌顺序，预知未来抽卡；
//   - 升级前先 `preview up <构筑#>` 看升阶前后对比（只读），再 act upgrade/up 执行。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import '../src/core/content/index.js';
import Player, { PLAYER_BASE_HP } from '../src/core/state/player.js';
import { createSkillRuntime } from '../src/core/state/skillRuntime.js';
import { BODY_STARTER_DECK } from '../src/core/content/bodySkills.js';
import { createNullPresenter, createRecordingPresenter } from '../src/core/presenter.js';
import { canUseSkill, makeSkillCtx, effectiveHandCount } from '../src/core/skills/helpers.js';
import { getSkillDefinition } from '../src/core/skills/registry.js';
import { listNamedTerms } from '../src/core/skills/namedTerms.js';
import { getEffectDefinition, allEffects } from '../src/core/effects/registry.js';
import { getEnemyDefinition } from '../src/core/enemies/registry.js';
import { gatedPromotionTargets } from '../src/core/run/promotion.js';
import { getAbilityDefinition } from '../src/core/abilities/registry.js';
import { getRelicDefinition } from '../src/core/relics/registry.js';
import { prepUseRelic, equipRelic, unequipRelic } from '../src/core/run/prep.js';
import { swapCostOf } from '../src/core/state/battleState.js';
import {
  startBattle, playerUseSkill, playerEndTurn, playerSwapCard, isBattleFinished, respondInput,
} from '../src/core/flow/battle.js';
import {
  createRun, enterBattle, createRunBattle, finishBattle, completeRewards, completeRoom, isBossFloor,
} from '../src/core/run/runFlow.js';
import {
  chooseSkillReward, chooseRewardPack, isRewardsClaimed, PACKS, maxRewardTier,
} from '../src/core/run/rewards.js';
import {
  chooseAscension, chooseAscensionAbility, chooseSeedCards, rerollSeedOffering,
  ASCENSION_PLACEHOLDER, FIRST_ASCENSION_GRANT,
} from '../src/core/run/ascension.js';
import {
  trainingMode, upgradableCards, trainUpgrade, trainDrawChoices, trainDraw, skipTraining,
} from '../src/core/run/rooms/training.js';
import { campOptions, campRest, campRecoverRemi, campUpgrade, CAMP_PLACEHOLDER } from '../src/core/run/rooms/camp.js';
import { playEvent } from '../src/core/run/rooms/event.js';
import { spinSlot, SLOT_PLACEHOLDER } from '../src/core/run/rooms/slotMachine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'tmp', 'playtests');

export const HELP = `动作表（按当前阶段）：
  战斗: play <手牌#> <卡名> [敌#] | swap <手牌#> <卡名>（弃1抽1，首次免费之后逐次+1） | end | auto
        in <候选#> <卡名>（应答输入请求） | lib（查牌库——抽牌严格按顺序，可预知未来抽到什么）
  奖励: pack <#|体修|火|通用> | take <候选#> <卡名> | skip | next
  房间: act rest | act remi | act upgrade <构筑#> <卡名> | act up <构筑#> <卡名> | act draw
        | act take <候选#> <卡名> | act skipdraw | act skip | act spin | act play | next
  预览: preview up <构筑#>（升阶前后对比，只读）
  进阶: dim 火|跳过（首次点亮火系：获赠点火+火弹术+体系能力「火灵脉」，再开种子九选三；
        跳过=体修等级+1：之后能抽到更高阶的体修卡牌） | reroll | ability <#|skip>
        | seed <#> <卡名>,<#> <卡名>,<#> <卡名>（选3张入组）
  通用: state | deck | lib | terms（词条/效果释义） | note <文本> | help
※ 打牌/选牌一律「编号+卡名」双重确认：编号定位、卡名校验，两者不匹配会报错并提示实际卡名。`;

// ---------- 小工具 ----------
// 富文本 → 纯文本：/effect{x}|/named{x} 保留内文；/card{id} 解析为卡名（渲染层同款语义）
export const plain = (s) => String(s ?? '')
  .replace(/\/card\{([^}]*)\}/g, (_, id) => getSkillDefinition(id)?.name ?? id)
  .replace(/\/(?:effect|named)\{([^}]*)\}/g, '$1');
export const defOf = (rt) => getSkillDefinition(rt.defId);
const costText = (def) => {
  const c = def.cost ?? {};
  const parts = [];
  if (c.mana === 'X') parts.push('X魏启'); else if (c.mana) parts.push(`${c.mana}魏启`);
  if (c.actionPoint) parts.push(`${c.actionPoint}AP`);
  return parts.join(' ') || '0费';
};
const kwText = (def) => (def.keywords ?? [])
  .filter(k => k !== 'blade').map(k => ({
    exhaust: '消耗', transient: '短暂', innate: '固有', anchored: '锁定', slowStart: '慢热',
  }[k] ?? k)).join(' ');
const effectsText = (unit) => unit.effects?.length
  ? unit.effects.map(e => `${getEffectDefinition(e.effectId)?.name ?? e.effectId}${e.stacks}`).join(' ') : '';
const intentText = (u) => {
  const it = u.intention;
  if (!it) return '未知';
  const kind = (it.kinds ?? []).map(k => ({
    attack: '攻击', defend: '防御', buff: '强化', debuff: '削弱',
    summon: '召唤', unknown: '未知', stun: '晕眩',
  }[k] ?? k)).join('+');
  const dmg = it.damage ? ` ${it.damage}${it.hits > 1 ? `×${it.hits}` : ''}` : '';
  return kind + dmg + (it.note ? `（${it.note}）` : '');
};
function cardLine(idx, rt, battleCtx) {
  const def = defOf(rt);
  // 咏唱卡前置「咏唱N·」标记（打出前可见——点燃/解除语义靠它）
  const nameTag = def.cardMode === 'chant' ? `咏唱${def.chantWeight ?? 2}·${def.name}` : def.name;
  const bits = [`[${idx}] ${nameTag} ${def.tier}阶 ${costText(def)}`];
  const kw = kwText(def); if (kw) bits.push(kw);
  if (rt.isActivated) bits.push('★已激活咏唱');
  else if (rt.remainingUses <= 0) bits.push(`冷却中(剩${rt.currentCooldown}拍)`);
  if (rt.power) bits.push(`威力${rt.power > 0 ? '+' : ''}${rt.power}`);
  let desc;
  try {
    desc = (battleCtx && def.battleDescribe)
      ? plain(def.battleDescribe(makeSkillCtx(battleCtx, rt)))
      : plain(def.describe());
  } catch { desc = plain(def.describe()); }
  bits.push(`「${desc}」`);
  if (battleCtx) bits.push(canUseSkill(battleCtx, rt) ? '可用' : '不可用');
  return bits.join(' | ');
}

// 无战斗上下文的卡面行（升级预览用）：名/阶/费用/关键词/描述
function cardDefLine(def) {
  const nameTag = def.cardMode === 'chant' ? `咏唱${def.chantWeight ?? 2}·${def.name}` : def.name;
  const bits = [`${nameTag} ${def.tier}阶 ${costText(def)}`];
  const kw = kwText(def); if (kw) bits.push(kw);
  bits.push(`「${plain(def.describe?.() ?? '')}」`);
  return bits.join(' | ');
}

// ---------- 会话状态机（replay 解释器） ----------
/**
 * @param seed 局种子
 * @param opts.makePresenter (S) => presenter —— 缺省 recording（CLI 日志用）；
 *        直播守护进程传「recording + wire 转发」的复合 presenter。
 * @param opts.onBattle (S, battle) => void —— 战斗装配完成、startBattle 之前回调
 *        （直播端在此发 battle:begin 并挂流式 tap）
 */
export function freshState(seed, { makePresenter = null, onBattle = null } = {}) {
  const run = createRun({ seed, player: new Player({ maxHp: PLAYER_BASE_HP, maxMana: 3, maxActionPoints: 3 }) });
  run.player.deck = BODY_STARTER_DECK.map(id => createSkillRuntime(id));
  run.player.abilities = [];
  const S = {
    run, battle: null, lastOutcome: '', presenter: null,
    onBattle, tapEnabled: false,
  };
  S.presenter = makePresenter ? makePresenter(S) : createRecordingPresenter();
  return S;
}

export function ensureBattle(S) {
  if (S.run.gameStage === 'prep') enterBattle(S.run); // 免 fight：战斗动作直达
  if (S.run.gameStage !== 'battle') throw new Error(`当前不在战斗阶段（${stageCn(S.run.gameStage)}）`);
  if (!S.battle) {
    S.presenter.clear(); // 战斗日志按场清零
    S.battle = createRunBattle(S.run, { presenter: S.presenter });
    S.onBattle?.(S, S.battle);
    startBattle(S.battle);
    if (isBattleFinished(S.battle)) settleBattle(S);
  }
  return S.battle;
}

// 战斗结算日志（presenter 调用 → 中文行；取尾部 N 条）
export function battleLogText(S, tail = 10) {
  const lines = [];
  for (const { method, args } of S.presenter?.calls ?? []) {
    const p = args?.[0] ?? {};
    switch (method) {
      case 'damage': {
        if ((p.dealt ?? 0) <= 0 && (p.shieldAbsorbed ?? 0) <= 0 && (p.defenseBlocked ?? 0) <= 0) break;
        const src = p.source?.name ?? (p.pierce ? '持续伤害' : '环境'); // 燃烧/中毒等无来源穿透伤
        lines.push(`${src} → ${p.target?.name}: ${p.dealt}伤`
          + `${p.pierce ? '（穿透）' : ''}${p.shieldAbsorbed ? `（盾挡${p.shieldAbsorbed}）` : ''}`
          + `${p.defenseBlocked ? `（防挡${p.defenseBlocked}）` : ''}`);
        break;
      }
      case 'heal': if ((p.healed ?? 0) > 0) lines.push(`${p.target?.name} 恢复 ${p.healed}`); break;
      case 'shield': if ((p.gained ?? 0) > 0) lines.push(`${p.target?.name} 护盾+${p.gained}`); break;
      case 'effect': {
        const name = getEffectDefinition(p.effectId)?.name ?? p.effectId;
        lines.push((p.stacks ?? 0) > 0 ? `${p.target?.name} 获得${name}${p.stacks}` : `${p.target?.name} ${name}消散`);
        break;
      }
      case 'unitDeath': lines.push(`${p.unit?.name} 被击败！`); break;
      case 'unitSpawned': lines.push(`${p.unit?.name} 现身！`); break;
      case 'cardTransformed':
        lines.push(`⚡卡牌变化: ${getSkillDefinition(p.fromDefId)?.name ?? p.fromDefId} → ${getSkillDefinition(p.toDefId)?.name ?? p.toDefId}`);
        break;
      case 'cardDiscarded': lines.push(`弃 ${p.card ? defOf(p.card).name : '?'}`); break;
      case 'cardBurnt': lines.push(`焚毁 ${p.card ? defOf(p.card).name : '?'}`); break;
      case 'cardAdded':
        lines.push(`洗入 ${p.card ? defOf(p.card).name : '?'}（${p.toZone === 'hand' ? '入手' : '入库'}）`);
        break;
      case 'cardMoved':
        lines.push(`${p.card ? defOf(p.card).name : '?'} → ${{ hand: '手牌', deck: '牌库', burnt: '焚毁区', pending: '结算区' }[p.toZone] ?? p.toZone}`);
        break;
      default: break; // 抽牌/展示/资源等由手牌与资源条直接可见，降噪省略
    }
  }
  return lines.slice(-tail);
}

// 手牌/候选双重确认寻址（子代理防呆）：`<编号> <卡名>` 两个参数都要对上。
// 编号定位 + 卡名校验（def.name 全等或前缀；咏唱卡可省略「咏唱N·」前缀写正名），
// 不匹配时报错并给出该编号的实际卡名，杜绝「打错牌」。
const stripChantTag = (s) => String(s ?? '').replace(/^咏唱\d+·/, '');
function nameMatches(given, actual) {
  const g = stripChantTag(given);
  return g === actual || actual.startsWith(g);
}
function resolveHandStrict(list, idxArg, nameArg, what = '手牌') {
  const i = idxOk(num(idxArg), list.length, what);
  const actual = defOf(list[i]).name;
  if (nameArg == null) {
    throw new Error(`缺少卡名参数：${what}需「编号+卡名」双重确认，如 ${what === '手牌' ? 'play' : '选'} ${idxArg} ${actual}`);
  }
  if (!nameMatches(nameArg, actual)) {
    throw new Error(`${what}第${idxArg}张是「${actual}」，不是「${nameArg}」——请对照列表编号重试`);
  }
  return i;
}
// 候选表（defId 数组）同款双重确认；返回校验通过的 defId
function resolveChoiceStrict(choices, idxArg, nameArg, what = '候选', nameOf) {
  const i = idxOk(num(idxArg), choices.length, what);
  const actual = nameOf(choices[i]);
  if (nameArg == null) {
    throw new Error(`缺少卡名参数：${what}需「编号+卡名」双重确认，如 take ${idxArg} ${actual}`);
  }
  if (!nameMatches(nameArg, actual)) {
    throw new Error(`${what}第${idxArg}张是「${actual}」，不是「${nameArg}」——请对照候选列表重试`);
  }
  return choices[i];
}

export function settleBattle(S) {
  const verdict = S.battle.ctx.kernel.verdict;
  finishBattle(S.run, verdict, S.battle);
  S.battle = null;
  if (verdict === 'victory') {
    S.lastOutcome = isBossFloor(S.run.floor)
      ? '⚔ Boss 击破！HP 回满，进入奖励'
      : `⚔ 战斗胜利！HP ${S.run.player.hp}/${S.run.player.maxHp}，进入奖励`;
  } else {
    S.lastOutcome = '💀 战斗失败……';
  }
}

const num = (s) => Number.parseInt(s, 10);
const idxOk = (n, len, what) => {
  if (!Number.isInteger(n) || n < 1 || n > len) throw new Error(`${what}编号越界：${n}（1..${len}）`);
  return n - 1;
};

// 升级门禁预检（gatedPromotionTargets 同源）：给出可读的拒绝理由
function upgradeGateError(run, card) {
  const targets = gatedPromotionTargets(run, defOf(card));
  if (targets.length) return null;
  return defOf(card).promotesTo
    ? `「${defOf(card).name}」的晋升目标等阶未解锁（卡包等级门禁），暂不可升级`
    : `「${defOf(card).name}」已是链尾，无可升级目标`;
}

// 老虎机/事件结果的中文呈现（内部 id → 名称）
function slotResultText(r) {
  switch (r.type) {
    case 'money': return `金币 +${r.money}`;
    case 'fruit': return `瑞米的水果 +1`;
    case 'training': return `训练次数 +1（等效一次训练）`;
    case 'card': return `获得卡牌：${getSkillDefinition(r.defId)?.name ?? r.defId}（已入构筑）`;
    case 'relic': return `获得遗物：${getRelicDefinition(r.relicId)?.name ?? r.relicId}`;
    default: return `空奖（nothing）`;
  }
}
function eventResultText(r) {
  if (r.eventId === 'moneyBag') return `「钱袋」金币 +${r.money}`;
  if (r.eventId === 'spring') return `「治愈泉」恢复 ${r.heal} 生命`;
  return JSON.stringify(r);
}

export function exec(S, raw) {
  const t = raw.trim().split(/\s+/);
  const [cmd, a, b] = t;
  const run = S.run;
  const stage = run.gameStage;
  switch (cmd) {
    case 'note': S.lastOutcome = `记事: ${t.slice(1).join(' ')}`; return;
    case 'state': case 'deck': case 'terms': case 'help': S.lastOutcome = ''; return;

    // ---- 战斗 ----
    case 'fight':
      if (stage !== 'prep') throw new Error('只能在战前准备(frep/prep)阶段开战');
      enterBattle(run); ensureBattle(S);
      S.lastOutcome = '⚔ 战斗开始';
      return;
    case 'play': {
      const battle = ensureBattle(S);
      if (battle.battleState.pendingInput) throw new Error('有待应答的输入请求（先用 in <候选#> <卡名>）');
      const hand = battle.battleState.zones.hand;
      const skill = hand[resolveHandStrict(hand, a, b)];
      const name = defOf(skill).name; // 先取名字：结算内斩等转化会就地改写 defId
      const target = t[3] != null
        ? battle.battleState.enemies[idxOk(num(t[3]), battle.battleState.enemies.length, '敌人')] : null;
      if (!playerUseSkill(battle, skill.uniqueID, target?.uniqueID ?? null)) throw new Error('无法打出（费用/条件不满足）');
      S.lastOutcome = `打出 ${name}`;
      if (isBattleFinished(battle)) settleBattle(S);
      return;
    }
    case 'swap': {
      const battle = ensureBattle(S);
      const hand = battle.battleState.zones.hand;
      if (!hand.length) throw new Error('手牌为空，无法换牌');
      const skill = hand[resolveHandStrict(hand, a, b)];
      if (!playerSwapCard(battle, skill.uniqueID)) throw new Error('无法换牌（行动点不足？）');
      S.lastOutcome = `换牌 ${defOf(skill).name}`;
      return;
    }
    case 'end': {
      const battle = ensureBattle(S);
      if (!playerEndTurn(battle)) throw new Error('无法结束回合');
      S.lastOutcome = '结束回合';
      if (isBattleFinished(battle)) settleBattle(S);
      return;
    }
    case 'in': {
      const battle = ensureBattle(S);
      const pending = battle.battleState.pendingInput;
      if (!pending) throw new Error('当前没有输入请求');
      const { request } = pending;
      if (request.kind === 'confirm') {
        if (t.length > 1) throw new Error('confirm 类输入无需参数');
        respondInput(battle, true);
      } else {
        const cands = request.candidates ?? [];
        const rest = t.slice(1);
        if (rest.length === 0 || rest.length % 2 !== 0) {
          throw new Error('候选需成对「编号 卡名」：in <候选#> <卡名>（候选名见上方待输入列表）');
        }
        const ids = [];
        for (let k = 0; k < rest.length; k += 2) {
          const i = idxOk(num(rest[k]), cands.length, '候选');
          const id = cands[i];
          const card = battle.battleState.zones.hand.find(h => h.uniqueID === id);
          if (card) { // 手牌候选做双重确认；非手牌候选（如有）无从校验，放行
            const actual = defOf(card).name;
            if (!nameMatches(rest[k + 1], actual)) {
              throw new Error(`候选第${rest[k]}个是「${actual}」，不是「${rest[k + 1]}」——请对照待输入列表重试`);
            }
          }
          ids.push(id);
        }
        respondInput(battle, ids);
      }
      S.lastOutcome = '已应答输入';
      if (isBattleFinished(battle)) settleBattle(S);
      return;
    }
    case 'auto': {
      if (stage === 'prep') { enterBattle(run); }
      const battle = ensureBattle(S);
      let steps = 0;
      while (!isBattleFinished(battle)) {
        if (++steps > 600) throw new Error('auto 战斗超步数，疑似卡死');
        const pi = battle.battleState.pendingInput;
        if (pi) {
          const r = pi.request;
          respondInput(battle, r.kind === 'confirm' ? true
            : (r.candidates ?? []).slice(0, Math.min(r.count ?? 1, (r.candidates ?? []).length)));
          continue;
        }
        const pick = battle.battleState.zones.hand.find(s => canUseSkill(battle.ctx, s));
        if (pick) playerUseSkill(battle, pick.uniqueID);
        else playerEndTurn(battle);
      }
      settleBattle(S);
      return;
    }

    // ---- 战后奖励 ----
    case 'pack': {
      if (stage !== 'reward') throw new Error('当前不在奖励阶段');
      const packs = run.rewards.packs;
      const PACK_ALIAS = { 体修: 'body', 火: 'fire', 火灵脉: 'fire', 通用: 'common' };
      const key = PACK_ALIAS[a] ?? a;
      const id = /^-?\d+$/.test(key ?? '')
        ? packs[idxOk(num(key), packs.length, '卡包')]
        : (packs.includes(key) ? key : (() => { throw new Error(`卡包不可选：${a}（${packs.join('/')}）`); })());
      chooseRewardPack(run, id);
      S.lastOutcome = `开包 ${PACKS[id]?.name ?? id}`;
      return;
    }
    case 'take': {
      if (stage !== 'reward') throw new Error('当前不在奖励阶段');
      const choices = run.rewards.skillChoices;
      const defId = resolveChoiceStrict(choices, a, b, '候选',
        id => getSkillDefinition(id)?.name ?? id);
      chooseSkillReward(run, defId);
      S.lastOutcome = `获得卡牌：${getSkillDefinition(defId).name}`;
      return;
    }
    case 'skip':
      if (stage !== 'reward') throw new Error('当前不在奖励阶段');
      chooseSkillReward(run, null);
      S.lastOutcome = '跳过奖励';
      return;

    // ---- 奖励房 ----
    case 'act': {
      if (stage !== 'room') throw new Error('当前不在奖励房');
      if (S.roomDone) throw new Error('本房间动作已完成，用 next 离开');
      const room = run.currentRoom;
      if (room === 'camp') {
        if (a === 'rest') {
          const before = run.player.hp;
          campRest(run);
          S.roomDone = true;
          S.lastOutcome = `休整：恢复${run.player.hp - before}生命（${Math.round(CAMP_PLACEHOLDER.restHealRatio * 100)}%最大生命），魏启回满`;
          return;
        }
        if (a === 'remi') { campRecoverRemi(run); S.roomDone = true; S.lastOutcome = '找回瑞米'; return; }
        if (a === 'upgrade') {
          const card = run.player.deck[resolveHandStrict(run.player.deck, b, t[3], '构筑卡')];
          const gateErr = upgradeGateError(run, card);
          if (gateErr) throw new Error(gateErr);
          const before = defOf(card).name;
          campUpgrade(run, card.uniqueID);
          S.roomDone = true;
          S.lastOutcome = `营地升级：${before} → ${defOf(card).name}`;
          return;
        }
        throw new Error('营地动作：act rest | act remi | act upgrade <构筑#> <卡名>');
      }
      if (room === 'training') {
        if (a === 'up') {
          const card = run.player.deck[resolveHandStrict(run.player.deck, b, t[3], '构筑卡')];
          const gateErr = upgradeGateError(run, card);
          if (gateErr) throw new Error(gateErr);
          const before = defOf(card).name;
          trainUpgrade(run, card.uniqueID);
          S.lastOutcome = `训练升级：${before} → ${defOf(card).name}（接下来强制三选一抓牌）`;
          return;
        }
        if (a === 'draw') { trainDrawChoices(run); S.lastOutcome = '训练抓牌候选已生成'; return; }
        if (a === 'take') {
          const choices = run.roomData?.drawChoices ?? [];
          const defId = resolveChoiceStrict(choices, b, t[3], '抓牌候选',
            id => getSkillDefinition(id)?.name ?? id);
          trainDraw(run, defId);
          S.roomDone = true;
          S.lastOutcome = `训练抓牌：${getSkillDefinition(defId).name}`;
          return;
        }
        if (a === 'skipdraw') { trainDraw(run, null); S.roomDone = true; S.lastOutcome = '跳过训练抓牌'; return; }
        if (a === 'skip') { skipTraining(run); S.roomDone = true; S.lastOutcome = '跳过训练（计一次训练）'; return; }
        throw new Error('训练动作：act up <构筑#> <卡名> | act draw | act take <#> <卡名> | act skipdraw | act skip');
      }
      if (room === 'slot') {
        if (a === 'spin') {
          const r = spinSlot(run);
          S.lastOutcome = `老虎机(-${SLOT_PLACEHOLDER.spinCost}金币)：${slotResultText(r)}`;
          return;
        }
        throw new Error('老虎机动作：act spin（离开用 next）');
      }
      if (room === 'event') {
        if (a === 'play') {
          const r = playEvent(run);
          S.roomDone = true;
          S.lastOutcome = `事件：${eventResultText(r)}`;
          return;
        }
        throw new Error('事件动作：act play');
      }
      throw new Error(`未知房间类型：${room}`);
    }

    // ---- 进阶 ----
    case 'dim': {
      if (stage !== 'ascension') throw new Error('当前不在进阶事件');
      if (a === '跳过' || a === 'skip') { chooseAscension(run, null); S.lastOutcome = `跳过进阶（体修隐藏等级+1，恢复${ASCENSION_PLACEHOLDER.healAmount}点生命，魏启上限+1）`; }
      else if (a === '火' || a === 'fire') {
        const first = run.player.leino.fire === 0;
        chooseAscension(run, 'fire');
        const grant = first ? FIRST_ASCENSION_GRANT.fire : null;
        const grantText = grant
          ? `；获赠 ${grant.cards.map(id => getSkillDefinition(id)?.name ?? id).join('+')}`
            + (grant.ability ? `+体系能力「${getAbilityDefinition(grant.ability)?.name}」` : '')
          : '';
        S.lastOutcome = `火灵脉 +1（恢复${ASCENSION_PLACEHOLDER.healAmount}点生命，魏启上限+1）${grantText}`;
      }
      else throw new Error('dim 火 | dim 跳过');
      return;
    }
    case 'seed': {
      const off = run.cardOffering;
      if (!off) throw new Error('当前没有种子卡待选');
      const groups = t.slice(1).join(' ').split(',').map(s => s.trim()).filter(Boolean);
      if (groups.some(g => g.split(/\s+/).length !== 2)) {
        throw new Error('种子卡需「编号 卡名」成对：seed 3 引焰,6 火弹术,4 蓄热火球（共3张）');
      }
      const picks = groups.map(g => {
        const [idxArg, nameArg] = g.split(/\s+/);
        return resolveChoiceStrict(off.cards, idxArg, nameArg, '种子卡',
          id => getSkillDefinition(id)?.name ?? id);
      });
      if (picks.length !== 3) throw new Error('种子卡必须选 3 张：seed 3 引焰,6 火弹术,4 蓄热火球');
      chooseSeedCards(run, picks);
      S.lastOutcome = `种子入组：${picks.map(id => getSkillDefinition(id).name).join('、')}`;
      return;
    }
    case 'reroll':
      rerollSeedOffering(run);
      S.lastOutcome = '刷新种子候选';
      return;
    case 'ability': {
      const offer = run.ascensionOffer;
      if (!offer) throw new Error('当前没有能力候选');
      if (a === 'skip' || a === '跳过') chooseAscensionAbility(run, null);
      else {
        const id = offer[idxOk(num(a), offer.length, '能力')];
        chooseAscensionAbility(run, id);
        S.lastOutcome = `获得能力：${id}`;
      }
      return;
    }

    // ---- 升级预览（只读，不入档）----
    case 'preview': {
      if (a !== 'up') throw new Error('用法：preview up <构筑#> [卡名]');
      const deck = run.player.deck;
      const i = idxOk(num(b), deck.length, '构筑卡');
      const card = deck[i];
      const actual = defOf(card).name;
      if (t[3] != null && !nameMatches(t[3], actual)) {
        throw new Error(`构筑第${b}张是「${actual}」，不是「${t[3]}」——请对照 deck 编号重试`);
      }
      const targets = gatedPromotionTargets(run, defOf(card));
      if (!targets.length) {
        S.lastOutcome = `【升级预览】${actual}：${upgradeGateError(run, card) ?? '不可升级'}`;
        return;
      }
      const L = [`【升级预览】当前（构筑第${b}张）：${cardDefLine(defOf(card))}`];
      for (const tid of targets) {
        const next = getSkillDefinition(tid);
        L.push(`  升级后 → ${cardDefLine(next)}`);
        const chain = gatedPromotionTargets(run, next);
        if (chain.length) L.push(`    （后续链：${chain.map(x => getSkillDefinition(x).name).join(' → ')}）`);
      }
      L.push('  确认升级：营地 act upgrade <#> <卡名> / 训练场 act up <#> <卡名>');
      S.lastOutcome = L.join('\n');
      return;
    }

    // ---- 遗物：装卸与主动使用（仅战前准备阶段；核心 API 见 run/prep.js）----
    case 'relic': {
      if (stage !== 'prep') throw new Error('遗物操作仅能在战前准备阶段');
      const sub = a, id = b;
      if (!sub || !id) {
        throw new Error(`用法：relic equip|use|unequip <遗物id>（背包：${(run.player.relics ?? []).join(' ') || '空'}）`);
      }
      const nameOf = (rid) => getRelicDefinition(rid)?.name ?? rid;
      if (sub === 'equip') {
        equipRelic(run, id);
        S.lastOutcome = `装备遗物 ${nameOf(id)}`;
      } else if (sub === 'unequip') {
        unequipRelic(run, id);
        S.lastOutcome = `卸下遗物 ${nameOf(id)}`;
      } else if (sub === 'use') {
        const before = run.player.hp;
        prepUseRelic(run, id);
        S.lastOutcome = `使用遗物 ${nameOf(id)}（HP ${before}→${run.player.hp}）`;
      } else {
        throw new Error(`未知遗物子命令：${sub}（equip|use|unequip）`);
      }
      return;
    }

    // ---- 阶段推进 ----
    case 'next':
      if (stage === 'reward') { completeRewards(run); S.roomDone = false; S.lastOutcome = '离开奖励'; return; }
      if (stage === 'room') {
        // 训练强绑尾款未领不允许离场（UI 契约：forced 状态只给三选一不给跳过）
        if (run.roomData?.forced) throw new Error('升级后的强绑抓牌必须领取：act take <#>');
        completeRoom(run); S.roomDone = false; S.lastOutcome = '离开房间'; return;
      }
      throw new Error(`当前阶段无需 next（${stageCn(stage)}）`);
    default:
      throw new Error(`未知动作：${cmd}（help 查看动作表）`);
  }
}

export const stageCn = (s) => ({
  prep: '战前准备', battle: '战斗', reward: '战后奖励', room: '奖励房',
  ascension: '进阶事件', end: '终局',
}[s] ?? s);

// ---------- 状态渲染 ----------
export function render(S) {
  const run = S.run;
  const p = run.player;
  const L = [];
  const head = `【魏启尖塔 · headless】第 ${run.floor}/${run.totalFloors} 层 · ${stageCn(run.gameStage)}`
    + (run.result ? `（${run.result === 'victory' ? '登顶成功' : '战败'}）` : '');
  L.push(`═══ ${head} ═══`);
  L.push(`玩家: HP ${p.hp}/${p.maxHp} 护盾${p.shield} 魏启 ${p.mana}/${p.maxMana} AP ${p.actionPoints}/${p.maxActionPoints} 金币 ${p.money} | 灵脉 火${p.leino.fire} 体修${p.bodyLevel ?? 0} | 训练 ${p.trainingCount} 进阶 ${p.ascensionCount}/${ASCENSION_PLACEHOLDER.maxAscensions}`);
  if (p.effects?.length) L.push(`玩家效果: ${effectsText(p)}`);
  if (p.abilities.length) L.push(`能力: ${p.abilities.join(' ')}`);
  if (p.equippedRelics?.length) L.push(`装备遗物: ${p.equippedRelics.map(id => getRelicDefinition(id)?.name ?? id).join(' ')}`);

  const stage = run.gameStage;
  if (stage === 'battle' && S.battle) {
    const bs = S.battle.battleState;
    L.push(`〔回合 ${bs.turn.count}〕敌人:`);
    bs.enemies.forEach((e, i) => {
      if (e.isDead()) { L.push(`  [${i + 1}] ${e.name} ✝`); return; }
      L.push(`  [${i + 1}] ${e.name} HP ${e.hp}/${e.maxHp}${e.shield ? ` 护盾${e.shield}` : ''}${effectsText(e) ? ` 效果:${effectsText(e)}` : ''} 意图: ${intentText(e)}`);
    });
    for (const al of bs.allies) {
      if (al.isDead()) continue;
      L.push(`瑞米: HP ${al.hp}/${al.maxHp} 意图: ${intentText(al)}`);
    }
    L.push(`牌库 ${bs.zones.deck.length}（lib 查抽牌顺序——顺序抽，可预知） | 焚毁 ${bs.zones.burnt.length} | 手牌 ${effectiveHandCount(bs)}/${p.maxHandSize}（加权）`);
    L.push(`手牌:`);
    bs.zones.hand.forEach((c, i) => L.push('  ' + cardLine(i + 1, c, S.battle.ctx)));
    L.push(`本回合累计: 打${bs.history.turn.played} 弃${bs.history.turn.discarded} 抽${bs.history.turn.drawn}`);
    const pi = bs.pendingInput?.request;
    if (pi) {
      L.push(`▶ 待输入: ${pi.prompt ?? pi.kind}${pi.count ? `（选${pi.count}张）` : ''}`);
      if (pi.candidates?.length) {
        L.push('  候选: ' + pi.candidates.map((id, i) => {
          const c = bs.zones.hand.find(h => h.uniqueID === id);
          return `[${i + 1}] ${c ? defOf(c).name : id}`;
        }).join(' '));
      }
    }
    L.push(`→ play <手牌#> <卡名> [敌#] / swap <手牌#> <卡名>（弃1抽1，费${swapCostOf(bs)}AP） / end / in <候选#> <卡名> / lib 看牌库`);
    const log = battleLogText(S);
    if (log.length) {
      L.push(`最近结算:`);
      for (const l of log) L.push(`  · ${l}`);
    }
  } else if (stage === 'reward' && run.rewards) {
    const rw = run.rewards;
    L.push(`金币 +${rw.money}`);
    if (!rw.packId) {
      L.push(`可选卡包:`);
      rw.packs.forEach((id, i) => L.push(`  [${i + 1}] ${PACKS[id]?.name ?? id}（等级上限 ${maxRewardTier(run, id)}）`));
      L.push(`→ pack <#>`);
    } else {
      L.push(`已开 ${PACKS[rw.packId]?.name ?? rw.packId}，候选:`);
      rw.skillChoices.forEach((id, i) => {
        const def = getSkillDefinition(id);
        const nameTag = def.cardMode === 'chant' ? `咏唱${def.chantWeight ?? 2}·${def.name}` : def.name;
        L.push(`  [${i + 1}] ${nameTag} ${def.tier}阶 ${costText(def)} ${kwText(def)}「${plain(def.describe())}」`);
      });
      L.push(`→ take <#> <卡名> / skip`);
    }
  } else if (stage === 'room') {
    const room = run.currentRoom;
    if (S.roomDone) {
      L.push(`（房间动作已完成 → next 离开）`);
    } else if (room === 'camp') {
      const optCn = { recoverRemi: '找回瑞米(remi)', rest: '休整(rest)', upgrade: '升级(upgrade)' };
      L.push(`营地。可用: ${campOptions(run).map(o => optCn[o] ?? o).join(' / ')}（act rest | act remi | act upgrade <构筑#> <卡名>——先 preview up <#> 看升阶对比，之后 next）`);
    } else if (room === 'training') {
      L.push(`训练场（累计训练 ${run.player.trainingCount} 次）。模式: ${trainingMode(run) === 'upgrade' ? '先升后抓' : '退化抓牌'}`);
      if (run.roomData?.drawChoices) {
        L.push(`抓牌候选:`);
        run.roomData.drawChoices.forEach((id, i) => {
          const def = getSkillDefinition(id);
          const nameTag = def.cardMode === 'chant' ? `咏唱${def.chantWeight ?? 2}·${def.name}` : def.name;
          L.push(`  [${i + 1}] ${nameTag} ${def.tier}阶 ${costText(def)} ${kwText(def)}「${plain(def.describe())}」${run.roomData.forced ? '' : '（可跳过）'}`);
        });
        L.push(`→ act take <#> <卡名>${run.roomData.forced ? '（升级强绑，不可跳过）' : ' / act skipdraw'}`);
      } else if (trainingMode(run) === 'upgrade') {
        const deckIdx = (rt) => `[${run.player.deck.indexOf(rt) + 1}]`;
        L.push(`可升级卡: ${upgradableCards(run).map(rt => `${deckIdx(rt)}${defOf(rt).name}`).join(' ')}`);
        L.push(`→ act up <构筑#> <卡名>（先 preview up <#> 看升阶对比；编号即 deck 视图行号）/ act skip`);
      } else {
        L.push(`→ act draw（看候选）/ act skip`);
      }
    } else if (room === 'slot') {
      L.push(`老虎机：${SLOT_PLACEHOLDER.spinCost}金币/次，现有 ${p.money} 金币 → act spin（可多次）/ next 离开`);
    } else if (room === 'event') {
      L.push(`事件房 → act play 触发事件`);
    }
  } else if (stage === 'ascension') {
    L.push(`→ dim 火 | dim 跳过`);
    L.push(`  提示：跳过本灵脉进阶 = 选择进阶体修等级（体修等级+1，之后能抽到更高阶的体修卡牌），另回${ASCENSION_PLACEHOLDER.healAmount}血、魏启上限+1`);
    if (run.cardOffering) {
      const off = run.cardOffering;
      const grant = FIRST_ASCENSION_GRANT[off.dimension];
      if (grant && run.player.leino[off.dimension] === 1) {
        const ab = grant.ability ? getAbilityDefinition(grant.ability) : null;
        L.push(`本次获赠（已入牌组）：${grant.cards.map(id => getSkillDefinition(id)?.name ?? id).join('、')}`
          + (ab ? ` ｜ 体系能力「${ab.name}」：${plain(ab.description)}` : ''));
      }
      L.push(`种子九选三（选3张入组，刷新剩 ${off.rerollsLeft}）:`);
      off.cards.forEach((id, i) => {
        const def = getSkillDefinition(id);
        L.push(`  [${i + 1}] ${def.cardMode === 'chant' ? `咏唱${def.chantWeight ?? 2}·` : ''}${def.name} ${def.tier}阶 ${costText(def)} ${kwText(def)}「${plain(def.describe())}」`);
      });
      L.push(`→ seed <#> <卡名>,<#> <卡名>,<#> <卡名> / reroll`);
    }
    if (run.ascensionOffer) {
      L.push(`能力候选:`);
      run.ascensionOffer.forEach((id, i) => {
        const def = getAbilityDefinition(id);
        L.push(`  [${i + 1}] ${def?.name ?? id}「${plain(def?.describe?.() ?? '')}」`);
      });
      L.push(`→ ability <#|skip>`);
    }
  } else if (stage === 'prep') {
    L.push(`本层遭遇: ${run.encounter.map(e => {
      const def = getEnemyDefinition(e.defId);
      const elite = def?.difficulty?.elite ? '精英·' : '';
      return `${elite}${def?.name ?? e.defId}(${e.maxHp}血${e.difficulty != null ? `·难${e.difficulty}` : ''})`;
    }).join(' + ')}`);
    L.push(`→ fight 开战 / deck 看牌组`);
  } else if (stage === 'end') {
    L.push(`本局结束：${run.result === 'victory' ? '登顶成功' : '战败'}。感谢游玩！`);
  }
  if ((stage === 'reward' || stage === 'end') && S.presenter?.calls?.length) {
    const log = battleLogText(S);
    if (log.length) {
      L.push('上场战斗尾档（死因/击杀回放）:');
      for (const l of log) L.push(`  · ${l}`);
    }
  }
  if (S.lastOutcome) L.push(`⟐ ${S.lastOutcome}`);
  return L.join('\n');
}

export function renderDeck(S) {
  // 战斗中看战斗牌区（牌库顶在前，可见冷却/激活）；平时看构筑（升级用编号）
  if (S.battle && S.run.gameStage === 'battle') {
    const z = S.battle.battleState.zones;
    const L = [`战斗牌区：手牌 ${z.hand.length} | 牌库 ${z.deck.length}（顶在前）| 焚毁 ${z.burnt.length} | 结算区 ${z.pending.length}`];
    L.push('牌库:');
    z.deck.forEach((c, i) => L.push('  ' + cardLine(i + 1, c, null)));
    if (z.burnt.length) {
      L.push('焚毁区:');
      z.burnt.forEach((c, i) => L.push(`  [${i + 1}] ${defOf(c).name}`));
    }
    return L.join('\n');
  }
  const L = [`构筑牌组（${S.run.player.deck.length} 张，升级用编号）:`];
  S.run.player.deck.forEach((rt, i) => {
    const def = defOf(rt);
    const targets = gatedPromotionTargets(S.run, def);
    const next = targets[0];
    const promo = next
      ? ` →${getSkillDefinition(next).name}`
      : (Array.isArray(def.promotesTo) ? def.promotesTo[0] : def.promotesTo)
        ? ' →（等阶未解锁）' : '';
    L.push(`  [${i + 1}] ${def.name} ${def.tier}阶${promo}`);
  });
  return L.join('\n');
}

// 牌库查阅（战斗中）：抽牌顺序视图——抽牌是顺序抽的，可预知未来抽到什么。
// 注：本场无弃牌堆，弃牌/换牌直接回牌库底（可在下表尾部看到）。
export function renderLib(S) {
  if (!S.battle || S.run.gameStage !== 'battle') {
    return '【牌库】lib 在战斗中查看抽牌顺序（平时用 deck 看构筑）。';
  }
  const z = S.battle.battleState.zones;
  const L = ['【牌库】抽牌严格按下列顺序（[1] 就是下一张抽到的）——可预知未来抽卡；弃牌/换牌回牌库底：'];
  if (!z.deck.length) {
    L.push('  （牌库已空——本场无弃牌堆；抽牌等效果会因无牌可抽而落空，注意卡牌循环）');
  } else {
    z.deck.forEach((c, i) => L.push('  ' + cardLine(i + 1, c, null)));
  }
  return L.join('\n');
}

export function renderTerms() {
  const L = ['【词条表】（卡面关键词的完整释义，等同游戏内悬浮说明）'];
  for (const { name, text } of listNamedTerms()) L.push(`  ${name} — ${text}`);
  L.push('【效果表】（状态栏图标释义）');
  for (const def of allEffects()) {
    L.push(`  ${def.name}（${def.type === 'buff' ? '增益' : '减益'}） — ${def.description}`);
  }
  return L.join('\n');
}

// ---------- 会话文件（tmp/playtests/<名>.json { seed, actions }） ----------
export const sessionDir = DIR;
export const sessionPath = (name) => path.join(DIR, `${name}.json`);
export const isValidSessionName = (name) => /^[A-Za-z0-9._-]+$/.test(String(name ?? '')) && name !== '.' && name !== '..';

export function listSessions() {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5));
}

export function readSession(name) {
  const file = sessionPath(name);
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { seed: data.seed, actions: Array.isArray(data.actions) ? data.actions : [] };
  } catch { return null; } // 写入中途的半个文件：让调用方下个轮询再试
}

export function writeSession(name, data) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(sessionPath(name), JSON.stringify(data, null, 2));
}

export { createNullPresenter, createRecordingPresenter };
