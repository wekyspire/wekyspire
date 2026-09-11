// 长案（CATALOG #25）：「细长供桌，桌面留烛台位」——家具类 prop（wood + stone 蜡 双族）。
// 原点=底面中心（y=0 落地），x=长 z=深，桌面高约 4.8；烛台位=桌面低环座（其中一位
// 可残留熄烛头，无火苗——本资产不承担布光职责）。变体走 build(opts)：案长/烛位数/烛头。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'tableLong',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'furniture'],
  footprint: { x: 8, z: 2.2 },
  behaviors: [],
  build({ len = 8, sockets = 3, stub = true, rng } = {}) {
    const g = new THREE.Group();
    const legX = len / 2 - 0.55;
    // 桌面：细长厚板（表面高 4.8）
    g.add(K.put(K.box({ color: P.wood, size: [len, 0.4, 1.9], family: 'wood' }), 0, 4.6, 0));
    // 四腿：方柱微外撇 + 两侧望板 + 低拉档（细长案身的稳定骨架）
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = K.box({ color: P.woodDark, size: [0.42, 4.4, 0.42], family: 'wood' });
      K.tilt(leg, -sz * 0.03, 0, sx * 0.03);
      if (rng) K.jitter(leg, rng, { rot: 0.012 });
      g.add(K.put(leg, sx * legX, 2.2, sz * 0.58));
    }
    for (const sz of [-1, 1]) {
      g.add(K.put(K.box({ color: shade(P.woodDark, 0.06), size: [len - 1.3, 0.34, 0.24], family: 'wood' }), 0, 4.05, sz * 0.58));
      g.add(K.put(K.box({ color: shade(P.woodDark, 0.1), size: [len - 1.4, 0.18, 0.18], family: 'wood' }), 0, 1.2, sz * 0.58));
    }
    // 烛台位：沿案均布的低环座（空位为主，供摆烛台）
    for (let i = 0; i < sockets; i++) {
      const x = sockets === 1 ? 0 : -len * 0.33 + i * (len * 0.66 / (sockets - 1));
      const ring = K.cyl({ color: P.woodDark, r: 0.3, rTop: 0.36, h: 0.14, seg: 6, family: 'wood' });
      if (rng) K.jitter(ring, rng, { rot: 0.02 });
      g.add(K.put(ring, x, 4.87, 0));
      // 中位残留一枚燃残的熄烛头（歪斜蜡柱，无焰）
      if (stub && i === Math.floor(sockets / 2)) {
        const waxStub = K.cyl({ color: P.wax, r: 0.15, h: 0.35, seg: 5 });
        K.tilt(waxStub, 0.08, 0.3, 0.05);
        g.add(K.put(waxStub, x, 5.1, 0));
      }
    }
    return g;
  },
};
