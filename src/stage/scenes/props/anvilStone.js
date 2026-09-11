// 石砧（CATALOG #46）：「矮平石砧，砧面凹磨」——prop 类（石体 stone + 磨坑 unlit 双族）。
// 原点=底面中心（y=0 落地），x=宽 z=深；座墩三段收分、砧面出挑（全高约 3，矮平方正剪影）。
// 变体走 build(opts)：磨损度（砧面缺角数与磨坑大小）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'anvilStone',
  place: 'prop',
  mount: 'floor',
  tags: ['stone'],
  footprint: { x: 3, z: 2.2 },
  behaviors: [],
  build({ wear = 2, rng } = {}) {
    const g = new THREE.Group();
    const w = Math.min(wear, 2); // 磨损度分三档：0 无缺角 → 2 双缺角大磨坑
    // 座墩三段：基台 → 收腰墩身 → 出挑砧面
    g.add(K.put(K.box({ color: shade(P.stone, -0.18), size: [2.7, 0.3, 2.1] }), 0, 0.15, 0));
    const seat = K.box({ color: shade(P.stone, -0.08), size: [2.45, 0.85, 1.85] });
    if (rng) K.jitter(seat, rng, { rot: 0.008 }); // 石作微歪的手工感
    g.add(K.put(seat, 0, 0.725, 0));
    g.add(K.put(K.box({ color: P.stone, size: [2.05, 1.25, 1.5] }), 0, 1.775, 0));
    // 砧面：出挑宽板，磨损度换缺角（打铁崩边，越磨越豁）
    const face = K.box({ color: shade(P.stone, 0.08), size: [2.9, 0.55, 2.05] });
    if (w >= 1) K.chip(face, { corner: [1, 1, 1], amount: 0.28 + 0.07 * w });
    if (w >= 2) K.chip(face, { corner: [-1, 1, -1], amount: 0.36 });
    g.add(K.put(face, 0, 2.675, 0));
    // 砧面凹磨：暗色磨坑贴嵌砧面（unlit 夜色读作凹陷，同 vaseClay 瓮口手法），磨损越重坑越大越偏
    const dish = K.cyl({ color: P.night, r: 0.5, h: 0.06, seg: 7, family: 'unlit' });
    K.scaleXYZ(dish, 1.4 + 0.18 * w, 1, 1);
    g.add(K.put(dish, -0.12 - 0.06 * w, 2.93, 0.04));
    return g;
  },
};
