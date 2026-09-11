import { getRelicDefinition } from '../relics/registry.js';

// 战前准备阶段（RUN_DESIGN §4.5）：prep 阶段的遗物装卸与主动使用。
// 遭遇预告 = run.encounter（createRun/advanceFloor 已按 seed+floor 确定性生成）。
// 装卸受 relicSlots 上限约束；主动遗物 prepUse 仅本阶段可触发（带次数）。

// 获得遗物入背包（初始化为满次数）
export function grantRelic(run, relicId) {
  getRelicDefinition(relicId); // 未注册直接抛错
  run.player.relics.push(relicId);
  const def = getRelicDefinition(relicId);
  if (def.uses != null) run.relicUses[relicId] = def.uses;
  return run;
}

// 装备遗物（上限校验；背包内且未装备）
export function equipRelic(run, relicId) {
  if (!run.player.relics.includes(relicId)) throw new Error(`背包中没有遗物：${relicId}`);
  if (run.player.equippedRelics.includes(relicId)) throw new Error(`遗物已装备：${relicId}`);
  if (run.player.equippedRelics.length >= run.player.relicSlots) {
    throw new Error(`遗物栏已满（上限 ${run.player.relicSlots}），先卸下再装备`);
  }
  run.player.equippedRelics.push(relicId);
  return run;
}

export function unequipRelic(run, relicId) {
  const i = run.player.equippedRelics.indexOf(relicId);
  if (i < 0) throw new Error(`遗物未装备：${relicId}`);
  run.player.equippedRelics.splice(i, 1);
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
  return run;
}
