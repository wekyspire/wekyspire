import { promoteCard, canPromoteRuntime } from '../promotion.js';
import { getRelicDefinition } from '../../relics/registry.js';
import { activeRelics } from '../prep.js';

// 营地（RUN_DESIGN §4.3）：三选一；Boss 前保底由 runFlow.roomOfFloor 调度。
// 选项随 run 状态动态可见：找回瑞米（仅被打跑时）、休整、升级卡（仅有可升级卡时）。
// 2026-09-18 用户定：合并房里**训练先于篝火**——训练没开始（或抓卡尾款未清）时
// 篝火不可用（UI 据快照 camp.locked 压暗提示，core 侧同一守卫拦连点/直调）。

export const CAMP_PLACEHOLDER = {
  restHealRatio: 0.35, // 休整恢复最大生命比例（§4.3；2026-09 试玩调参：30%→35% 总生命）
};

// 合并房的篝火门：训练必做且先行（campTraining 房专属；单房 'camp' 无训练概念）
export function campLocked(run) {
  return run.currentRoom === 'campTraining'
    && (!run.roomData?.trained || !!run.roomData?.pendingUpgrade);
}

export function campOptions(run) {
  const opts = [];
  if (run.remi.drivenOff) opts.push('recoverRemi');
  opts.push('rest');
  if (run.player.deck.some(rt => canPromoteRuntime(rt, run))) opts.push('upgrade');
  return opts;
}

// 休整：玩家 35% 生命 + 全部魏启 + 瑞米全部状态（占位：瑞米每场战斗按满血出战）
// 每房一次的营地动作守卫（合并房里训练部分有自己的计时，互不干扰）
function markCampUsed(run) {
  if (campLocked(run)) throw new Error('先完成训练，才能使用篝火');
  if (run.roomData?.campUsed) throw new Error('本房的营地动作已经用过了');
  run.roomData = { ...(run.roomData ?? {}), campUsed: true };
}

export function campRest(run) {
  markCampUsed(run);
  const p = run.player;
  p.hp = Math.min(p.maxHp, p.hp + Math.ceil(p.maxHp * CAMP_PLACEHOLDER.restHealRatio));
  p.mana = p.maxMana;
  run.remi.drivenOff = false;
  // 非槽位式遗物的营地钩子（如山泉壶「休息时额外回 5 血」）——已激活的才算
  for (const id of activeRelics(run)) getRelicDefinition(id)?.onCampRest?.(run);
  return run;
}

// 找回瑞米（仅被打跑时可选）
export function campRecoverRemi(run) {
  if (!run.remi.drivenOff) throw new Error('瑞米未被打跑，无需找回');
  markCampUsed(run);
  run.remi.drivenOff = false;
  return run;
}

// 升级一张卡（营地升级不计训练次数）
export function campUpgrade(run, uniqueID, targetId = null) {
  markCampUsed(run);
  const result = promoteCard(run, uniqueID, targetId);
  if (!result) throw new Error('该卡暂无可用晋升目标，无法升级');
  return run;
}
