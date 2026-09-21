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

// 【后手】：此牌作为手牌中**最后一张自由牌**打出（2026-09-21 用户定，NAMED.md 同步）——
// 判据是位置：打出那一刻其右侧没有别的自由牌（右侧全是激活咏唱不挡；左侧的牌不管）。
// 旧口径（2026-09-13「唯一非激活卡」）要求清空整只手，过苛；新口径只需把它打在最右。
// 邻牌等物理位置语义不受影响（飞刀献祭照旧，用户划线）。
// 结算中自身已离手（pending），handIndexAtPlay 捕获打出时手位——其后的牌
// （slice(i)）即当时位于它右侧的牌；预览态（canUse/battleDescribe）自身仍在手，
// 右侧 = slice(selfIndex + 1)。
export function isLastHandCardAtPlay(sctx) {
  const hand = sctx.battleState.zones.hand;
  if (sctx.handIndexAtPlay != null) {
    return hand.slice(sctx.handIndexAtPlay).every(c => c.isActivated);
  }
  const selfIndex = hand.findIndex(c => c.uniqueID === sctx.self.uniqueID);
  if (selfIndex < 0) return false;
  return hand.slice(selfIndex + 1).every(c => c.isActivated);
}

// 【先手】：此牌作为本回合打出的第一张牌（敏捷连击系判据，2026-09-13 用户拍板）——
// 位置不可控变时序可控；每回合天然限触发一次（「第一张」只有一张），数值因此无需下调。
// 咏唱发动也是一次打出，会抢先手位=真实顺序抉择。
// 结算读 UseSkill stage 1 捕获（嵌套出牌时母卡已占 pending 坑，不算第一张）；
// 预览态读实时计数（本回合未出牌且无卡在结算区即成立）。
export function isFirstPlayThisTurn(sctx) {
  if (sctx.firstPlayThisTurn != null) return sctx.firstPlayThisTurn;
  return sctx.battleState.history.turn.played === 0
    && sctx.battleState.zones.pending.length === 0;
}

// ---- 指令组合原语（全部返回被提交的指令，便于命中探针/断言）----

// 造成伤害。amount 已是最终数值（攻击卡请先过 attackAmount）。
// 伤害指令携带 skill 引用（sctx.self）——「第一张火灵脉攻击牌」之类的能力按它反查卡定义。
// type：'major' 主级（缺省，出牌直接伤害）| 'minor' 附级（反伤/抽卡伤害/tick 等被动伤害，
// 不吃任何加成、不触发任何响应——见 instructions/combat.js 两原语注释）。
export function dealDamage(sctx, amount, {
  target = null, pierce = false, fixed = false, tags = [], source = sctx.player, type = 'major',
  skillDefId = null, // 日志归属覆写：结算时点卡已变身的场合（斩链打出拍先变身后结算），
                    // 用打出时点的 defId 归属，避免「[削金斩] 30伤」这类名数错位
} = {}) {
  const instr = new DealDamageInstruction({
    source, target: target ?? enemyTarget(sctx), amount, pierce, fixed, tags, skill: sctx.self, type,
    skillDefId,
  });
  sctx.kernel.submitInstruction(instr);
  return instr;
}

// 攻击伤害：基数自动叠加攻击面板与 power
export function attackDamage(sctx, base, opts = {}) {
  return dealDamage(sctx, attackAmount(sctx, base), opts);
}

// 群伤原语：对每个存活敌人一枚 aoe 标记攻击（面板/power 逐枚结算）；返回命中敌人数。
// 体修扫腿/刀组横劈共用（火系 aoeDamage 是「选定敌人最后命中」的局部特化，不复用）。
export function aoeAttack(sctx, base) {
  return aoeAttackProbes(sctx, base).length;
}

// 群伤的逐段探针版：需要「每命中 1 敌人」逐敌结算的效果（扫腿格挡、横劈碎铁）
// 用它拿各段伤害指令，下一结算阶段经 damageLandedCount 读命中数。
export function aoeAttackProbes(sctx, base) {
  const probes = [];
  for (const e of aliveEnemies(sctx.battleState)) {
    probes.push(attackDamage(sctx, base, { target: e, tags: ['aoe'] }));
  }
  return probes;
}

// 【命中】统一谓词（2026-09-21 用户定，与 NAMED 词条一致）：**造成伤害即命中**——
// 打在护盾上（shieldAbsorbed）也算；被闪避/被 veto/目标已死（全零）算未命中。
// 接受一组伤害指令（探针），返回命中的段数。多段伤害天然能触发多次。
export function damageLandedCount(probes) {
  return (probes ?? []).filter(
    p => (p?.result?.dealt ?? 0) > 0 || (p?.result?.shieldAbsorbed ?? 0) > 0).length;
}

/**
 * 卡牌威力提升（runtime.power 增加）——**唯一入口**：改数值 + 通知 presenter 播
 * 「牌状态改变」的放缩节拍（公共动画：bridge 的 cardPowerUp → ANIM_CARD_POWER_UP）。
 * 内容侧任何改 power 的地方都该走它，别裸改 `card.power += n`（那样只有数字变、没有演出）。
 */
