// 带盖瓮（CATALOG2 #25）：「圆胖瓮+覆碗盖+盖钮」——容器类 prop/floor（陶器 stone 单族）。
// 原点=底面中心（y=0 落地），通高约 3.1；变体走 build(opts)：丰满度 fat / 盖歪 ajar。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 瓮身轮廓（lathe profile：小圈足→圆胖鼓腹→收肩→直颈外撇口），身高约 2.15
const BODY = [
  [0.02, 0], [0.46, 0], [0.56, 0.12], [0.8, 0.5], [1.08, 1.0],
  [1.16, 1.4], [1.02, 1.74], [0.8, 1.94], [0.76, 2.04], [0.84, 2.15],
];
// 覆碗盖轮廓（盖沿外撇罩住瓮口的倒扣碗，盖顶承钮），盖高约 0.84
const LID = [
  [0.05, 0], [0.88, 0.05], [0.98, 0.2], [0.92, 0.42], [0.6, 0.68], [0.2, 0.84],
];

export default {
  id: 'urnLidded',
  place: 'prop',
  mount: 'floor',
  tags: ['pottery', 'container', 'brittle', 'crypt'],
  footprint: { x: 2.6, z: 2.6 },
  behaviors: [],
  build({ fat = 1, ajar = 0, rng } = {}) {
    const g = new THREE.Group();
    // 瓮身：lathe 一体拉坯（fat 控丰满度），微歪的窑烧手工感
    const body = K.lathe({ color: P.clay, seg: 8, profile: BODY.map(([r, y]) => [r * fat, y]) });
    if (rng) K.jitter(body, rng, { rot: 0.018 });
    g.add(body);
    // 肩线弦纹：鼓腹上缘一道压暗环带（clayDark 读作湿坯旋纹）
    g.add(K.put(K.cyl({ color: P.clayDark, r: 1.1 * fat, h: 0.1, seg: 8 }), 0, 1.12, 0));
    // 覆碗盖：罩在瓮口上的倒扣碗（盖沿外撇略宽于口沿），ajar 给一点点开盖歪斜
    const lid = K.lathe({ color: shade(P.clay, 0.04), seg: 8, profile: LID.map(([r, y]) => [r * fat, y]) });
    K.tilt(lid, ajar, ajar * 0.6, 0);
    g.add(K.put(lid, ajar * 0.3, 2.13, -ajar * 0.3));
    // 盖钮：盖顶小圆珠（clayDark，随盖同歪）
    const knob = K.sphereLo({ color: P.clayDark, r: 0.17, seg: 1 });
    K.tilt(knob, ajar * 0.5, 0, 0);
    g.add(K.put(knob, ajar * 0.6, 2.99, -ajar * 0.6));
    return g;
  },
};
