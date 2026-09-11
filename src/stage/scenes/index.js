// 场景注册表（STAGE_DESIGN §2）：战斗 → 场景定义的映射入口。
// dungeon = 手工大厅（回退/对照）；pcg:* = 房型配方层 PCG 房间（P3/P4，
// 配方按章节/Boss 选，见 rooms/index.js 的 sceneIdForFloor）。未知 id 回退 dungeon。

import { DUNGEON } from './dungeon.js';
import { getRoomScene } from './rooms/index.js';

const SCENES = Object.freeze({
  dungeon: DUNGEON,
});

/**
 * @param id 场景 id：'dungeon' | 'pcg:fortress' | 'pcg:palace' | 'pcg:manor' | 'pcg:library' | 'pcg:boss' | 'pcg:mezzanine'
 * @param seed PCG 房间种子（run 种子 + 层号派生；同种子恒定同布局）——仅 pcg:* 使用
 */
export function getScene(id = 'dungeon', seed = 'dev') {
  if (id.startsWith('pcg:')) return getRoomScene(id.slice(4), seed);
  return SCENES[id] ?? DUNGEON;
}

/**
 * 槽位 → 世界变换：position = lerp(near, far, t) + lane·laneGap。
 * @param count 同排**实际**单位数（含已阵亡者，保证倒下不挪位）：lane/t 在槽位带内
 *   按数量均分，单只取带中点。槽位表因此只声明「带的两端 + 错落 t」，不再隐含
 *   「最多几只、第几只用第几槽」——否则 3 敌会依次吃掉偏右的带的前三个槽，最右一只出画。
 */
export function slotTransform(scene, side, index = 0, count = 1) {
  const { battleLine: bl, slots } = scene;
  const list = side === 'player' ? null : (side === 'ally' ? slots.allies : slots.enemies);
  let t;
  let lane;
  if (!list || !list.length) {
    t = slots.player?.t ?? 0.5;
    lane = slots.player?.lane ?? 0;
  } else {
    const ts = list.map(s => s.t ?? 0);
    const ls = list.map(s => s.lane ?? 0);
    const t0 = Math.min(...ts); const t1 = Math.max(...ts);
    const l0 = Math.min(...ls); const l1 = Math.max(...ls);
    const k = count <= 1 ? 0.5 : index / (count - 1);
    t = t0 + (t1 - t0) * k;
    lane = l0 + (l1 - l0) * k;
  }
  const x = bl.near.x + (bl.far.x - bl.near.x) * t;
  const y = bl.near.y + (bl.far.y - bl.near.y) * t; // near.y=far.y=地板高度（脚底锚定）
  const z = bl.near.z + (bl.far.z - bl.near.z) * t;
  // lane 沿横排轴偏移（地面法向 ≈ 屏幕横向；lane+ = 屏幕左，与旧假透视语义一致）
  return {
    x: x + lane * bl.laneGap,
    y,
    z, // z 不再随 index 移动，排成一排即可
    scale: bl.nearScale + (bl.farScale - bl.nearScale) * t,
  };
}
