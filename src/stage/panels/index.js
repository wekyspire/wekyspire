// 各休息阶段面板的构建器：「快照 → widget 列表」纯映射。
// 一个面板一个 builder；PanelObject 只认 widget 描述，不认识任何面板语义。
// action 字段即上报给宿主：`local: true` 的由舞台自己消化（面板本地交互态，如勾选），
// 其余转给 runController.dispatchPanelIntent（见 THREE_UI_MIGRATION §2.1）。
//
// 本文件只做装配与转发——各域实现在同目录：
//   shared.js     共享小件（标签映射 / DIM_META / ROOM_META / 通用按钮 / 产出文案）
//   prep.js       战前准备    reward.js    战后奖励    ascension.js 进阶事件
//   roomCamp.js   营地·训练场 roomSlot.js  老虎机/银行机 roomGurpas.js 古尔帕斯之店
//   shop.js       售货机        room.js     房间分发器

import { DIM_META, slotPrizeText } from './shared.js';
import { buildPrepPanel } from './prep.js';
import { buildRewardPanel } from './reward.js';
import { buildAscensionPanel } from './ascension.js';
import { buildRoomPanel } from './room.js';
import { buildShopPanel } from './shop.js';
import { buildSlotPanel, buildBankPanel } from './roomSlot.js';
import { buildCampPartPanel, buildTrainingPartPanel, buildCampTrainingPanel } from './roomCamp.js';

export {
  DIM_META, slotPrizeText,
  buildPrepPanel, buildRewardPanel, buildAscensionPanel,
  buildRoomPanel, buildShopPanel,
  buildSlotPanel, buildBankPanel,
  buildCampPartPanel, buildTrainingPartPanel, buildCampTrainingPanel,
};

/**
 * 快照 kind → widget builder + PanelObject 形态（**所有舞台共用一份**：
 * 塔楼层 MapStage、战斗层 BattleStage（战后奖励）、房间层 RoomStage 的 dock 面板各取所需）。
 * 未登记 kind = 该阶段没有 Three 面板（目前 stage='end' 由 Vue 的 EndPanel 接管）。
 */
export const PANEL_BUILDERS = Object.freeze({
  prep: { build: buildPrepPanel, form: 'anchored' },
  reward: { build: buildRewardPanel, form: 'modal' },
  ascension: { build: buildAscensionPanel, form: 'modal' },
  room: { build: buildRoomPanel, form: 'modal' },
  // 售货机在塔楼层的占位视图（场景式商店房走 RoomStage 的 dock 面板）：这里没有 3D 货架，
  // 所以要带购买按钮（`buttons: true`），否则降级路径上买不了东西
  shop: { build: (snap) => buildShopPanel(snap, { buttons: true }), form: 'modal' },
});
