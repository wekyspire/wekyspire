// 箱堆（CATALOG #32）：「大小两箱叠放，上箱歪斜」——prop 类（wood 箱板 + metal 包角 双族）。
// 独立资产：箱件几何思路同 #31 木箱（本文件自带组合逻辑，禁 import 其他资产文件）。
// 原点=底面中心（y=0 落地）；变体走 build(opts)：上箱歪斜角/转向角/大小箱比例。

import * as THREE from 'three';
import { P, K } from '../kit/index.js';

// 单只箱（简板箱体 + 出檐盖板 + 板缝 + 四角包铁；大小两箱共用）
function crate(w, h, d, seams) {
  const g = new THREE.Group();
  g.add(K.put(K.box({ color: P.wood, size: [w, h, d] }), 0, h / 2, 0));
  g.add(K.put(K.box({ color: P.woodDark, size: [w + 0.16, 0.2, d + 0.16] }), 0, h + 0.08, 0));
  for (let i = 1; i <= seams; i++) {
    g.add(K.put(K.box({
      color: P.woodDark, size: [w + 0.02, 0.08, 0.09],
    }), 0, (h * i) / (seams + 1), d / 2 + 0.03));
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    g.add(K.put(K.box({
      color: P.iron, size: [0.3, h + 0.06, 0.3], family: 'metal',
    }), sx * (w / 2 - 0.02), (h + 0.06) / 2, sz * (d / 2 - 0.02)));
  }
  return g;
}

export default {
  id: 'crateStack',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'container'],
  footprint: { x: 3.6, z: 3.6 },
  behaviors: [],
  build({ tilt = 0.1, yaw = 0.42, ratio = 0.72, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('crateStack');
    // 下箱：大箱端坐
    const big = crate(3.0, 2.3, 3.0, 2);
    K.jitter(big, r, { rot: 0.015 });
    g.add(big);
    // 上箱：小箱歪斜压叠（歪斜角 + 转向 + 略偏轴；底面落在大箱盖沿上）
    const small = crate(3.0 * ratio, 2.3 * ratio, 3.0 * ratio, 1);
    K.tilt(small, tilt * (0.7 + r() * 0.6), yaw + r() * 0.1, 0);
    g.add(K.put(small, 0.15, 2.52, -0.08));
    return g;
  },
};
