import { promoteCard, canPromoteRuntime } from '../promotion.js';

// 营地（RUN_DESIGN §4.3）：三选一；Boss 前保底由 runFlow.roomOfFloor 调度。
// 选项随 run 状态动态可见：找回瑞米（仅被打跑时）、休整、升级卡（仅有可升级卡时）。

export const CAMP_PLACEHOLDER = {
  restHealRatio: 0.35, // 休整恢复最大生命比例（§4.3；2026-09 试玩调参：30%→35% 总生命）
};

export function campOptions(run) {
  const opts = [];
  if (run.remi.drivenOff) opts.push('recoverRemi');
  opts.push('rest');
  if (run.player.deck.some(rt => canPromoteRuntime(rt, run))) opts.push('upgrade');
  return opts;
}

// 休整：玩家 50% 生命 + 全部魏启 + 瑞米全部状态（占位：瑞米每场战斗按满血出战）
export function campRest(run) {
  const p = run.player;
  p.hp = Math.min(p.maxHp, p.hp + Math.ceil(p.maxHp * CAMP_PLACEHOLDER.restHealRatio));
  p.mana = p.maxMana;
  run.remi.drivenOff = false;
  return run;
}

// 找回瑞米（仅被打跑时可选）
export function campRecoverRemi(run) {
  if (!run.remi.drivenOff) throw new Error('瑞米未被打跑，无需找回');
  run.remi.drivenOff = false;
  return run;
}

// 升级一张卡（营地升级不计训练次数）
export function campUpgrade(run, uniqueID, targetId = null) {
  const result = promoteCard(run, uniqueID, targetId);
  if (!result) throw new Error('该卡暂无可用晋升目标，无法升级');
  return run;
}
