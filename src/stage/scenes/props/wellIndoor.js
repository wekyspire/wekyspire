// 室内小井（CATALOG2 编号 80）：「石沿圈+辘轳架垂绳」——起居 prop/floor（stone+wood+cloth 三族）。
// 原点=井心（y=0 落地，沿径约 4、总高约 6，L 档）；石沿圈沿 hearthStone/statuePedestal
// 石作语汇（毛石环排、明暗三档、断续二层加砌），井口以压暗石片读作井内幽深；
// 辘轳=双木柱+横轴（aim 轴向贯穿）+轴端下折摇柄+轴中绳卷，垂绳分节垂坠（hooksRope
// 语汇：微摆+末端收结）直落井口。变体走 build(opts)：圈石数/加砌数/绳长。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'wellIndoor',
  place: 'prop',
  mount: 'floor',
  tags: ['stone', 'quarters'],
  footprint: { x: 5.6, z: 4.6 },
  behaviors: [],
  build({ blocks = 10, topBlocks = 4, ropeLen = 3.8, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('wellIndoor');
    const ringR = 1.72;
    // 石沿圈：毛石环排（长边切向、明暗三档）+ 断续二层加砌
    const n = Math.max(8, Math.min(11, blocks));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const blk = K.box({
        color: [shade(P.stone, -0.08), P.stone, shade(P.stone, 0.06)][i % 3],
        size: [1.08, 0.6, 0.55],
      });
      K.tilt(blk, 0, a + Math.PI / 2 + (r() - 0.5) * 0.06, (r() - 0.5) * 0.03);
      g.add(K.put(blk, Math.cos(a) * ringR, 0.3, Math.sin(a) * ringR));
    }
    const m = Math.max(0, Math.min(5, topBlocks));
    for (let i = 0; i < m; i++) {
      const a = (i / m) * Math.PI * 2 + 0.5 + r() * 0.3;
      const blk = K.box({ color: shade(P.stone, i % 2 ? -0.14 : 0.02), size: [0.92, 0.4, 0.48] });
      K.tilt(blk, 0, a + Math.PI / 2 + (r() - 0.5) * 0.08, (r() - 0.5) * 0.04);
      g.add(K.put(blk, Math.cos(a) * ringR, 0.9, Math.sin(a) * ringR));
    }
    // 井口：圈心压暗石片读作井内幽深
    g.add(K.put(K.cyl({ color: shade(P.stone, -0.52), r: 1.36, h: 0.16, seg: 9 }), 0, 0.1, 0));
    // 辘轳架：双木柱（跨井口微歪）+ 横轴（aim 轴向，外伸轴端）+ 轴中绳卷
    for (const sx of [-1, 1]) {
      const post = K.cyl({ color: P.wood, r: 0.2, h: 5.9, seg: 7, family: 'wood' });
      K.jitter(post, r, { rot: 0.015 });
      g.add(K.put(post, sx * 1.95, 2.95, 0));
    }
    const axle = K.cyl({ color: shade(P.wood, 0.06), r: 0.15, h: 4.7, seg: 6, family: 'wood' });
    K.aim(axle, 1, 0, 0);
    g.add(K.put(axle, 0.25, 5.5, 0));
    const drum = K.cyl({ color: P.rope, r: 0.24, h: 0.9, seg: 6, family: 'cloth' });
    K.aim(drum, 1, 0, 0);
    g.add(K.put(drum, 0, 5.5, 0));
    // 摇柄：轴外伸端下折臂 + 横握手（L 形曲拐）
    g.add(K.put(K.box({ color: shade(P.wood, -0.08), size: [0.14, 0.62, 0.14], family: 'wood' }), 2.6, 5.19, 0));
    const grip = K.cyl({ color: shade(P.wood, 0.1), r: 0.09, h: 0.72, seg: 5, family: 'wood' });
    K.aim(grip, 1, 0, 0);
    g.add(K.put(grip, 2.96, 4.88, 0));
    // 垂绳：自绳卷底分节垂坠（微摆、深浅交替绳股感），绳头收小结——直落井口
    const yTop = 5.2;
    const segs = 4;
    const step = ropeLen / segs;
    for (let i = 0; i < segs; i++) {
      const sway = Math.sin(i * 0.9) * 0.08;
      const seg = K.cyl({
        color: i % 2 ? shade(P.rope, -0.07) : P.rope,
        r: 0.08, h: step + 0.08, seg: 5, family: 'cloth',
      });
      K.tilt(seg, 0, 0, sway);
      g.add(K.put(seg, sway * 0.5, yTop - step * (i + 0.5), sway * 0.3));
    }
    g.add(K.put(K.cyl({
      color: shade(P.rope, -0.12), r: 0.16, rTop: 0.12, h: 0.3, seg: 5, family: 'cloth',
    }), 0, yTop - ropeLen - 0.15, 0));
    return g;
  },
};
