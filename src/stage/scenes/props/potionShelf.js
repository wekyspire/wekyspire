// 药剂架（CATALOG #35）：「三层格架，瓶色各异地摆」——prop 类（木架 stone + 药瓶 glass 双族）。
// 原点=底面中心（y=0 落地），x=宽 z=深；下两层立细颈高瓶、顶层摆圆肚小瓶，颜色轮换深浅各异。
// 变体走 build(opts)：高瓶数/小瓶数。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 细颈高瓶轮廓（lathe profile：底→圆肚→收肩→细颈→翻口），高约 1.45
const VIAL = [
  [0.02, 0], [0.24, 0.04], [0.33, 0.3], [0.35, 0.55],
  [0.22, 0.82], [0.11, 0.98], [0.11, 1.3], [0.17, 1.38], [0.15, 1.45],
];
// 圆肚小瓶轮廓（宽肩细口），高约 0.88
const FLASK = [
  [0.02, 0], [0.26, 0.05], [0.36, 0.28], [0.33, 0.52],
  [0.14, 0.64], [0.1, 0.82], [0.15, 0.88],
];
const COLORS = ['potionGreen', 'potionBlue', 'potionRed'];

// 格位：三层搁板高度 / 高瓶三槽 / 顶层小瓶三槽（留空位即「各异地摆」的疏密变化）
const SHELF_Y = [1.4, 3.1, 4.8];
const VIAL_X = [-1.15, 0, 1.15];
const FLASK_X = [-0.9, 0.05, 0.9];

export default {
  id: 'potionShelf',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'container'],
  footprint: { x: 3.8, z: 1.6 },
  behaviors: [],
  build({ bottles = 6, flasks = 2, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('potionShelf');
    // 框架：底座板 + 两侧夹板 + 三层搁板（下两层带前挡细条，格位读作三层格架）
    g.add(K.put(K.box({ color: P.woodDark, size: [3.8, 0.26, 1.5] }), 0, 0.13, 0));
    for (const s of [-1, 1]) {
      g.add(K.put(K.box({ color: P.woodDark, size: [0.26, 5.2, 1.4] }), s * 1.77, 2.6, 0));
    }
    SHELF_Y.forEach((y, i) => {
      g.add(K.put(K.box({ color: P.wood, size: [3.4, 0.2, 1.3] }), 0, y, 0));
      if (i < 2) g.add(K.put(K.box({ color: P.woodDark, size: [3.4, 0.12, 0.1] }), 0, y + 0.16, 0.62));
    });
    // 高瓶：下两层三槽轮换摆放，三色 × 深浅交替各瓶不同（玻璃族），rng 微歪微挪
    for (let i = 0; i < bottles; i++) {
      const tier = i % 2, slot = Math.floor(i / 2) % 3;
      const c = COLORS[i % 3];
      const v = K.lathe({
        color: [P[c], shade(P[c], 0.12), shade(P[c], -0.1)][(i + 1) % 3],
        profile: VIAL, seg: 7, family: 'glass',
      });
      K.tilt(v, (r() - 0.5) * 0.08, 0, (r() - 0.5) * 0.1);
      g.add(K.put(v, VIAL_X[slot] + (r() - 0.5) * 0.12, SHELF_Y[tier] + 0.1, (r() - 0.5) * 0.16));
    }
    // 小瓶：顶层圆肚瓶错开摆（默认占两槽留一空位）
    for (let i = 0; i < flasks; i++) {
      const c = COLORS[(bottles + i) % 3];
      const f = K.lathe({ color: shade(P[c], i % 2 ? 0.1 : -0.06), profile: FLASK, seg: 7, family: 'glass' });
      K.tilt(f, 0, 0, (r() - 0.5) * 0.08);
      g.add(K.put(f, FLASK_X[i % 3] + (r() - 0.5) * 0.1, SHELF_Y[2] + 0.1, (r() - 0.5) * 0.14));
    }
    return g;
  },
};
