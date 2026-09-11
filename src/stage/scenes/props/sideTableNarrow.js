// 窄边几（CATALOG2 #14）：「三条细腿小几」——起居家具 prop（纯 wood 单族）。
// 小圆厚几面（提亮一档读「摆用磨亮」）+ 下沿窄箍圈 + 三条细腿 120 度均布、
// 上收下撇的外倾三足，半腰一片小圆托盘（三足几的第二层）。
// 原点=底面中心（y=0 落地），几面高约 2.4。变体走 build(opts)：腿外撇角/托盘有无。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'sideTableNarrow',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'furniture', 'quarters'],
  footprint: { x: 3.4, z: 3.4 },
  behaviors: [],
  build({ splay = 0.22, tier = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('sideTableNarrow');
    const topR = 1.32;
    // 几面：小圆厚面（磨亮）+ 底下窄箍圈（读出面板厚度层次）
    g.add(K.put(K.cyl({ color: shade(P.wood, 0.1), r: topR, h: 0.22, seg: 7, family: 'wood' }), 0, 2.32, 0));
    g.add(K.put(K.cyl({ color: P.woodDark, r: topR * 0.92, h: 0.12, seg: 7, family: 'wood' }), 0, 2.18, 0));
    // 三条细腿：局部先向 +x 外倾（splay 控制），再绕 y 每 120 度展开
    for (let i = 0; i < 3; i++) {
      const leg = new THREE.Group();
      const bar = K.cyl({ color: P.woodDark, r: 0.1, rTop: 0.085, h: 2.42, seg: 5, family: 'wood' });
      K.tilt(bar, 0, 0, -splay);
      K.jitter(bar, r, { rot: 0.012 });
      leg.add(K.put(bar, 1.18, 1.18, 0));
      leg.rotation.y = i * (Math.PI * 2 / 3) + 0.5;
      g.add(leg);
    }
    // 半腰小托盘：落在三腿收拢处的一片小圆盘
    if (tier) {
      g.add(K.put(K.cyl({ color: shade(P.wood, 0.05), r: 1.16, h: 0.12, seg: 7, family: 'wood' }), 0, 1.3, 0));
    }
    return g;
  },
};
