// 苔藓斑（CATALOG #52）：「不规则苔块，深浅两层」——撒印类 floorDecal（贴地薄片）。
// 原点=斑心投影；底层暗苔大块（mossDark，铺得开）+ 上层浅苔碎块（moss 系）错位叠压，
// 压扁 jitter 球 rng 组合出不规则边缘，总高 ≤0.25。变体：苔块数/铺开半径。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'mossPatchFloor',
  place: 'floorDecal',
  tags: ['moss'],
  footprint: { x: 5, z: 5 },
  behaviors: [],
  build({ blobs = 4, spread = 1.0, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('mossPatchFloor');
    // 底层：暗苔大块（环布主斑，铺出斑底）
    const base = Math.max(2, blobs - 1);
    for (let i = 0; i < base; i++) {
      const a = (i / base) * Math.PI * 2 + r() * 0.8;
      const q = 0.35 + r() * 0.5;
      const blob = K.sphereLo({ color: P.mossDark, r: 1, seg: 1, jitter: 0.18, rng: r });
      K.scaleXYZ(blob, 1.7, 0.16, 1.45);
      K.tilt(blob, 0, a, 0);
      g.add(K.put(blob, Math.cos(a) * q * 1.0 * spread, 0.07, Math.sin(a) * q * 0.85 * spread));
    }
    // 上层：浅苔碎块错位叠压（亮层，最亮一撮点睛）
    const tones = [P.moss, shade(P.moss, 0.14), shade(P.moss, 0.24)];
    for (let i = 0; i < blobs + 2; i++) {
      const a = r() * Math.PI * 2;
      const q = Math.pow(r(), 0.8);                     // 向心聚拢
      const blob = K.sphereLo({ color: tones[i % 3], r: 1, seg: 1, jitter: 0.22, rng: r });
      K.scaleXYZ(blob, 0.95 + r() * 0.55, 0.14, 0.7 + r() * 0.45);
      K.tilt(blob, 0, r() * Math.PI, 0);
      g.add(K.put(blob, Math.cos(a) * q * 1.3 * spread, 0.15, Math.sin(a) * q * 1.05 * spread));
    }
    return g;
  },
};
