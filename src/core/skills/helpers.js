import { getSkillDefinition } from './registry.js';
import { getAbilityDefinition } from '../abilities/registry.js';
import { handNeighbors } from '../state/battleState.js';

// 技能上下文：技能定义的所有方法（use/canUse/describe/subscriptions/activated.*）
// 只接触 sctx = { ...ctx, self, def }，看不到定义外的世界。
export function makeSkillCtx(ctx, self) {
  return { ...ctx, self, def: getSkillDefinition(self.defId) };
}

// 可用性基础检查（充能/咏唱规则/自定义条件/费用），费用修正（PRE 订阅）在结算时作用于
// 消耗指令，canUse 与结算的费用一致性由"消耗走资源指令"保证（多扣已在结算内，少扣由
// canUse 兜底）。资源不足时进入裁决链：任一能力的 canUseSkill 钩子返回 true 即放行
// （突破极限"蓝量大于1时可超费使用"等），结算侧由资源指令的 clamp 兜底。
// 裁决链第二环：手牌中已激活的咏唱卡可提供 activated.canUseSkill 钩子（卡牌级放行，
// 如「突破极限」——激活期间蓝大于 0 即可透支），与能力钩子同语义、同兜底。
// 咏唱双态规则：激活态打出 = 免费解除并离场（anchored 锁定除外）；未激活打出 = 付费发动，
// 发动合法性 = 激活后加权手牌数 ≤ 手牌上限（咏唱压力与手牌压力统一，用户定）。
export function canUseSkill(ctx, self) {
  const def = getSkillDefinition(self.defId);
  if (self.remainingUses <= 0) return false;
  if (def.cardMode === 'chant') {
    if (self.isActivated) {
      if (def.keywords?.includes('anchored')) return false; // 锁定：不可主动解除
    } else if (!chantActivationLegal(ctx, self, def)) {
      return false; // 激活后手牌压力超限：发动无效果，可用性直接拒绝
    }
  }
  if (def.canUse && !def.canUse(makeSkillCtx(ctx, self))) return false;
  const free = freeChantToggle(def, self);
  // X 费（'X'）消耗全部现有资源，X 可为 0 → 恒可打出
  const manaCost = def.cost?.mana ?? 0;
  const apCost = def.cost?.actionPoint ?? 0;
  const manaOk = free || manaCost === 'X' || ctx.player.mana >= manaCost;
  const apOk = free || apCost === 'X' || ctx.player.actionPoints >= apCost;
  if (manaOk && apOk) return true;
  const budget = { manaOk, apOk };
  for (const id of ctx.player.abilities ?? []) {
    const verdict = getAbilityDefinition(id).canUseSkill?.(makeSkillCtx(ctx, self), budget);
    if (verdict === true) return true;
  }
  for (const card of ctx.battleState.zones.hand) {
    if (!card.isActivated || card.uniqueID === self.uniqueID) continue;
    const hook = getSkillDefinition(card.defId).activated?.canUseSkill;
    if (hook?.(makeSkillCtx(ctx, card), budget) === true) return true;
  }
  return false;
}

// ---- 咏唱双态元语（无槽模型：压力走手牌上限加权口径）----
// 咏唱卡与普通卡同住四区；激活态 = isActivated（仅手牌中可为真，离手即熄）。
// 玩家获得所有已激活咏唱卡的 activated 能力；无激活数上限——其代价是手牌压力：
// 激活的咏唱卡按咏唱值（chantWeight）计多张手牌（咏唱3 = 占 3 张手牌位）。

// 手牌上限（旧档无字段时兜底 7；能力可修改 player.maxHandSize）
export function handLimitOf(ctx) {
  return ctx.player.maxHandSize ?? 7;
}

// 单卡的手牌压力权重：激活咏唱 = 咏唱值，其余恒 1
export function handWeightOf(card) {
  return card.isActivated ? (getSkillDefinition(card.defId).chantWeight ?? 2) : 1;
}

// 加权手牌数（抽牌满手判定 / 咏唱发动合法性共用口径）
export function effectiveHandCount(battleState) {
  return battleState.zones.hand.reduce((n, c) => n + handWeightOf(c), 0);
}

// 咏唱发动合法性：激活后（自身权重 1 → chantWeight）加权手牌数 ≤ 上限。
// 卡在手牌中调用（结算中的卡已离手，先放回再算）。
export function chantActivationLegal(ctx, self, def = getSkillDefinition(self.defId)) {
  const weight = def.chantWeight ?? 2;
  return effectiveHandCount(ctx.battleState) + weight - 1 <= handLimitOf(ctx);
}

