// 石凳（CATALOG2 #6）：「整条石板+两石墩」——家具类 prop（纯 stone 单族）。
// 原点=底面中心（y=0 落地），x=长 z=深，凳面高约 3.1（石凳尺度口径）；
// 两座石墩=垫板+两阶收进墩身（粗凿块），石板边角风化轻缺。变体走 build(opts)：凳长 / 是否缺角。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'benchStone',
  place: 'prop',
  mount: 'floor',
  tags: ['stone', 'furniture', 'generic'],
  footprint: { x: 5.6, z: 1.9 },
  behaviors: [],
  build({ len = 5.4, chipped = true, rng } = {}) {
    const g = new THREE.Group();
    // 两座石墩：垫板 + 两阶收进墩身（粗凿块，rng 微歪读出手凿感）
    for (const sx of [-1, 1]) {
      const px = sx * (len / 2 - 0.85);
      g.add(K.put(K.box({ color: shade(P.stone, -0.12), size: [1.3, 0.2, 1.6], family: 'stone' }), px, 0.1, 0));
      const low = K.box({ color: P.rock, size: [1.05, 1.3, 1.4], family: 'stone' });
      if (rng) K.jitter(low, rng, { rot: 0.01 });
      g.add(K.put(low, px, 0.85, 0));
      const up = K.box({ color: shade(P.rock, 0.08), size: [0.88, 1.05, 1.24], family: 'stone' });
      if (chipped) K.chip(up, { corner: [sx, 1, 1], amount: 0.12 });
      if (rng) K.jitter(up, rng, { rot: 0.012 });
      g.add(K.put(up, px, 2.02, 0));
    }
    // 整条石板凳面：长条整板压在两墩上（风化轻缺两对角）
    const slab = K.box({ color: P.stone, size: [len, 0.55, 1.6], family: 'stone' });
    if (chipped) {
      K.chip(slab, { corner: [1, 1, 1], amount: 0.18 });
      K.chip(slab, { corner: [-1, 1, -1], amount: 0.14 });
    }
    g.add(K.put(slab, 0, 2.82, 0));
    return g;
  },
};
