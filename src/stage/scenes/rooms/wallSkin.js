// 房型配方层 · 墙体皮肤 PCG（2026-09 用户定）：2D 深度图 + 行 run 贪心合并几何。
// 墙永远是单侧视角，沿法线剖面压扁成带符号深度图 d(u,y)（+=凸出墙面 / -=凹进墙内），
// boolean（挖孔/剥落/龟裂）全是 2D mask 运算；透穿破洞 = 真 opening 参与切墙——
// 墙后就是 PCG 天空：左墙破洞漏月光（shadow map 自动透光成月光柱），背墙破洞露夜空。
//
// 美术口径（用户定 2026-09）：墙面**同色无缝**——不要体素间的起伏/变色/灰缝读感，
// 大面读作平整墙皮；mesher 对同行同深度格做 run 贪心合并（等效 greedy meshing），
// 平整面只剩少数几条长方体。小起伏只来自少量真特征：透穿洞/坍塌咬口 + 浅剥落斑 +
// 龟裂刻线（均为同色斑，只靠几何深浅读形）。
//
// 三层职责不合并：结构层（bay 砌墙+扶壁肋/腰线，walls.js）/ 皮肤层（本文件）
// / 道具层（L2 立面挂饰，composeRoom 按 skin.holes 避让）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';
import { FLOOR_Y } from '../dungeon3D.js';
import { makeNoise2D } from './terrain.js';

const CELL = 1.6;   // 皮肤格宽：深度图分辨率（特征边缘锯齿/崩边都按此采样）
export const SKIN_TOP = 120; // 皮肤带高度：视野带内墙面 100% 纯体素（用户定：体素墙不要大长方体），
                            // 上方视野外用简单大盒挡光；120 覆盖相机上仰可见范围
export const SKIN_CAVITY = 1.6; // 皮肤暗腔深：皮肤带内基底墙完全不砌（体素柱 + 背板挡光）
const TOP = SKIN_TOP;

// 逐格标志（mesher 分派：透穿格跳过，其余按深度 run 合并）
const F = { PLAIN: 0, THROUGH: 1 };

// 点到矩形距离（0 = 在矩形内）；矩形 = {u0,u1,y0,y1}（皮肤坐标系：u 沿墙 / y 高）
const rectDist = (u, y, r) => {
  const du = Math.max(r.u0 - u, 0, u - r.u1);
  const dy = Math.max(r.y0 - y, 0, y - r.y1);
  return Math.hypot(du, dy);
};

/**
 * 生成单面墙的皮肤深度图（确定性，rng 由调用方派生）。
 * 基底全平（d=0，用户定：墙面平整、无砌体起伏/变色）；特征 = 剥落斑/龟裂/透穿洞/咬口。
 * @param rng  本墙的 rng 流
 * @param cfg  配方 wallSkin 段 { spalls, holes, holeChance, backHoleChance, bites, biteChance, backBiteChance }
 * @param spec { u0, u1, side: 'left'|'back', openings: [{u0,u1,sill,top}]（窗/门，y 为地板相对高）,
 *               avoid: [{u0,u1,y0,y1}]（附加避让，如背墙窄缝窗）, ribs: [{u0,u1}],
 *               bandSegs: [{u0,u1,y0,y1}]（腰线/墙裙实体段，皮肤抑制带） }
 * @returns { grid, holes, floorRects, depthAt }
 */
