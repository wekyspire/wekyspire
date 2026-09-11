// 卡面世界尺寸（wtc，10px/世界单位 约定的产物）——战斗手牌/画廊/休息阶段面板共用同一尺寸源。
// 值 = 烘焙画布 CARD_FACE_SIZE × 1.3 缩放 / 10（2026-08 手牌观感迭代整体放大卡面）。
// 从 BattleStage 抽出的原因：休息阶段面板也要摆卡（奖励三选一、牌库选卡），
// 让通用 UI 对象反过来 import BattleStage 是错的依赖方向。

export const CARD_WIDTH = 26;
export const CARD_HEIGHT = 35.1;
