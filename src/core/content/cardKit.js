// 卡牌内容共享工具箱（content 层专用）：把设计稿里的高频机制词收敛成可复用原语，
// 拳/刀/拆/火各体系文件共用一份，避免同一算式与同一语义各写一遍。
//
// 边界：本模块只做「组合指令 + 读结算结果」，不持有战斗状态、不做 zone 迁移绕过——
// 一切卡牌流动仍走 instructions（PRE/POST 订阅与播报统一，见 AGENTS.md 结算纪律）。
//
// 结算期选牌（await input）的既有范式：技能 use(sctx, stage) 分段，段 N 提交
// requestHandSelection/requestDeckSelection 并 return false，段 N+1 读 selected(...)。
// 参考实现：test/asyncInput.test.js、test/deckCraft.test.js。

import { zoneOf, aliveEnemies } from '../state/battleState.js';
import { getSkillDefinition } from '../skills/registry.js';
import { handIndexAtPlay, handLimitOf, effectiveHandCount } from '../skills/helpers.js';
import { DealDamageInstruction, GainShieldInstruction } from '../instructions/combat.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import {
  DrawCardsInstruction, AddCardInstruction, BurnCardInstruction,
  DiscardCardInstruction, MoveCardInstruction,
} from '../instructions/cards.js';
import { PlayerTurnEndInstruction, ChantTriggerInstruction } from '../instructions/turn.js';
import AwaitPlayerInputInstruction from '../instructions/input.js';
import { enemyTarget, resolvedDamageText } from './skills.js';

// 选靶与文本：复用 skills.js 的统一口径（玩家指定优先 → 首个存活敌人）
export { enemyTarget, resolvedDamageText };

// ---- 攻击算式 ----

// 体修/火灵脉攻击卡统一算式：基数 + 攻击面板 + power（battle.md F1 / U1 读轨口径）
export function attackAmount(sctx, base) {
  // 负面板（虚弱叠高）可把原始和压到负——地板 0（execute 同款口径，防预览露出 -N）
  return Math.max(0, base + sctx.player.getStat('attack') + sctx.self.power);
}

// 随机存活敌人（走种子 rng，可复现）；无存活敌人返回 null
export function randomAliveEnemy(sctx) {
  const list = aliveEnemies(sctx.battleState);
  if (list.length === 0) return null;
  return list[sctx.battleState.rng.int(0, list.length - 1)];
}

// ---- 位置语义（统一读「打出那一刻」，与 handIndexAtPlay 同源）----

// 自身的出牌时点手位（不在手牌返回 -1）
export function handIndex(sctx) {
  return handIndexAtPlay(sctx);
}

// 【后手】：此牌作为手牌最后一张打出。结算中自身已离手（pending），手牌为空即成立；
// 预览态（canUse/battleDescribe）自身仍在手，手牌恰为自身这一张即成立。
export function isLastHandCardAtPlay(sctx) {
  const hand = sctx.battleState.zones.hand;
  if (sctx.handIndexAtPlay != null) return hand.length === 0;
  return hand.length === 1 && hand[0].uniqueID === sctx.self.uniqueID;
}

// ---- 指令组合原语（全部返回被提交的指令，便于命中探针/断言）----

// 造成伤害。amount 已是最终数值（攻击卡请先过 attackAmount）。
export function dealDamage(sctx, amount, {
  target = null, pierce = false, fixed = false, tags = [], source = sctx.player,
} = {}) {
  const instr = new DealDamageInstruction({
    source, target: target ?? enemyTarget(sctx), amount, pierce, fixed, tags,
  });
  sctx.kernel.submitInstruction(instr);
  return instr;
}

// 攻击伤害：基数自动叠加攻击面板与 power
export function attackDamage(sctx, base, opts = {}) {
  return dealDamage(sctx, attackAmount(sctx, base), opts);
}

export function gainShield(sctx, amount, target = sctx.player) {
  sctx.kernel.submitInstruction(new GainShieldInstruction({ target, amount }));
}

// 格挡层数（block 效果，≠ 护盾池）
export function gainBlock(sctx, stacks, target = sctx.player) {
  sctx.kernel.submitInstruction(new AddEffectInstruction({ target, effectId: 'block', stacks }));
}

export function addEffect(sctx, effectId, stacks, target = sctx.player) {
  sctx.kernel.submitInstruction(new AddEffectInstruction({ target, effectId, stacks }));
}