export function gainPower(sctx, card, delta) {
  if (!card || !delta) return card;
  card.power += delta;
  sctx.presenter?.cardPowerUp?.({ card, delta });
  return card;
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
  const room = handLimitOf(sctx) - effectiveHandCount(sctx);
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

// 【短暂】：回合结束时若仍滞留手牌则回牌库（打出走 FIFO 回库底，抽到不打出也不许
// "攥着过夜"）。砺刀系与遗物生成的〈压制射击〉用这一形态。
// ⚠ 短暂只有「在手」这一种形态（2026-09-13 用户定基本约定：焚毁即彻底离场，无例外）
// ——原「消耗+短暂=焚毁后回合末回库」形态（returnToDeckAtTurnEnd）已废除。
export function leaveHandAtTurnEnd(sctx) {
  const uniqueID = sctx.self.uniqueID;
  return {
    when: PlayerTurnEndInstruction, phase: 'post',
    filter: (instr, ctx) => zoneOf(ctx.battleState, uniqueID) === 'hand',
    react: (instr, ctx) => ctx.kernel.submitInstruction(
      new MoveCardInstruction({ uniqueID, toZone: 'deck' }), instr),
  };
}

// 【快速咏唱】：提前触发一次咏唱节拍（P5 挂载点复用）
export function triggerChant(sctx) {
  sctx.kernel.submitInstruction(new ChantTriggerInstruction());
}


// ---- 结算期选牌 ----

/**
 * 通用「从指定卡牌集里选 min~max 张」请求（2026-09-11）——**结算期选牌请求形状的唯一事实源**
 * （用户定 2026-09-13：所有多选卡牌操作统一走这一条，不再各自手搓请求对象）。
 *
 * `source` 只描述卡牌集来自哪个区：'hand' 的候选在战斗场景里**已有唯一 CardObject**，
 * 前端界面应当**接管/移动**这些实例（不渲染副本）；'deck'/'burnt' 等区的候选在场景里
 * 没有对象，界面按投影新建即可（与牌库查看器同口径）。
 *
 * 呈现口径（`picker`，前端据此选交互）：
 *   · **多选（max > 1）永远走覆盖层**（'overlay'）：卡阵 + 逐张点选 + 确认按钮。
 *     历史教训：手牌多选曾走"在手牌上逐张累加"的私有通道，而该通道只认旧字段 `count`——
 *     新请求只发 min/max 时它读到 undefined，点牌被判成单选、校验不过 → 界面死锁
 *     （用户 2026-09-13 报的「二重花刀打出后卡死」）。多选从此只有一条路。
 *   · 单选（max = 1）：手牌来源**原地点牌即应答**；非手牌来源仍走覆盖层（场景里无可点对象）。
 *
 * 候选为空时**返回 null 不提交**（空集无合法应答，会把界面挂死）——调用方据此跳过。
 * 形状：`{ kind:'selectCards', source, min, max, reason, picker?, candidates:[uniqueID] }`
 * （**不再有 `count` 字段**：min/max 是规范，count 是已废弃的旧口径。）
 */
export function buildCardSelectionRequest(sctx, {
  source = 'hand', min = 1, max = null, filter = null, reason = null, zone = null,
  overlay = null,
} = {}) {
  const zoneName = zone ?? (source === 'deck' ? 'deck' : 'hand');
  const pool = (sctx.battleState.zones[zoneName] ?? []).filter(c => (filter ? filter(c) : true));
  if (pool.length === 0) return null;                       // 空集守卫：不发起请求
  const lo = Math.max(0, Math.min(min, pool.length));
  const hi = Math.max(lo, Math.min(max ?? Math.max(min, pool.length), pool.length));
  const useOverlay = hi > 1 || (overlay ?? source !== 'hand');
  return {
    kind: 'selectCards', source, min: lo, max: hi, reason,
    picker: useOverlay ? 'overlay' : undefined,
    candidates: pool.map(c => c.uniqueID),
  };
}

export function requestCardSelection(sctx, opts = {}) {
  const request = buildCardSelectionRequest(sctx, opts);
  if (!request) return null;
  const instr = new AwaitPlayerInputInstruction({ request });
  sctx.kernel.submitInstruction(instr);
  return instr;
}

// 手牌选牌请求：返回 AwaitPlayerInputInstruction（调用方存到 sctx.self 上，下一段读 selected）
export function requestHandSelection(sctx, { count = 1, filter = null, reason = null } = {}) {
  return requestCardSelection(sctx, { source: 'hand', min: count, max: count, filter, reason });
}

// 牌库选牌请求（寻找/抽出类）
export function requestDeckSelection(sctx, { count = 1, filter = null, reason = null } = {}) {
  return requestCardSelection(sctx, { source: 'deck', min: count, max: count, filter, reason });
}

// 读选牌结果（应答值恒为 uniqueID 数组；未应答/空选择返回 []）
export function selected(instr) {
  return instr?.result?.selection ?? [];
}

// 是否刀法牌（培植/开刃/砺刀系列的作用域判定）。
// 判据 = 「blade 系列」而非「keywords 含 blade」：碎铁/出鞘等**斩的衍生与处理牌**是
// 刀法牌，但它们的卡面页脚不该多一个 "blade" 词条（关键词是给玩家读的，不是分类标记）——
// 用户 2026-09-12 定：碎铁应吃到关于刀法牌的一切效果与增益（养刀术/锻刀术/练刀/砺刀系）。
export function isBladeCard(card) {
  const def = getSkillDefinition(card.defId);
  return def.series === 'blade' || def.keywords?.includes('blade') === true;
}
