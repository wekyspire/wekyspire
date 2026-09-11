// 场景定义：地牢长廊（STAGE_DESIGN §2）。
// battleLine：战线轴——槽位参数 t∈[0,1] 沿线 lerp 位置/缩放/z。
// **前-后占位为主（2026-08-02 用户定）**：轴沿纵深（z）走，友军前排近镜头偏左、
// 敌人后排远镜头偏右；x 向只保留少量斜漂（战场不死板、双方不成正对的平行线）。
// 小 FOV 透视下 z 差产生真实纵深；nearScale/farScale 是风格化夸张开关（当前 1/1 关闭——
// 用户定稿：透视纵深已够，机制保留）。
// 单位脚底锚定水平地板（y=FLOOR_Y），lane 为地面内横排偏移（轴法向≈屏幕横向，单位=格）。

import { buildDungeon3D, FLOOR_Y } from './dungeon3D.js';

export const DUNGEON = {
  id: 'dungeon',
  build3D: buildDungeon3D,
  battleLine: {
    near: { x: -32, y: FLOOR_Y, z: 15 },  // 友军排锚点：近镜头、偏左（z 不宜更近——下半身会被手牌扇遮）
    far: { x: 24, y: FLOOR_Y, z: -60 },   // 敌军排锚点：远镜头、偏右
    nearScale: 1,
    farScale: 1,
    laneGap: 30, // 横排轴格宽（世界单位）：轴沿 z 后 lane≈屏幕横向（斜向微升），排内间隔
  },
  slots: {
    player: { t: 0.0, lane: 0 },
    allies: [
      { t: 0.0, lane: 0.75 }, // 瑞米：主角朝敌一侧（屏幕右）同排，并列而非身后（lane+ 会被主角挡住）
      { t: 0.0, lane: 0.8 },
    ],
    // 敌排：lane 在**对称带**内按实际数量均分（slotTransform 的 count 参数负责均分，
    // 槽位表只声明带的两端 + 错落 t）。半宽 0.6 由投影实测定：相机斜视自敌侧，
    // lane +1.2 恰在右边界面（ndcX=1.000，2026-09 试玩：3 敌最右一只身体出画）；
    // 收到 ±0.6 后各数量都落在 ndcX 0.31~0.80，留出立牌半宽的余量。
    enemies: [
      { t: 0.93, lane: -0.6 },
      { t: 0.95, lane: -0.2 },
      { t: 0.93, lane: 0.2 },
      { t: 0.96, lane: 0.6 },
    ],
  },
  // 战区留白带（PCG keepout 专用，**与站位解耦**）：比站位带宽——单位只占带内一段，
  // 但战斗区（血泊/粒子/卡牌飞行路径）要整条空出来。数值 = 站位收窄前的几何，
  // 保持 PCG 布局不动（曾经耦合：改站位连带重排道具，boss 房间两件落地道具被挤到相叠）。
  keepoutSlots: {
    player: { t: 0.0, lane: 0 },
    allies: [
      { t: 0.0, lane: 0.75 },
      { t: 0.0, lane: 0.8 },
    ],
    enemies: [
      { t: 0.92, lane: -1.4 },
      { t: 0.94, lane: -0.1 },
      { t: 0.92, lane: 1.2 },
      { t: 0.96, lane: 2.2 },
    ],
  },
};
