// 桶堆（CATALOG #30）：「两竖一横叠，横桶略滚错位」——prop 类（wood 桶身 + metal 铁箍 双族）。
// 独立资产：桶件几何思路同 #29 木酒桶（本文件自带组合逻辑，禁 import 其他资产文件）。
// 原点=底面中心（y=0 落地）；变体走 build(opts)：桶板凸度/横桶滚转角/横桶纵移/转向角。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 单只桶（鼓形桶身 lathe + 凹嵌桶头 + 双端箍；两竖一横共用）
function barrel(h, rMid, rEnd) {
  const g = new THREE.Group();
  g.add(K.lathe({
    color: P.wood, seg: 9,
    profile: [[0, 0], [rEnd, 0.12], [rMid, h / 2], [rEnd, h - 0.3], [rEnd - 0.08, h]],
  }));
  g.add(K.put(K.cyl({ color: P.woodDark, r: rEnd - 0.18, h: 0.18, seg: 9 }), 0, h - 0.2, 0));
  for (const y of [0.3, h - 0.3]) {
    g.add(K.put(K.cyl({
      color: shade(P.iron, -0.04), r: rEnd + 0.05, h: 0.3, seg: 9, family: 'metal',
    }), 0, y, 0));
  }
  return g;
}

export default {
  id: 'barrelStack',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'container'],
  footprint: { x: 4.4, z: 4.6 },
  behaviors: [],
  build({ bulge = 1, roll = 0.16, shift = 0.42, yaw = 0.08, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('barrelStack');
    const H = 3.8, RM = 1.0 * bulge;
    // 两竖：并肩相靠（中心距 2×腰半径，鼓腰相触）
    for (const s of [-1, 1]) {
      const up = barrel(H, RM, 0.82);
      K.jitter(up, r, { pos: 0.03, rot: 0.02 });
      g.add(K.put(up, s * RM, 0, 0));
    }
    // 一横：卧于两竖桶谷间（触点高 ≈ (√3-1)·RM），绕自身长轴略滚 + 沿轴错位 + 微偏轴
    const lying = new THREE.Group();
    const one = barrel(H * 0.96, RM * 0.98, 0.82);
    K.tilt(one, Math.PI / 2, 0, 0);                    // 立转卧：桶轴 y→z
    lying.add(K.put(one, 0, 0, -H * 0.48));            // 卧桶自身居中
    K.tilt(lying, 0, yaw, roll);
    g.add(K.put(lying, -0.12, H + RM * 0.73, shift));
    return g;
  },
};
