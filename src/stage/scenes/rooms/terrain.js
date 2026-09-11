// 房型配方层 · 地形分区 v2（用户定 2026-09：heightmap 管线，取代矩形分区）：
//   perlin 值噪声 fbm 高度场 → 单位占位 control（keepout 距离场 blend，站位区强制归零）
//   → 分类图（高台/低谷/平坦量化 + 连通域 + 分区 flatten）→ 裂缝 carving（ridge 噪声窄带）
//   → 靠墙斜坡 carve → 0.5 量化 → 体素柱几何（kit 顶点色合批口径）。
// 摆放规则（用户定）：低谷/平面/高台可摆任意装饰与结构；裂缝（深沟/深不见底）仅 rubble
// 类装饰；斜坡（|∇h| 陡带）仅小型 rubble 且垂直坡面法线摆放；岩浆河 = 塔基场景预留留空。
// 战场水平铁律由占位 control 保证：站位区/战线走廊的高度被距离场压回 0（单位永不踏上地形）。
//
// 高度口径：相对 FLOOR_Y（0 = 室内地平）；放置方 y = FLOOR_Y + heightAt(x, z)。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';
import { FLOOR_X0, FLOOR_X1, FLOOR_Z0, FLOOR_Z1 } from './walls.js';

const CELL = 4;                 // 高度图格宽（世界单位）——体素柱 read  chunky 房间美学
const QUANT = 0.5;              // 高度量化步长（台阶感）
const FLAT_LO = -1.8;           // 分类阈值：低于 → 低谷候选
const FLAT_HI = 2.0;            // 高于 → 高台候选
const STEEP_TAN = 0.55;         // |∇h| 超此 = 斜坡带（≈29°）