export function drawCards(sctx, count, opts = {}) {
  sctx.kernel.submitInstruction(new DrawCardsInstruction({ count, ...opts }));
}

// 抽到手牌上限（虚形拳「后手：抽满手牌」；按加权口径算差额）
export function drawToHandLimit(sctx) {
  const room = handLimitOf(sctx) - effectiveHandCount(sctx.battleState);
  if (room > 0) drawCards(sctx, room);
}

// 造牌入场。index: null=末尾 | 数字 | 'random'（洗入类用 'random'）
export function addCard(sctx, defId, { toZone = 'deck', index = null, overrides = {} } = {}) {
  sctx.kernel.submitInstruction(new AddCardInstruction({ defId, toZone, index, overrides }));
}

export function burnCard(sctx, uniqueID) {
  sctx.kernel.submitInstruction(new BurnCardInstruction({ uniqueID }));
}

export function discardCard(sctx, uniqueID) {
  sctx.kernel.submitInstruction(new DiscardCardInstruction({ uniqueID }));
}

export function moveCardTo(sctx, uniqueID, toZone, index = null) {
  sctx.kernel.submitInstruction(new MoveCardInstruction({ uniqueID, toZone, index }));
}

// ---- 机制词原语 ----

// 【破】：失去全部格挡并返回失去的层数（每层触发一次的载荷由调用方逐层展开）
export function breakAllBlock(sctx, target = sctx.player) {
  const stacks = target.getEffectStacks('block');
  if (stacks > 0) {
    sctx.kernel.submitInstruction(new AddEffectInstruction({
      target, effectId: 'block', stacks: -stacks,
    }));
  }
  return stacks;
}

// 【短暂】：出牌时登记一次性回合结束回库（消耗卡焚毁后照常回牌库）
export function returnToDeckAtTurnEnd(sctx) {
  const uniqueID = sctx.self.uniqueID;
  sctx.kernel.addSubscription({
    when: PlayerTurnEndInstruction, phase: 'post', window: 'once',
    filter: (instr, ctx) => zoneOf(ctx.battleState, uniqueID) === 'burnt',
    react: (instr, ctx) => ctx.kernel.submitInstruction(
      new MoveCardInstruction({ uniqueID, toZone: 'deck' }), instr),
  });
}

// 【快速咏唱】：提前触发一次咏唱节拍（P5 挂载点复用）
export function triggerChant(sctx) {
  sctx.kernel.submitInstruction(new ChantTriggerInstruction());
}

// 【命中】：结算期探针。提交伤害后用 beginHitProbe 记录，下一阶段 hitLanded() 读
// 实际生命值伤害（被 veto/被闪避/打空 → false；按 A4 取消无联动）。
export function beginHitProbe(sctx, instr) {
  sctx.self._hitProbe = instr;
  return instr;
}

export function hitLanded(sctx) {
  const probe = sctx.self._hitProbe;
  sctx.self._hitProbe = null;
  return (probe?.result?.dealt ?? 0) > 0;
}

// ---- 结算期选牌 ----

// 手牌选牌请求：返回 AwaitPlayerInputInstruction（调用方存到 sctx.self 上，下一段读 selected）
export function requestHandSelection(sctx, { count = 1, filter = null, reason = null } = {}) {
  const hand = sctx.battleState.zones.hand.filter(c => (filter ? filter(c) : true));
  const instr = new AwaitPlayerInputInstruction({
    request: { kind: 'selectHandCard', count, reason, candidates: hand.map(c => c.uniqueID) },
  });
  sctx.kernel.submitInstruction(instr);
  return instr;
}

// 牌库选牌请求（寻找/抽出类）
export function requestDeckSelection(sctx, { count = 1, filter = null, reason = null } = {}) {
  const deck = sctx.battleState.zones.deck.filter(c => (filter ? filter(c) : true));
  const instr = new AwaitPlayerInputInstruction({
    request: { kind: 'selectDeckCard', count, reason, candidates: deck.map(c => c.uniqueID) },
  });
  sctx.kernel.submitInstruction(instr);
  return instr;
}

// 读选牌结果（应答值恒为 uniqueID 数组；未应答/空选择返回 []）
export function selected(instr) {
  return instr?.result?.selection ?? [];
}

// 是否刀法牌（培植/开刃/砺刀系列的作用域判定）
export function isBladeCard(card) {
  return getSkillDefinition(card.defId).keywords?.includes('blade') === true;
}
