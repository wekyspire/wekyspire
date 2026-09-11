// 叠盘（CATALOG2 编号 74）：「一摞陶盘+顶碗」——起居餐饮小件 prop（陶器 stone + 碗口 unlit 双族）。
// 原点=底面中心（y=0 落地）；陶盘=圈足→斜盘面→立沿的 lathe（径约 1.5），步进 0.17 相嵌叠放，
// 盘色深浅交替、其中一只盘沿缺角（chip）；顶碗浅弧壁收口，碗内 unlit 暗盘读作空腔。
// 变体走 build(opts)：盘数 plates（3~7）/缺角盘序 chipIndex。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 盘轮廓（lathe profile 自下而上）：圈足→盘面斜出→立沿微收，高约 0.28
const PLATE = [
  [0.02, 0], [0.27, 0], [0.3, 0.05],
  [0.38, 0.1], [0.6, 0.16], [0.73, 0.24], [0.75, 0.28],
];
// 碗轮廓：小圈足→浅弧壁→口沿微收，高约 0.56
const BOWL = [
  [0.02, 0], [0.19, 0], [0.23, 0.06], [0.3, 0.12],
  [0.48, 0.32], [0.61, 0.5], [0.63, 0.56],
];

export default {
  id: 'platesStack',
  place: 'prop',
  mount: 'floor',
  tags: ['pottery', 'quarters'],
  footprint: { x: 1.9, z: 1.9 },
  behaviors: [],
  build({ plates = 5, chipIndex = 3, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('platesStack');
    const tones = [P.clay, shade(P.clay, 0.08), shade(P.clay, -0.09)];
    // 一摞陶盘：相嵌叠放，逐盘微转微挪、深浅交替；第 chipIndex 只盘沿缺角
    const n = Math.min(Math.max(plates, 3), 7);
    const chipped = Math.min(Math.max(chipIndex, 0), n - 1);
    for (let i = 0; i < n; i++) {
      const p = K.lathe({ color: tones[i % 3], seg: 8, profile: PLATE });
      if (i === chipped) K.chip(p, { corner: [1, 1, 1], amount: 0.16 });
      K.tilt(p, 0, r() * Math.PI * 2, (r() - 0.5) * 0.04);
      g.add(K.put(p, (r() - 0.5) * 0.08, i * 0.17, (r() - 0.5) * 0.08));
    }
    // 顶碗：坐在最上盘的盘心，碗内暗盘读作空腔
    const top = n * 0.17;
    const bowl = K.lathe({ color: shade(P.clay, 0.12), seg: 8, profile: BOWL });
    K.tilt(bowl, 0, r() * Math.PI, (r() - 0.5) * 0.05);
    g.add(K.put(bowl, (r() - 0.5) * 0.06, top, (r() - 0.5) * 0.06));
    g.add(K.put(K.cyl({ color: P.night, r: 0.52, h: 0.05, seg: 8, family: 'unlit' }), 0, top + 0.48, 0));
    return g;
  },
};