export function generateWallSkin(rng, cfg, spec) {
  const { u0, u1, side, openings = [], avoid = [], ribs = [], bandSegs = [] } = spec;
  const nu = Math.ceil((u1 - u0) / CELL);
  const ny = Math.ceil(TOP / CELL);
  const at = (i, j) => j * nu + i;
  const cu = i => u0 + (i + 0.5) * CELL;   // 格中心 u（世界沿墙坐标）
  const cy = j => (j + 0.5) * CELL;        // 格中心 y（0 = 室内地平）
  const d = new Float32Array(nu * ny);     // 有符号深度（+凸 / -凹），基底 0 = 平整墙面
  const flag = new Uint8Array(nu * ny).fill(F.PLAIN);
  const noise = makeNoise2D(Math.floor(rng() * 1e9));   // 剥落斑内起伏
  const ridgeN = makeNoise2D(Math.floor(rng() * 1e9));  // 龟裂脊线
  const h2 = (a, b) => { // 逐格确定性哈希（0..1）
    let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const fbm = (n, x, y, oct = 3) => {
    let s = 0; let amp = 1; let f = 1; let norm = 0;
    for (let o = 0; o < oct; o++) { s += n(x * f, y * f) * amp; norm += amp; amp *= 0.5; f *= 2; }
    return s / norm;
  };

  // 开口避让区（皮肤坐标 y = sill..top）
  const openRects = [...openings.map(o => ({ u0: o.u0, u1: o.u1, y0: o.sill, y1: o.top })), ...avoid];
  const nearOpen = (u, y, margin) => openRects.some(r => rectDist(u, y, r) < margin);

  // ---- 1) 剥落斑（spall）：成片抹灰掉落——浅凹同色斑（小起伏很少，用户定）----
  const spalls = [];
  for (let s = 0; s < (cfg.spalls ?? 3); s++) {
    for (let t = 0; t < 16; t++) {
      const cU = u0 + 12 + rng() * (u1 - u0 - 24);
      const cY = 6 + rng() * (TOP - 30);
      const rU = 6 + rng() * 7; const rY = 4.5 + rng() * 6;
      if (nearOpen(cU, cY, Math.max(rU, rY) + 5)) continue;
      spalls.push({ cU, cY, rU, rY });
      break;
    }
  }
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nu; i++) {
      const u = cu(i); const y = cy(j); const k = at(i, j);
      for (const s of spalls) {
        const e = ((u - s.cU) / s.rU) ** 2 + ((y - s.cY) / s.rY) ** 2;
        if (e < 1) {
          const depth = -(0.35 + 0.3 * fbm(noise, u / 5, y / 5, 2)); // 浅斑：体素侧面在掠射光下会暗，起伏大了读成马赛克
          if (depth < d[k]) { d[k] = depth; break; }
        }
      }
    }
  }

  // ---- 2) 龟裂：ridge 噪声窄带刻线（不穿；辉光裂缝预留=只加深不加光）----
  for (let j = 1; j < ny - 1; j++) {
    for (let i = 1; i < nu - 1; i++) {
      const k = at(i, j);
      if (flag[k] === F.THROUGH) continue;
      const r = 1 - Math.abs(fbm(ridgeN, cu(i) / 11, cy(j) / 11, 3) * 2 - 1); // 脊线≈1
      if (r < 0.9) continue;
      if (nearOpen(cu(i), cy(j), 3)) continue;
      const depth = -(0.3 + r * 0.3);
      if (depth < d[k]) d[k] = depth;
    }
  }

  // ---- 3) 透穿破洞 + 坍塌咬口：真 opening（切墙露天空），环带锥形崩边收剖面 ----
  // 左墙破洞 = 月光柱新光源；背墙破洞低频（用户定）且偏右上半墙；咬口底部接地板瓦砾。
  const holes = [];      // 真洞口 rect（世界 u/y，含 kind），供切墙 + 立面避让 + 月光柱
  const floorRects = []; // 咬口底部 u 区间（地面瓦砾接续锚点）
  const carveEllipse = (cU, cY, rU, rY, kind) => {
    let i0 = nu; let i1 = -1; let j0 = ny; let j1 = -1;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nu; i++) {
        const e = ((cu(i) - cU) / rU) ** 2 + ((cy(j) - cY) / rY) ** 2;
        const k = at(i, j);
        if (e < 0.55) { flag[k] = F.THROUGH; d[k] = 0; i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j); }
        else if (e < 1.0) { const dd = -(1.2 + 0.6 * h2(i, j)); if (dd < d[k]) d[k] = dd; }
        else if (e < 1.5 && h2(i + 7, j + 3) < 0.55) { const dd = -(2.0 + 0.8 * h2(i + 1, j + 9)); if (dd < d[k]) d[k] = dd; }
        else if (e < 1.2 && h2(i + 3, j + 5) >= 0.8 && flag[k] !== F.THROUGH) { const dd = 0.9 + 0.3 * h2(i, j); if (dd > d[k]) d[k] = dd; } // 断口外翻石茬
      }
    }
    if (i1 - i0 < 2 || j1 - j0 < 2) return;
    // 切墙 rect = 透穿 bbox 内缩 1 格：外圈透穿格保留墙皮 + 深凹环 = 锯齿暗框收边
    holes.push({ u0: cu(i0 + 1) - CELL / 2, u1: cu(i1 - 1) + CELL / 2, y0: cy(j0 + 1) - CELL / 2, y1: cy(j1 - 1) + CELL / 2, kind });
    if (kind === 'bite') floorRects.push({ u0: cU - rU * 0.8, u1: cU + rU * 0.8 });
  };
  const ribBlocks = (cU, r) => ribs.some(rb => cU + r > rb.u0 && cU - r < rb.u1);
  const bandBlocks = (cU, cY, r) => bandSegs.some(b => cU + r > b.u0 && cU - r < b.u1 && cY + r > b.y0 && cY - r < b.y1);
  // 3a) 上半墙破洞
  const wantHoles = side === 'left'
    ? (rng() < (cfg.holeChance ?? 0.8) ? (cfg.holes ?? 1) : 0)
    : (rng() < (cfg.backHoleChance ?? 0.25) ? 1 : 0);
  for (let n = 0; n < wantHoles; n++) {
    for (let t = 0; t < 24; t++) {
      const mid = (u0 + u1) / 2;
      const cU = side === 'back' ? mid + 8 + rng() * Math.max(4, u1 - 16 - mid) : u0 + 16 + rng() * (u1 - u0 - 32);
      const cY = side === 'left' ? 16 + rng() * 36 : 26 + rng() * 30;
      const rU = (side === 'left' ? 3.5 + rng() * 2.5 : 2.5 + rng() * 1.5);
      const rY = rU * (1.1 + rng() * 0.5);
      if (nearOpen(cU, cY, Math.max(rU, rY) + 6)) continue;
      if (ribBlocks(cU, rU + 2) || bandBlocks(cU, cY, rY + 2)) continue;
      carveEllipse(cU, cY, rU, rY, 'breach');
      break;
    }
  }
  // 3b) 坍塌咬口（底部连通地板；左墙主，背墙低概率）
  const wantBites = rng() < (side === 'left' ? (cfg.biteChance ?? 0.6) : (cfg.backBiteChance ?? 0.2))
    ? (cfg.bites ?? 1) : 0;
  for (let n = 0; n < wantBites; n++) {
    for (let t = 0; t < 24; t++) {
      const cU = u0 + 18 + rng() * (u1 - u0 - 36);
      const rU = 6 + rng() * 5; const rY = 5 + rng() * 5;
      const cY = rY * 0.9; // 底部没入地板（墙裙 suppression 再咬齐）
      if (nearOpen(cU, cY, rU + 6)) continue;
      if (ribBlocks(cU, rU + 2) || bandBlocks(cU, cY, rY + 2)) continue;
      carveEllipse(cU, cY, rU, rY, 'bite');
      break;
    }
  }

  // ---- 4) 开口透穿雕刻：窗/门洞 cell = THROUGH（纯体素墙真透空，天空直见）----
  // 崩边环（5）与抑制带（6）都跳过 THROUGH。
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nu; i++) {
      const u = cu(i); const y = cy(j); const k = at(i, j);
      for (const r of openRects) {
        if (u > r.u0 && u < r.u1 && y > r.y0 && y < r.y1) { flag[k] = F.THROUGH; d[k] = 0; break; }
      }
    }
  }

  // ---- 5) 开口崩边环：窗/门/缝边缘 2.2 格内 30% 概率崩口（结构化开口融入破损墙）----
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nu; i++) {
      const k = at(i, j);
      if (flag[k] === F.THROUGH) continue;
      const u = cu(i); const y = cy(j);
      for (const r of openRects) {
        if (rectDist(u, y, r) < 2.2 && h2(i + 11, j + 13) < 0.3) {
          const dd = -(0.3 + 0.25 * h2(i + 5, j + 7));
          if (dd < d[k]) d[k] = dd;
        }
      }
    }
  }

  // ---- 6) 抑制带：扶壁肋（含 1.2 边距）与腰线/墙裙段上皮肤归零（结构层遮蔽处不发射）----
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nu; i++) {
      const u = cu(i); const y = cy(j); const k = at(i, j);
      if (flag[k] === F.THROUGH) continue; // 洞口永不回填
      if (ribs.some(r => u > r.u0 - 1.2 && u < r.u1 + 1.2)) { d[k] = 0; continue; }
      if (bandSegs.some(b => u > b.u0 && u < b.u1 && y > b.y0 && y < b.y1)) { d[k] = 0; }
    }
  }

  // ---- 7) 深度收口：凹进钳到体素柱可实现范围（真几何凹穴下限 -1.3，更深读作暗色台阶）----
  for (let k = 0; k < d.length; k++) if (d[k] < -1.3) d[k] = -1.3;

  // ---- API ----
  const idxOf = (u, y) => {
    const i = Math.min(nu - 1, Math.max(0, Math.floor((u - u0) / CELL)));
    const j = Math.min(ny - 1, Math.max(0, Math.floor(y / CELL)));
    return at(i, j);
  };
  return {
    grid: { nu, ny, cell: CELL, u0, d, flag },
    holes, floorRects,
    plateCuts: openings.map(o => ({ u0: o.u0, u1: o.u1, y0: o.sill, y1: o.top })), // 背板开窗：真开口（窗/门）
    depthAt: (u, y) => d[idxOf(u, y)],
  };
}

