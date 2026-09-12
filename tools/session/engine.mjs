// playSession 引擎：replay 式会话状态机 + 动作解释器（exec）。
//
// 会话 = tmp/playtests/<名>.json { seed, actions: [] }。每次调用把全部动作确定性
// 重放一遍（战斗种子由 run 种子派生、奖励走 run rng，同种子同动作序列必同局），
// 新动作成功后才入档——中途战斗状态无需序列化。
//
// 本模块是**引擎**（无 CLI 副作用），三个消费者共用同一份 exec/render，输出不漂移：
//   tools/headlessPlay.mjs —— 一次性 CLI（一个动作一个进程，agent 用）
//   tools/broadcast.mjs    —— 直播守护进程（内存态常驻 + 只对新动作开流）
//   tmp/*.mjs              —— 试玩辅助脚本
//
// 子模块：format.mjs（中文文本）/ addressing.mjs（编号+卡名寻址）/ render.mjs（状态渲染）/
// files.mjs（会话文件）。动作解释器按阶段拆成 exec* 小函数，exec 只做分发。
import '../../src/core/content/index.js'; // 内容登记（副作用 import，必须在建 run 之前）
import Player, { PLAYER_BASE_HP } from '../../src/core/state/player.js';
import { createSkillRuntime } from '../../src/core/state/skillRuntime.js';
import { BODY_STARTER_DECK } from '../../src/core/content/bodySkills.js';
import { createRecordingPresenter } from '../../src/core/presenter.js';
import { canUseSkill, makeSkillCtx, effectiveHandCount, chantActivationLegal } from '../../src/core/skills/helpers.js';
import { getSkillDefinition } from '../../src/core/skills/registry.js';
import { getEffectDefinition } from '../../src/core/effects/registry.js';
import { getAbilityDefinition } from '../../src/core/abilities/registry.js';
import { getRelicDefinition, allRelics } from '../../src/core/relics/registry.js';
import { gatedPromotionTargets } from '../../src/core/run/promotion.js';
import { prepUseRelic, equipRelic, unequipRelic, grantRelic } from '../../src/core/run/prep.js';
import {
  startBattle, playerUseSkill, playerEndTurn, playerSwapCard, isBattleFinished, respondInput,
} from '../../src/core/flow/battle.js';
import {
  createRun, enterBattle, createRunBattle, finishBattle, completeRewards, completeRoom, isBossFloor,
} from '../../src/core/run/runFlow.js';
import { chooseSkillReward, chooseRewardPack, PACKS } from '../../src/core/run/rewards.js';
import {
  chooseAscension, chooseAscensionAbility, chooseSeedCards, rerollSeedOffering,
  ASCENSION_PLACEHOLDER, FIRST_ASCENSION_GRANT,
} from '../../src/core/run/ascension.js';
import { trainUpgrade, trainDrawChoices, trainDraw, skipTraining } from '../../src/core/run/rooms/training.js';
import { campRest, campRecoverRemi, campUpgrade, CAMP_PLACEHOLDER } from '../../src/core/run/rooms/camp.js';
import { playEvent } from '../../src/core/run/rooms/event.js';
import {
  spinSlot, takeSlotPrize, declineSlotPrize, slotUpgrade, devourSlot,
} from '../../src/core/run/rooms/slotMachine.js';
import { buyShopItem, takeShopCard } from '../../src/core/run/rooms/shop.js';
import {
  bankDeposit, bankWithdraw, bankOverdraft, chooseDemonDebuff, bankUpgrade, bankBurn,
} from '../../src/core/run/rooms/bank.js';
import {
  ensureGurpasStock, gurpasView, buyGurpas, takeGurpasCard, sellGurpasRelic, removeCardAtGurpas,
} from '../../src/core/run/rooms/gurpas.js';

import { defOf, plain, cardDefLine, slotResultText, eventResultText } from './format.mjs';
import {
  num, idxOk, isIdxArg, nameMatches, resolveHandStrict, resolveHandArg, pickHandCard,
  resolveChoiceArg, resolveChoiceStrict,
} from './addressing.mjs';

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
  const S = { run, battle: null, lastOutcome: '', presenter: null, onBattle };
  S.presenter = makePresenter ? makePresenter(S) : createRecordingPresenter();
  return S;
}

