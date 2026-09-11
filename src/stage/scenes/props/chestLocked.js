// 上锁箱（CATALOG #44）：「平盖锁扣箱，锁头厚重」——prop 类（wood 箱体 + metal 铁件 + unlit 锁孔 三族）。
// 原点=底面中心（y=0 落地）；与宝箱（#43）区分：平盖闭合上锁、锁扣厚重。
// 变体走 build(opts)：锁头大小/铁箍有无。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'chestLocked',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'metal', 'container'],
  footprint: { x: 3.0, z: 2.5 },
  behaviors: [],
  build({ lock = 1, straps = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('chestLocked');
    const w = 2.7, hB = 1.55, d = 2.0;
    // 垫脚 + 箱身 + 出檐平盖（盖板压边一圈，闭合读作上锁的平顶箱）
    for (const s of [-1, 1]) {
      g.add(K.put(K.box({ color: P.woodDark, size: [0.6, 0.22, d * 0.7] }), s * (w / 2 - 0.5), 0.11, 0));
    }
    const body = K.box({ color: P.wood, size: [w, hB, d] });
    K.jitter(body, r, { rot: 0.012 });
    g.add(K.put(body, 0, 0.22 + hB / 2, 0));
    const top = 0.22 + hB;
    g.add(K.put(K.box({ color: P.woodDark, size: [w + 0.24, 0.3, d + 0.24] }), 0, top + 0.15, 0));
    // 铁箍：前后各两道竖箍 + 两侧各一道横箍（周箍感）
    if (straps) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        g.add(K.put(K.box({
          color: P.iron, size: [0.26, hB, 0.09], family: 'metal',
        }), sx * (w / 2 - 0.55), 0.22 + hB / 2, sz * (d / 2 + 0.03)));
      }
      for (const sx of [-1, 1]) {
        g.add(K.put(K.box({
          color: shade(P.iron, 0.05), size: [0.09, 0.26, d], family: 'metal',
        }), sx * (w / 2 + 0.03), 0.22 + hB / 2, 0));
      }
    }
    // 锁扣：盖沿搭扣片 + 厚重锁头（压暗铁色、随 lock 缩放）+ 锁孔（unlit 读作透空）
    g.add(K.put(K.box({
      color: P.iron, size: [0.55 * lock, 0.2, 0.3], family: 'metal',
    }), 0, top + 0.08, d / 2 + 0.1));
    g.add(K.put(K.box({
      color: shade(P.iron, -0.16), size: [0.8 * lock, 0.9 * lock, 0.45], family: 'metal',
    }), 0, top - 0.5 * lock, d / 2 + 0.2 * lock));
    g.add(K.put(K.box({
      color: P.night, size: [0.16, 0.34, 0.08], family: 'unlit',
    }), 0, top - 0.45 * lock, d / 2 + 0.46 * lock));
    return g;
  },
};
