// 陶瓮（CATALOG #33）：「圆胖大口陶瓮，肩宽带纹」——prop 类（陶器 stone + 瓮口 unlit 双族）。
// 原点=底面中心（y=0 落地）；mount 双宿主 ['floor','smallWallTop']（S 档常上柱顶/基座顶，
// 宿主准入见 CATALOG §1.2）。变体走 build(opts)：丰满度/微歪。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 瓮身轮廓（lathe profile：小圈足→鼓腹→收肩→直颈→外撇大口），高约 2.35，腹径约 2.1
const BODY = [
  [0.02, 0], [0.42, 0], [0.5, 0.12], [0.62, 0.35], [0.98, 0.85],
  [1.06, 1.3], [0.98, 1.62], [0.8, 1.82], [0.74, 1.95], [0.86, 2.1], [0.9, 2.25], [0.72, 2.35],
];

export default {
  id: 'vaseClay',
  place: 'prop',
  mount: ['floor', 'smallWallTop'],
  tags: ['pottery', 'container', 'brittle'],
  footprint: { x: 2.2, z: 2.2 },
  behaviors: [],
  build({ fat = 1, rng } = {}) {
    const g = new THREE.Group();
    // 瓮身：lathe 一体拉坯，fat 控丰满度（0.85 瘦长 ~ 1.15 圆胖）
    const body = K.lathe({
      color: P.clay, seg: 7,
      profile: BODY.map(([r, y]) => [r * fat, y]),
    });
    if (rng) K.jitter(body, rng, { rot: 0.02 }); // 窑烧微歪的手工感
    g.add(body);
    // 肩宽带纹：两道凸弦纹（半径略凸过瓮身）
    g.add(K.put(K.cyl({ color: P.clayDark, r: 1.08 * fat, h: 0.09, seg: 7 }), 0, 1.22, 0));
    g.add(K.put(K.cyl({ color: P.clayDark, r: 1.05 * fat, h: 0.09, seg: 7 }), 0, 1.48, 0));
    // 瓮口：颈内暗盘（unlit 夜色读作空腔，藏于口沿下方不露边）
    g.add(K.put(K.cyl({ color: P.night, r: 0.76 * fat, h: 0.07, seg: 7, family: 'unlit' }), 0, 2.15, 0));
    return g;
  },
};
