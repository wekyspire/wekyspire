// 碎石带（CATALOG #49）：「长条散石，头密尾疏」——撒印类 floorDecal（战场区准入层）。
// 原点=带中点投影（y=0 落地），x=长轴 z=带宽；头端（-x）石块大而密、垫两块平石，
// 沿 +x 间距与体量同步衰减（x=t^1.55 间距曲线），尾端散成零星小石。rng 驱动确定性变体。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'rubbleScatter',
  place: 'floorDecal',
  tags: ['rubble'],
  footprint: { x: 8, z: 3 },
  behaviors: [],
  build({ rocks = 15, spread = 1.0, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('rubbleScatter');
    const tones = [shade(P.rock, 0.12), P.rock, shade(P.slab, 0.06)];
    // 主散石：头密尾疏（间距曲线 + 体量/带宽向尾端收敛）
    for (let i = 0; i < rocks; i++) {
      const t = i / Math.max(1, rocks - 1);              // 0 头 → 1 尾
      const size = 0.55 - t * 0.27 + (r() - 0.5) * 0.08;
      const rock = K.sphereLo({ color: tones[i % 3], r: size, seg: 0, jitter: 0.22, rng: r });
      K.tilt(rock, r() * 0.5, r() * Math.PI, r() * 0.5);
      g.add(K.put(rock,
        -3.3 + 6.6 * Math.pow(t, 1.55) + (r() - 0.5) * 0.4,
        size * 0.5,
        (r() * 2 - 1) * spread * (0.95 - t * 0.35)));
    }
    // 头端两块平石（加密头部剪影）
    for (const [x, z, ry] of [[-2.7, 0.45, 0.35], [-2.2, -0.5, -0.5]]) {
      const slab = K.plate({ color: shade(P.slab, -0.04), w: 1.0, d: 0.72, th: 0.2 });
      g.add(K.put(K.tilt(slab, 0.04, ry, -0.05), x, 0.11, z));
    }
    // 头部一撮小砾（垫密度的碎屑）
    for (let i = 0; i < 4; i++) {
      const pebble = K.sphereLo({ color: tones[i % 3], r: 0.13 + r() * 0.05, seg: 0, jitter: 0.2, rng: r });
      g.add(K.put(pebble, -3.1 + r() * 1.2, 0.07, (r() * 2 - 1) * 0.55 * spread));
    }
    return g;
  },
};
