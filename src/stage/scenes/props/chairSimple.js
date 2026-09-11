// 简椅（CATALOG2 #4）：「四腿薄板座背，坐面磨亮」——家具类 prop（纯 wood 单族）。
// 原点=底面中心（y=0 落地），x=宽 z=深，+z 朝前；座高约 2.3、总高约 4.6（凳与高背椅之间）；
// 磨亮坐面=座板比椅身木色提亮一档（久坐磨出的光面）。变体走 build(opts)：背高 / 磨亮程度。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'chairSimple',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'furniture', 'quarters'],
  footprint: { x: 1.8, z: 1.9 },
  behaviors: [],
  build({ backH = 4.6, polish = 0.15, rng } = {}) {
    const g = new THREE.Group();
    // 前腿一对（方细腿，后腿即背柱见下）
    for (const sx of [-1, 1]) {
      const leg = K.box({ color: P.woodDark, size: [0.24, 2.2, 0.24], family: 'wood' });
      if (rng) K.jitter(leg, rng, { rot: 0.012 });
      g.add(K.put(leg, sx * 0.62, 1.1, 0.58));
    }
    // 薄板座面：提亮一档读作久坐磨亮
    g.add(K.put(K.box({ color: shade(P.wood, polish), size: [1.68, 0.16, 1.62], family: 'wood' }), 0, 2.28, 0));
    // 后腿通顶成背柱（微后仰）+ 薄板背 + 下一根细棂
    for (const sx of [-1, 1]) {
      const stile = K.box({ color: P.woodDark, size: [0.26, backH, 0.26], family: 'wood' });
      K.tilt(stile, -0.07, 0, 0);
      if (rng) K.jitter(stile, rng, { rot: 0.008 });
      g.add(K.put(stile, sx * 0.62, backH / 2, -0.58));
    }
    const back = K.box({ color: shade(P.wood, 0.08), size: [1.5, 0.5, 0.1], family: 'wood' });
    K.tilt(back, -0.07, 0, 0);
    g.add(K.put(back, 0, 3.85, -0.7));
    const slat = K.box({ color: P.wood, size: [1.5, 0.14, 0.09], family: 'wood' });
    K.tilt(slat, -0.07, 0, 0);
    g.add(K.put(slat, 0, 3.0, -0.65));
    return g;
  },
};
