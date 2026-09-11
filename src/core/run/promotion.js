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

// 过等阶门禁后的可用晋升目标（run 语境；UI 候选与执行判定都走这里，保证同源）
export function gatedPromotionTargets(run, def) {
  const cap = TIER_RANK[maxRewardTier(run, packOf(def))] ?? Infinity;
  return promotionTargets(def).filter(id =>
    (TIER_RANK[getSkillDefinition(id).tier] ?? Infinity) <= cap);
}

// deck 内某张 runtime 是否可升级（需传 run 以过等阶门禁）
export function canPromoteRuntime(runtime, run) {
  return gatedPromotionTargets(run, getSkillDefinition(runtime.defId)).length > 0;
}

// 晋升 deck 内一张卡。targetId 可选（分叉时指定）；无可用目标（含被等阶门禁挡下）
// 返回 null（调用方决定跳过）。uniqueID 保持不变（牌面身份稳定），其余运行时状态
// 按新定义重置。
export function promoteCard(run, uniqueID, targetId = null) {
  const runtime = run.player.deck.find(s => s.uniqueID === uniqueID);
  if (!runtime) throw new Error(`卡组中不存在该卡：${uniqueID}`);
  const targets = gatedPromotionTargets(run, getSkillDefinition(runtime.defId));
  if (targetId !== null && !targets.includes(targetId)) {
    throw new Error(`'${targetId}' 不是 '${runtime.defId}' 的可用晋升目标（不存在或等阶未解锁）`);
  }
  const next = targetId ?? targets[0];
  if (!next) return null; // 晋升目标内容缺省/被门禁挡下 → 跳过（占位）
  Object.assign(runtime, createSkillRuntime(next), { uniqueID: runtime.uniqueID });
  return runtime;
}
