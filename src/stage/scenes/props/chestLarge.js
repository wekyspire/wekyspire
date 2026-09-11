// 大铁皮箱（CATALOG2 编号 35）：「XL 包铁重箱+双锁扣」——容器类 prop/floor（wood 箱体 + metal 包铁 + unlit 锁孔 三族）。
// 原点=底面中心（y=0 落地）；与上锁箱（chestLocked）区分：XL 尺码、四角包角铁、
// 底裙周箍、竖箍越盖、双锁扣垂前。变体走 build(opts)：箍带 straps 有无/锁扣数 locks（1~2）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'chestLarge',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'metal', 'container', 'vault'],
  footprint: { x: 5.2, z: 3.6 },
  behaviors: [],
  build({ straps = true, locks = 2, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('chestLarge');
    const w = 4.7, hB = 2.05, d = 2.9;
    // 垫脚 ×4 + 箱身 + 出檐重盖
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      g.add(K.put(K.box({
        color: P.woodDark, size: [0.85, 0.28, 0.55], family: 'wood',
      }), sx * (w / 2 - 0.65), 0.14, sz * (d / 2 - 0.45)));
    }
    const body = K.box({ color: P.wood, size: [w, hB, d], family: 'wood' });
    K.jitter(body, r, { rot: 0.008 });
    g.add(K.put(body, 0, 0.28 + hB / 2, 0));
    const top = 0.28 + hB;
    g.add(K.put(K.box({ color: P.woodDark, size: [w + 0.3, 0.45, d + 0.3], family: 'wood' }), 0, top + 0.225, 0));
    const lidTop = top + 0.45;
    // 包角铁：四角前后/左右双面立板
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      g.add(K.put(K.box({
        color: shade(P.iron, -0.05), size: [0.55, hB, 0.12], family: 'metal',
      }), sx * (w / 2 - 0.5), 0.28 + hB / 2, sz * (d / 2 + 0.05)));
      g.add(K.put(K.box({
        color: shade(P.iron, -0.05), size: [0.12, hB, 0.55], family: 'metal',
      }), sx * (w / 2 + 0.05), 0.28 + hB / 2, sz * (d / 2 - 0.5)));
    }
    // 底裙周箍：前后 + 左右
    for (const sz of [-1, 1]) {
      g.add(K.put(K.box({
        color: P.iron, size: [w, 0.34, 0.12], family: 'metal',
      }), 0, 0.28 + 0.17, sz * (d / 2 + 0.04)));
    }
    for (const sx of [-1, 1]) {
      g.add(K.put(K.box({
        color: shade(P.iron, 0.04), size: [0.12, 0.34, d], family: 'metal',
      }), sx * (w / 2 + 0.04), 0.28 + 0.17, 0));
    }
    // 竖箍（前后各三）+ 盖顶横箍（越盖包到顶）
    if (straps) {
      for (const x of [-1.5, 0, 1.5]) {
        g.add(K.put(K.box({
          color: P.iron, size: [0.34, hB, 0.1], family: 'metal',
        }), x, 0.28 + hB / 2, d / 2 + 0.05));
        g.add(K.put(K.box({
          color: P.iron, size: [0.34, hB, 0.1], family: 'metal',
        }), x, 0.28 + hB / 2, -d / 2 - 0.05));
        g.add(K.put(K.box({
          color: shade(P.iron, 0.05), size: [0.34, 0.1, d + 0.3], family: 'metal',
        }), x, lidTop + 0.05, 0));
      }
    }
    // 双锁扣：盖沿搭扣片 + 厚重锁头 + 锁孔（unlit 读作透空）
    const nl = Math.min(Math.max(locks, 1), 2);
    for (let i = 0; i < nl; i++) {
      const x = nl === 1 ? 0 : (i === 0 ? -1.35 : 1.35);
      g.add(K.put(K.box({
        color: P.iron, size: [0.62, 0.26, 0.3], family: 'metal',
      }), x, top + 0.1, d / 2 + 0.12));
      g.add(K.put(K.box({
        color: shade(P.iron, -0.16), size: [0.74, 0.8, 0.42], family: 'metal',
      }), x, top - 0.5, d / 2 + 0.18));
      g.add(K.put(K.box({
        color: P.night, size: [0.15, 0.3, 0.08], family: 'unlit',
      }), x, top - 0.46, d / 2 + 0.41));
    }
    return g;
  },
};
