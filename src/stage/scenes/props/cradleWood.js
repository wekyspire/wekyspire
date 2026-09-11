// 木摇篮（CATALOG2 #10）：「船形摇篮+小被褥」——起居小件 prop（wood 船体 + cloth 被褥 双族）。
// 原点=底面中心（y=0 落地），x=长 z=宽；船形=平底板+双舷板+首尾起翘的斜端板，
// 摇板=每侧两段微倾木条拼出浅弧（中央触地、两端翘起）。被褥=蓬起小丘（jitter 球）+
// 小枕 + 搭角布片。变体走 build(opts)：被褥蓬度 heap / 摇摆姿态 swing（船体在摇板上微倾）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'cradleWood',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'cloth', 'quarters'],
  footprint: { x: 3.6, z: 1.6 },
  behaviors: [],
  build({ heap = 1.0, swing = 0, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('cradleWood');
    // 摇板：每侧两段微倾拼浅弧（中央触地）
    for (const sz of [-1, 1]) for (const sx of [-1, 1]) {
      const runner = K.box({ color: shade(P.woodDark, -0.06), size: [1.35, 0.14, 0.16], family: 'wood' });
      K.tilt(runner, 0, 0, sx * 0.2);
      g.add(K.put(runner, sx * 0.66, 0.23, sz * 0.55));
    }
    // 船体（子组整体微倾 = 摇摆姿态）
    const hull = new THREE.Group();
    K.tilt(hull, 0, 0, swing);
    g.add(hull);
    hull.add(K.put(K.box({ color: P.woodDark, size: [2.5, 0.22, 1.3], family: 'wood' }), 0, 0.38, 0));
    for (const sz of [-1, 1]) {
      const wall = K.box({ color: P.wood, size: [2.1, 0.55, 0.15], family: 'wood' });
      K.tilt(wall, 0, 0, (r() - 0.5) * 0.02);
      hull.add(K.put(wall, 0, 0.72, sz * 0.62));
    }
    for (const sx of [-1, 1]) {
      const end = K.box({ color: shade(P.wood, 0.05), size: [0.7, 0.85, 1.28], family: 'wood' });
      K.tilt(end, 0, 0, -sx * 0.55);
      hull.add(K.put(end, sx * 1.15, 0.9, 0));
    }
    // 小被褥：蓬丘（jitter 球压扁）+ 小枕 + 搭角
    const quilt = K.sphereLo({ color: P.sack, r: 0.75, seg: 1, jitter: 0.15, rng: r, family: 'cloth' });
    K.scaleXYZ(quilt, 1.2 * heap, 0.5 * heap, 0.65);
    hull.add(K.put(quilt, -0.05, 0.62, 0));
    hull.add(K.put(K.box({ color: P.flour, size: [0.55, 0.2, 0.7], family: 'cloth' }), -0.75, 0.85, 0));
    hull.add(K.put(K.box({
      color: shade(P.bannerRed, -0.04), size: [0.8, 0.13, 0.9], family: 'cloth',
    }), 0.45, 1.05, 0.02));
    return g;
  },
};
