// 瓶架（CATALOG #36）：「斜靠酒瓶的木架，一只瓶倒」——家具类范例（木+玻璃双族）。
// 原点=底面中心（y=0 落地），x=宽 z=深；变体走 build(opts)：瓶数/倒瓶数/斜靠角。

import * as THREE from 'three';
import { P, K } from '../kit/index.js';

// 瓶身轮廓（lathe profile：底→圆肚→收肩→细颈→瓶口），高约 1.5
const BOTTLE = [
  [0.03, 0], [0.30, 0.03], [0.42, 0.35], [0.44, 0.62],
  [0.26, 0.92], [0.12, 1.08], [0.12, 1.32], [0.17, 1.36],
];
const BOTTLE_COLORS = ['potionGreen', 'potionBlue', 'potionRed'];

export default {
  id: 'bottleRack',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'container', 'brittle'],
  footprint: { x: 4, z: 2 },
  behaviors: [],
  build({ bottles = 5, fallen = 1, lean = 0.2, rng } = {}) {
    const g = new THREE.Group();
    // 框架：四腿微外撇 + 三层搁板 + 背靠两杆（瓶斜靠用）
    for (const sx of [-1.6, 1.6]) for (const sz of [-0.55, 0.55]) {
      g.add(K.put(K.tilt(
        K.box({ color: P.woodDark, size: [0.35, 4.2, 0.35], family: 'wood' }),
        0, 0, sx * 0.03), sx, 2.1, sz));
    }
    for (const y of [0.7, 2.0, 3.3]) {
      g.add(K.put(K.box({ color: P.wood, size: [3.5, 0.24, 1.3], family: 'wood' }), 0, y, 0));
      g.add(K.put(K.box({ color: P.woodDark, size: [3.4, 0.14, 0.14], family: 'wood' }), 0, y + 1.0, -0.5));
    }
    // 酒瓶：分层斜靠背杆，颜色轮换；rng 在场时逐瓶微抖（确定性变体）
    const standing = bottles - fallen;
    for (let i = 0; i < standing; i++) {
      const shelfTop = [0.82, 2.12, 3.42][Math.floor(i / 2) % 3];
      const b = K.lathe({ color: P[BOTTLE_COLORS[i % 3]], profile: BOTTLE, seg: 7, family: 'glass' });
      K.tilt(b, -lean, 0, 0);
      if (rng) K.jitter(b, rng, { pos: 0.05, rot: 0.04 });
      g.add(K.put(b, -1.35 + (i % 2) * 0.55 + (i % 3) * 0.5, shelfTop, -0.18));
    }
    // 倒瓶：顶层搁板上横躺（轴 y→z 躺平，瓶肚半径 0.44 垫高）
    for (let i = 0; i < fallen; i++) {
      const b = K.lathe({ color: P[BOTTLE_COLORS[(standing + i) % 3]], profile: BOTTLE, seg: 7, family: 'glass' });
      K.tilt(b, Math.PI / 2 - 0.06, 0.2, 0);
      g.add(K.put(b, -0.9 + i * 1.4, 3.86, 0.15));
    }
    return g;
  },
};
