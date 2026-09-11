import { getRelicDefinition, hasRelic, allRelics } from '../relics/registry.js';
import { isDraftable, FILLER_RELIC_ID } from '../relics/draft.js';

// 战前准备阶段（RUN_DESIGN §4.5）：prep 阶段的遗物装卸与主动使用。
// 遭遇预告 = run.encounter（createRun/advanceFloor 已按 seed+floor 确定性生成）。
//
// 槽位口径（用户 2026-09-10 定，以 RELICS.md 为准）：**权重和** Σcost ≤ relicSlots(3)，
// 不是"件数"。cost 0 = 可装备但不占槽；`nonSlot: true` = 非槽位式，**不进装卸界面、
// 恒生效**（拾起即算 / 营地与战后钩子类）。
// 已拥有排除（一局内遗物唯一）在抽选侧（relics/draft.js）保证；本文件只做落地。

const SLOT_COST = (def) => (def?.nonSlot ? 0 : (Number.isFinite(def?.cost) ? def.cost : 1));

/** 遗物是否"非槽位式"（恒生效、不需装备）。 */
export const isNonSlot = (id) => !!getRelicDefinition(id)?.nonSlot;

/** 已激活的遗物 id：装备中的 + 全部非槽位式的（战斗挂载与 run 修正都按这个口径）。 */
export function activeRelics(run) {
  const p = run.player;
  const out = [...(p.equippedRelics ?? [])];
  for (const id of p.relics ?? []) {
    if (isNonSlot(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** 已装备（含非槽位式）遗物占用的槽位总和。 */
export function usedSlots(run) {
  return (run.player.equippedRelics ?? []).reduce((n, id) => n + SLOT_COST(getRelicDefinition(id)), 0);
}

/**
 * 拾取时永久增加生命上限（同时回等量当前生命——用户 2026-09-10 定）。
 * 必须同时抬 baseStats，否则下一次 refreshRunModifiers 会把成长抹掉。
 */
export function gainMaxHp(run, amount) {
  const p = run.player;
  p.baseStats.maxHp += amount;
  p.maxHp += amount;
  p.hp = Math.min(p.maxHp, p.hp + amount);
  return run;
}

/**
 * 永久增加魏启上限（进阶事件用；镜像 gainMaxHp）。
 * **必须抬 baseStats**——否则下一次 refreshRunModifiers 会把它重算掉
 * （这就是「进阶 1 次后魏启上限仍是 3」那个 bug 的根因）。
 */
export function gainMaxMana(run, amount) {
  const p = run.player;
  p.baseStats.maxMana += amount;
  p.maxMana += amount;
  p.mana = Math.min(p.maxMana, p.mana + amount);
  return run;
}

/**
 * 从 baseStats 重算 run 级数值：base + Σ**已激活**遗物的 runModifiers 补丁。
 * 每次装备/卸下/拾取/进战前调用一次——"从基准重算"而非"增量累加"，杜绝逐战叠加。
 */
export function refreshRunModifiers(run, battleState = null) {
  const p = run.player;
  const base = p.baseStats ?? {};
  const patch = { maxMana: 0, maxActionPoints: 0, attack: 0, defense: 0, maxHandSize: 0 };
  for (const id of activeRelics(run)) {
    const def = getRelicDefinition(id);
    const mods = def?.runModifiers;
    const add = typeof mods === 'function' ? mods(p) : (mods ?? {});
    for (const k of Object.keys(patch)) patch[k] += add[k] ?? 0;
    // 遗物声明的**战斗级**修正：只在战斗内折入（生命周期 = 一场战斗，
    // 传 battleState 才生效；prep 装卸时自动不计）。
    if (battleState) {
      const bmods = def?.battleModifiers;
      const badd = typeof bmods === 'function' ? bmods(p) : (bmods ?? {});
      for (const k of Object.keys(patch)) patch[k] += badd[k] ?? 0;
    }
  }
  // 战斗内的**动态**修正（战中获得的临时上限：燃元的 +魏启上限、海神戟第 3 回合结束等）。
  // 存在 battleState 上 → 随战斗对象一起消失，不需要任何回滚/记账。
  if (battleState?.modifiers) {
    for (const k of Object.keys(patch)) patch[k] += battleState.modifiers[k] ?? 0;
  }
  p.maxMana = (base.maxMana ?? 3) + patch.maxMana;
  p.maxActionPoints = (base.maxActionPoints ?? 3) + patch.maxActionPoints;
  p.attack = (base.attack ?? 0) + patch.attack;
  p.defense = (base.defense ?? 0) + patch.defense;
  p.maxHandSize = (base.maxHandSize ?? 7) + patch.maxHandSize;
  p.mana = Math.min(p.mana, p.maxMana);        // 上限下调时不残留
  p.actionPoints = Math.min(p.actionPoints, p.maxActionPoints);
  return run;
}

/**
 * 战斗级数值修正的唯一入口：改 battleState.modifiers 并**立刻重算**。
 * 内容侧（卡/遗物/能力）不要直写 player 的上限字段——直写会漏掉重算，
 * 战后也不会随 battleState 消失（本函数是这条纪律的收口点）。
 */
export function applyBattleModifier(ctx, field, delta) {
  const bs = ctx.battleState;
  if (!bs) throw new Error('战斗级数值修正只能在战斗内使用（缺少 battleState）');
  bs.modifiers ??= { maxMana: 0, maxActionPoints: 0, attack: 0, defense: 0, maxHandSize: 0 };
  if (!(field in bs.modifiers)) {
    throw new Error(`未知的战斗级修正字段：${field}（可用：${Object.keys(bs.modifiers).join('/')}）`);
  }
  bs.modifiers[field] += delta;
  refreshRunModifiers(ctx.runState, bs);
  return bs.modifiers[field];
}

/**
 * 获得遗物入背包：唯一性校验 → 初始化次数 → onAcquire（拾起时）→ 重算 run 修正。
 * 非槽位式遗物拾起即生效（无需装备）；槽位式需玩家在 prep 阶段自行装备。
 */
export function grantRelic(run, relicId) {
  const def = getRelicDefinition(relicId); // 未注册直接抛错
  const owned = run.player.relics.includes(relicId);
  if (owned && relicId !== FILLER_RELIC_ID) {
    throw new Error(`已拥有该遗物（一局内遗物唯一）：${relicId}`);
  }
  if (!owned) run.player.relics.push(relicId);
  if (def.uses != null) run.relicUses[relicId] = def.uses;
  def.onAcquire?.(run);
  refreshRunModifiers(run);
  return run;
}

/** 装备遗物：Σcost ≤ relicSlots；非槽位式不进装卸界面故不可装备。 */
export function equipRelic(run, relicId) {
  if (!run.player.relics.includes(relicId)) throw new Error(`背包中没有遗物：${relicId}`);
  if (run.player.equippedRelics.includes(relicId)) throw new Error(`遗物已装备：${relicId}`);
  const def = getRelicDefinition(relicId);
  if (def?.nonSlot) throw new Error(`非槽位式遗物无需装备（恒生效）：${relicId}`);
  const cost = SLOT_COST(def);
  if (usedSlots(run) + cost > run.player.relicSlots) {
    throw new Error(`遗物槽不足（占 ${cost}，已用 ${usedSlots(run)}/${run.player.relicSlots}），先卸下再装备`);
  }
  run.player.equippedRelics.push(relicId);
  refreshRunModifiers(run);
  return run;
}

export function unequipRelic(run, relicId) {
  const i = run.player.equippedRelics.indexOf(relicId);
  if (i < 0) throw new Error(`遗物未装备：${relicId}`);
  run.player.equippedRelics.splice(i, 1);
  refreshRunModifiers(run);
  return run;
}

// 战前主动使用遗物（仅 prep 阶段；次数耗尽不可再用）
export function prepUseRelic(run, relicId) {
  if (run.gameStage !== 'prep') throw new Error('主动遗物只能在战前准备阶段使用');
  if (!run.player.equippedRelics.includes(relicId)) throw new Error(`遗物未装备：${relicId}`);
  const def = getRelicDefinition(relicId);
  if (!def.prepUse) throw new Error(`遗物不可主动使用：${relicId}`);
  if (def.uses != null) {
    if ((run.relicUses[relicId] ?? 0) <= 0) throw new Error(`遗物次数已耗尽：${relicId}`);
    run.relicUses[relicId] -= 1;
  }
  def.prepUse(run);
  refreshRunModifiers(run);
  return run;
}

export { hasRelic, allRelics, isDraftable };
