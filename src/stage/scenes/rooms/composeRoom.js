// 房型配方层 · 房间组装器：墙/地生成 + L0-L3 红线摆放 + 合批 + 场景契约封装。
// 摆放方法 = CATALOG 地块红线法：功能分区(zoning) → 地块红线(plots) → 沿街立面(facade)
// → 撒印(stamping)，全程 createRng 确定性驱动；战场 keepout（站位 + 战线走廊）是绝对红线。
//
// 返回与 dungeon3D 同构的场景契约：{ group, torches, update, sampleStandeeTint, moonlight, skydome }
// 另暴露 placements/openings 供契约测试断言（keepout 零违例 / 红线不重叠 / 确定性）。

import * as THREE from 'three';
import {
  K, P, shade, createRng, scatter, mergeStatic, setTheme,
} from '../kit/index.js';
import { propRegistry, getProp } from '../props/index.js';
import { DUNGEON } from '../dungeon.js';
import { FLOOR_Y } from '../dungeon3D.js';
import { buildSkydome } from '../skydome.js';
import { buildMoonDust } from '../moonDust.js';
import {
  FLOOR_X0, FLOOR_X1, FLOOR_Z0, FLOOR_Z1, BACK_WALL_Z,
  buildLeftWall, buildBackWall,
} from './walls.js';
import { buildFloor } from './floor.js';
import { generateTerrain, buildTerrain } from './terrain.js';
import { createLighting } from './lighting.js';
import { getRecipe } from './presets.js';

// ---- L0 功能分区（地块红线法的带状分区；密度/格宽由配方 bandDensities 供给）----
const BANDS = {
  back: { x0: -86, x1: 134, z0: -78, z1: -64, wall: 'back' },   // 背墙边缘带（相机权重最高）
  left: { x0: -86, x1: -72, z0: -58, z1: 98, wall: 'left' },    // 左墙边缘带
  right: { x0: 102, x1: 136, z0: -58, z1: 58 },                 // 右墙边缘带（相机权重中）
  mid: { x0: -86, x1: -42, z0: -66, z1: -36 },                  // 中景带（敌侧翼，稀疏大剪影）
  midRight: { x0: 48, x1: 98, z0: -34, z1: 26 },                // 战场右翼（走廊与右墙之间，破空旷）
  fgLeft: { x0: -84, x1: -56, z0: 48, z1: 98 },                 // 前景角袋（框景大剪影，密度极低）
  fgRight: { x0: 58, x1: 96, z0: 44, z1: 96 },
  front: { x0: -38, x1: 46, z0: 56, z1: 100 },                  // 相机侧前景（小件点缀，框底边）
};

// 风味分区 tag（CATALOG2 §0.5：每件资产带且仅带一个区带 tag，多语境省视同 generic）
const ZONE_TAGS = ['prison', 'barrack', 'chapel', 'crypt', 'library', 'kitchen', 'smith', 'arcane', 'nature', 'quarters', 'vault', 'generic'];

const BAND_Y = { low: 7, mid: 20, high: 34 }; // 墙面装饰高度带（地板相对挂点高）

// ---- 战场 keepout：由 battleLine + **战区留白带**（keepoutSlots）派生 ----
// 注意用 keepoutSlots 而非 slots：后者是单位**站位**带（画面安全区，2026-09 收窄防出画），
// 留白要覆盖整条战线，两者解耦后改站位不再连带重排 PCG 道具。

function slotPos(slot) {
  const bl = DUNGEON.battleLine;
  const x = bl.near.x + (bl.far.x - bl.near.x) * slot.t;
  const z = bl.near.z + (bl.far.z - bl.near.z) * slot.t;
  return { x: x + slot.lane * bl.laneGap, z };
}

export function buildKeepout() {
  const band = DUNGEON.keepoutSlots ?? DUNGEON.slots;
  const hard = [];
  const soft = [];
  const push = (slot, half, list) => {
    const p = slotPos(slot);
    list.push({ x0: p.x - half, x1: p.x + half, z0: p.z - half, z1: p.z + half });
  };
  push(band.player, 11, hard);
  push(band.player, 8, soft);
  for (const s of band.allies) { push(s, 9, hard); push(s, 7, soft); }
  for (const s of band.enemies) { push(s, 10, hard); push(s, 8, soft); }
  // 战线走廊：near→far 三段 AABB（半宽 14，盖卡牌飞行路径）
  const bl = DUNGEON.battleLine;
  for (const t of [0.15, 0.5, 0.85]) {
    const cx = bl.near.x + (bl.far.x - bl.near.x) * t;
    const cz = bl.near.z + (bl.far.z - bl.near.z) * t;
    hard.push({ x0: cx - 14, x1: cx + 14, z0: cz - 14, z1: cz + 14 });
  }
  return { hard, soft };
}

const rectsIntersect = (a, b) => a.x0 < b.x1 && a.x1 > b.x0 && a.z0 < b.z1 && a.z1 > b.z0;

// ---- 选品：tag 权重池（区带 tag + 内容 tag 加权；flash 产线已对齐此口径）----
function zoneOf(def) {
  for (const t of def.tags || []) if (ZONE_TAGS.includes(t)) return t;
  return 'generic';
}

function tagWeight(def, weights = {}) {
  let w = weights[zoneOf(def)] || 0;
  for (const t of def.tags || []) w += weights[t] || 0;
  return w;
}

function poolByPlace(place, weights) {
  return [...propRegistry.values()].filter(d => d.place === place && tagWeight(d, weights) > 0);
}

function pickWeighted(rng, pool, weights, { sizeBias = 0, wideBias = 0 } = {}) {
  const w = (d) => {
    let x = tagWeight(d, weights);
    if (sizeBias > 0 && d.footprint) x *= 1 + (Math.max(d.footprint.x, d.footprint.z) / 8) * sizeBias;
    if (wideBias > 0 && d.bayWidth === 2) x *= wideBias;
    return x;
  };
  let total = 0;
  for (const d of pool) total += w(d);
  if (total <= 0) return null;
  let roll = rng() * total;
  for (const d of pool) {
    roll -= w(d);
    if (roll <= 0) return d;
  }
  return pool[pool.length - 1];
}

// ---- 摆位记录（placements）：暴露给契约测试 ----
function measure(obj) {
  const b = new THREE.Box3().setFromObject(obj);
  return { height: b.max.y - b.min.y };
}

/**
 * 组装一个房间。
 * @param recipeId 配方 id（presets.js）
 * @param seed 房间种子（同种子恒定同布局）
 */
