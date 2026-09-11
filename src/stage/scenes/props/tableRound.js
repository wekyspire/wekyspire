// 圆木桌（CATALOG2 #1）：「圆面厚板+中柱三脚，桌缘木色差」——家具类 prop（纯 wood 单族）。
// 原点=底面中心（y=0 落地），圆桌径约 5，桌面高约 4.6（同 tableWood 尺度口径）；
// 桌缘色差=台面下沿一圈略外凸的深色边带。变体走 build(opts)：桌径 / 三脚外撇角 / 边带。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'tableRound',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'furniture', 'quarters'],
  footprint: { x: 5.4, z: 5.4 },
  behaviors: [],
  build({ dia = 5, splay = 0.72, rimBand = true, rng } = {}) {
    const g = new THREE.Group();
    const r = dia / 2;
    // 桌面：圆厚板（面高约 4.6），下沿叠一圈略外凸的深色边带读出「桌缘木色差」
    g.add(K.put(K.cyl({ color: P.wood, r, h: 0.45, seg: 8, family: 'wood' }), 0, 4.37, 0));
    if (rimBand) {
      g.add(K.put(K.cyl({ color: shade(P.woodDark, 0.04), r: r + 0.13, h: 0.22, seg: 8, family: 'wood' }), 0, 4.19, 0));
    }
    // 中柱：础盘 + 收分柱身（独柱承面）
    g.add(K.put(K.cyl({ color: P.woodDark, r: 0.75, h: 0.42, seg: 7, family: 'wood' }), 0, 0.21, 0));
    g.add(K.put(K.cyl({ color: shade(P.woodDark, 0.1), r: 0.44, rTop: 0.32, h: 3.73, seg: 6, family: 'wood' }), 0, 2.28, 0));
    // 三脚：120° 均布、上收进柱身下张外撇（粗脚头落地）
    for (let i = 0; i < 3; i++) {
      const a = i * (Math.PI * 2 / 3) + 0.55;
      const leg = K.cyl({ color: P.woodDark, r: 0.27, rTop: 0.18, h: 2.4, seg: 5, family: 'wood' });
      K.tilt(leg, -Math.sin(a) * splay, 0, Math.cos(a) * splay);
      if (rng) K.jitter(leg, rng, { rot: 0.02 });
      g.add(K.put(leg, Math.cos(a) * 1.35, 0.9, Math.sin(a) * 1.35));
    }
    return g;
  },
};