// ---- 几何：行 run 贪心合并（等效 greedy meshing，用户定 2026-09）----
// 同行相邻同深度格并成一条 box：平整墙面整行只有 1~2 条长方体，体素间无缝无色差；
// 每格独立柱的时代结束（那代的逐块调色/灰缝/0.18 缩格缝全删——"墙面像马赛克"病灶）。
// 柱背 1.35 锚进暗腔、腔底暗背板封缝；透穿格断 run（切墙 rect 露天空）；
// 全墙同色 P.wall（凹穴也不调色，只靠几何投影读形）。
const REC_CLAMP = -1.25;
export function buildWallSkin(skin, axis, face) {
  const { nu, ny, cell, u0, d, flag } = skin.grid;
  const g = new THREE.Group();
  g.name = 'wallSkin';
  // axis='x'：背墙（u→x，face=z，体朝 +z）；axis='z'：左墙（u→z，face=x，体朝 +x）
  for (let j = 0; j < ny; j++) {
    let i = 0;
    while (i < nu) {
      const k = j * nu + i;
      if (flag[k] === F.THROUGH) { i++; continue; }
      const dd = Math.max(d[k], REC_CLAMP) + 0.02; // 前面偏移（含防 z-fight 微浮）
      let i2 = i + 1;
      while (i2 < nu && flag[j * nu + i2] !== F.THROUGH && Math.max(d[j * nu + i2], REC_CLAMP) + 0.02 === dd) i2++;
      const depth = dd + SKIN_CAVITY - 0.23;       // 柱背到 face-1.35（背板前 0.05，腔深 1.6）
      const w = (i2 - i) * cell;                   // 满格宽：相邻 run 前表面同平面同色，无缝可读
      const box = K.box({ color: P.wall, size: axis === 'x' ? [w, cell, depth] : [depth, cell, w] });
      const u = u0 + (i + (i2 - i) / 2) * cell;
      const y = FLOOR_Y + (j + 0.5) * cell; // 网格 y 是地板相对（0=室内地平），落世界必须 +FLOOR_Y
      const c = face + dd - depth / 2; // 盒中心：前面 - depth/2
      if (axis === 'x') K.put(box, u, y, c); else K.put(box, c, y, u);
      g.add(box);
      i = i2;
    }
  }
  // 暗腔背板：封柱间细缝（同地板底衬板口径）——没有它缝底见的是内退基底盒（同色墙皮，网格不可读）。
  // 透穿洞处背板让位（洞 rect 外扩 0.6 藏边），否则洞里见暗板不见天空。
  {
    const uSpan = nu * cell;
    const plateColor = shade(P.stone, -0.5);
    const pc = face - SKIN_CAVITY + 0.15; // 背板贴腔底：span face-1.6..face-1.3（前缘齐最深凹穴）
    let plates = [{ u0, u1: u0 + uSpan, y0: 0, y1: TOP }];
    const cutRects = [...(skin.holes || []), ...(skin.plateCuts || [])];
    for (const h of cutRects) {
      const hr = { u0: h.u0 - 0.6, u1: h.u1 + 0.6, y0: h.y0 - 0.6, y1: h.y1 + 0.6 };
      const next = [];
      for (const r of plates) {
        if (hr.u1 <= r.u0 || hr.u0 >= r.u1 || hr.y1 <= r.y0 || hr.y0 >= r.y1) { next.push(r); continue; }
        if (hr.y1 < r.y1) next.push({ u0: r.u0, u1: r.u1, y0: hr.y1, y1: r.y1 });
        if (hr.y0 > r.y0) next.push({ u0: r.u0, u1: r.u1, y0: r.y0, y1: hr.y0 });
        const iu0 = Math.max(r.u0, hr.u0); const iu1 = Math.min(r.u1, hr.u1);
        if (iu0 > r.u0) next.push({ u0: r.u0, u1: iu0, y0: Math.max(r.y0, hr.y0), y1: Math.min(r.y1, hr.y1) });
        if (iu1 < r.u1) next.push({ u0: iu1, u1: r.u1, y0: Math.max(r.y0, hr.y0), y1: Math.min(r.y1, hr.y1) });
      }
      plates = next;
    }
    for (const r of plates) {
      const w = r.u1 - r.u0; const hgt = r.y1 - r.y0;
      if (w <= 0.2 || hgt <= 0.2) continue;
      const plate = axis === 'x'
        ? K.box({ color: plateColor, size: [w, hgt, 0.3] })
        : K.box({ color: plateColor, size: [0.3, hgt, w] });
      plate.name = 'wallPlate'; // 调试可隔离
      const cu = (r.u0 + r.u1) / 2; const cy = FLOOR_Y + (r.y0 + r.y1) / 2;
      if (axis === 'x') K.put(plate, cu, cy, pc); else K.put(plate, pc, cy, cu);
      g.add(plate);
    }
  }
  return g;
}