export function composeRoom(recipeId, seed = 'dev') {
  const recipe = getRecipe(recipeId);
  setTheme(recipe.theme);
  const keepout = buildKeepout();
  // 房间有效边界（阶段配方 room.scale 缩小空间：右缘/近缘收入，左/背墙与战斗几何不动）；
  // 近缘半率收缩（相机在近缘外，收太多会露出地板边）
  const rs = recipe.room?.scale ?? 1;
  const RX1 = FLOOR_X0 + (FLOOR_X1 - FLOOR_X0) * rs;
  const RZ1 = FLOOR_Z0 + (FLOOR_Z1 - FLOOR_Z0) * (1 - (1 - rs) * 0.5);
  const placements = []; // {id, place, x, y, z, ry, fx, fz, height, tags, onWall}
  const occupied = [];   // 地板红线（XZ 矩形）
  const staticRoot = new THREE.Group();
  staticRoot.name = `room:${recipeId}`;
  // 地板与撒印独立合批：它们是贴地接收面，castShadow 必须关——
  // 水平薄板对低角度月光自投影 = 全场阴影痤疮（dungeon3D 地板只 receive 的口径）
  const floorRoot = new THREE.Group();
  floorRoot.name = 'room:floor';
  const decalRoot = new THREE.Group();
  decalRoot.name = 'room:decals';

  // 摆位记录（placements）：暴露给契约测试。onWall=墙面挂件；hosted=宿主顶摆件
  // （与宿主同 x/z，不参与地板红线）；floating=顶挂（悬空，不涉地板红线）；
  // composition=配方构图定点（压阵大件，允许进战场 keepout，by design）。
  // scale=落地件整体放大系数（相机不动靠体量撑场面；fp 同步缩放，红线语义不变）。
  const track = (def, obj, {
    x, y, z, ry = 0, onWall = false, hosted = false, composition = false, root = staticRoot, scale = 1,
    tiltX = 0, tiltZ = 0,
  }) => {
    obj.position.set(x, y, z);
    obj.rotation.y = ry;
    if (tiltX) obj.rotation.x = tiltX; // 斜坡姿态：垂直坡面法线（用户定，非水平摆放）
    if (tiltZ) obj.rotation.z = tiltZ;
    if (scale !== 1) obj.scale.setScalar(scale);
    root.add(obj);
    const fp = def.footprint || { x: 1, z: 1 };
    const { height } = measure(obj);
    placements.push({
      id: def.id, place: def.place, x, y, z, ry,
      fx: (fp.x / 2) * scale, fz: (fp.z / 2) * scale, height, tags: def.tags || [],
      onWall, hosted, floating: def.mount === 'ceiling', composition,
    });
    return height;
  };

  // ---- 地形分区（低谷/高台/裂缝/斜坡；用户定五类规则）----
  // 在 keepout 之后、一切摆放之前生成：分区避让站位区（单位永不踏上地形 = 站位区留空），
  // 摆放器经 terra.heightAt/zoneAt/tiltAt 取放置高度/选品限制/斜坡姿态。
  const terra = generateTerrain(
    createRng(`${seed}:${recipeId}:terrain`),
    recipe,
    keepout,
    [...(recipe.fires || []), ...(recipe.guaranteed || [])],
    { x1: RX1, z1: RZ1 },
  );
  const ty = (x, z) => FLOOR_Y + terra.heightAt(x, z); // 放置高度（室内地平为基准）
  const terraIsBarren = (x, z) => { const t = terra.zoneAt(x, z)?.type; return t === 'slope' || t === 'fissure'; };

  // ---- 墙与地（独立 rng 流，子布局稳定）----
  const wallRng = createRng(`${seed}:${recipeId}:wall`);
  const wallTh = recipe.wall?.thickness ?? 12; // 配方可减薄（隔层）——内侧面/战斗几何不动
  const left = buildLeftWall(wallRng, { windows: recipe.wall.windows, brickChance: recipe.wall.brickChance, skinCfg: recipe.wallSkin, wallTh });
  staticRoot.add(left.group);
  const door = recipeId === 'boss' ? { x: 24, w: 18, h: 28 } : { x: 30, w: 13, h: 22 };
  const back = buildBackWall(wallRng, { door, slits: recipe.wall.slits, brickChance: recipe.wall.brickChance, skinCfg: recipe.wallSkin, wallTh });
  staticRoot.add(back.group);
  floorRoot.add(K.put(buildFloor(createRng(`${seed}:${recipeId}:floor`), {
    ...recipe.floor,
    avoid: terra.pitRects,
    area: { x0: FLOOR_X0 + 8, z0: FLOOR_Z0 + 6, x1: RX1 - 10, z1: RZ1 - 14 },
  }), 0, FLOOR_Y, 0));
  staticRoot.add(K.put(buildTerrain(terra.grid), 0, FLOOR_Y, 0)); // 体素柱地形（台/坑/缝/坡，与道具同批）

  // ---- 摆放工具：占用红线 ----
  const claim = (x, z, fx, fz, margin = 1.2) => {
    const r = { x0: x - fx - margin, x1: x + fx + margin, z0: z - fz - margin, z1: z + fz + margin };
    occupied.push(r);
    return r;
  };
  const blocked = (x, z, fx, fz, margin = 1.2) => {
    const r = { x0: x - fx - margin, x1: x + fx + margin, z0: z - fz - margin, z1: z + fz + margin };
    return keepout.hard.some(k => rectsIntersect(r, k)) || occupied.some(o => rectsIntersect(r, o));
  };

  const scatterScale = recipe.scatter.scale ?? 1; // 落地件放大系数（体量撑场面，相机不动）

  // ---- 单调打断体（breaker）：打破"两面墙+一个地板"的基本几何组合（用户定原则）----
  // 手段不限于立柱：房中立柱/断柱、墙角塌方体（大石块向上堆高）、岩堆、
  // 木箱高塔（向上堆积）、贴墙斜倒石板（斜线破竖横）——按候选点语义 rng 选型。
  // 所有点位都不进战线走廊（blocked() 由 keepout 保证），footprint 走 scatterScale 放大。
  const breakerRng = createRng(`${seed}:${recipeId}:breaker`);
  const columnDef = getProp('columnRound');
  // 程序化打断体（与 cratePile 同范式：合成 def，几何全走 kit 图元）
  const BREAKER_DEFS = {
    collapsedCorner: {
      id: 'collapsedCorner', place: 'prop', tags: ['stone', 'rubble'], behaviors: [],
      footprint: { x: 13, z: 13 }, // 墙角塌方：充填一角，石块两三层向上堆
      build({ rng }) {
        const g = new THREE.Group();
        const n = 5 + Math.floor(rng() * 3);
        for (let i = 0; i < n; i++) {
          const s = 3.5 + rng() * 3.5;
          const b = K.box({ color: shade(P.stone, -0.16 + rng() * 0.2), size: [s, s * (0.6 + rng() * 0.5), s * (0.7 + rng() * 0.4)] });
          K.jitter(b, rng, { pos: 0.08, rot: 0.03 });
          const ring = i < 3 ? 4.2 : 1.2; // 底层贴外圈、上层收进中心 = 塌落堆形
          const a = rng() * Math.PI * 2;
          K.put(b, Math.cos(a) * ring, s * 0.32 + (i >= 3 ? 4.5 + rng() * 2 : 0), Math.sin(a) * ring);
          b.rotation.y = rng() * Math.PI;
          g.add(b);
        }
        return g;
      },
    },
    rockPile: {
      id: 'rockPile', place: 'prop', tags: ['stone', 'rubble'], behaviors: [],
      footprint: { x: 10, z: 9 },
      build({ rng }) {
        const g = new THREE.Group();
        const n = 4 + Math.floor(rng() * 3);
        for (let i = 0; i < n; i++) {
          const r = 1.8 + rng() * 2.2;
          const rock = K.cyl({ color: shade(P.stone, -0.1 + rng() * 0.18), r, rTop: r * (0.55 + rng() * 0.3), h: r * (0.9 + rng() * 0.6), seg: 6 });
          K.jitter(rock, rng, { pos: 0.06, rot: 0.04 });
          K.put(rock, (rng() - 0.5) * 5.5, r * 0.4 + (i >= 3 ? r * 0.8 : 0), (rng() - 0.5) * 4.5);
          rock.rotation.y = rng() * Math.PI;
          g.add(rock);
        }
        return g;
      },
    },
    crateTower: {
      id: 'crateTower', place: 'prop', tags: ['container', 'generic'], behaviors: [],
      footprint: { x: 6.5, z: 6.5 }, // 向上堆积：2~3 层大木箱塔（竖向体量）
      build({ rng }) {
        const g = new THREE.Group();
        const levels = 2 + Math.floor(rng() * 2);
        for (let lv = 0; lv < levels; lv++) {
          for (let k = 0; k < 2; k++) {
            if (lv > 0 && rng() < 0.3) continue;
            const s = 2.8 + rng() * 0.9;
            const b = K.box({ color: shade(P.wood, -0.18 + rng() * 0.2), size: [s, s, s] });
            K.jitter(b, rng, { pos: 0.04, rot: 0.02 });
            K.put(b, (k - 0.5) * (s + 0.3) + (rng() - 0.5), s / 2 + lv * (s + 0.15), (rng() - 0.5) * 1.5);
            b.rotation.y = (rng() - 0.5) * 0.4;
            g.add(b);
          }
        }
        return g;
      },
    },
    leaningSlab: {
      id: 'leaningSlab', place: 'prop', tags: ['stone', 'rubble'], behaviors: [],
      footprint: { x: 5, z: 9 }, // 斜线：断板斜靠墙面（顶端倒向墙，碎块散在板脚）
      build({ rng }) {
        const g = new THREE.Group();
        const inner = new THREE.Group();
        // 尺寸克制（用户三轮报障"墙色大长方体/体素墙缺失"实为斜板冒充墙体）：
        // 窄板（4~5.4 宽）+ 低板（13~20 高）+ 陡斜（42°+）——读作"塌下来的断板"而非墙
        const h = 13 + rng() * 7;
        const slab = K.box({ color: shade(P.stone, -0.3 + rng() * 0.16), size: [3.8 + rng() * 1.6, h, 2.2] });
        K.jitter(slab, rng, { rot: 0.012 });
        K.chip(slab, { corner: [1, 1, 1], amount: 0.35 }); // 顶角崩缺
        K.put(slab, 0, h / 2 - 0.5, 0);
        inner.add(slab);
        // 断口截面：板顶一道浅色茬口（读出断裂面）
        inner.add(K.put(K.box({ color: shade(P.stone, 0.02), size: [3.4, 0.7, 2.0] }), 0, h - 0.8, 0));
        // 板面裂缝两道（深色细条贴面）
        for (let i = 0; i < 2; i++) {
          const crack = K.box({ color: shade(P.night, 0.1), size: [0.4 + rng() * 0.5, h * (0.3 + rng() * 0.3), 0.2], family: 'unlit' });
          K.tilt(crack, 0, 0, (rng() - 0.5) * 0.5);
          inner.add(K.put(crack, (rng() - 0.5) * 2.4, h * (0.35 + rng() * 0.3), 1.15));
        }
        for (let i = 0; i < 3; i++) {
          const s = 1.2 + rng() * 1.2;
          const b = K.box({ color: shade(P.stone, -0.2 + rng() * 0.18), size: [s, s * 0.7, s] });
          K.put(b, (rng() - 0.5) * 4, s * 0.3, 2.4 + rng() * 2.2);
          b.rotation.y = rng() * Math.PI;
          inner.add(b);
        }
        // 斜靠：rotation.x 正值把顶端倒向局部 -z（由 spot.ry 把局部 -z 对准墙）
        inner.rotation.x = 0.42 + rng() * 0.18;
        g.add(inner);
        return g;
      },
    },
  };
  // 候选点：两翼/近景（柱、塔、岩堆）+ 贴墙线（斜靠板）+ 墙角（塌方/岩堆，corner 标记）
  const BREAKER_SPOTS = [
    { x: -52, z: -30 }, { x: -50, z: -4 },               // 左翼（左墙与战场之间）
    { x: 66, z: -10 }, { x: 74, z: 16 }, { x: 92, z: -22 }, // 右翼（右墙与敌排之间）
    { x: 38, z: 40 }, { x: -46, z: 44 },                 // 近景框边（相机侧大剪影）
    { x: -60, z: -70, ry: 0 }, { x: 48, z: -70, ry: 0 },      // 背墙贴墙线
    { x: -82, z: 30, ry: Math.PI / 2 }, { x: -82, z: -52, ry: Math.PI / 2 }, // 左墙贴墙线
    { x: -76, z: -71, corner: true }, { x: 120, z: -71, corner: true },      // 背墙两角（塌方叙事位）
  ];
  const pickBreaker = (rng, spot) => {
    if (spot.corner) return rng() < 0.55 ? 'collapsedCorner' : 'rockPile';
    if (spot.ry !== undefined) return rng() < 0.45 ? 'leaningSlab' : 'rockPile';
    const roll = rng();
    return roll < 0.45 ? 'column' : roll < 0.72 ? 'crateTower' : 'rockPile';
  };
  const brPicks = [...BREAKER_SPOTS];
  for (let i = brPicks.length - 1; i > 0; i--) {
    const j = Math.floor(breakerRng() * (i + 1));
    [brPicks[i], brPicks[j]] = [brPicks[j], brPicks[i]];
  }
  for (const spot of brPicks.slice(0, recipe.breakers ?? 5)) {
    const kind = pickBreaker(breakerRng, spot);
    let def; let buildOpts = { rng: createRng(`${seed}:${recipeId}:br:${spot.x}:${spot.z}`) };
    if (kind === 'column') {
      const broken = breakerRng() < 0.3;
      def = columnDef;
      buildOpts = { ...buildOpts, shaftH: broken ? 12 + breakerRng() * 12 : 34 + breakerRng() * 26 };
    } else {
      def = BREAKER_DEFS[kind];
    }
    const fp = def.footprint || { x: 4, z: 4 };
    // 斜靠板收 cap（用户报障：2.2× 后是墙色巨板，读作旧墙体——它只需"斜线破竖横"，不需撑体量）
    const ksc = kind === 'leaningSlab' ? Math.min(scatterScale, 1.35) : scatterScale;
    const bhx = (fp.x / 2) * ksc;
    const bhz = (fp.z / 2) * ksc;
    if (terraIsBarren(spot.x, spot.z)) continue; // 坡/缝不放打断体（大件插不进坡面）
    if (blocked(spot.x, spot.z, bhx, bhz, 1.2)) continue;
    const obj = def.build(buildOpts);
    // 斜靠板必须让局部 -z 对准墙（spot.ry），其余面向战场中轴
    const ry = spot.ry !== undefined ? spot.ry + (breakerRng() - 0.5) * 0.2
      : Math.atan2(0 - spot.x, -10 - spot.z);
    track(def, obj, { x: spot.x, y: ty(spot.x, spot.z), z: spot.z, ry, scale: ksc });
    claim(spot.x, spot.z, bhx, bhz, 1.2);
  }

  // ---- 皮肤咬口底部瓦砾接续：坍塌咬口在地板上留下石堆（墙→地叙事连续，wallSkin.floorRects）----
  for (const [wallSide, skin] of [['left', left.skin], ['back', back.skin]]) {
    for (const fr of skin?.floorRects || []) {
      const u = (fr.u0 + fr.u1) / 2;
      const x = wallSide === 'left' ? FLOOR_X0 + 6 : u;
      const z = wallSide === 'left' ? u : BACK_WALL_Z + 6.5;
      const def = BREAKER_DEFS.rockPile;
      const ksc = Math.min(scatterScale, 6.2 / (def.footprint.z / 2)); // 贴墙行深度 cap（同角簇口径）
      const fpx = (def.footprint.x / 2) * ksc; const fpz = (def.footprint.z / 2) * ksc;
      if (terraIsBarren(x, z)) continue;
      if (blocked(x, z, fpx, fpz, 1.2)) continue;
      const obj = def.build({ rng: createRng(`${seed}:${recipeId}:spill:${wallSide}:${Math.round(u)}`) });
      track(def, obj, { x, y: ty(x, z), z, ry: Math.atan2(0 - x, -10 - z), scale: ksc });
      claim(x, z, fpx, fpz, 1.2);
    }
  }


  // ---- L1 地块红线：边缘带/中景/前景逐格撒布 ----
  const plotRng = createRng(`${seed}:${recipeId}:plot`);
  const normalPool = poolByPlace('prop', recipe.scatter.tags)
    .concat(poolByPlace('smallWall', recipe.scatter.tags));
  const bigPool = (recipe.bigSilhouettes || []).map(id => getProp(id));
  const fireAnchorOf = (p) => {
    if (!p.tags.some(t => t === 'lightSource' || t === 'fire')) return null;
    return { x: p.x, y: p.y + (p.onWall ? 1.5 : Math.min(p.height * 0.75, 5)), z: p.z };
  };
  const fireAnchors = [];   // 构图定点火源（最高优先级，必发光）
  const fireExtra = [];   // 撒布/立面收集的火位（cap 富余时依次点亮）

  // 扶壁肋墙带避让：件背缘与墙面间隙小于肋深时，给出沿离墙方向的推距（不推=0）。
  // 墙裙恒定 1.6 深，由基础间隙 2.0 覆盖；肋体更深，逐个核算。
  const ribPush = (wallKey, cx, cz, halfAlong, halfDeep) => {
    if (wallKey === 'back') {
      const gap = cz - halfDeep - BACK_WALL_Z;
      if (gap >= 2.0) return 0;
      for (const r of back.relief) {
        if (cx + halfAlong > r.u0 && cx - halfAlong < r.u1 && gap < r.depth + 0.4) return r.depth + 0.4 - gap;
      }
      return 2.0 - gap;
    }
    if (wallKey === 'left') {
      const gap = cx - halfDeep - FLOOR_X0;
      if (gap >= 2.0) return 0;
      for (const r of left.relief) {
        if (cz + halfAlong > r.u0 && cz - halfAlong < r.u1 && gap < r.depth + 0.4) return r.depth + 0.4 - gap;
      }
      return 2.0 - gap;
    }
    return 0;
  };

  for (const [bandKey, band] of Object.entries(BANDS)) {
    const cfg = recipe.scatter.bands[bandKey];
    if (!cfg || cfg.density <= 0) continue;
    const isEdge = bandKey === 'back' || bandKey === 'left' || bandKey === 'right';
    const nx = Math.max(1, Math.floor((band.x1 - band.x0) / cfg.cell));
    const nz = Math.max(1, Math.floor((band.z1 - band.z0) / cfg.cell));
    for (let ix = 0; ix < nx; ix++) {
      for (let iz = 0; iz < nz; iz++) {
        if (plotRng() >= cfg.density) continue;
        const cx = band.x0 + (ix + 0.5) * cfg.cell + (plotRng() - 0.5) * cfg.cell * 0.3;
        const cz = band.z0 + (iz + 0.5) * cfg.cell + (plotRng() - 0.5) * cfg.cell * 0.3;
        // 大剪影池：前景/中景高概率，边缘带也有机会（破"小而碎"的处方手段）
        const bigChance = (bandKey === 'fgLeft' || bandKey === 'fgRight' || bandKey === 'mid') ? 0.65
          : isEdge ? 0.45 : 0;
        const useBig = bigPool.length && plotRng() < bigChance;
        const cellPool = useBig ? bigPool : normalPool.filter(d => {
          const fp = d.footprint || { x: 2, z: 2 };
          return Math.max(fp.x, fp.z) <= cfg.cell * 0.95;
        });
        // 地形分区选品限制（用户定）：裂缝/斜坡仅 rubble 类装饰；斜坡另限小型件
        const zn0 = terra.zoneAt(cx, cz);
        const pool = (zn0?.type === 'fissure' || zn0?.type === 'slope')
          ? cellPool.filter(d => (d.tags || []).includes('rubble')
              && Math.max(d.footprint?.x ?? 2, d.footprint?.z ?? 2) <= (zn0.type === 'slope' ? 3.5 : 99))
          : cellPool;
        // sizeBias：大件权重上浮（堆积感的大物体优先于小零碎）
        const def = pickWeighted(plotRng, pool, recipe.scatter.tags, { sizeBias: 1 });
        if (!def) continue;
        const fp = def.footprint || { x: 2, z: 2 };
        // 落地件按 scatterScale 放大：红线/keepout/扶壁肋避让全部按放大后口径核算。
        // 墙带深度有限（14）：深度方向半跨 >5.4 的件按带深收 cap（不穿墙、不探进战场）
        let isc = scatterScale;
        if (band.wall === 'back') isc = Math.min(isc, 5.4 / (fp.z / 2));
        else if (band.wall === 'left') isc = Math.min(isc, 5.4 / (fp.x / 2));
        const hx = (fp.x / 2) * isc;
        const hz = (fp.z / 2) * isc;
        let px = cx; let pz = cz;
        if (band.wall === 'back') pz += ribPush('back', px, pz, hx, hz);
        else if (band.wall === 'left') px += ribPush('left', px, pz, hz, hx);
        if (blocked(px, pz, hx, hz)) continue;
        const obj = def.build({ rng: createRng(`${seed}:${recipeId}:p${placements.length}`) });
        // 面向战场中轴（+z 为资产观众侧）；斜坡带 tilt（垂直坡面法线躺贴）
        const ry = Math.atan2(0 - px, -10 - pz);
        const tilt = terra.tiltAt(px, pz) || {};
        track(def, obj, { x: px, y: ty(px, pz), z: pz, ry, scale: isc, ...tilt });
        claim(px, pz, hx, hz);
        const anchor = fireAnchorOf(placements[placements.length - 1]);
        if (anchor) fireExtra.push(anchor);
        // 堆积感：边缘带主物旁补一个小件货堆（桶挨着箱、筐挨着架）；坡/缝不补
        if (isEdge && !terraIsBarren(px, pz) && plotRng() < 0.6) {
          const compPool = normalPool.filter(d => {
            const f = d.footprint || { x: 2, z: 2 };
            return Math.max(f.x, f.z) <= 4.5;
          });
          const comp = pickWeighted(plotRng, compPool, recipe.scatter.tags);
          if (comp) {
            const cfp = comp.footprint || { x: 2, z: 2 };
            let csc = scatterScale;
            if (band.wall === 'back') csc = Math.min(csc, 5.4 / (cfp.z / 2));
            else if (band.wall === 'left') csc = Math.min(csc, 5.4 / (cfp.x / 2));
            const chx = (cfp.x / 2) * csc;
            const chz = (cfp.z / 2) * csc;
            const sgn = plotRng() < 0.5 ? -1 : 1;
            const along = bandKey === 'back' ? [sgn, 0] : [0, sgn]; // 沿墙方向贴靠
            let ox = px + along[0] * (hx + chx + 0.6);
            let oz = pz + along[1] * (hz + chz + 0.6);
            if (band.wall === 'back') oz += ribPush('back', ox, oz, chx, chz);
            else if (band.wall === 'left') ox += ribPush('left', ox, oz, chz, chx);
            if (!blocked(ox, oz, chx, chz, 0.8)) {
              const cobj = comp.build({ rng: createRng(`${seed}:${recipeId}:p${placements.length}`) });
              track(comp, cobj, { x: ox, y: ty(ox, oz), z: oz, ry: Math.atan2(0 - ox, -10 - oz), scale: csc });
              claim(ox, oz, chx, chz, 0.8);
              const cAnchor = fireAnchorOf(placements[placements.length - 1]);
              if (cAnchor) fireExtra.push(cAnchor);
            }
          }
        }
        // 宿主层级：smallWall 顶面可再摆小件（topY 随宿主缩放）
        if (def.place === 'smallWall' && def.topY >= 3 && plotRng() < 0.4) {
          const topPool = normalPool.filter(d => (d.mount === 'smallWallTop' || (Array.isArray(d.mount) && d.mount.includes('smallWallTop'))));
          const top = pickWeighted(plotRng, topPool, recipe.scatter.tags);
          if (top) {
            const tobj = top.build({ rng: createRng(`${seed}:${recipeId}:t${placements.length}`) });
            track(top, tobj, { x: px, y: ty(px, pz) + def.topY * isc, z: pz, ry: plotRng() * Math.PI * 2, hosted: true });
          }
        }
      }
    }
  }

  // ---- 构图定点火源 + 压阵大件（不走格子，坐标为配方处方）----
  // 火源先查 blocked（keepout + 已占红线）：处方坐标被 breaker/撒布占时沿螺旋环带
  // 就近挪步找空位——火是构图锚点，不能与任何落地件交叠（红线测试两两不交）。
  const FIRE_NUDGES = [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5], [5, 5], [-5, 5], [5, -5], [-5, -5],
    [10, 0], [0, 10], [-10, 0], [0, -10], [10, 5], [-10, -5], [10, -5], [-10, 5]];
  for (const f of recipe.fires || []) {
    const def = getProp(f.id);
    const fsc = scatterScale; // 火源道具同倍放大（2x 道具丛里的小火盆会失衡）
    const fhx = ((def.footprint?.x ?? 2) / 2) * fsc;
    const fhz = ((def.footprint?.z ?? 2) / 2) * fsc;
    const fireOk = (x, z) => !blocked(x, z, fhx, fhz) && !terraIsBarren(x, z);
    const nudge = FIRE_NUDGES.find(([dx, dz]) => fireOk(f.x + dx, f.z + dz)) || [0, 0];
    const fx = f.x + nudge[0];
    const fz = f.z + nudge[1];
    const obj = def.build({ rng: createRng(`${seed}:${recipeId}:f:${f.id}`) });
    track(def, obj, { x: fx, y: ty(fx, fz), z: fz, ry: Math.atan2(0 - fx, -10 - fz), scale: fsc });
    claim(fx, fz, fhx, fhz);
    fireAnchors.push({ x: fx, y: FLOOR_Y + Math.min(measure(obj).height * 0.75, 5), z: fz });
  }
  for (const g of recipe.guaranteed || []) {
    const def = getProp(g.id);
    const obj = def.build({ rng: createRng(`${seed}:${recipeId}:g:${g.id}`) });
    track(def, obj, { x: g.x, y: FLOOR_Y, z: g.z, ry: g.ry ?? 0, composition: true });
    claim(g.x, g.z, (def.footprint?.x ?? 2) / 2, (def.footprint?.z ?? 2) / 2);
    const anchor = fireAnchorOf(placements[placements.length - 1]);
    if (anchor) fireAnchors.push(anchor);
  }

  // ---- 墙根角簇：大件沿墙密堆积，塑造几何起伏（用户反馈"墙角没有大件堆积"）----
  // 每簇 3~5 件沿墙线性密排（间距 0.4~1.0），首件高概率是程序化木箱货堆——
  // 兜底保证每个激活角都有"立方体级"体量；选品走 container/furniture 中大件池。
  const clusterRng = createRng(`${seed}:${recipeId}:cluster`);
  const clusterWeights = { container: 2.2, furniture: 1.4, generic: 1.2, ...recipe.scatter.tags };
  const clusterPool = [...propRegistry.values()].filter(d => {
    if (d.place !== 'prop' || !d.footprint) return false;
    const m = Math.max(d.footprint.x, d.footprint.z);
    return m >= 2.5 && m <= 8.5;
  });
  const cratePileDef = {
    id: 'cratePile', place: 'prop', tags: ['container', 'generic'], behaviors: [],
    footprint: { x: 7, z: 6 },
    build({ rng }) {
      const g = new THREE.Group();
      const n = 3 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        const s = 2.4 + rng() * 2.2;
        const b = K.box({ color: shade(P.wood, -0.18 + rng() * 0.22), size: [s, s * (0.65 + rng() * 0.5), s * (0.75 + rng() * 0.35)] });
        K.jitter(b, rng, { pos: 0.06, rot: 0.025 });
        K.put(b, (rng() - 0.5) * 3.2, s * 0.36 + (i >= 2 ? s * 0.55 : 0), (rng() - 0.5) * 2.4);
        b.rotation.y = rng() * Math.PI;
        g.add(b);
      }
      const plank = K.box({ color: shade(P.wood, -0.28), size: [6.4, 0.5, 1.7] });
      K.put(plank, 0.6, 3.2, 0.8);
      plank.rotation.z = 0.22;
      plank.rotation.y = 0.4;
      g.add(plank);
      return g;
    },
  };
  // 角簇锚点：背墙两端 + 左墙两端（相机可见侧）；axis=沿墙走向，wall=墙面内缘坐标
  const CLUSTER_SPOTS = [
    { axis: 'x', wall: BACK_WALL_Z, from: -84, to: -56 },
    { axis: 'x', wall: BACK_WALL_Z, from: 124, to: 96 },
    { axis: 'z', wall: FLOOR_X0, from: -72, to: -48 },
    { axis: 'z', wall: FLOOR_X0, from: 86, to: 58 },
  ];
  const spots = CLUSTER_SPOTS.slice(0, recipe.clusters ?? 3);
  for (const spot of spots) {
    const dir = Math.sign(spot.to - spot.from);
    let u = spot.from;
    const target = 3 + Math.floor(clusterRng() * 3);
    for (let n = 0; n < target && (u - spot.to) * dir <= 0; n++) {
      // 首件 75% 用程序化货堆（保证体量），其余从 container 大件池选；
      // 地形限制（用户定）：斜坡不放（大件躺不进坡面），裂缝仅 rubble
      const kzn = terra.zoneAt(
        spot.axis === 'x' ? u : spot.wall,
        spot.axis === 'x' ? spot.wall : u,
      );
      if (kzn?.type === 'slope') break;
      let def = (n === 0 && clusterRng() < 0.75) ? cratePileDef
        : pickWeighted(clusterRng, clusterPool, clusterWeights, { sizeBias: 1.2 });
      if (kzn?.type === 'fissure') {
        def = pickWeighted(clusterRng, clusterPool.filter(d => (d.tags || []).includes('rubble')), clusterWeights);
      }
      if (!def) def = cratePileDef;
      const fp = def.footprint || { x: 2, z: 2 };
      const along = spot.axis === 'x' ? fp.x : fp.z;   // 沿墙方向跨度
      const deep = spot.axis === 'x' ? fp.z : fp.x;    // 垂直墙方向跨度
      const ksc = Math.min(scatterScale, 6.2 / (deep / 2)); // 贴墙行深度有限，按墙深收 cap
      const khx = (fp.x / 2) * ksc;
      const khz = (fp.z / 2) * ksc;
      const kalong = (along / 2) * ksc;
      const kdeep = (deep / 2) * ksc;
      let cx = spot.axis === 'x' ? u + dir * kalong : spot.wall + kdeep + 0.4;
      let cz = spot.axis === 'x' ? spot.wall + kdeep + 0.4 : u + dir * kalong;
      // 扶壁肋/墙裙避让：背墙簇沿 +z 推、左墙簇沿 +x 推
      if (spot.axis === 'x') cz += ribPush('back', cx, cz, khx, khz);
      else cx += ribPush('left', cx, cz, khz, khx);
      if (blocked(cx, cz, khx, khz, 1.2)) { u += dir * (kalong * 2 + 2); continue; }
      const obj = def.build({ rng: createRng(`${seed}:${recipeId}:k${placements.length}`) });
      track(def, obj, { x: cx, y: ty(cx, cz), z: cz, ry: Math.atan2(0 - cx, -10 - cz), scale: ksc });
      claim(cx, cz, khx, khz, 1.2);
      const kAnchor = fireAnchorOf(placements[placements.length - 1]);
      if (kAnchor) fireExtra.push(kAnchor);
      u += dir * (kalong * 2 + 1.0 + clusterRng() * 1.2);
    }
  }

  // ---- L2 沿街立面：bay 分段 → 开口避让 → wallStructure（允许同 bay 叠加）→ wallDecor（并集层）----
  // 组合规则（用户定）：bay 只被"开口"硬门约束；墙面结构（柱/凸拱/壁炉/扶壁件）允许互相
  // 重叠摆放（同 bay 主结构 + 叠加结构，二次 roll 排除同 def），扶壁肋只挡装饰不挡结构；
  // 墙面装饰 = 并集层——在除开口/肋体外的所有 bay 独立 roll，与被结构占据的 bay 共存
  // （被凸起遮住的装饰自然浪费，露出的部分强化"挂在上面的组合感"）。
  const facadeRng = createRng(`${seed}:${recipeId}:facade`);
  const structurePool = poolByPlace('wallStructure', recipe.facade.tags);
  const decorPool = poolByPlace('wallDecor', recipe.facade.tags);
  const decorateWall = (wall) => {
    const bayCount = Math.floor((wall.u1 - wall.u0) / wall.bay);
    const openFree = new Array(bayCount).fill(true);  // 开口硬门：结构/装饰都不放
    const ribFree = new Array(bayCount).fill(true);   // 肋门：只挡装饰（结构可叠上肋体）
    const uOf = i => wall.u0 + i * wall.bay;
    const openingBays = wall.openings.map(([a, b]) => [
      Math.floor((a - wall.u0) / wall.bay), Math.ceil((b - wall.u0) / wall.bay),
    ]);
    for (const [a, b] of openingBays) {
      for (let i = Math.max(0, a - 1); i <= Math.min(bayCount - 1, b); i++) openFree[i] = false;
    }
    // 扶壁肋占用区间：肋上及两侧 bay 不挂饰（挂件会悬在肋外或插进肋体），但允许叠结构
    for (const r of wall.reserved || []) {
      const a = Math.floor((r.u0 - wall.u0) / wall.bay);
      const b = Math.ceil((r.u1 - wall.u0) / wall.bay);
      for (let i = Math.max(0, a); i <= Math.min(bayCount - 1, b); i++) ribFree[i] = false;
    }
    const maint = recipe.maintenance ?? 0; // 维护度：墙饰歪挂概率/歪斜幅度（阶段配方驱动）
    const placeAt = (def, u, y, isDecor = false) => {
      const obj = def.build({ rng: createRng(`${seed}:${recipeId}:w:${placements.length}`) });
      const pos = wall.axis === 'x'
        ? { x: u, y, z: wall.face + 0.15 }
        : { x: wall.face + 0.15, y, z: u };
      // 维护差 → 挂饰歪挂：绕贴墙轴小角度旋 + 离墙点松脱（paintingTilted 是"天生歪"，这里是后天歪）
      let ry = wall.ry;
      if (isDecor && maint > 0 && facadeRng() < maint * 0.55) {
        ry += (facadeRng() - 0.5) * 0.5 * maint;
        if (wall.axis === 'x') pos.z += facadeRng() * 0.4 * maint;
        else pos.x += facadeRng() * 0.4 * maint;
      }
      track(def, obj, { ...pos, ry, onWall: true });
      const anchor = fireAnchorOf(placements[placements.length - 1]);
      if (anchor) fireExtra.push(anchor);
    };
    // 结构层：每 bay 独立 roll 主结构；命中后再按 structureOverlapProb roll 叠加结构
    // （排除同 def，bayWidth2 需邻 bay 也开口自由——只约束开口，不互斥其他结构）
    const overlapProb = recipe.facade.structureOverlapProb ?? 0.35;
    const placeStructure = (i, exclude) => {
      const two = openFree[i + 1] || false;
      const candidates = structurePool.filter(d => d !== exclude
        && (d.bayWidth === 1 || (d.bayWidth === 2 && two)));
      const def = pickWeighted(facadeRng, candidates, recipe.facade.tags, { wideBias: 2.0 });
      if (!def) return null;
      const n = Math.min(def.bayWidth, two ? 2 : 1);
      placeAt(def, uOf(i) + (n * wall.bay) / 2, FLOOR_Y);
      return def;
    };
    for (let i = 0; i < bayCount; i++) {
      if (!openFree[i] || facadeRng() >= recipe.facade.structureProb) continue;
      const first = placeStructure(i, null);
      if (first && facadeRng() < overlapProb) placeStructure(i, first);
    }
    // 装饰层（并集）：除开口/肋体外所有 bay 独立 roll，同 bay 上限 2，与结构共存
    for (let i = 0; i < bayCount; i++) {
      if (!openFree[i] || !ribFree[i]) continue;
      let placed = 0;
      for (const band of ['low', 'mid', 'high']) {
        if (placed >= 2) break;
        if (facadeRng() >= recipe.facade.decorProb[band]) continue;
        const candidates = decorPool.filter(d => d.band === band || (Array.isArray(d.band) && d.band.includes(band)));
        const def = pickWeighted(facadeRng, candidates, recipe.facade.tags);
        if (!def) continue;
        placeAt(def, uOf(i) + wall.bay / 2, FLOOR_Y + BAND_Y[band], true);
        placed++;
      }
    }
  };
  decorateWall({
    axis: 'x', face: BACK_WALL_Z, ry: 0, bay: 5.2,
    u0: FLOOR_X0 + 2, u1: RX1 - 6,
    openings: [[door.x - door.w / 2 - 2, door.x + door.w / 2 + 2],
      ...(back.skin?.holes || []).map(h => [h.u0 - 2, h.u1 + 2])],
    reserved: back.relief,
  });
  decorateWall({
    axis: 'z', face: FLOOR_X0, ry: Math.PI / 2, bay: 5.2,
    u0: -78, u1: 100,
    openings: [...recipe.wall.windows.map(w => [w.z0 - 2, w.z1 + 2]),
      ...(left.skin?.holes || []).map(h => [h.u0 - 2, h.u1 + 2])],
    reserved: left.relief,
  });

  // ---- 维护度·蛛网 pass：高墙顶角/窗楣旁张网（maintenance 驱动，用户定阶段 3 维护变差）----
  // 网走 unlit pale 丝线，暗室里泛微光；避开口（网心撞窗洞/门洞上缘就跳）。
  const maint = recipe.maintenance ?? 0;
  if (maint > 0) {
    const webRng = createRng(`${seed}:${recipeId}:web`);
    const webDef = getProp('cobwebCorner');
    const webWalls = [
      {
        axis: 'x', face: BACK_WALL_Z, ry: 0, u0: FLOOR_X0 + 8, u1: RX1 - 12,
        openings: [...(back.skin?.holes || []).map(h => [h.u0, h.u1, h.y1]),
          ...recipe.wall.slits.map(s => [s.x - 3, s.x + 3, s.y + 7])],
      },
      {
        axis: 'z', face: FLOOR_X0, ry: Math.PI / 2, u0: -72, u1: 94,
        openings: [...recipe.wall.windows.map(w => [w.z0, w.z1, w.top]),
          ...(left.skin?.holes || []).map(h => [h.u0, h.u1, h.y1])],
      },
    ];
    const webCount = Math.round(maint * 10);
    for (let n = 0; n < webCount; n++) {
      const wall = webWalls[n % 2];
      const u = wall.u0 + webRng() * (wall.u1 - wall.u0);
      const y = FLOOR_Y + 52 + webRng() * 14; // 高带：顶角/窗楣高度
      if (wall.openings.some(([a, b, top]) => u > a - 2 && u < b + 2 && y < FLOOR_Y + top + 2)) continue;
      const obj = webDef.build({ rng: createRng(`${seed}:${recipeId}:web${n}`) });
      const pos = wall.axis === 'x'
        ? { x: u, y, z: wall.face + 0.3 }
        : { x: wall.face + 0.3, y, z: u };
      track(webDef, obj, { ...pos, ry: wall.ry + (webRng() - 0.5) * 0.3, onWall: true });
    }
  }

  // ---- 顶挂（不占地块）：吊灯按配方数挂在构图点 ----
  const ceilRng = createRng(`${seed}:${recipeId}:ceil`);
  const ceilPool = [...propRegistry.values()].filter(d => d.mount === 'ceiling');
  const ceilSpots = [[-6, -30], [14, 8]];
  for (let i = 0; i < (recipe.ceiling.chandeliers || 0) && i < ceilSpots.length; i++) {
    const def = pickWeighted(ceilRng, ceilPool, {}) || ceilPool[0];
    if (!def) break;
    const obj = def.build({ rng: createRng(`${seed}:${recipeId}:c${i}`) });
    const [x, z] = ceilSpots[i];
    track(def, obj, { x, y: FLOOR_Y + 64, z, ry: ceilRng() * Math.PI * 2 });
  }

  // ---- L3 撒印：floorDecal 走红线外撒布（避让战场软 keepout 与已占红线）----
  const decalRng = createRng(`${seed}:${recipeId}:decal`);
  const decalPool = poolByPlace('floorDecal', recipe.decals.tags);
  if (decalPool.length && recipe.decals.count > 0) {
    const pts = scatter(decalRng, {
      count: recipe.decals.count,
      area: { x0: FLOOR_X0 + 5, z0: FLOOR_Z0 + 4, x1: RX1 - 8, z1: RZ1 - 10 },
      avoid: [...occupied, ...keepout.soft, ...terra.pitRects],
      spacing: 5,
    });
    for (const p of pts) {
      const def = pickWeighted(decalRng, decalPool, recipe.decals.tags);
      if (!def) break;
      const obj = def.build({ rng: createRng(`${seed}:${recipeId}:d${placements.length}`) });
      track(def, obj, { x: p.x, y: FLOOR_Y + 0.05, z: p.z, ry: p.rot, root: decalRoot });
    }
  }
  if (recipe.compositionDecal) {
    const def = getProp(recipe.compositionDecal.id);
    const obj = def.build({ rng: createRng(`${seed}:${recipeId}:dc`) });
    track(def, obj, {
      x: recipe.compositionDecal.x, y: FLOOR_Y + 0.05, z: recipe.compositionDecal.z, composition: true, root: decalRoot,
    });
  }

  // ---- 地面起伏处方：废墟铺地补丁（战场水平铁律不动——单位脚底锚定/卡牌路径/阴影相机
  // 全建在 FLOOR_Y 平面上；起伏只发生在战区外）----
  // 每补丁 = 3~6 块错位大石板薄叠（破裂铺地），高度抖 0.2~0.9：道具基座微埋进瓦砾是
  // 自然残破感。走 floorRoot 合批（castShadow 关——水平薄板自投影痤疮口径同地板）。
  const reliefRng = createRng(`${seed}:${recipeId}:relief`);
  const reliefPatches = recipe.floor?.patches ?? 0;
  if (reliefPatches > 0) {
    const pts = scatter(reliefRng, {
      count: reliefPatches,
      area: { x0: FLOOR_X0 + 12, z0: FLOOR_Z0 + 12, x1: RX1 - 16, z1: RZ1 - 12 },
      avoid: [...occupied, ...keepout.hard, ...terra.pitRects],
      spacing: 18,
    });
    for (const p of pts) {
      const n = 3 + Math.floor(reliefRng() * 4);
      for (let k = 0; k < n; k++) {
        const w = 6 + reliefRng() * 9;
        const d = 5 + reliefRng() * 7;
        const slab = K.box({ color: shade(P.stone, -0.1 + reliefRng() * 0.16), size: [w, 0.7 + reliefRng() * 0.6, d] });
        K.jitter(slab, reliefRng, { pos: 0.15, rot: 0.02 });
        K.put(slab, p.x + (reliefRng() - 0.5) * 10, FLOOR_Y + 0.25 + reliefRng() * 0.5, p.z + (reliefRng() - 0.5) * 8);
        slab.rotation.y = reliefRng() * Math.PI;
        floorRoot.add(slab);
      }
    }
  }

  // ---- 合批：墙/道具/顶挂走投影批（unlit 族不投影），地板/撒印走接收批 ----
  const merged = mergeStatic(staticRoot);
  merged.traverse(o => {
    if (!o.isMesh) return;
    const fam = o.material?.userData?.kitFamily;
    o.castShadow = fam !== 'unlit';
    o.receiveShadow = true;
  });
  const floorMerged = mergeStatic(floorRoot);
  floorMerged.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
  const decalMerged = mergeStatic(decalRoot);
  decalMerged.traverse(o => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; } });
  const group = new THREE.Group();
  group.name = `roomScene:${recipeId}`;
  group.add(merged, floorMerged, decalMerged);

  // ---- 布光 / 夜空 / 月光浮尘 ----
  const lighting = createLighting(recipe.lighting, [...fireAnchors, ...fireExtra]);
  group.add(lighting.group);
  const skydome = buildSkydome({ moonDir: new THREE.Vector3(-0.55, 0.5, -0.45), flat: true });
  group.add(skydome);
  let moonDust = null;
  // 光路 = 窄高窗 + 皮肤透穿洞（左墙破洞漏月光成柱，用户定）：只取上半墙 breach 洞
  // （kind=bite 的贴地咬口出的是贴地乱溅光扇，读作地板白斑——用户报障"炸裂"）；
  // skin 洞 rect 是 {u0,u1,y0,y1} 口径，统一转成窗的 {sill,top,u0,u1}
  const beamRects = [
    ...left.windowRects.map(w => ({ sill: w.sill, top: w.top, u0: w.z0, u1: w.z1 })),
    ...(left.skin?.holes || []).filter(h => h.kind === 'breach' && h.y1 - h.y0 >= 4)
      .map(h => ({ sill: h.y0, top: h.y1, u0: h.u0, u1: h.u1 })),
  ];
  if (beamRects.length) {
    const beamDir = new THREE.Vector3(0.836, -0.542, 0.09); // 平行光 dir 反推（窗口→地板光池）
    moonDust = buildMoonDust({
      beams: beamRects.map(w => {
        const h = w.top - w.sill;
        return {
          origin: new THREE.Vector3(FLOOR_X0 + 0.5, FLOOR_Y + w.sill + h * 0.8, (w.u0 + w.u1) / 2),
          dir: beamDir, len: h * 1.45, radius: (w.u1 - w.u0) * 0.39,
        };
      }),
    });
    group.add(moonDust.points);
  }

  // ---- 场景契约：update / sampleStandeeTint（口径同 dungeon3D，色彩参数走布光预设）----
  const scratch = new THREE.Color();
  function update(dt, particles = null, camPos = null) {
    lighting.update(dt, particles);
    if (camPos) skydome.updateSkydome(camPos);
    if (moonDust) moonDust.update(dt, lighting.moonlight);
  }

  function sampleStandeeTint(pos, out = scratch) {
    const t = lighting.tint;
    out.setRGB(t.base[0], t.base[1], t.base[2]);
    for (const tor of lighting.torches) {
      const d = Math.hypot(pos.x - tor.x, pos.y - tor.y);
      const f = tor.intensity * Math.max(0, 1 - d / t.radius);
      out.r += t.fireGain[0] * f;
      out.g += t.fireGain[1] * f;
      out.b += t.fireGain[2] * f;
    }
    const dim = THREE.MathUtils.clamp(1 - Math.max(0, 8 - pos.z) * 0.008, 0.72, 1);
    out.multiplyScalar(dim);
    out.r = Math.min(out.r, 1.12);
    out.g = Math.min(out.g, 1.12);
    out.b = Math.min(out.b, 1.12);
    return out;
  }

  return {
    group,
    torches: lighting.torches,
    placements,
    openings: { windows: left.windowRects, door },
    recipe,
    // 特殊色调（用户定 2026-09）：配方 grading 随契约下发——exposure=渲染曝光倍率；
    // tint=[r,g,b] 场景调色（composer 路径生效；非 composer 路径渲染层以曝光为准）
    grading: recipe.grading ?? null,
    update,
    sampleStandeeTint,
    moonlight: lighting.moonlight,
    skydome,
  };
}
