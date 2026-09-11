// 木桌（CATALOG #24）：「厚板四腿，桌角磨圆」——家具类 prop（纯 wood 单族）。
// 原点=底面中心（y=0 落地），x=宽 z=深，桌面高约 4.6；变体走 build(opts)：
// 桌面宽深 / 桌角磨圆量 / 腿外撇角（rng 在场时逐腿微抖出旧木手工感）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'tableWood',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'furniture'],
  footprint: { x: 4, z: 2.8 },
  behaviors: [],
  build({ w = 3.8, d = 2.6, h = 4.2, round = 0.18, splay = 0.05, rng } = {}) {
    const g = new THREE.Group();
    // 桌面：厚板四角磨圆（chip 逐角内拉，flatShading 下读作圆角倒边，角顶微沉更旧）
    const top = K.box({ color: P.wood, size: [w, 0.45, d], family: 'wood' });
    if (round > 0) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        K.chip(top, { corner: [sx, 1, sz], amount: round });
      }
    }
    g.add(K.put(top, 0, h + 0.225, 0));
    // 四腿：方柱微外撇（腿脚张开的老木桌姿态）
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = K.box({ color: P.woodDark, size: [0.4, h, 0.4], family: 'wood' });
      K.tilt(leg, -sz * splay, 0, sx * splay);
      if (rng) K.jitter(leg, rng, { rot: 0.015 });
      g.add(K.put(leg, sx * (w / 2 - 0.35), h / 2, sz * (d / 2 - 0.35)));
    }
    // 望板：四面框住腿根（家具感的收束线脚）
    for (const sz of [-1, 1]) {
      g.add(K.put(K.box({ color: shade(P.woodDark, 0.06), size: [w - 1.1, 0.3, 0.26], family: 'wood' }), 0, h - 0.35, sz * (d / 2 - 0.35)));
    }
    for (const sx of [-1, 1]) {
      g.add(K.put(K.box({ color: shade(P.woodDark, 0.06), size: [0.26, 0.3, d - 1.1], family: 'wood' }), sx * (w / 2 - 0.35), h - 0.35, 0));
    }
    return g;
  },
};
