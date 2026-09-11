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
import { canUseSkill, makeSkillCtx, effectiveHandCount, chantActivationLegal } from '../src/core/skills/helpers.js';
import { getSkillDefinition } from '../src/core/skills/registry.js';
import { listNamedTerms } from '../src/core/skills/namedTerms.js';
import { getEffectDefinition, allEffects } from '../src/core/effects/registry.js';
import { getEnemyDefinition } from '../src/core/enemies/registry.js';
import { gatedPromotionTargets } from '../src/core/run/promotion.js';
import { getAbilityDefinition } from '../src/core/abilities/registry.js';
import { getRelicDefinition, allRelics } from '../src/core/relics/registry.js';
import { prepUseRelic, equipRelic, unequipRelic, grantRelic } from '../src/core/run/prep.js';
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
import {
  spinSlot, SLOT, slotView, takeSlotPrize, declineSlotPrize, slotUpgrade,
  devourSlot, devourableRelics, devourableCards,
} from '../src/core/run/rooms/slotMachine.js';
import { buyShopItem, takeShopCard } from '../src/core/run/rooms/shop.js';
import {
  bankView, bankDeposit, bankWithdraw, bankOverdraft, chooseDemonDebuff, bankUpgrade, bankBurn,
  pendingDebuffViews,
} from '../src/core/run/rooms/bank.js';
import {
  ensureGurpasStock, gurpasView, buyGurpas, takeGurpasCard, sellGurpasRelic, removeCardAtGurpas,
} from '../src/core/run/rooms/gurpas.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'tmp', 'playtests');

export const HELP = `动作表（按当前阶段）：
  战斗: play <手牌#> <卡名> [敌#] | play <卡名> [敌#] | swap <手牌#> <卡名> | swap <卡名>
        （弃1抽1，首次免费之后逐次+1） | end | auto
        in <候选#> <卡名>（应答输入请求） | lib（查牌库——抽牌严格按顺序，可预知未来抽到什么）
  奖励: pack <#|体修|火|通用> | take <候选#> <卡名> | take <卡名> | skip | next
  房间: act rest | act remi | act upgrade <构筑#> <卡名> | act up <构筑#> <卡名> | act draw
        | act take <候选#> <卡名> | act skipdraw | act skip | act play | next
        | act spin | act claim <#|id> [卡名] | act drop | act devour relic <id> | act devour card <构筑#>
        | act shop buy <#> | act shop claim <#|defId> [卡名]（售货机与房间并存，不消耗房间行动）
  预览: preview up <构筑#>（升阶前后对比，只读）
  进阶: dim 火|跳过（首次点亮火系：获赠点火+火弹术+体系能力「火灵脉」，再开种子九选三；
        跳过=体修等级+1：之后能抽到更高阶的体修卡牌） | reroll | ability <#|skip>
        | seed <#> <卡名>,<#> <卡名>,<#> <卡名>（选3张入组）
  通用: state | deck | lib | relics（遗物效果一览） | terms（词条/效果释义） | note <文本> | help
※ 打牌/选牌：**批处理里请只用卡名**（如 play 拳）——同名同态会直接取第一张，可用「拳#2」指定第几张。
  带编号的「编号+卡名」只在单次调用时可靠：**出牌（尤其带抽牌）后手牌编号会整体前移**，一次批处理里连用编号几乎必然错位。
※ 老虎机未中奖不产生产出：act spin 未中奖可直接再拉，不需要 claim/drop。
※ why <手牌#>|<卡名>（只读）：逐项定位「这张牌为什么打不出」——费用/充能冷却/咏唱压力/自定义条件/目标。
※ dev（**仅覆盖局用**，正常局不要用；用了必须在报告里标注）：dev relic <id> | dev relics <id,id,..>
   | dev listed（全部遗物 id + 效果） | dev money <n> | dev heal`;

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
  // 语义性意图（只有 unknown 一种 kind 且有说明）：直接显示说明，不套「未知（…）」
  if (it.kinds?.length === 1 && it.kinds[0] === 'unknown' && it.note) return it.note;
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
const stripChantTag = (s) => String(s ?? '').replace(/^咏唱[0-9]+·/, '');
const isIdxArg = (v) => /^[0-9]+$/.test(String(v ?? ''));
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
// 手牌定位（两种写法）：**「编号 + 卡名」双重确认**（推荐），或**只给卡名**（卡名唯一时自动定位）。
// 后者是为修「打出带抽牌的卡后手牌编号瞬移」这一高频摩擦（report-r1-A 缺陷#2）：
// 一次批处理里连打抽牌卡时编号会变，靠卡名定位就不会错位。
function resolveHandArg(list, idxOrName, nameArg, what = '手牌') {
  if (isIdxArg(idxOrName)) return resolveHandStrict(list, idxOrName, nameArg, what);
  if (idxOrName == null) {
    throw new Error(`缺少卡名：${what}支持「编号+卡名」或「卡名」（卡名唯一时自动定位）`);
  }
  // 「卡名#序号」：显式指定第几张同名卡（如 拳#2）
  const ordinal = /^(.+)#([0-9]+)$/.exec(String(idxOrName));
  const want = ordinal ? ordinal[1] : idxOrName;
  const hits = list.map((c, i) => ({ i, name: defOf(c).name })).filter(h => nameMatches(want, h.name));
  if (!hits.length) {
    throw new Error(`${what}里没有「${want}」。当前：${list.map(c => defOf(c).name).join(' / ') || '（空）'}`);
  }
  if (ordinal) {
    const k = Number.parseInt(ordinal[2], 10);
    if (k < 1 || k > hits.length) {
      throw new Error(`${what}里只有 ${hits.length} 张「${want}」（要的是第 ${k} 张，编号 ${hits.map(h => h.i + 1).join('/')}）`);
    }
    return hits[k - 1].i;
  }
  if (hits.length > 1) {
    // **同名同态 = 等价**（打哪张都一样）→ 直接取第一张，不再逼玩家回到会漂移的编号。
    // 状态不同（如一张已激活的咏唱与一张未激活的）才要求显式指定。
    const first = list[hits[0].i];
    const interchangeable = hits.every(h => list[h.i].defId === first.defId
      && !!list[h.i].isActivated === !!first.isActivated);
    if (interchangeable) return hits[0].i;
    throw new Error(`${what}里有 ${hits.length} 张「${want}」且状态不同（编号 ${hits.map(h => h.i + 1).join('/')}）`
      + `——请用「编号+卡名」或「${want}#序号」指定，如 play ${hits[0].i + 1} ${want}`);
  }
  return hits[0].i;
}

