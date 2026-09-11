// 方凳（CATALOG2 #5）：「四腿方座面微裂」——家具类 prop（纯 wood 单族）。
// 原点=底面中心（y=0 落地），高约 2.5（同三脚凳尺度）；方座面上一两道深色贴面细缝
// 读作木面微裂，一角轻缺（chip 小量掉角）。变体走 build(opts)：裂缝道数 / 腿外撇角。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'stoolSquare',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'furniture', 'quarters'],
  footprint: { x: 1.9, z: 1.9 },
  behaviors: [],
  build({ cracks = 2, splay = 0.08, rng } = {}) {
    const g = new THREE.Group();
    // 方座面：厚板一角轻缺（微裂旧凳的掉角）
    const seat = K.box({ color: P.wood, size: [1.7, 0.22, 1.7], family: 'wood' });
    K.chip(seat, { corner: [1, 1, 1], amount: 0.12 });
    g.add(K.put(seat, 0, 2.39, 0));
    // 座面裂缝：贴面细缝条（深色暗缝一道微斜贯通，第二道短斜缝），读作木面微裂
    const seam1 = K.box({ color: shade(P.woodDark, -0.06), size: [1.45, 0.05, 0.08], family: 'wood' });
    K.tilt(seam1, 0, 0.08, 0);
    g.add(K.put(seam1, 0.05, 2.51, -0.12));
    if (cracks >= 2) {
      const seam2 = K.box({ color: shade(P.woodDark, -0.06), size: [0.72, 0.05, 0.07], family: 'wood' });
      K.tilt(seam2, 0, -0.5, 0);
      g.add(K.put(seam2, -0.42, 2.51, 0.3));
    }
    // 四腿：方细腿微外撇（脚头张开）
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = K.box({ color: P.woodDark, size: [0.26, 2.28, 0.26], family: 'wood' });
      K.tilt(leg, -sz * splay, 0, sx * splay);
      if (rng) K.jitter(leg, rng, { rot: 0.015 });
      g.add(K.put(leg, sx * 0.6, 1.14, sz * 0.6));
    }
    return g;
  },
};