// 激活态打出 = 免费关停
export function freeChantToggle(def, self) {
  return def.cardMode === 'chant' && self.isActivated;
}

/**
 * 熄灭咏唱（唯一出口）：onDisable → 摘旗 → 按 owner 注销订阅 → 播报。
 * 调用方：打出已激活咏唱（免费解除，随后按卡牌特性离场）、离手不变量
 * （弃/焚/移出/转化——任何离开手牌的路径先经此，卡还在手时调用）。
 * 幂等：未激活静默落空。anchored 不设防——离手熄灭是物理事实，锁定只挡主动解除。
 */
export function deactivateChant(ctx, skill, reason, target = null) {
  if (!skill?.isActivated) return false;
  const sctx = makeSkillCtx(ctx, skill);
  if (target) sctx.target = target; // 解除路径的出牌目标（终止类群伤的软指定用）
  sctx.def.activated?.onDisable?.(sctx, reason);
  skill.isActivated = false;
  ctx.kernel.removeSubscriptionsByOwner(skill.uniqueID);
  ctx.presenter?.chantToggled?.({ skill, on: false, reason });
  return true;
}

// 注册技能常驻订阅（触发器）。战斗开始时对每张技能调用一次（window:'battle'），
// zone 限定写在订阅 filter 里（匹配时查 zoneOf），卡牌换 zone 无需重新注册。
export function registerSkillSubscriptions(ctx, self) {
  const def = getSkillDefinition(self.defId);
  if (!def.subscriptions) return [];
  const sctx = makeSkillCtx(ctx, self);
  return def.subscriptions(sctx).map(sub =>
    ctx.kernel.addSubscription({ window: 'battle', ...sub, owner: self.uniqueID })
  );
}

// ---- 卡牌进出战斗的生命周期元语 ----
// 一切"卡牌进入战斗"（起手构筑 / AddCard 造牌 / Transform 重绑定）都必须走 enterBattle，
// 否则新卡的常驻订阅不会注册、充能状态不受定义约束。leaveBattle 是其逆操作。

// 进入战斗：按 def 初始化充能（slowStart 起手 0 充能）+ 注册常驻订阅。
export function enterBattle(ctx, self) {
  const def = getSkillDefinition(self.defId);
  const slow = def.keywords?.includes('slowStart');
  const max = def.charges?.max ?? Infinity;
  self.remainingUses = slow ? 0 : max;
  self.currentCooldown = def.charges?.cooldownTurns ?? 0;
  self.isActivated = false;
  registerSkillSubscriptions(ctx, self);
  return self;
}

// 离开战斗（或转化时的换绑前奏）：注销该卡名下全部订阅（常驻 + activated 同 owner）。
export function leaveBattle(ctx, uniqueID) {
  ctx.kernel.removeSubscriptionsByOwner(uniqueID);
}

// ---- 出牌时点位置查询 ----
// 结算中的发动卡已离手（hand→pending，UseSkill stage 1）且带捕获手位 sctx.handIndexAtPlay；
// 预览态（canUse / battleDescribe / projection）自身在手，无捕获值。两条路径经此组助手
// 取得一致口径——位置类语义（最左端 / 唯一手牌 / 两侧邻牌）永远读「打出那一刻」。

// 自身的出牌时点手位：结算中读捕获值，预览态实时查询。
export function handIndexAtPlay(sctx) {
  if (sctx.handIndexAtPlay != null) return sctx.handIndexAtPlay;
  return sctx.battleState.zones.hand.findIndex(c => c.uniqueID === sctx.self.uniqueID);
}

// 自身的出牌时点两侧邻牌：结算中按捕获 index 对当前 hand 换算（移除自身后 left=hand[i-1]、
// right=hand[i]）；预览态回落实时 handNeighbors。返回 { left, right }（卡 runtime 或 null）。
export function handNeighborsAtPlay(sctx) {
  if (sctx.handIndexAtPlay != null) {
    const hand = sctx.battleState.zones.hand;
    const i = sctx.handIndexAtPlay;
    return { left: hand[i - 1] ?? null, right: hand[i] ?? null };
  }
  return handNeighbors(sctx.battleState, sctx.self.uniqueID);
}
