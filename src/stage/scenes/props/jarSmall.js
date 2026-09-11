// 小陶罐（CATALOG2 #23）：「矮胖小罐（柱顶件）」——容器类 prop（陶器 stone + 罐口 unlit 双族）。
// 原点=底面中心（y=0 落地）；矮胖剪影：小底→圆鼓腹→急收短颈外翻小口，高约 1.2、腹径约 1.4。
// mount 双宿主 ['floor','smallWallTop']（S 档柱顶件，宿主准入见 CATALOG §1.2）。
// 变体走 build(opts)：fat 丰满度（0.85 偏瘦 ~ 1.2 圆胖）；rng 驱动确定性。

import * as THREE from 'three';
import { P, K } from '../kit/index.js';

// 罐身轮廓（lathe profile 自下而上），总高 1.2
const BODY = [
  [0.02, 0], [0.34, 0], [0.42, 0.06],
  [0.56, 0.25], [0.68, 0.55], [0.7, 0.78],
  [0.56, 1.0], [0.48, 1.06], [0.55, 1.13], [0.58, 1.2],
];

export default {
  id: 'jarSmall',
  place: 'prop',
  mount: ['floor', 'smallWallTop'],
  tags: ['pottery', 'container', 'brittle', 'generic'],
  footprint: { x: 1.7, z: 1.7 },
  behaviors: [],
  build({ fat = 1, rng } = {}) {
    const g = new THREE.Group();
    // 罐身：lathe 一体拉坯，fat 控丰满度
    const body = K.lathe({
      color: P.clay, seg: 7,
      profile: BODY.map(([r, y]) => [r * fat, y]),
    });
    if (rng) K.jitter(body, rng, { rot: 0.03 }); // 窑烧微歪的手工感
    g.add(body);
    // 腹部贴身凸弦一道（最大腹径处，永远凸过罐身）
    g.add(K.put(K.cyl({ color: P.clayDark, r: 0.7 * fat + 0.04, h: 0.08, seg: 7 }), 0, 0.55, 0));
    // 口沿唇圈 + 罐口暗盘（unlit 夜色读作空腔）
    g.add(K.put(K.cyl({ color: P.clayDark, r: 0.56 * fat + 0.02, h: 0.07, seg: 7 }), 0, 1.17, 0));
    g.add(K.put(K.cyl({ color: P.night, r: 0.44 * fat, h: 0.05, seg: 7, family: 'unlit' }), 0, 1.1, 0));
    return g;
  },
};
