// 小瓦砾堆（CATALOG #48）：「碎砖小丘，混断木片」——撒印类范例（floorDecal）。
// 原点=堆心投影（y=0 落地）；碎块按小丘逻辑堆叠（越高越收拢），rng 驱动确定性变体。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'rubblePile',
  place: 'floorDecal',
  tags: ['rubble'],
  footprint: { x: 3, z: 3 },
  behaviors: [],
  build({ rocks = 9, spread = 0.7, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('rubblePile');
    for (let i = 0; i < rocks; i++) {
      const t = i / Math.max(1, rocks - 1);        // 0 底层 → 1 塔尖
      const size = 0.95 - t * 0.45;                // 越高越小
      const rad = spread * (1 - t * 0.72);         // 越高越收拢（2~3 层锥形小丘）
      const a = r() * Math.PI * 2;
      const rock = K.sphereLo({
        color: [shade(P.rock, 0.14), P.rock, shade(P.slab, 0.08)][i % 3],
        r: size, seg: 0, jitter: 0.25, rng: r,
      });
      K.tilt(rock, r() * 0.8, r() * Math.PI, r() * 0.8);
      g.add(K.put(rock, Math.cos(a) * rad * r(), size * 0.5 + t * 1.1, Math.sin(a) * rad * r()));
    }
    // 碎砖两块（缺角+歪斜）+ 断木一片
    for (const [x, z, ry] of [[-0.7, 0.45, 0.4], [0.55, -0.6, -0.7]]) {
      const brick = K.chip(K.box({ color: P.slab, size: [0.8, 0.4, 0.5] }), { corner: [1, 1, 1], amount: 0.22 });
      g.add(K.put(K.tilt(brick, 0.1, ry, 0.08), x, 0.24, z));
    }
    g.add(K.put(
      K.tilt(K.box({ color: P.woodDark, size: [1.5, 0.16, 0.3] }), 0.06, 1.1, -0.05),
      0.15, 0.1, 0.2));
    return g;
  },
};