// ---- 确定性 2D 值噪声 + fbm（整数哈希，无依赖；种子由 rng 派生）----
// wallSkin 等配方层复用同一噪声口径（皮肤深度图/地形高度图同源确定性）
export function makeNoise2D(seed) {
  const rand2 = (x, y) => {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1013904223);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
  };
  const sm = t => t * t * (3 - 2 * t);
  return (x, y) => {
    const xi = Math.floor(x); const yi = Math.floor(y);
    const xf = x - xi; const yf = y - yi;
    const a = rand2(xi, yi); const b = rand2(xi + 1, yi);
    const c = rand2(xi, yi + 1); const d = rand2(xi + 1, yi + 1);
    const u = sm(xf); const v = sm(yf);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
const fbm = (n, x, y, oct = 4, lac = 2, gain = 0.5) => {
  let s = 0; let amp = 1; let f = 1; let norm = 0;
  for (let o = 0; o < oct; o++) { s += n(x * f, y * f) * amp; norm += amp; amp *= gain; f *= lac; }
  return s / norm; // 0..1
};

// 点到矩形距离（0 = 在矩形内）
function rectDist(x, z, r) {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}
const smoothstep = (a, b, t) => {
  const u = Math.min(1, Math.max(0, (t - a) / (b - a)));
  return u * u * (3 - 2 * u);
};

/**
 * 高度图 + 分类图生成（确定性）。
 * @param anchors 构图定点 [{x,z}]：近处强制压平（构图火源/压阵件保持在室内地平上）
 * @param bounds  房间有效边界覆盖 {x1,z1}（阶段配方 room.scale 缩小空间时收地形范围；
 *                缺省用墙常量全幅）
 */
export function generateTerrain(rng, recipe, keepout, anchors = [], bounds = {}) {
  const cfg = recipe.floor?.terrain || {};
  const BX1 = bounds.x1 ?? FLOOR_X1;
  const BZ1 = bounds.z1 ?? FLOOR_Z1;
  const AMP = cfg.amp ?? 13; // 起伏总幅度（阶段配方：要塞/图书馆加大，宫殿/隔层收小/归零）
  const nx = Math.ceil((BX1 - FLOOR_X0) / CELL);
  const nz = Math.ceil((BZ1 - FLOOR_Z0) / CELL);
  const noise = makeNoise2D(Math.floor(rng() * 1e9));
  const ridgeN = makeNoise2D(Math.floor(rng() * 1e9));
  const x0 = FLOOR_X0; const z0 = FLOOR_Z0;
  const cx = i => x0 + (i + 0.5) * CELL;
  const cz = j => z0 + (j + 0.5) * CELL;

  // ---- 1) 基础高度场：fbm，幅度 ~[-5.5, +6.5] ----
  const h = new Float32Array(nx * nz);
  const cat = new Array(nx * nz).fill('flat');
  const at = (i, j) => j * nx + i;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      h[at(i, j)] = (fbm(noise, cx(i) / 34, cz(j) / 34, 4) - 0.42) * AMP;
    }
  }

  // ---- 2) 单位占位 control：站位区/战线走廊距离场把高度压回 0（用户定：站位留空水平）----
  // 内缘 +2 起压、外缘 +16 全放开；构图锚点 8 内压平
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = cx(i); const z = cz(j);
      let d = Infinity;
      for (const k of keepout.hard) d = Math.min(d, rectDist(x, z, k));
      for (const a of anchors) d = Math.min(d, Math.hypot(x - a.x, z - a.z) - 6);
      const mask = smoothstep(2, 16, d);
      h[at(i, j)] *= mask;
      if (mask < 1) cat[at(i, j)] = 'flat'; // 占位带内永不进分类
    }
  }

  // ---- 3) 靠墙斜坡 carve（用户定：斜坡必须靠着墙体生成）----
  // 在墙根 carve 线性坡：坡顶贴墙（H），坡脚朝室内延伸到 rampLen 归零；体素柱天然成坡。
  const rampCount = cfg.slopes ?? 1;
  const rampWalls = ['left', 'back'].slice(0, Math.max(0, rampCount));
  for (const wall of rampWalls) {
    for (let t = 0; t < 24; t++) {
      const H = 3.5 + rng() * 2.5;
      const rampLen = 10 + rng() * 4;
      const len = 16 + rng() * 12;
      let u0; let fixed; let ok = true;
      if (wall === 'left') { fixed = x0 + 1; u0 = z0 + 10 + rng() * (BZ1 - FLOOR_Z0 - 30 - len); }
      else { fixed = z0 + 1; u0 = x0 + 10 + rng() * (BX1 - FLOOR_X0 - 40 - len); }
      // 校验：坡带不撞 keepout（端点+中点取样）
      for (let s = 0; s <= 4 && ok; s++) {
        const u = u0 + (len * s) / 4;
        const px = wall === 'left' ? fixed + 2 : u;
        const pz = wall === 'left' ? u : fixed + 2;
        for (const k of keepout.hard) if (rectDist(px, pz, k) < 2) { ok = false; break; }
      }
      if (!ok) continue;
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) {
          const u = wall === 'left' ? cz(j) : cx(i);
          const d = wall === 'left' ? cx(i) - fixed : cz(j) - fixed;
          if (u < u0 || u > u0 + len || d < -0.5 || d > rampLen) continue;
          const k = at(i, j);
          if (cat[k] !== 'flat') continue; // 不占裂缝
          h[k] = Math.max(h[k], H * (1 - Math.max(0, d) / rampLen));
          cat[k] = 'slope-ramp';
        }
      }
      break;
    }
  }

  // ---- 4) 裂缝 carving：ridge 噪声窄带（|n|≈1 的脊线），eligible = 占位带外/非坡 ----
  const fissureN = cfg.fissures ?? 1;
  for (let j = 1; j < nz - 1; j++) {
    for (let i = 1; i < nx - 1; i++) {
      const k = at(i, j);
      if (cat[k] !== 'flat' || fissureN <= 0) continue;
      const r = 1 - Math.abs(fbm(ridgeN, cx(i) / 30, cz(j) / 30, 3) * 2 - 1); // 0..1，脊线≈1
      if (r < 0.93) continue;
      // 周边占位控制复核（带缘 cell 不做缝）
      let d = Infinity;
      for (const kk of keepout.hard) d = Math.min(d, rectDist(cx(i), cz(j), kk));
      if (d < 8) continue;
      cat[k] = 'fissure';
      h[k] = rng() < 0.6 ? -(3.5 + rng() * 1.5) : -(9 + rng() * 2.5); // 60% 深沟 / 40% 深不见底（真洞，靠深黑暗化）
    }
  }
  // 裂缝连贯化：剔除孤立格（8 邻域内裂缝邻居 <2 的散格溶解为平地）——ridge 细线被 keepout
  // 斩断后残留的孤立黑方块读作随机污渍而非地裂（用户报障：地板体素黑得异常）
  for (let j = 1; j < nz - 1; j++) {
    for (let i = 1; i < nx - 1; i++) {
      const k = at(i, j);
      if (cat[k] !== 'fissure') continue;
      let nb = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        if (cat[at(i + di, j + dj)] === 'fissure') nb++;
      }
      if (nb < 2) { cat[k] = 'flat'; h[k] = 0; }
    }
  }

  // ---- 5) 分类图 + 连通域 + 分区 flatten（高台/低谷量化到台面，碎小区溶解为平地）----
  const mark = new Array(nx * nz).fill(0);
  let label = 0;
  const components = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = at(i, j);
      if (mark[k] || cat[k] !== 'flat') continue;
      const isHigh = h[k] > FLAT_HI;
      const isLow = h[k] < FLAT_LO;
      if (!isHigh && !isLow) continue;
      // flood fill 同号区域
      label++;
      const stack = [k]; const cells = [];
      mark[k] = label;
      while (stack.length) {
        const c = stack.pop();
        cells.push(c);
        const ci = c % nx; const cj = (c / nx) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = ci + di; const nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
          const nk = at(ni, nj);
          if (mark[nk] || cat[nk] !== 'flat') continue;
          if (isHigh ? h[nk] <= FLAT_HI : h[nk] >= FLAT_LO) continue;
          mark[nk] = label;
          stack.push(nk);
        }
      }
      components.push({ label, kind: isHigh ? 'platform' : 'basin', cells });
    }
  }
  for (const comp of components) {
    if (comp.cells.length < 6) { // 碎小区溶解（<6 格 ≈ <96 平）
      for (const c of comp.cells) { h[c] = 0; }
      continue;
    }
    let m = comp.cells.reduce((s, c) => s + h[c], 0) / comp.cells.length;
    m = comp.kind === 'platform' ? Math.max(m, 3.2) : Math.min(m, -2.6);
    for (const c of comp.cells) { h[c] = m; cat[c] = comp.kind; }
  }
  // 平地带归零（未被分类的残余高度）
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = at(i, j);
      if (cat[k] === 'flat') h[k] = 0;
    }
  }
  // 分区 flatten 后的裙边：贴坑/台缘的一圈向内侧缓降一级（破硬切边）
  const skirt = (target, dist, level) => {
    for (let j = dist; j < nz - dist; j++) {
      for (let i = dist; i < nx - dist; i++) {
        const k = at(i, j);
        if (cat[k] !== 'flat' || h[k] !== 0) continue;
        let near = false;
        for (let dj = -dist; dj <= dist && !near; dj++) {
          for (let di = -dist; di <= dist; di++) {
            if (Math.max(Math.abs(di), Math.abs(dj)) !== dist) continue;
            if (cat[at(i + di, j + dj)] === target) { near = true; break; }
          }
        }
        if (near) h[k] = target === 'basin' || target === 'fissure' ? -level : level;
      }
    }
  };
  // 两级裙边：紧贴 ±1、外圈 ±0.5（体素台阶的过渡带）
  for (const [t, d, lv] of [['basin', 1, 1], ['fissure', 1, 1], ['platform', 1, 1]]) skirt(t, d, lv);
  for (const [t, d, lv] of [['basin', 2, 0.5], ['fissure', 2, 0.5], ['platform', 2, 0.5]]) skirt(t, d, lv);

  // ---- 6) 0.5 量化（台阶体素感）----
  for (let k = 0; k < h.length; k++) h[k] = Math.round(h[k] / QUANT) * QUANT;

  // ---- API ----
  const idxOf = (x, z) => {
    const i = Math.min(nx - 1, Math.max(0, Math.floor((x - x0) / CELL)));
    const j = Math.min(nz - 1, Math.max(0, Math.floor((z - z0) / CELL)));
    return at(i, j);
  };
  const zoneAt = (x, z) => {
    const k = idxOf(x, z);
    const c = cat[k];
    if (c === 'fissure') return { type: 'fissure', subtype: h[k] < -6 ? 'abyss' : 'groove' };
    if (c === 'slope-ramp') return { type: 'slope' };
    if (c === 'platform') return { type: 'platform' };
    if (c === 'basin') return { type: 'basin' };
    // 平坦带按坡度现判斜坡（台缘/坑缘的陡带 = 自然坡）
    const i = k % nx; const j = (k / nx) | 0;
    const gx = (h[at(Math.min(nx - 1, i + 1), j)] - h[at(Math.max(0, i - 1), j)]) / (2 * CELL);
    const gz = (h[at(i, Math.min(nz - 1, j + 1))] - h[at(i, Math.max(0, j - 1))]) / (2 * CELL);
    if (Math.hypot(gx, gz) > STEEP_TAN) return { type: 'slope' };
    return { type: 'flat' };
  };
  const heightAt = (x, z) => h[idxOf(x, z)];
  // 斜坡姿态：垂直坡面法线（normal ∝ (-gx, 1, -gz)）——小 rubble 躺贴在坡面上
  const tiltAt = (x, z) => {
    if (zoneAt(x, z).type !== 'slope') return null;
    const k = idxOf(x, z);
    const i = k % nx; const j = (k / nx) | 0;
    const gx = (h[at(Math.min(nx - 1, i + 1), j)] - h[at(Math.max(0, i - 1), j)]) / (2 * CELL);
    const gz = (h[at(i, Math.min(nz - 1, j + 1))] - h[at(i, Math.max(0, j - 1))]) / (2 * CELL);
    if (Math.hypot(gx, gz) <= STEEP_TAN) return null;
    return { tiltZ: Math.atan(gx), tiltX: -Math.atan(gz) };
  };
  // 坑/缝避让矩形（连通域 bbox + margin）：供石板撒布/撒印/铺地补丁避让
  const pitRects = [];
  const seen = new Set();
  for (let k = 0; k < h.length; k++) {
    if (h[k] >= -0.5 || seen.has(k)) continue;
    const stack = [k]; seen.add(k);
    let rx0 = Infinity; let rx1 = -Infinity; let rz0 = Infinity; let rz1 = -Infinity;
    while (stack.length) {
      const c = stack.pop();
      const ci = c % nx; const cj = (c / nx) | 0;
      rx0 = Math.min(rx0, cx(ci)); rx1 = Math.max(rx1, cx(ci));
      rz0 = Math.min(rz0, cz(cj)); rz1 = Math.max(rz1, cz(cj));
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = ci + di; const nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= nx || nj >= nz) continue;
        const nk = at(ni, nj);
        if (h[nk] < -0.5 && !seen.has(nk)) { seen.add(nk); stack.push(nk); }
      }
    }
    pitRects.push({ x0: rx0 - CELL, x1: rx1 + CELL, z0: rz0 - CELL, z1: rz1 + CELL });
  }
  return {
    grid: { nx, nz, cell: CELL, x0, z0, h, cat, x1: BX1, z1: BZ1 },
    pitRects, zoneAt, heightAt, tiltAt,
  };
}

