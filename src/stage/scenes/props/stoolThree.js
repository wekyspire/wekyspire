// 三脚凳（CATALOG #26）：「三腿圆凳，凳面龟裂」——家具类 prop（纯 wood 单族）。
// 原点=底面中心（y=0 落地），高约 2.5；凳面=压扁 jitter 低模球（起伏读作龟裂木面），
// 三腿 120° 均布外撇。变体走 build(opts)：龟裂强度 / 腿外撇角。

import * as THREE from 'three';
import { P, K } from '../kit/index.js';

export default {
  id: 'stoolThree',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'furniture'],
  footprint: { x: 2, z: 2 },
  behaviors: [],
  build({ cracked = 0.14, splay = 0.16, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('stoolThree');
    // 凳面：低模球压扁 + 龟裂起伏（flatShading 下棱面读作裂纹），顶面约 2.5
    const seat = K.sphereLo({ color: P.wood, r: 0.88, seg: 1, jitter: cracked, rng: r, family: 'wood' });
    K.scaleXYZ(seat, 1, 0.15, 1);
    g.add(K.put(seat, 0, 2.36, 0));
    // 三腿：120° 均布、上收下张（外撇的脚头 + 微抖的手工感）
    for (let i = 0; i < 3; i++) {
      const a = i * (Math.PI * 2 / 3) + 0.4;
      const leg = K.cyl({ color: P.woodDark, r: 0.13, rTop: 0.1, h: 2.32, seg: 5, family: 'wood' });
      K.tilt(leg, -Math.sin(a) * splay, 0, Math.cos(a) * splay);
      K.jitter(leg, r, { rot: 0.02 });
      g.add(K.put(leg, Math.cos(a) * 0.6, 1.16, Math.sin(a) * 0.6));
    }
    return g;
  },
};
