// 木箱（CATALOG #31）：「简板钉箱，箱角包铁」——prop 类（wood 箱板 + metal 包角钉头 双族）。
// 原点=底面中心（y=0 落地），x=宽 z=深；变体走 build(opts)：尺寸/板缝数/包铁。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'crateWood',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'container'],
  footprint: { x: 3.2, z: 3.2 },
  behaviors: [],
  build({ w = 2.9, h = 2.6, d = 2.9, planks = 2, iron = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('crateWood');
    // 箱体 + 出檐盖板（压边一圈读作钉死的顶盖）
    const body = K.box({ color: P.wood, size: [w, h, d] });
    K.jitter(body, r, { rot: 0.012 });                 // 码放微歪的手工感
    g.add(K.put(body, 0, h / 2, 0));
    g.add(K.put(K.box({ color: P.woodDark, size: [w + 0.18, 0.22, d + 0.18] }), 0, h + 0.09, 0));
    // 板缝：正面/侧面横缝细条微凸，读作拼板箱
    for (let i = 1; i <= planks; i++) {
      const y = (h * i) / (planks + 1);
      g.add(K.put(K.box({ color: P.woodDark, size: [w + 0.02, 0.09, 0.1] }), 0, y, d / 2 + 0.03));
      g.add(K.put(K.box({ color: P.woodDark, size: [0.1, 0.09, d + 0.02] }), w / 2 + 0.03, y, 0));
    }
    if (iron) {
      // 箱角包铁：四竖楞方护角（嵌在棱上双向露面）
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        g.add(K.put(K.box({
          color: P.iron, size: [0.32, h + 0.08, 0.32], family: 'metal',
        }), sx * (w / 2 - 0.02), (h + 0.08) / 2, sz * (d / 2 - 0.02)));
      }
      // 钉头：盖沿两枚冒头方钉
      for (const s of [-1, 1]) {
        g.add(K.put(K.box({
          color: shade(P.iron, 0.12), size: [0.16, 0.14, 0.1], family: 'metal',
        }), s * (w / 2 - 0.4), h + 0.18, d / 2 + 0.1));
      }
    }
    return g;
  },
};
