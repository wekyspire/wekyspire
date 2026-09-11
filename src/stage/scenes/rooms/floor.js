// 房型配方层 · 程序化地板：整板基底 + 错位石板 + 裂板 + 苔斑（dungeon3D 观感重建，
// 走顶点色管线与道具同批合并）。局部坐标：y=0 即地板面，调用方整组落到 FLOOR_Y。
// 撒布全部确定性（rng 由 composeRoom 以种子派生传入）。

import * as THREE from 'three';
import { P, K, shade, scatter } from '../kit/index.js';
import {
  FLOOR_X0, FLOOR_X1, FLOOR_Z0, FLOOR_Z1,
} from './walls.js';

/**
 * 程序化地板装饰层（基底由 terrain.js 体素柱取代——高度图管线，见 terrain.js 头注）：
 * 错位石板 + 裂板 + 苔斑撒布，避让地形坑缝。
 * @param rng 确定性 rng
 * @param slabCount 错位石板数量（dungeon3D 基准 13）
 * @param mossChance 苔斑/水渍贴印概率（0~1，逐石板决策）
 * @param avoid 避让矩形（地形坑缝 bbox）——石板不搭桥
 */
export function buildFloor(rng, { slabCount = 13, mossChance = 0.3, avoid = [], area = null } = {}) {
  const group = new THREE.Group();
  group.name = 'floor';

  // 错位石板：拒绝采样撒布（间距互斥 + 地形坑缝避让，宁缺毋滥），高度/转角微抖
  const spots = scatter(rng, {
    count: slabCount,
    area: area || { x0: FLOOR_X0 + 8, z0: FLOOR_Z0 + 6, x1: FLOOR_X1 - 10, z1: FLOOR_Z1 - 14 },
    spacing: 16,
    scaleRange: [1, 1],
    avoid: avoid.map(h => ({ x0: h.x0 - 2, x1: h.x1 + 2, z0: h.z0 - 2, z1: h.z1 + 2 })),
  });
  let i = 0;
  for (const s of spots) {
    i++;
    const sw = 11 + rng() * 5;
    const sd = 7 + rng() * 3;
    if (i === 2 && spots.length > 4) {
      // 裂板：两半错位互翘（第二块必有，观感锚点）
      const a = K.plate({ color: P.slab, w: sw * 0.55, d: sd, th: 1.1 });
      K.tilt(a, 0.05, s.rot + 0.1, 0.06);
      group.add(K.put(a, s.x - 2, 0.2, s.z));
      const b = K.plate({ color: P.slab, w: sw * 0.45, d: sd * 0.9, th: 1 });
      K.tilt(b, -0.04, s.rot - 0.06, -0.05);
      group.add(K.put(b, s.x + 3, 0.1, s.z + 0.8));
    } else {
      const slab = K.plate({ color: P.slab, w: sw, d: sd, th: 1 });
      K.tilt(slab, 0, s.rot, 0);
      group.add(K.put(slab, s.x, 0.15 + rng() * 0.45, s.z));
    }
    if (rng() < mossChance) {
      // 苔斑/水渍贴印（压暗苔色薄板，微抬防 z-fight）
      const moss = K.plate({
        color: rng() < 0.5 ? shade(P.mossDark, -0.15) : shade(P.water, -0.2),
        w: sw * (0.5 + rng() * 0.5), d: sd * (0.5 + rng() * 0.5), th: 0.18,
      });
      K.tilt(moss, 0, rng() * Math.PI, 0);
      group.add(K.put(moss, s.x + (rng() - 0.5) * 6, 0.72, s.z + (rng() - 0.5) * 4));
    }
  }
  return group;
}