// ---- 几何：体素柱地形（每格一根柱，顶 = 高度；风格匹配：体素块 + 块间细缝 + 逐块调色）----
// 统一签名 (top, tone)：调用方传 (top, colTone)——曾把 top 当 tone 传入致 shade 过曝发白
const CAT_COLOR = {
  flat: (hh, tone) => shade(P.floor, tone),
  platform: (hh, tone) => shade(P.stone, 0.04 + tone * 0.5), // 石质台面（P.slab 过亮会发光）
  basin: (hh, tone) => shade(P.stone, -0.28 + tone),
  // 裂缝不调色（用户定 2026-09：不用黑色体素填充——真洞 + 场景光照自然暗下去）
  fissure: (hh, tone) => shade(P.floor, tone),
  'slope-ramp': (hh, tone) => shade(P.stone, -0.12 + tone),
};
const colTone = (i, j) => ((((i * 73 + j * 151) % 17) + 17) % 17) / 17 * 0.1 - 0.05; // 确定性逐块调色

export function buildTerrain(grid) {
  const { nx, nz, cell, x0, z0, h, cat } = grid;
  const gap = 0.18; // 块间细缝：顶视读出体素拼砌（缝底是柱侧阴影，不用额外几何）
  const size = cell - gap;
  const solid = new THREE.Group();
  solid.name = 'terrain';
  // 统一深基柱（用户定 2026-09）：每格柱从 BASE 直通顶面——裂缝/坑格是真洞（顶面深、
  // 侧壁由邻格柱面露出），不填 unlit 黑柱。柱底全部落在同一深度，衬板在更下面兜底。
  const BASE = -13;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const top = h[k];
      const c = cat[k];
      const x = x0 + (i + 0.5) * cell; const z = z0 + (j + 0.5) * cell;
      const H = top - BASE; // 顶面恒在 BASE 之上（最深裂缝 -11.5 > BASE）
      const color = (CAT_COLOR[c] || CAT_COLOR.flat)(top, colTone(i, j));
      solid.add(K.put(K.box({ color, size: [size, H, size] }), x, (top + BASE) / 2, z));
    }
  }
  // 底衬板：封住块间细缝与洞底的视线（缝底/洞底见它而非夜空穹顶）——相机浅角度从缝穿过去
  // 会瞄到穹顶亮部，读出"缝会发光"的亮边（用户报障）；必须在最深柱底之下
  const span = [(grid.x1 ?? FLOOR_X1) - FLOOR_X0 + 8, (grid.z1 ?? FLOOR_Z1) - FLOOR_Z0 + 8];
  solid.add(K.put(
    K.plate({ color: shade(P.stone, -0.48), w: span[0], d: span[1], th: 0.4 }),
    (FLOOR_X0 + (grid.x1 ?? FLOOR_X1)) / 2, BASE - 0.6, (FLOOR_Z0 + (grid.z1 ?? FLOOR_Z1)) / 2,
  ));
  return solid;
}
