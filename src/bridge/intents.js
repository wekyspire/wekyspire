import {
  playerUseSkill, playerEndTurn, playerDumpCards,
  respondInput, isWaitingPlayerInput, canDumpCards,
} from '../core/flow/battle.js';
import { canUseSkill } from '../core/skills/helpers.js';

// 玩家意图层：UI 操作 → flow API 的唯一入口（Stage Picker / Shell 按钮都走这里）。
// 同时暴露可用性查询（按钮置灰、Picker 仲裁用），避免 UI 直接读 Core 状态做判断。
// 咏唱双态：打出 = 发动（付费）/ 解除（免费关停），统一走 playCard，无独立停咏入口。
export function createIntents(battle) {
  const { ctx } = battle;
  return {
    // ---- 操作（返回 bool：是否被接受） ----
    playCard: (uniqueID, targetUniqueID = null) => playerUseSkill(battle, uniqueID, targetUniqueID),
    endTurn: () => playerEndTurn(battle),
    dumpCards: (uniqueIDs) => playerDumpCards(battle, uniqueIDs),
    respondInput: (selection) => respondInput(battle, selection),

    // ---- 可用性（置灰/仲裁） ----
    canPlayCard: (uniqueID) => {
      if (!isWaitingPlayerInput(battle)) return false;
      const skill = ctx.battleState.zones.hand.find(s => s.uniqueID === uniqueID);
      return !!skill && canUseSkill(ctx, skill);
    },
    canEndTurn: () => isWaitingPlayerInput(battle),
    // 弃牌动作整体可用性（按钮置灰用）：有自由牌 + 费够 + 自由行动窗
    // （自由牌 = 未激活咏唱；迷你卡照常可弃——迷你只管手牌计数，与弃牌无关）
    canDump: () => {
      const free = ctx.battleState.zones.hand.filter(s => !s.isActivated);
      return free.length > 0 && canDumpCards(battle, [free[0].uniqueID]);
    },
  };
}