// play/swap 的手牌定位：优先「编号+卡名」双重确认；**编号与卡名不符时改按卡名定位**
// （卡名是不漂移的意图，编号会随抽牌前移——三轮试玩的第一高频摩擦）。
// 返回 { skill, note }；note 用于回执里说明发生过回落。
function pickHandCard(hand, idxOrName, nameArg, byIndex) {
  if (byIndex && nameArg != null) {
    try {
      return { skill: hand[resolveHandArg(hand, idxOrName, nameArg)], note: '' };
    } catch (err) {
      if (!/不是「/.test(err.message)) throw err;   // 越界/找不到卡等错误照常抛
      const i = resolveHandArg(hand, nameArg);
      return { skill: hand[i], note: `（编号 ${idxOrName} 与卡名不符，已按卡名定位到第 ${i + 1} 张）` };
    }
  }
  return { skill: hand[resolveHandArg(hand, idxOrName)], note: '' };
}

// 候选列表（元素数组）同款两种写法；只给名字时返回命中的**元素本身**
function resolveChoiceArg(choices, idxOrName, nameArg, what = '候选', nameOf = (x) => x) {
  if (isIdxArg(idxOrName)) return resolveChoiceStrict(choices, idxOrName, nameArg, what, nameOf);
  const hits = choices.map((c, i) => ({ c, name: nameOf(c) })).filter(h => nameMatches(idxOrName, h.name));
  if (!hits.length) {
    throw new Error(`${what}里没有「${idxOrName}」。当前：${choices.map(c => nameOf(c)).join(' / ')}`);
  }
  if (hits.length > 1) {
    throw new Error(`${what}里有 ${hits.length} 个「${idxOrName}」——请用「编号+名称」指定`);
  }
  return hits[0].c;
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
  // 终局复盘快照（report-r1-A 缺陷#9）：死时手牌 + 敌人剩余。必须在 S.battle 置空前取。
  {
    const bs = S.battle.battleState;
    S.lastBattleTail = {
      hand: bs.zones.hand.map((c) => defOf(c).name),
      enemies: bs.enemies.map((e) => ({
        name: e.name, hp: Math.max(0, e.hp), maxHp: e.maxHp, dead: e.isDead(),
      })),
    };
  }
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

// 老虎机产出候选定位：编号 → 候选 id；名字 → 候选 id（唯一时）；已是 id 则原样返回
function resolveSlotClaimArg(pending, raw) {
  if (raw == null) return null;
  const list = pending.choices?.length ? pending.choices
    : pending.relicChoices?.length ? pending.relicChoices : null;
  if (!list) return raw;
  if (isIdxArg(raw)) return list[idxOk(num(raw), list.length, '产出候选')].id;
  const byId = list.find(e => e.id === raw);
  if (byId) return byId.id;
  return resolveChoiceArg(list, raw, undefined, '产出候选', e => e.name).id;
}

// 老虎机/事件结果的中文呈现（内部 id → 名称）
function slotResultText(p) {
  if (!p) return '（无）';
  const head = p.tier === 'major' ? '★大奖 ' : (p.tier === 'none' ? '' : '小奖 ');
  const body = p.money != null ? `金币+${p.money}`
    : p.healPct != null ? `恢复${Math.round(p.healPct * 100)}%生命`
      : p.fullRestore ? '全状态恢复'
        : p.special ? `特殊物品：${p.special}`
          : p.relicChoices?.length ? `三选一A级遗物：${p.relicChoices.map(r => `${r.name}(${r.id})`).join(' / ')}`
            : p.relicId ? `遗物：${p.relicId}`
              : p.upgradeCopyId ? `升级后复制品：${p.upgradeCopyId}`
                : p.upgrade?.kind === 'random' ? `随机升级${p.upgrade.count}张`
                  : p.upgrade?.kind === 'free' ? '免费指定升级一张卡'
                    : p.choices?.length ? `卡${p.choices.length}选1：${p.choices.map(c => `${c.name}(${c.id})`).join(' / ')}`
                      : p.kind;
  return head + body;
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
    case 'why': { // 只读：逐项定位「这张牌为什么打不出」（第 3 轮试玩：只能逐张试，失败一次浪费一个动作）
      if (stage !== 'battle' || !S.battle) throw new Error('why 仅在战斗内可用（看手牌为什么打不出）');
      const bs = S.battle.battleState;
      const hand = bs.zones.hand;
      if (!hand.length) throw new Error('手牌为空');
      const rt = hand[resolveHandArg(hand, a, isIdxArg(a) ? b : undefined)];
      const def = defOf(rt);
      const pl = run.player;
      const freeToggle = def.cardMode === 'chant' && rt.isActivated;
      const manaCost = def.cost?.mana ?? 0;
      const apCost = def.cost?.actionPoint ?? 0;
      const ok = canUseSkill(S.battle.ctx, rt);
      const L = [`【为什么】${def.name}（${def.tier ?? '?'}阶，${ok ? '可用 ✓' : '不可用 ✗'}）`];
      L.push(`  费用: 魏启 ${manaCost === 'X' ? 'X(全部)' : manaCost}（有 ${pl.mana}）`
        + `｜AP ${apCost === 'X' ? 'X(全部)' : apCost}（有 ${pl.actionPoints}）`
        + (freeToggle ? '｜已激活咏唱：本次免费' : ''));
      // 冷却只在「充能耗尽」时才是阻塞原因（满充能卡预置的计时是无意义残留，不展示，免误导）
      L.push(`  充能: 剩余 ${rt.remainingUses}`
        + (rt.remainingUses <= 0 && rt.currentCooldown > 0 ? `，冷却剩 ${rt.currentCooldown} 拍` : ''));
      if (def.cardMode === 'chant') {
        L.push(`  咏唱: ${rt.isActivated ? '已激活' : '未激活'}｜加权手牌 ${effectiveHandCount(bs)} / 上限 ${pl.maxHandSize}`);
      }
      const reasons = [];
      if (rt.remainingUses <= 0) reasons.push('充能耗尽（冷却中）');
      if (def.cardMode === 'chant' && rt.isActivated && def.keywords?.includes('anchored')) reasons.push('锁定：不可主动解除');
      if (def.cardMode === 'chant' && !rt.isActivated && !chantActivationLegal(S.battle.ctx, rt, def)) {
        reasons.push(`激活后手牌压力超限（加权会变成 >${pl.maxHandSize}）`);
      }
      if (def.canUse && !def.canUse(makeSkillCtx(S.battle.ctx, rt))) reasons.push('卡面自定义条件不满足（卡面「不可用」条件）');
      if (!freeToggle && manaCost !== 'X' && pl.mana < manaCost) reasons.push(`魏启不足（需 ${manaCost}，有 ${pl.mana}）`);
      if (!freeToggle && apCost !== 'X' && pl.actionPoints < apCost) reasons.push(`AP 不足（需 ${apCost}，有 ${pl.actionPoints}）`);
      if (def.targetMode === 'enemy' && !bs.enemies.some(e => !e.isDead())) reasons.push('需要敌方目标，但场上无存活敌人');
      L.push(reasons.length ? `  → 原因: ${reasons.join('；')}`
        : (ok ? '  → 逐项检查都通过，可以直接打出' : '  → 常见原因都不成立：可能是能力/已激活咏唱卡的放行钩子未覆盖'));
      S.lastOutcome = L.join('\n');
      return;
    }
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
      const byIndex = isIdxArg(a);
      const { skill, note } = pickHandCard(hand, a, b, byIndex);
      const name = defOf(skill).name; // 先取名字：结算内斩等转化会就地改写 defId
      const targetArg = byIndex ? t[3] : b; // 只给卡名的写法里，第二个参数就是目标
      const target = targetArg != null
        ? battle.battleState.enemies[idxOk(num(targetArg), battle.battleState.enemies.length, '敌人')] : null;
      // 指定目标已死：引擎会回落到首个存活敌人（cardKit.enemyTarget）——静默改打很坑，明确告知
      const deadTargetNote = target?.isDead() ? `（指定目标「${target.name}」已死，实际打向首个存活敌人）` : '';
      if (!playerUseSkill(battle, skill.uniqueID, target?.uniqueID ?? null)) throw new Error('无法打出（费用/条件不满足）');
      S.lastOutcome = `打出 ${name}${note}${deadTargetNote}`;
      if (isBattleFinished(battle)) settleBattle(S);
      return;
    }
    case 'swap': {
      const battle = ensureBattle(S);
      const hand = battle.battleState.zones.hand;
      if (!hand.length) throw new Error('手牌为空，无法换牌');
      const { skill, note } = pickHandCard(hand, a, b, isIdxArg(a));
      if (!playerSwapCard(battle, skill.uniqueID)) throw new Error('无法换牌（行动点不足？）');
      S.lastOutcome = `换牌 ${defOf(skill).name}${note}`;
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
        const min = request.min ?? request.count ?? 1;
        const max = request.max ?? request.count ?? 1;
        // 卡牌集里的卡可能来自任何区（手牌/牌库/焚毁…）：建 uniqueID → runtime 表用于卡名双重确认
        const byId = new Map();
        for (const z of ['hand', 'deck', 'burnt', 'pending']) {
          for (const c of battle.battleState.zones[z]) byId.set(c.uniqueID, c);
        }
        const rest = t.slice(1);
        // 支持两种写法：重复的「编号 卡名」对（推荐）或纯编号列表（in 1 3 5）
        const picks = [];
        for (let k = 0; k < rest.length; k++) {
          if (!isIdxArg(rest[k])) throw new Error('候选只能用编号：in <候选#> [卡名] ...（候选名见待输入列表）');
          const next = rest[k + 1];
          const hasName = next != null && !isIdxArg(next);
          picks.push({ idxArg: rest[k], nameArg: hasName ? next : undefined });
          if (hasName) k += 1;
        }
        if (picks.length < min || picks.length > max) {
          throw new Error(`本次要选 ${min === max ? `${min}` : `${min}~${max}`} 张，你给了 ${picks.length} 张`);
        }
        const ids = picks.map(({ idxArg, nameArg }) => {
          const i = idxOk(num(idxArg), cands.length, '候选');
          const id = cands[i];
          if (nameArg != null) {
            const card = byId.get(id);
            const actual = card ? defOf(card).name : id;
            if (!nameMatches(nameArg, actual)) {
              throw new Error(`候选第${idxArg}个是「${actual}」，不是「${nameArg}」——请对照待输入列表重试`);
            }
          }
          return id;
        });
        if (new Set(ids).size !== ids.length) throw new Error('同一张候选不能选两次');
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
      // 摘要：auto 之前只打印整屏新状态，看不出打了多久、打成什么样（report-r1-A 缺陷#4）
      const rounds = battle.battleState.turn.count;
      const foeLeft = battle.battleState.enemies.filter(e => !e.isDead());
      const hp0 = S.run.player.hp;
      const hpMax = S.run.player.maxHp;
      settleBattle(S);
      S.lastOutcome = (S.lastOutcome ?? '') + ` ｜ auto：${rounds} 回合，结束 HP ${hp0}/${hpMax}`
        + (foeLeft.length ? `，残留敌人 ${foeLeft.map(e => `${e.name}(${e.hp}血)`).join(' ')}` : '，已清场');
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
      const defId = resolveChoiceArg(choices, a, b, '候选',
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
      // 售货机与房间**并存**：不消耗房间行动，也不受"房间动作已完成"限制
      if (a === 'shop') {
        // 售货机（与房间并存，不消耗房间行动）：buy <#> 购买 / claim <id> 卡包三选一
        if (!run.shop) throw new Error('本层没有售货机（只在 4/8、15/19、25/29、36/40 层出现）');
        if (b === 'buy') {
          const idx = num(t[3]);
          const it = run.shop.items[idx];
          const res = buyShopItem(run, idx);
          S.lastOutcome = `购买「${it.label}」(-${it.price}金币)：${JSON.stringify(res)}`
            + (res.kind === 'pack' ? '（用 act shop claim <#> 选卡，候选见状态）' : '')
            + (res.kind === 'relic' ? `（槽位式需 relic equip ${res.relicId} 才生效；非槽位式拾起即生效）` : '');
          return;
        }
        if (b === 'claim') {
          if (!run.shopPending) throw new Error('当前没有待选的卡包');
          // 候选表刚生成、期间不会漂移：给编号即选；也可用卡名（唯一时）定位
          const raw = t[3];
          const defId = run.shopPending.choices.includes(raw) ? raw // 兼容历史 defId 记法（可全量重放）
            : isIdxArg(raw)
              ? run.shopPending.choices[idxOk(num(raw), run.shopPending.choices.length, '卡包候选')]
              : resolveChoiceArg(run.shopPending.choices, raw, t[4], '卡包候选',
                id => getSkillDefinition(id)?.name ?? id);
          takeShopCard(run, defId);
          S.lastOutcome = `卡包开封：${getSkillDefinition(defId)?.name ?? defId} 已入组`;
          return;
        }
        throw new Error('售货机动作：act shop buy <#> / act shop claim <#|defId> [卡名]（离开用 next）');
      }
      const room = run.currentRoom;
      const merged = room === 'campTraining';
      // 合并房（营地·训练场）：两个部分各自一次、互不阻塞，随时可 next 离房
      const campUsed = merged ? !!run.roomData?.campUsed : !!S.roomDone;
      const trainDone = merged ? !!run.roomData?.trained : !!S.roomDone;
      // 合并房按**动作名**分流（营地动作 / 训练动作各一套），避免落到对方的报错分支
      const goCamp = room === 'camp' || (merged && ['rest', 'remi', 'upgrade'].includes(a));
      const goTraining = room === 'training' || (merged && ['up', 'draw', 'take', 'skipdraw', 'skip'].includes(a));
      if (S.roomDone && !merged) throw new Error('本房间动作已完成，用 next 离开');
      if (goCamp) {
        if (campUsed) throw new Error('本房的营地动作已经用过了（合并房里训练部分仍可用）');
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
          S.lastOutcome = `升级：${before} → ${defOf(card).name}（营地）`;
          return;
        }
        throw new Error('营地动作：act rest | act remi | act upgrade <构筑#> <卡名>');
      }
      if (goTraining) {
        if (trainDone) throw new Error('本房的训练已经完成了（合并房里营地部分仍可用）');
        if (a === 'up') {
          const card = run.player.deck[resolveHandStrict(run.player.deck, b, t[3], '构筑卡')];
          const gateErr = upgradeGateError(run, card);
          if (gateErr) throw new Error(gateErr);
          const before = defOf(card).name;
          trainUpgrade(run, card.uniqueID);
          S.lastOutcome = `升级：${before} → ${defOf(card).name}（训练场，接下来强制三选一抓牌）`;
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
      if (merged) {
        throw new Error('合并房动作（营地）：act rest | act remi | act upgrade <构筑#> <卡名>'
          + '｜（训练）：act up <构筑#> <卡名> | act draw | act take <#> | act skipdraw | act skip'
          + '｜离开：next');
      }
      if (room === 'gurpas') {
        // 古尔帕斯之店（35 层固定房）：buy <#> / claim <#|defId> / sell <遗物id> / remove <构筑#> <卡名>
        if (b === 'buy') {
          const idx = num(t[3]);
          const it = ensureGurpasStock(run).items[idx];
          if (!it) throw new Error(`货架上没有这一件：${idx}`);
          const res = buyGurpas(run, idx);
          S.lastOutcome = `购买「${it.label}」(-${it.price}金)：${JSON.stringify(res)}`
            + (res.kind === 'pack' ? '（用 act gurpas claim <#> 选卡）' : '');
          return;
        }
        if (b === 'claim') {
          const v = gurpasView(run);
          if (!v.pendingPack) throw new Error('当前没有待选的卡包');
          // 候选刚生成、不会漂移：给编号即选（与 act shop claim 同口径）；也可用卡名定位
          const raw = t[3];
          const defId = isIdxArg(raw)
            ? v.pendingPack.choices[idxOk(num(raw), v.pendingPack.choices.length, '卡包候选')]
            : resolveChoiceArg(v.pendingPack.choices, raw, t[4], '卡包候选',
              id => getSkillDefinition(id)?.name ?? id);
          takeGurpasCard(run, defId);
          S.lastOutcome = `卡包开封：${getSkillDefinition(defId)?.name ?? defId} 已入组`;
          return;
        }
        if (b === 'sell') {
          const out = sellGurpasRelic(run, t[3]);
          S.lastOutcome = `她收下了「${out.name}」(+${out.price}金) → 持有 ${run.player.money}`;
          return;
        }
        if (b === 'remove') {
          const card = run.player.deck[resolveHandStrict(run.player.deck, t[3], t[4], '构筑卡')];
          const name = removeCardAtGurpas(run, card.uniqueID);
          S.lastOutcome = `删卡服务：${name} 已从牌库彻底抹掉`;
          return;
        }
        throw new Error('古尔帕斯之店动作：act gurpas buy <#> | claim <#|defId> [卡名]'
          + ' | sell <遗物id> | remove <构筑#> <卡名>（离开用 next）');
      }
      if (room === 'slot') {
        // 拉一次杆：产出会挂起（文档：产出总是可以放弃）→ 需 claim/drop 处理
        if (a === 'spin') {
          const view = slotView(run);
          const p = spinSlot(run);
          S.lastOutcome = `老虎机(-${p.cost}金币)：${p.tier === 'none' ? '未中奖（无产出，可直接再 act spin）' : slotResultText(p)}`
            + (p.tier === 'none' ? '' : '（用 act claim <#|id> 领取 / act drop 放弃）');
          void view;
          return;
        }
        if (a === 'claim') {
          if (!run.slotPending) { S.lastOutcome = '本次未中奖，没有待领取的产出（无需处理）'; return; }
          const out = takeSlotPrize(run, resolveSlotClaimArg(run.slotPending ?? {}, b ?? null));
          S.lastOutcome = `领取产出：${JSON.stringify(out)}`
            + (out.needsCardPick ? '（用 act upgrade <构筑#> <卡名> 指定要升级的卡）' : '');
          return;
        }
        if (a === 'drop') {
          if (!run.slotPending) { S.lastOutcome = '本次未中奖，没有待放弃的产出（无需处理）'; return; }
          declineSlotPrize(run); S.lastOutcome = '放弃产出'; return;
        }
        if (a === 'upgrade') {
          // 大奖「免费指定升级」的落地（与营地/训练场同一套 <构筑#> <卡名> 记法）
          const card = run.player.deck[resolveHandStrict(run.player.deck, b, t[3], '构筑卡')];
          const before = defOf(card).name;
          const out = slotUpgrade(run, card.uniqueID);
          S.lastOutcome = `免费指定升级：${before} → ${out.defId}`;
          return;
        }
        if (a === 'devour') {
          const arg = t[3] ?? null;
          const res = devourSlot(run, b === 'relic'
            ? { kind: 'relic', relicId: arg }
            : { kind: 'card', uniqueID: num(arg) });
          S.lastOutcome = `吞噬${b}：+${res.gold}金币${res.freeRoll ? '（下次 roll 免费）' : ''}`;
          return;
        }
        if (a === 'bank') {
          // 银行机（与老虎机成对出现）：deposit [n] / withdraw / overdraft <档> / pick <词条id>
          // / upgrade <构筑#> <卡名>（词条的立即升级）/ burn <构筑#> <卡名>（词条的自选焚毁）
          const sub = b;
          if (sub === 'deposit') {
            const amt = t[3] != null ? num(t[3]) : null;
            const v = bankDeposit(run, amt);
            S.lastOutcome = `存款 ${amt ?? '（全部）'} → 存款 ${v.deposit} 金（连击 ${v.combo}）`;
            return;
          }
          if (sub === 'withdraw') {
            const { gold, view } = bankWithdraw(run);
            S.lastOutcome = `取款 +${gold} 金 → 持有 ${view.money}（连击清零）`;
            return;
          }
          if (sub === 'overdraft') {
            const v = bankOverdraft(run, t[3]);
            S.lastOutcome = `超额取款(${t[3]}) 到手 ${v.pendingRoll.gold} 金｜候选词条：`
              + v.pendingRoll.options.map(o => `${o.name}[${o.id}]`).join(' / ') + '（用 act bank pick <id> 选一个）';
            return;
          }
          if (sub === 'pick') {
            const out = chooseDemonDebuff(run, t[3]);
            S.lastOutcome = `承受恶魔词条「${out.name}」`
              + (out.battle ? `（未来 ${out.battle.battles} 场战斗生效）` : '（立即生效）');
            return;
          }
          if (sub === 'upgrade') {
            const card = run.player.deck[resolveHandStrict(run.player.deck, t[3], t[4], '构筑卡')];
            const before = defOf(card).name;
            bankUpgrade(run, card.uniqueID);
            S.lastOutcome = `词条附赠升级：${before} → ${defOf(card).name}`;
            return;
          }
          if (sub === 'burn') {
            const card = run.player.deck[resolveHandStrict(run.player.deck, t[3], t[4], '构筑卡')];
            const name = bankBurn(run, card.uniqueID);
            S.lastOutcome = `词条附赠焚毁：${name} 已移出牌库`;
            return;
          }
          throw new Error('银行机动作：act bank deposit [金额] | withdraw | overdraft <yellow|red|black>'
            + ' | pick <词条id> | upgrade <构筑#> <卡名> | burn <构筑#> <卡名>');
        }
        if (a === 'skip') { // 不拉杆直接走：老虎机期望为负时这是最高频操作，不该逼玩家换用 next
          completeRoom(run); S.roomDone = false;
          S.lastOutcome = '跳过老虎机（未拉杆）离开房间';
          return;
        }
        throw new Error('老虎机动作：act spin / act claim <#|id> / act drop / act devour relic <遗物id>'
          + ' / act devour card <构筑#>｜不拉杆离开用 act skip（或 next）');
      }
      if (room === 'event') {
        if (a === 'play') {
          const r = playEvent(run);
          S.roomDone = true;
          S.lastOutcome = `事件：${eventResultText(r)}`;
          return;
        }
        if (a === 'skip') { // 不想触发事件时直接离开（与老虎机同口径）
          completeRoom(run); S.roomDone = false;
          S.lastOutcome = '跳过事件（未触发）离开房间';
          return;
        }
        throw new Error('事件动作：act play 触发事件｜不想触发就用 act skip（或 next）离开');
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

    // ---- dev：覆盖局专用（受试内容在早期拿不到时的取样手段）----
    // 这些动作**照常入档**，所以重放模型不受影响；但它们绕过正常的获取流程，
    // 用它们打的对局必须在报告里标注为「覆盖局」，其平衡感受不可与正常局混同。
    case 'dev': {
      const what = a;
      const battleOk = what === 'money' || what === 'heal'; // 覆盖局保命用，战斗内也放行
      if (!battleOk && stage !== 'prep' && stage !== 'room') {
        throw new Error(`dev ${what ?? ''} 仅在战前准备/奖励房可用（当前：${stageCn(stage)}）；`
          + '战斗内只放行 dev money / dev heal（取物要等下一场才生效）');
      }
      if (battleOk && stage === 'end') throw new Error('本局已终局，dev 无效');
      if (what === 'relic') {
        const id = b;
        if (!getRelicDefinition(id)) throw new Error(`没有这个遗物 id：${id}（dev listed 看全部 id）`);
        if ((run.player.relics ?? []).includes(id)) { S.lastOutcome = `已经拥有 ${id}`; return; }
        grantRelic(run, id);
        const d = getRelicDefinition(id);
        S.lastOutcome = `[dev] 获得遗物 ${d.name}（${d.rarity}${d.nonSlot ? '·非槽位式' : `·${d.cost ?? 1}槽`}）`
          + (d.nonSlot ? '——拾起即生效' : '——需 relic equip 才生效');
        return;
      }
      if (what === 'relics') {
        const ids = String(b ?? '').split(',').map(x => x.trim()).filter(Boolean);
        if (!ids.length) throw new Error('用法：dev relics <id1,id2,...>（dev listed 看全部 id）');
        const bad = ids.filter(id => !getRelicDefinition(id));
        if (bad.length) throw new Error(`不存在的遗物 id：${bad.join(' ')}（dev listed 看全部）`);
        const added = [];
        for (const id of ids) {
          if ((run.player.relics ?? []).includes(id)) continue;
          grantRelic(run, id);
          added.push(getRelicDefinition(id).name);
        }
        S.lastOutcome = `[dev] 获得遗物 ${added.join('、') || '（都已拥有）'}`;
        return;
      }
      if (what === 'listed') {          // dev listed：列出全部遗物 id 与效果（等价 relics 视图 + id）
        const L = ['【dev 遗物 id 名单】按 id 发给自己：dev relic <id> 或 dev relics <id,id,...>'];
        for (const d of allRelics()) {
          const gate = d.requires ? `［需${d.requires.leino ? `灵脉${d.requires.leino}≥${d.requires.min}` : '任意灵脉≥1'}］` : '';
          L.push(`  ${d.id} = ${d.name}（${d.rarity}${d.nonSlot ? '·非槽位式' : `·${d.cost ?? 1}槽`}）${gate} ${plain(d.description ?? '')}`);
        }
        S.lastOutcome = L.join('\n');
        return;
      }
      if (what === 'money') {
        const n = num(b);
        if (!Number.isInteger(n) || n <= 0) throw new Error('用法：dev money <正整数>');
        run.player.money += n;
        S.lastOutcome = `[dev] 金币 +${n} → ${run.player.money}`;
        return;
      }
      if (what === 'heal') {
        run.player.hp = run.player.maxHp;
        run.player.mana = run.player.maxMana;
        S.lastOutcome = `[dev] 生命/魏启回满（HP ${run.player.hp}/${run.player.maxHp}）`;
        return;
      }
      throw new Error('dev 子命令：relic <id> | relics <id,id,...> | listed | money <n> | heal');
    }

    // ---- 遗物：装卸与主动使用（核心 API 见 run/prep.js）----
    // 装卸在 prep 与奖励房都允许：奖励房（含商店）仍在下一场战斗之前，买完就能装上，
    // 不必等下一层 prep 再回头装（第 2 轮试玩反馈：忘了装 = 整场白买）。主动 use 仍限 prep。
    case 'relic': {
      const sub = a, id = b;
      const equipish = sub === 'equip' || sub === 'unequip' || !sub;
      if (!(stage === 'prep' || (stage === 'room' && equipish))) {
        throw new Error(`遗物装卸仅能在战前准备/奖励房阶段（当前：${stageCn(stage)}）；主动使用仅限战前准备`);
      }
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
  const apNote = p.actionPoints > p.maxActionPoints
    ? `（+${p.actionPoints - p.maxActionPoints} 来自本回合临时加成，非上限）` : '';
  L.push(`玩家: HP ${p.hp}/${p.maxHp} 护盾${p.shield} 魏启 ${p.mana}/${p.maxMana} AP ${p.actionPoints}/${p.maxActionPoints}${apNote} 金币 ${p.money} | 灵脉 火${p.leino.fire} 体修${p.bodyLevel ?? 0} | 训练 ${p.trainingCount} 进阶 ${p.ascensionCount}/${ASCENSION_PLACEHOLDER.maxAscensions}`);
  if (p.effects?.length) L.push(`玩家效果: ${effectsText(p)}`);
  if (p.abilities.length) L.push(`能力: ${p.abilities.join(' ')}`);
  // 遗物：背包全量 + 槽位占用（槽位是**权重和**口径 Σcost ≤ relicSlots；非槽位式恒生效、不需装备）
  if (p.relics?.length) {
    const cost = (id) => { const d = getRelicDefinition(id); return d?.nonSlot ? 0 : (d?.cost ?? 1); };
    const used = (p.equippedRelics ?? []).reduce((n, id) => n + cost(id), 0);
    L.push(`遗物槽位 ${used}/${p.relicSlots}：`
      + p.relics.map((id) => {
        const d = getRelicDefinition(id);
        const tags = [d?.rarity ?? 'C', d?.nonSlot ? '非槽位式' : `${cost(id)}槽`];
        if ((p.equippedRelics ?? []).includes(id)) tags.push('已装备');
        return `${d?.name ?? id}(${tags.join('·')})`;
      }).join(' / '));
    L.push('  → relic equip|unequip <遗物id>（仅 prep；非槽位式不用装备）｜ relics 查看全部遗物效果说明');
  }

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
      const lo = pi.min ?? pi.count ?? 1;
      const hi = pi.max ?? pi.count ?? 1;
      const need = lo === hi ? `选 ${lo} 张` : `选 ${lo}~${hi} 张`;
      L.push(`▶ 待输入: ${pi.reason ?? pi.prompt ?? pi.kind}${pi.kind === 'confirm' ? '' : `（${need}）`}`);
      if (pi.candidates?.length) {
        const byId = new Map();
        for (const z of ['hand', 'deck', 'burnt', 'pending']) for (const c of bs.zones[z]) byId.set(c.uniqueID, c);
        L.push(`  候选（来源 ${pi.source ?? '?'}，共 ${pi.candidates.length} 张）: `
          + pi.candidates.map((id, i) => `[${i + 1}] ${byId.has(id) ? defOf(byId.get(id)).name : id}`).join(' '));
      }
    }
    L.push(`→ play <手牌#> <卡名> [敌#] / swap <手牌#> <卡名>（弃1抽1，费${swapCostOf(bs)}AP） / end`
      + ` / in <候选#> [卡名] …（多选就重复写，如 in 1 拳 3 盾） / why <手牌#> / lib 看牌库`);
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
    L.push(S.roomDone
      ? '状态：本房间动作已完成 → next 离开（售货机不受限，仍可 act shop buy）'
      : '状态：房间动作未完成（可选动作见下）');
    // 售货机与房间**并存**（不占房间名额）：任何房间都可能同层有货架
    if (run.shop) {
      const disc = run.shop.discount < 1 ? `（${Math.round(run.shop.discount * 10)} 折）` : '';
      L.push(`自动售货机${disc}｜持有 ${p.money} 金币：`);
      if (run.shop.broken) L.push('  瑞米：“上次逃得太狼狈了……忘记补货了……”');
      run.shop.items.forEach((it, i) => L.push(`  [${i}] ${it.label} — ${it.price} 金`
        + (it.sub ? `｜${plain(it.sub)}` : '') + (it.sold ? '（已售出）' : '')));
      if (run.shopPending) {
        L.push('  卡包待选:');
        run.shopPending.choices.forEach((id, i) => {
          const def = getSkillDefinition(id);
          L.push(`    [${i + 1}] ${def?.tier ?? '?'}阶 ${def?.name ?? id}「${plain(def?.describe?.() ?? '')}」`);
        });
        L.push('  → act shop claim <#|defId> [卡名]');
      } else {
        L.push('  → act shop buy <#> 购买（离开房间不清货架，买光不补）');
      }
    }
    if (S.roomDone) {
      // 状态行已在段首统一给出（report-r1-A 缺陷#8：避免有的房间给提示、有的不给）
    } else if (room === 'camp' || room === 'training' || room === 'campTraining') {
      // 营地部分与训练部分各自一段；合并房（campTraining）两段都渲染
      const renderCamp = () => {
        const optCn = { recoverRemi: '找回瑞米(remi)', rest: '休整(rest)', upgrade: '升级(upgrade)' };
        L.push(`营地。可用: ${campOptions(run).map(o => optCn[o] ?? o).join(' / ')}`
          + `（act rest | act remi | act upgrade <构筑#> <卡名>——先 preview up <#> 看升阶对比）`);
      };
      const renderTraining = () => {
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
      };
      if (room !== 'training') {
        if (run.roomData?.campUsed) L.push('营地部分：已用过（每房一次）');
        else renderCamp();
      }
      if (room !== 'camp') {
        if (run.roomData?.trained) L.push('训练部分：已完成（每房一次）');
        else renderTraining();
      }
      if (room === 'campTraining') {
        L.push(run.roomData?.forced
          ? '（升级强绑抓牌未领：必须 act take <#>）'
          : '（营地与训练各自可做一次，随时 next 离开）');
      }
    } else if (room === 'slot') {
      const v = slotView(run);
      L.push(`老虎机：本次单价 ${v.cost} 金币（每抽 +${SLOT.costStep}）｜持有 ${p.money}`
        + (v.freeRolls ? `｜免费 ${v.freeRolls} 次` : '')
        + `｜小奖 ${Math.round(v.minorChance * 100)}% 大奖 ${Math.round(v.majorChance * 100)}%（未中累加）`);
      L.push(`吞噬进度 ${v.devourProgress}/${v.devourEvery}${v.devourReady ? '（可吞噬）：act devour relic <遗物id> / act devour card <构筑#>' : ''}`);
      // 银行机（与老虎机成对出现）
      {
        const bk = bankView(run);
        L.push(`🏦 银行机：存款 ${bk.deposit} 金 ｜ 连击 ${bk.combo} ｜ 每层利率 每 ${bk.ratePer} 金产 ${bk.rateYield} 金`
          + (bk.deposit > 0 ? `（再攒一层 +${bk.nextInterest}）` : ''));
        const pend = pendingDebuffViews(run);
        if (pend.length) L.push(`  身负恶魔词条：${pend.map(d => `${d.name}(剩${d.battlesLeft}场)`).join('、')}`);
        if (bk.pendingRoll) {
          L.push(`  恶魔 roll（${bk.pendingRoll.tier} 档，已入账 ${bk.pendingRoll.gold} 金）——必须选一个：`);
          for (const o of bk.pendingRoll.options) L.push(`    ${o.name}[${o.id}]：${o.desc}`);
          L.push('  → act bank pick <词条id>');
        } else {
          const acts = [];
          if (bk.money > 0) acts.push('act bank deposit [金额]');
          if (bk.deposit > 0) acts.push('act bank withdraw');
          if (bk.canOverdraft) acts.push('act bank overdraft <yellow|red|black>');
          else if (bk.lockout > 0) L.push(`  （通过黑色级后，银行机再过 ${bk.lockout} 次见面才允许超额取款）`);
          if (acts.length) L.push(`  → ${acts.join(' | ')}`);
        }
        for (const offer of bk.offers) {
          L.push(offer === 'upgrade'
            ? '  → act bank upgrade <构筑#> <卡名>（词条附赠：立即免费升级一张）'
            : '  → act bank burn <构筑#> <卡名>（词条附赠：自选焚毁一张）');
        }
      }
      if (run.slotPending) {
        L.push(`待处理产出：${slotResultText(run.slotPending)}`);
        const pd = run.slotPending;
        if (pd.choices?.length) {
          L.push('  候选卡:');
          pd.choices.forEach((c, i) => {
            const def = getSkillDefinition(c.id);
            L.push(`    [${i + 1}] ${def?.tier ?? '?'}阶 ${c.name}「${plain(def?.describe?.() ?? '')}」`);
          });
          L.push('  → act claim <#>（编号或卡名）');
        } else if (pd.relicChoices?.length) {
          L.push('  候选遗物:');
          pd.relicChoices.forEach((r, i) => {
            L.push(`    [${i + 1}] ${r.name}：${plain(getRelicDefinition(r.id)?.description ?? '')}`);
          });
          L.push('  → act claim <#>（编号或遗物名）');
        }
        else if (pd.upgrade?.kind === 'free' || run.slotUpgradePending) L.push('  → act upgrade <构筑#> <卡名>（指定要升级的卡）');
        else L.push('  → act claim 领取 / act drop 放弃');
      } else {
        L.push('→ act spin 拉杆（产出可放弃）/ next 离开');
      }
    } else if (room === 'gurpas') {
      const g = gurpasView(run);
      L.push(`古尔帕斯之店（持有 ${g.money} 金币）——她只收 A/S 级遗物，货架买光不补：`);
      g.items.forEach((it, i) => L.push(`  [${i}] ${it.label} — ${it.price} 金`
        + (it.sub ? `｜${plain(it.sub)}` : '') + (it.sold ? '（已售出）' : '')
        + (it.kind === 'remove' ? `（本次已用 ${it.used ?? 0}/2）` : '')));
      if (g.pendingPack) {
        L.push('  卡包待选:');
        g.pendingPack.choices.forEach((id, i) => {
          const def = getSkillDefinition(id);
          L.push(`    [${i + 1}] ${def?.tier ?? '?'}阶 ${def?.name ?? id}「${plain(def?.describe?.() ?? '')}」`);
        });
        L.push('  → act gurpas claim <#|defId> [卡名]');
      } else {
        L.push('  → act gurpas buy <#>｜act gurpas remove <构筑#> <卡名>（删卡服务）');
      }
      if (g.sellable.length) {
        L.push('  收购（A/S）：' + g.sellable.map(x => `${x.name}(${x.rarity},+${x.price}金)`).join(' / '));
        L.push('  → act gurpas sell <遗物id>');
      } else {
        L.push('  （身上没有她收的 A/S 级遗物）');
      }
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
    {
      // 未装备遗物显式提醒（买/抽到忘装 = 整场不生效，第 2 轮试玩点名的最大摩擦点）
      const costOf = (id) => { const d = getRelicDefinition(id); return d?.nonSlot ? 0 : (d?.cost ?? 1); };
      const unequipped = (p.relics ?? []).filter(
        id => !(p.equippedRelics ?? []).includes(id) && !getRelicDefinition(id)?.nonSlot);
      const free = p.relicSlots - (p.equippedRelics ?? []).reduce((n, id) => n + costOf(id), 0);
      if (unequipped.length) {
        const fits = unequipped.filter(id => costOf(id) <= free);
        const shown = unequipped.slice(0, 6).map(id => `${getRelicDefinition(id)?.name ?? id}(${costOf(id)}槽)`);
        const tail = unequipped.length > shown.length ? ` 等 ${unequipped.length} 件` : '';
        L.push(`⚠ 有 ${unequipped.length} 件遗物未装备（空槽 ${free} 点）：${shown.join(' / ')}${tail}`);
        L.push(fits.length
          ? `  → 可装：${fits.slice(0, 4).map(id => `relic equip ${id}`).join(' / ')}（不装本场不生效）`
          : `  → 空槽不足（未装备的都要 ${Math.min(...unequipped.map(costOf))} 点以上）：先 relic unequip <遗物id> 腾槽`);
      }
    }
    L.push(`→ fight 开战 / deck 看牌组`);
  } else if (stage === 'end') {
    L.push(`本局结束：${run.result === 'victory' ? '登顶成功' : '战败'}。感谢游玩！`);
    const tail = S.lastBattleTail;
    if (tail) {
      L.push(`终局快照 · 死时手牌: ${tail.hand.length ? tail.hand.join(' / ') : '（空）'}`);
      L.push(`终局快照 · 敌人: ${tail.enemies.map((e) => `${e.name} ${e.dead ? '已死' : `${e.hp}/${e.maxHp}血`}`).join(' | ') || '（无）'}`);
    }
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
    return '【牌库】lib 只在战斗内有意义（战斗中才能预知下一张抽到什么）。'
      + '当前非战斗阶段——你看到的是静态构筑，抽牌顺序要等开战才有；用 deck 查构筑。';
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

// 遗物一览（只读）：拥有的全部遗物 + 效果文本 + 槽位占用（report-r1-A 缺陷#7）
export function renderRelics(S) {
  const run = S.run;
  const p = run.player;
  const cost = (id) => { const d = getRelicDefinition(id); return d?.nonSlot ? 0 : (d?.cost ?? 1); };
  const owned = p.relics ?? [];
  const L = ['【遗物】槽位是**权重和**口径：已装备遗物的槽位值之和 ≤ 槽位上限；非槽位式（0 槽）恒生效、不用装备。'];
  if (!owned.length) return L.concat('  （还没有遗物）').join('\n');
  const used = (p.equippedRelics ?? []).reduce((n, id) => n + cost(id), 0);
  L.push(`槽位 ${used}/${p.relicSlots}（战斗中生效 = 已装备 + 全部非槽位式）`);
  for (const id of owned) {
    const d = getRelicDefinition(id);
    const tags = [d?.rarity ?? 'C', d?.nonSlot ? '非槽位式·恒生效' : `${cost(id)}槽`];
    if ((p.equippedRelics ?? []).includes(id)) tags.push('已装备');
    else if (!d?.nonSlot) tags.push('未装备·不生效');
    L.push(`  ${d?.name ?? id}（${tags.join('·')}）：${plain(d?.description ?? '')}`);
  }
  if (run.gameStage === 'prep') {
    L.push('  → relic equip <遗物id> / relic unequip <遗物id>（进战斗前定好；编号见上）');
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
