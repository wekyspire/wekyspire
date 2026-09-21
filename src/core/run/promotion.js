import { getSkillDefinition, hasSkill } from '../skills/registry.js';
import { createSkillRuntime } from '../state/skillRuntime.js';
import { maxRewardTier, packOf, TIER_RANK } from './rewards.js';

// 局外卡牌升级（晋升）：RUN_DESIGN §6.2。
// 机制 = 换绑 deck 内 runtime 的 defId + 重置运行时状态（充能/冷却/激活）。
// 卡定义契约：`promotesTo: defId | [defIds]`（支持分叉；分叉抉择由调用方传入，
// 缺省取第一个可用目标）。取代旧 precessor 逆链。
// 注意边界：promotesTo 是**局外晋升专用**字段——局内转化链（斩系列「打出后进阶」）
// 走 `battlePromotesTo`，本模块不可见，斩卡因此永远不会出现在营地/训练场的升级候选里。
//
// 等阶门禁（§5.2，与抓牌同口径）：晋升目标等阶不得超过该卡**所属体系**当前解锁的
// 最高等阶（体修看隐藏 bodyLevel，灵脉看 leino 维度；0 级 → D/C，1 级 → B，2 级 → A）。
// 体修 0 级升出 A 级揽云手的事故即门禁漏接所致——抓牌侧（rewards.js）有门禁，
// 晋升侧也必须过同一道闸。

// 某定义当前可用的晋升目标（内容缺省/未注册的目标自动跳过，§9 内容留坑）
export function promotionTargets(def) {
  if (!def?.promotesTo) return [];
  const ids = Array.isArray(def.promotesTo) ? def.promotesTo : [def.promotesTo];
  return ids.filter(hasSkill);
}

// 这条晋升链（沿 promotesTo 上溯，含分叉）是否最终能到 S。
// 「一次升两阶」只给**到不了 S 的短链**（链顶止步 A/B）：晚局单步价值太薄；能一路
// 通往 S 的链（如斩灭 A→S，尽管 S 目标本身被门禁排除）保持单步——通往 S 的每一阶
// 都有长期价值。（2026-09-21 用户定）
function chainReachesS(def) {
  const seen = new Set();
  const queue = [def?.id];
  while (queue.length) {
    const id = queue.pop();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const d = getSkillDefinition(id);
    if (d?.tier === 'S') return true;
    queue.push(...promotionTargets(d));
  }
  return false;
}

// 过等阶门禁后的可用晋升目标（run 语境；UI 候选与执行判定都走这里，保证同源）。
// S 阶不可经晋升获得（2026-09 定）：训练场/营地/老虎机升级一律到不了 S——晋升链
// 本身保留（作为未来特殊事件的升 S 通道数据），S 的常规来源只有卡包直出。
// 一次升两阶（2026-09-21 用户定）：门禁已开高、单步目标还低于上限、且这条链到不了 S
// 的低阶卡，直接给**两阶后**的目标（D→B、C→A）——晚局升一张 D/C 卡不再只挪一小格。
// 只在链线性时跳（单目标→单目标）；分叉保持原样走升级子面板抉择。
export function gatedPromotionTargets(run, def) {
  const cap = TIER_RANK[maxRewardTier(run, packOf(def))] ?? Infinity;
  let targets = promotionTargets(def);
  if (targets.length === 1 && !chainReachesS(def)) {
    const child = getSkillDefinition(targets[0]);
    if ((TIER_RANK[child?.tier] ?? Infinity) < cap) {   // 单步目标低于上限 = 还有余量
      const grand = promotionTargets(child);
      if (grand.length === 1) {
        const g = getSkillDefinition(grand[0]);
        if (g && g.tier !== 'S') targets = grand;       // 两阶跳（≤cap 由下方过滤兜底）
      }
    }
  }
  return targets.filter(id => {
    const target = getSkillDefinition(id);
    if (target.tier === 'S') return false;
    return (TIER_RANK[target.tier] ?? Infinity) <= cap;
  });
}

// deck 内某张 runtime 是否可升级（需传 run 以过等阶门禁）
export function canPromoteRuntime(runtime, run) {
  return gatedPromotionTargets(run, getSkillDefinition(runtime.defId)).length > 0;
}

// 晋升 deck 内一张卡。targetId 可选（分叉时指定）；**缺省且多分叉时按 run.rng 确定性
// 随机取一条**（用户定 2026-09-13：随机升级随机选分叉——老虎机随机升级/headless 兜底都走
// 这条；营地/训练场等 UI 流由升级子面板显式传 targetId）。无可用目标（含被等阶门禁挡下）
// 返回 null（调用方决定跳过）。uniqueID 保持不变（牌面身份稳定），其余运行时状态
// 按新定义重置。
export function promoteCard(run, uniqueID, targetId = null) {
  const runtime = run.player.deck.find(s => s.uniqueID === uniqueID);
  if (!runtime) throw new Error(`卡组中不存在该卡：${uniqueID}`);
  const targets = gatedPromotionTargets(run, getSkillDefinition(runtime.defId));
  if (targetId !== null && !targets.includes(targetId)) {
    throw new Error(`'${targetId}' 不是 '${runtime.defId}' 的可用晋升目标（不存在或等阶未解锁）`);
  }
  const next = targetId
    ?? (targets.length > 1 && run.rng
      ? targets[Math.floor(run.rng.next() * targets.length)]
      : targets[0]);
  if (!next) return null; // 晋升目标内容缺省/被门禁挡下 → 跳过（占位）
  Object.assign(runtime, createSkillRuntime(next), { uniqueID: runtime.uniqueID });
  return runtime;
}
