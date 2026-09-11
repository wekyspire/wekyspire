// 挂盾（CATALOG #79）：「凹痕圆盾，皮条残断」——wallDecor（metal+cloth 皮条 双族）。
// 原点=墙面挂点（z=0 贴墙，+z 朝室内，同 wallTorch 约定）；band=mid；盾径约 4，盾心 y≈2.2。
// 盾体=三层同心短圆柱（暗缘环/盾面/中央伞钉，轴向 z 贴墙）；凹痕=盾缘 chip 缺角 +
// 盾面压扁 sphereLo 暗斑块半嵌（读作凹陷）；皮条残断=P.rope 薄条（cloth 族）自盾后
// 下缘垂下，长短/歪斜不齐。变体走 build(opts)：斑块数/皮条数。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'shieldWall',
  place: 'wallDecor',
  band: 'mid',
  tags: ['metal'],
  behaviors: [],
  build({ dents = 3, straps = 2, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('shieldWall');
    const cy = 2.2, cz = 0.28;
    // 挂钩垫块（贴墙，藏于盾后上缘）
    g.add(K.put(K.box({ color: shade(P.iron, -0.2), size: [0.5, 0.4, 0.22], family: 'metal' }), 0, cy + 1.85, 0.11));
    // 盾体：暗缘环（缺角）+ 盾面（略缩进）+ 中央伞钉（凸出）
    const rim = K.cyl({ color: shade(P.iron, -0.2), r: 2.05, h: 0.3, seg: 9, family: 'metal' });
    K.chip(rim, { corner: [1, 1, 1], amount: 0.3 }); // 盾缘缺角
    K.tilt(rim, Math.PI / 2);
    g.add(K.put(rim, 0, cy, cz));
    const face = K.cyl({ color: shade(P.iron, 0.05), r: 1.78, h: 0.3, seg: 9, family: 'metal' });
    K.tilt(face, Math.PI / 2);
    g.add(K.put(face, 0, cy, cz - 0.02));
    const boss = K.cyl({ color: shade(P.iron, 0.16), r: 0.52, rTop: 0.38, h: 0.3, seg: 8, family: 'metal' });
    K.tilt(boss, Math.PI / 2);
    g.add(K.put(boss, 0, cy, cz + 0.14));
    // 缘钉一圈（提亮小珠，钉在缘环带上）
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3 + 0.3;
      g.add(K.put(K.sphereLo({ color: shade(P.iron, 0.12), r: 0.1, seg: 0, family: 'metal' }), Math.cos(a) * 1.92, cy + Math.sin(a) * 1.92, cz + 0.16));
    }
    // 凹痕暗斑块：压扁 sphereLo 半嵌盾面（避开伞钉，深浅两档）
    const patches = Math.max(1, Math.min(4, dents));
    for (let i = 0; i < patches; i++) {
      const a = r() * Math.PI * 2;
      const rad = 0.78 + r() * 0.7;
      const dent = K.sphereLo({ color: shade(P.iron, -0.3 - (i % 2) * 0.12), r: 0.3 + r() * 0.16, seg: 0, jitter: 0.2, rng: r, family: 'metal' });
      K.scaleXYZ(dent, 1, 1, 0.4);
      K.tilt(dent, 0, r() * Math.PI, 0);
      g.add(K.put(dent, Math.cos(a) * rad, cy + Math.sin(a) * rad, cz + 0.1));
    }
    // 皮条残断：自盾后下缘垂下，长短/歪斜不齐
    const st = Math.max(1, Math.min(3, straps));
    for (let i = 0; i < st; i++) {
      const x = st === 1 ? -0.6 : -0.85 + i * (1.7 / (st - 1));
      const len = 0.65 + r() * 0.25;
      const strap = K.box({ color: P.rope, size: [0.4, len, 0.09], family: 'cloth' });
      K.tilt(strap, r() * 0.1, 0, Math.sign(x || 1) * (0.05 + r() * 0.18));
      g.add(K.put(strap, x, 0.9 - len / 2, cz - 0.08));
    }
    return g;
  },
};
