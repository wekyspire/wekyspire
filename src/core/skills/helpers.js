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
  // 费用覆写通道（2026-09-21）：runtime costOverride 随卡旅行（如无上发现的 0 费控火术），
  // 命中即替代定义费用；动态加价只叠在定义费用上（与结算侧 ConsumeSkillResources 同口径）
  const ov = self.costOverride ?? null;
  const baseMana = ov?.mana ?? def.cost?.mana ?? 0;
  // 逐卡动态费用（runtime 计数加价，如蓄热火球链「每次打出费用+1」）：只加在
  // 定义费用上（X 费/覆写/免费窗口不叠加），纯读 runtime，无副作用
  const manaDelta = (!ov && typeof baseMana === 'number')
    ? (def.manaCostDelta?.(makeSkillCtx(ctx, self)) ?? 0)
    : 0;
  const manaCost = baseMana === 'X' ? 'X' : baseMana + manaDelta;
  const apCost = ov?.actionPoint ?? def.cost?.actionPoint ?? 0;
  // 免费窗口豁免（2026-09-14）：battleState.freePlays > 0 时费用检查放行——
  // 逍遥游「下 N 张打出的牌无开销」挂在出牌侧 PRE 置 0，但若玩家资源低于牌面费用，
  // canUse 会在结算前就拒绝出牌，免费窗口对贵牌失效。计数器放 battleState
  // （turnDrawBonus 同通道先例，可序列化），扣减由出牌侧 PRE 按牌计数（同一张卡的
  // AP/蓝两次消耗只扣一份）。万变拳的 PRE-only 旧口径不同步接入（只免 AP 且已知
  // 局限：3AP 卡仍需 3AP 在手才能启动豁免——保留现状，不与全免通道混流）。
  const freePlay = (ctx.battleState?.freePlays ?? 0) > 0;
  const manaOk = free || freePlay || manaCost === 'X' || ctx.player.mana >= manaCost;
  const apOk = free || freePlay || apCost === 'X' || ctx.player.actionPoints >= apCost;
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

// 手牌容量（跨回合留存口径；旧档无字段时兜底 6；能力可修改 player.maxHandSize）：
// 回合开始抽牌抽到此上限，回合结束超载部分被尾弃（P9）。
// 2026-09-13 批次 13 起 7→6（用户定「1 咏唱容量 + 6 手牌」一步到位）。
export function handLimitOf(ctx) {
  return ctx.player.maxHandSize ?? 6;
}

// 咏唱容量（2026-09-13 批次 13 用户定）：激活咏唱**先吃咏唱容量**、吃饱后的溢出部分
// 才吃手牌容量。按咏唱开销（权重）计数，不按卡数。默认 1；参数化走 baseStats/
// runModifiers/battleModifiers（与 maxHandSize 同通道），空系未来在容量增加上动手脚。
// 数学等价性：cap=1、上限 6 时，W≥1 的占用 = 普通+(W−1) ≡ 旧口径（上限 7）的普通+W
// ——含咏唱构筑零漂移；仅无咏唱构筑 −1（囤牌税修正）。
export function chantCapacityOf(ctx) {
  return ctx.player.chantCapacity ?? 1;
}

// 手牌构成分解（口径函数/投影灯珠/headless 文本的唯一同源）：
// normal = 未激活卡张数；chantW = 激活咏唱的共鸣石折扣后权重和。
export function handBreakdown(battleState) {
  let normal = 0, chantW = 0;
  for (const c of battleState.zones.hand) {
    if (c.isActivated) chantW += chantWeightOf(c, battleState);
    else normal += 1;
  }
  return { normal, chantW };
}

// 超载上限 = 容量 + 5（2026-09-13 两级手牌口径，用户定：7 容量 + 12 超载起步）。
// 回合内的抽牌效果可以把手牌顶过容量、直到超载；超载空间当回合有效、不过夜。
// overloadBonus：遗物给的额外超载余量（胀满的背包，挂 battleState、随战斗消失）。
export const OVERLOAD_HEADROOM = 5;
export function overloadLimitOf(ctx) {
  return handLimitOf(ctx) + OVERLOAD_HEADROOM + (ctx.battleState?.overloadBonus ?? 0);
}