/** 战斗动作直达：prep 阶段先自动开战（免 fight），再幂等装配本场战斗。 */
export function ensureBattle(S) {
  if (S.run.gameStage === 'prep') enterBattle(S.run);
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

export const stageCn = (s) => ({
  prep: '战前准备', battle: '战斗', reward: '战后奖励', room: '奖励房',
  ascension: '进阶事件', end: '终局',
}[s] ?? s);

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

// ---------- 动作解释器 ----------
export function exec(S, raw) {
  const t = raw.trim().split(/\s+/);
  const cmd = t[0];
  switch (cmd) {
    case 'note': S.lastOutcome = `记事: ${t.slice(1).join(' ')}`; return;
    case 'state': case 'deck': case 'terms': case 'help': S.lastOutcome = ''; return;
    case 'fight': case 'play': case 'swap': case 'end': case 'in': case 'auto': case 'why':
      return execBattle(S, cmd, t);
    case 'pack': case 'take': case 'skip': return execReward(S, cmd, t);
    case 'act': return execRoom(S, t);
    case 'dim': case 'seed': case 'reroll': case 'ability': return execAscension(S, cmd, t);
    case 'preview': return execPreview(S, t);
    case 'dev': return execDev(S, t);
    case 'relic': return execRelic(S, t);
    case 'next': return execNext(S);
    default: throw new Error(`未知动作：${cmd}（help 查看动作表）`);
  }
}

// ---- 战斗动作 ----
function execBattle(S, cmd, t) {
  const run = S.run;
  const stage = run.gameStage;
  const [, a, b] = t;
  switch (cmd) {
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
  }
}

// ---- 战后奖励 ----
function execReward(S, cmd, t) {
  const run = S.run;
  const [, a, b] = t;
  if (run.gameStage !== 'reward') throw new Error('当前不在奖励阶段');
  if (cmd === 'pack') {
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
  if (cmd === 'take') {
    const choices = run.rewards.skillChoices;
    const defId = resolveChoiceArg(choices, a, b, '候选',
      id => getSkillDefinition(id)?.name ?? id);
    chooseSkillReward(run, defId);
    S.lastOutcome = `获得卡牌：${getSkillDefinition(defId).name}`;
    return;
  }
  chooseSkillReward(run, null);
  S.lastOutcome = '跳过奖励';
}

// ---- 奖励房（含常驻售货机；房间类型分流到各自子解释器） ----
function execRoom(S, t) {
  const run = S.run;
  if (run.gameStage !== 'room') throw new Error('当前不在奖励房');
  const [, a] = t;
  // 售货机与房间**并存**：不消耗房间行动，也不受"房间动作已完成"限制
  if (a === 'shop') return execRoomShop(S, t);
  const room = run.currentRoom;
  const merged = room === 'campTraining';
  const campUsed = merged ? !!run.roomData?.campUsed : !!S.roomDone;
  const trainDone = merged ? !!run.roomData?.trained : !!S.roomDone;
  // 合并房按**动作名**分流（营地动作 / 训练动作各一套），避免落到对方的报错分支
  const goCamp = room === 'camp' || (merged && ['rest', 'remi', 'upgrade'].includes(a));
  const goTraining = room === 'training' || (merged && ['up', 'draw', 'take', 'skipdraw', 'skip'].includes(a));
  if (S.roomDone && !merged) throw new Error('本房间动作已完成，用 next 离开');
  if (goCamp) return execRoomCamp(S, t, campUsed);
  if (goTraining) return execRoomTraining(S, t, trainDone);
  if (merged) {
    throw new Error('合并房动作（营地）：act rest | act remi | act upgrade <构筑#> <卡名>'
      + '｜（训练）：act up <构筑#> <卡名> | act draw | act take <#> | act skipdraw | act skip'
      + '｜离开：next');
  }
  if (room === 'gurpas') return execRoomGurpas(S, t);
  if (room === 'slot') return execRoomSlot(S, t);
  if (room === 'event') return execRoomEvent(S, t);
  throw new Error(`未知房间类型：${room}`);
}

// 售货机（与任何房间并存，不消耗房间行动）：buy <#> 购买 / claim <#|defId> 卡包三选一
function execRoomShop(S, t) {
  const run = S.run;
  const [, , b] = t;
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

// 营地（非合并房的 camp，或合并房的营地部分）
function execRoomCamp(S, t, campUsed) {
  const run = S.run;
  const [, a, b] = t;
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

// 训练场（非合并房的 training，或合并房的训练部分）
function execRoomTraining(S, t, trainDone) {
  const run = S.run;
  const [, a, b] = t;
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

// 古尔帕斯之店（35 层固定房）：buy/claim/sell/remove
function execRoomGurpas(S, t) {
  const run = S.run;
  const [, b] = t;
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

// 老虎机 + 银行机（成对出现）
function execRoomSlot(S, t) {
  const run = S.run;
  const [, a, b] = t;
  // 拉一次杆：产出会挂起（文档：产出总是可以放弃）→ 需 claim/drop 处理
  if (a === 'spin') {
    const prize = spinSlot(run);
    S.lastOutcome = `老虎机(-${prize.cost}金币)：${prize.tier === 'none' ? '未中奖（无产出，可直接再 act spin）' : slotResultText(prize)}`
      + (prize.tier === 'none' ? '' : '（用 act claim <#|id> 领取 / act drop 放弃）');
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
    if (b === 'deposit') {
      const amt = t[3] != null ? num(t[3]) : null;
      const v = bankDeposit(run, amt);
      S.lastOutcome = `存款 ${amt ?? '（全部）'} → 存款 ${v.deposit} 金（连击 ${v.combo}）`;
      return;
    }
    if (b === 'withdraw') {
      const { gold, view } = bankWithdraw(run);
      S.lastOutcome = `取款 +${gold} 金 → 持有 ${view.money}（连击清零）`;
      return;
    }
    if (b === 'overdraft') {
      const v = bankOverdraft(run, t[3]);
      S.lastOutcome = `超额取款(${t[3]}) 到手 ${v.pendingRoll.gold} 金｜候选词条：`
        + v.pendingRoll.options.map(o => `${o.name}[${o.id}]`).join(' / ') + '（用 act bank pick <id> 选一个）';
      return;
    }
    if (b === 'pick') {
      const out = chooseDemonDebuff(run, t[3]);
      S.lastOutcome = `承受恶魔词条「${out.name}」`
        + (out.battle ? `（未来 ${out.battle.battles} 场战斗生效）` : '（立即生效）');
      return;
    }
    if (b === 'upgrade') {
      const card = run.player.deck[resolveHandStrict(run.player.deck, t[3], t[4], '构筑卡')];
      const before = defOf(card).name;
      bankUpgrade(run, card.uniqueID);
      S.lastOutcome = `词条附赠升级：${before} → ${defOf(card).name}`;
      return;
    }
    if (b === 'burn') {
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

// 事件房
function execRoomEvent(S, t) {
  const run = S.run;
  const [, a] = t;
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

// ---- 进阶 ----
function execAscension(S, cmd, t) {
  const run = S.run;
  const a = t[1];
  if (cmd === 'dim') {
    if (run.gameStage !== 'ascension') throw new Error('当前不在进阶事件');
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
  if (cmd === 'seed') {
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
  if (cmd === 'reroll') {
    rerollSeedOffering(run);
    S.lastOutcome = '刷新种子候选';
    return;
  }
  // ability
  const offer = run.ascensionOffer;
  if (!offer) throw new Error('当前没有能力候选');
  if (a === 'skip' || a === '跳过') chooseAscensionAbility(run, null);
  else {
    const id = offer[idxOk(num(a), offer.length, '能力')];
    chooseAscensionAbility(run, id);
    S.lastOutcome = `获得能力：${id}`;
  }
}

// ---- 升级预览（只读，不入档）----
function execPreview(S, t) {
  const run = S.run;
  const [, a, b] = t;
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
}

// ---- dev：覆盖局专用（受试内容在早期拿不到时的取样手段）----
// 这些动作**照常入档**，所以重放模型不受影响；但它们绕过正常的获取流程，
// 用它们打的对局必须在报告里标注为「覆盖局」，其平衡感受不可与正常局混同。
function execDev(S, t) {
  const run = S.run;
  const stage = run.gameStage;
  const [, a, b] = t;
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
function execRelic(S, t) {
  const run = S.run;
  const stage = run.gameStage;
  const [, sub, id] = t;
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
}

// ---- 阶段推进 ----
function execNext(S) {
  const run = S.run;
  const stage = run.gameStage;
  if (stage === 'reward') { completeRewards(run); S.roomDone = false; S.lastOutcome = '离开奖励'; return; }
  if (stage === 'room') {
    // 训练强绑尾款未领不允许离场（UI 契约：forced 状态只给三选一不给跳过）
    if (run.roomData?.forced) throw new Error('升级后的强绑抓牌必须领取：act take <#>');
    completeRoom(run); S.roomDone = false; S.lastOutcome = '离开房间'; return;
  }
  throw new Error(`当前阶段无需 next（${stageCn(stage)}）`);
}
