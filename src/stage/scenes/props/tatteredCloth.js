// 破布条（CATALOG #76）：「残布三条飘挂，长短差」——wallDecor 高带挂件（cloth+metal 双族）。
// 原点=墙面高位挂点（z=0 贴墙，+z 朝室内）；band=high 挂点在上、残布自铁钉垂挂向下，
// 每条上下两段错折出「飘」势（下段外扬 + 底角缺切=撕裂茬），长短差明显（最长 ~8）。
// 变体走 build(opts)：布条数（3~4）/最长条长/长短差步距/飘摆幅度；rng 驱动确定性。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'tatteredCloth',
  place: 'wallDecor',
  band: 'high',
  tags: ['cloth'],
  behaviors: [],
  build({ strips = 3, maxLen = 8, gap = 1.35, drift = 1, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('tatteredCloth');
    const n = Math.min(Math.max(strips, 3), 4);
    // 残布配色：红青两旗的残片混挂（深浅 shade 微差）
    const tones = [P.bannerRed, shade(P.bannerBlue, -0.07), shade(P.bannerRed, -0.14), P.bannerBlue];
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * gap + (r() - 0.5) * 0.2;
      // 长短差：自最长条按步距递减，再带抖动
      const len = maxLen - i * (maxLen / (n + 1)) + (r() - 0.5) * 0.9;
      const w = 0.8 + (r() - 0.5) * 0.25;
      const color = tones[i % 4];
      const sway = (r() - 0.5) * 0.22 * drift;
      const z0 = 0.14 + (r() - 0.5) * 0.1;
      // 上段（近垂直贴墙）
      const upperH = len * 0.58;
      const upper = K.box({ color, size: [w, upperH, 0.09], family: 'cloth' });
      K.tilt(upper, 0, 0, sway * 0.4);
      g.add(K.put(upper, x, -upperH / 2 - 0.05, z0));
      // 下段（错折外飘，底角缺切出撕裂茬口）
      const lowerH = len * 0.45;
      const lower = K.box({ color: shade(color, -0.06), size: [w * 0.92, lowerH, 0.09], family: 'cloth' });
      K.chip(lower, { corner: [i % 2 ? -1 : 1, -1, 1], amount: 0.16 });
      K.tilt(lower, 0, 0, sway * 2.4);
      g.add(K.put(lower, x + sway * 0.8, -upperH + 0.15 - lowerH / 2, z0 + 0.16 * drift));
      // 挂钉：小铁钉冒头顶住布条上缘
      g.add(K.put(K.box({ color: P.iron, size: [0.18, 0.18, 0.26], family: 'metal' }), x, 0.02, 0.16));
    }
    return g;
  },
};