// 单卡的手牌压力权重：激活咏唱 = 咏唱值（缺省 1——2026-09-13 权重分档，用户定：
// 大量 1 咏 / 中量 2 咏 / 少量强卡 3-4 咏），其余恒 1
export function handWeightOf(card) {
  return card.isActivated ? (getSkillDefinition(card.defId).chantWeight ?? 1) : 1;
}

// 共鸣石折扣（battleState.chantWeightDiscount，遗物挂载、随战斗消失）。
// 口径（用户 2026-09-20 重申）：折扣只作用于**权重 > 1** 的激活咏唱——每点 -1，
// 且下限为 1；权重 1 的咏唱纹丝不动（绝不砍到 0）；权重 0（2026-09-20 稿：
// 牢大 A / 混元 A 的显式零容量压力）折扣同样不作用、也不会被钳回 1。
// 一切加权口径（抽牌/尾弃/激活合法性）统一走这里。
function chantWeightOf(card, battleState) {
  const w = handWeightOf(card);
  if (!card.isActivated) return w;
  if (w <= 0) return 0;
  const discount = battleState?.chantWeightDiscount ?? 0;
  return discount > 0 ? Math.max(1, w - discount) : w;
}

// 加权手牌数（抽牌满手判定 / 咏唱发动合法性共用口径，2026-09-13 批次 13 改）：
// = 普通张数 + max(0, 激活咏唱权重和 − 咏唱容量)——容量内的咏唱不占手牌。
// 收 ctx 而非 battleState：容量是 run 级参数，收 battleState 会让调用点漏传 cap 静默回退。
export function effectiveHandCount(ctx) {
  const { normal, chantW } = handBreakdown(ctx.battleState);
  return normal + Math.max(0, chantW - chantCapacityOf(ctx));
}

// P9 超载尾弃的对象枚举（核心清理与前端「将弃」预告共用同一算法，两处不得漂移）：
// 从手牌尾部（最新到的卡）向前枚举，**跳过激活咏唱**（豁免——付费点亮的咏唱
// 不得被系统掐灭，用户定 2026-09-13），直到加权手牌数 ≤ 容量。
// 返回 uniqueID 数组，尾部在前——弃置顺序即数组顺序（最右最先回牌库底，FIFO 确定）。
export function pickOverflowVictims(hand, ctx) {
  const capacity = handLimitOf(ctx);
  const { normal, chantW } = handBreakdown(ctx.battleState);
  let total = normal + Math.max(0, chantW - chantCapacityOf(ctx));
  const victims = [];
  for (let i = hand.length - 1; i >= 0 && total > capacity; i--) {
    const card = hand[i];
    if (card.isActivated) continue; // 激活咏唱豁免（付费点亮不得被系统掐灭）
    victims.push(card.uniqueID);
    total -= 1; // 被弃的只会是普通卡，恒减 1
  }
  return victims;
}

// 咏唱发动合法性：**激活后口径直算**——自身从普通卡(1)变为激活咏唱(weight)，
// 激活后的加权手牌数 = (普通−1) + max(0, W+weight−容量) ≤ 手牌上限。
// ⚠ 不可用「effective + weight − 1」近似：容量>0 时第一张咏唱（W=0）的 weight 被容量
// 兜住不占手牌，近似式会把它误算成占用、对无咏唱构筑多收 1（双重囤牌税，批次 13 勘定）。
// 卡在手牌中调用（结算中的卡已离手，先放回再算）。
export function chantActivationLegal(ctx, self, def = getSkillDefinition(self.defId)) {
  const base = def.chantWeight ?? 1;
  const discount = ctx.battleState?.chantWeightDiscount ?? 0;
  // 折扣地板与 chantWeightOf 同口径：只削权重 >1（下限 1，权重 1 不砍到 0）；
  // 权重 0 = 显式零容量压力，折扣不作用。
  const weight = base <= 0 ? 0 : Math.max(1, base - discount);
  const { normal, chantW } = handBreakdown(ctx.battleState);
  return (normal - 1) + Math.max(0, chantW + weight - chantCapacityOf(ctx)) <= handLimitOf(ctx);
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
