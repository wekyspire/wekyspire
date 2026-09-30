// 「中央附近错位」取位器：所有「卡牌出现在/飞往画面中央」类演出共用的位置分配器。
//
// 背景（2026-09-30 用户定）：宾语展示、牌库焚毁飞入、造牌起点、升级/焚毁演出的
// 中央新建……全都挤在正中央一个点，并发或衔接时完全重叠。分配器按**槽位环轮转 +
// 小抖动**给每次取位一个中央附近的错开量：相邻两次必不同槽、≤7 张并发必不撞，
// 叠 ±1.2 抖动破「完全相同的复现感」。
//
// 口径约束：
//   · 只返回 **xy 偏移量**（dx/dy），各效果保留自己的基准位——z 是层语言
//     （造牌 70 > 宾语 60 > 手牌 10~40 > 区域图标 5），一律不动；
//   · dy 幅度 ≤ ~2.6：宾语展示（基准 y4）与发动卡 held（y-2）的刻意垂直分离
//     在叠加偏移后仍然成立（4-2.6=1.4 > -2）；
//   · 视觉专用随机：不影响逻辑确定性（fuzz/回放不受影响）；
//   · 发动卡 held 展示位**刻意不接**（单张语义强，瞄准线/卡面阅读都锚它）。
//
// 接入点（改这些效果时保持同源）：battleBeats/cards.js 的 _showcaseBeat /
// _departureBeat（焚毁飞入）/ _addCardBeat（造牌起点）、stagePickerKit 的
// playCardUpgrade / playCardBurn 中央新建分支。

// 槽位环：中央起手，左右交替外扩。幅度按「相邻槽 ≥ 一卡宽」标定（卡宽 20 世界
// 单位、屏宽 ±44——首版 ±7.5 实测只有 1/3 卡宽的错位，视觉上仍叠成一摞）。
// 轮转序保证**任意相邻两槽** dx ≥ 16：并发/连播的两张至少错开一整卡。
const SPOT_RING = Object.freeze([
  [0, 0], [16, 3], [-16, 3], [9, -4], [-9, -4], [22, 0], [-22, 0],
].map(([x, y]) => Object.freeze({ x, y })));

const JIT = 1.5;    // 每轴随机抖动幅度（±）
let cursor = 0;

/**
 * 取一个「中央附近」的错开量。
 * @returns {{ dx: number, dy: number }} 相对各自基准位的偏移（加在效果自己的 base 上）
 */
export function nextCardSpot() {
  const spot = SPOT_RING[cursor % SPOT_RING.length];
  cursor = (cursor + 1) % SPOT_RING.length;
  return {
    dx: spot.x + (Math.random() * 2 - 1) * JIT,
    dy: spot.y + (Math.random() * 2 - 1) * JIT,
  };
}
