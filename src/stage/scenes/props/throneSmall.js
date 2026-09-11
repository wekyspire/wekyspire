// 小王座（CATALOG2 #11）：「高背石座+扶手兽头雕」——圣所家具 prop（纯 stone 单族）。
// 原点=底面中心（y=0 落地），总高约 8.7；线脚沿用 statuePedestal 的阶座收放手法：
// 两级方座 → 座身 → 坐垫板，高背自座身直上带出挑檐口与 45° 菱徽（chairHighback 贴章手法），
// 扶手为整石板+前撑柱，尽头兽头雕=剪影级 box 组合（头颅+吻部+双耳斜张）。
// 变体走 build(opts)：背高 backH / 兽头雕有无 heads。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'throneSmall',
  place: 'prop',
  mount: 'floor',
  tags: ['stone', 'chapel'],
  footprint: { x: 3.6, z: 3.3 },
  behaviors: [],
  build({ backH = 6.8, heads = true, rng } = {}) {
    const g = new THREE.Group();
    // 两级方座 + 座身 + 坐垫板（阶座收放）
    g.add(K.put(K.box({ color: shade(P.stone, -0.1), size: [3.3, 0.7, 3.0], family: 'stone' }), 0, 0.35, 0));
    g.add(K.put(K.box({ color: P.stone, size: [2.9, 0.5, 2.6], family: 'stone' }), 0, 0.95, 0));
    g.add(K.put(K.box({ color: shade(P.stone, 0.03), size: [2.5, 1.5, 2.2], family: 'stone' }), 0, 1.95, 0));
    g.add(K.put(K.box({ color: shade(P.stone, 0.06), size: [2.3, 0.4, 2.0], family: 'stone' }), 0, 2.9, 0));
    // 高背：自座身直上 + 出挑檐口 + 菱徽
    const back = K.box({ color: P.stone, size: [2.4, backH, 0.62], family: 'stone' });
    if (rng) K.jitter(back, rng, { rot: 0.008 });
    g.add(K.put(back, 0, 0.7 + backH / 2, -1.05));
    const backTop = 0.7 + backH;
    g.add(K.put(K.box({
      color: shade(P.stone, 0.05), size: [2.9, 0.55, 1.0], family: 'stone',
    }), 0, backTop + 0.27, -1.0));
    const sigil = K.box({ color: shade(P.stone, 0.12), size: [0.5, 0.5, 0.14], family: 'stone' });
    K.tilt(sigil, 0, 0, Math.PI / 4);
    g.add(K.put(sigil, 0, backTop + 0.75, -0.98));
    // 背面浅刻板（浅一档读作刻面）
    g.add(K.put(K.box({
      color: shade(P.stone, 0.09), size: [1.7, 3.4, 0.16], family: 'stone',
    }), 0, 4.6, -0.7));
    // 扶手：整石板 + 前撑柱
    for (const s of [-1, 1]) {
      g.add(K.put(K.box({
        color: shade(P.stone, -0.03), size: [0.5, 0.28, 1.5], family: 'stone',
      }), s * 1.05, 3.62, 0.1));
      g.add(K.put(K.box({
        color: shade(P.stone, -0.06), size: [0.44, 1.3, 0.44], family: 'stone',
      }), s * 1.05, 2.85, 0.72));
    }
    // 兽头雕：头颅 + 吻部 + 双耳斜张（剪影级 box 组合，立于扶手前端）
    if (heads) {
      for (const s of [-1, 1]) {
        const hx = s * 1.05;
        g.add(K.put(K.box({
          color: shade(P.stone, 0.1), size: [0.52, 0.5, 0.56], family: 'stone',
        }), hx, 3.98, 0.82));
        g.add(K.put(K.box({
          color: shade(P.stone, 0.07), size: [0.3, 0.26, 0.36], family: 'stone',
        }), hx, 3.86, 1.22));
        for (const e of [-1, 1]) {
          const ear = K.box({ color: shade(P.stone, 0.04), size: [0.12, 0.24, 0.18], family: 'stone' });
          K.tilt(ear, 0, 0, e * s * 0.4);
          g.add(K.put(ear, hx + e * 0.16, 4.32, 0.78));
        }
      }
    }
    return g;
  },
};
