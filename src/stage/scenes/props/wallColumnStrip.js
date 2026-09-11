// 竖棱墙带（CATALOG #67）：「连续竖线脚浅浮雕」——wallStructure 类（纯 stone 单族）。
// 原点=墙脚挂点（z=0 贴墙面，+z 朝室内，同 pilasterHalf）；占 2 墙段（bayWidth:2），
// 通高 19.9 与 pilasterHalf 平。底板压暗衬底，竖棱（lesene 线脚）前凸明暗相间，
// 中腰横串一道线脚断开竖向长感。变体走 build(opts)：ribs（竖棱数 4~7）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'wallColumnStrip',
  place: 'wallStructure',
  bayWidth: 2,
  tags: ['stone'],
  behaviors: [],
  build({ ribs = 5, rng } = {}) {
    const g = new THREE.Group();
    // 底板（凹衬）+ 压顶/底座收边
    g.add(K.put(K.box({ color: shade(P.stone, -0.16), size: [9.9, 18.3, 0.5] }), 0, 10.75, 0.25));
    g.add(K.put(K.box({ color: shade(P.stone, -0.08), size: [10.4, 1.6, 1.15] }), 0, 0.8, 0.575));
    g.add(K.put(K.box({ color: shade(P.stone, -0.08), size: [10.4, 1.3, 1.15] }), 0, 19.25, 0.575));
    // 连续竖棱：等距明暗相间，微抖出手凿感
    const n = Math.min(7, Math.max(4, Math.round(ribs)));
    const step = 8 / (n - 1);
    for (let i = 0; i < n; i++) {
      const rib = K.box({ color: shade(P.stone, i % 2 ? 0.06 : 0.12), size: [0.85, 18.3, 0.95] });
      if (rng) K.jitter(rib, rng, { pos: 0.02, rot: 0.006 });
      g.add(K.put(rib, -4 + i * step, 10.75, 0.475));
    }
    // 中腰横线脚（断开竖棱长线，front 比 ribs 出一档）
    g.add(K.put(K.box({ color: shade(P.stone, -0.02), size: [9.9, 0.5, 1.05] }), 0, 13.4, 0.525));
    return g;
  },
};
