// 起翘地砖（CATALOG #51）：「几块翘起碎砖，缺角错台」——撒印类 floorDecal。
// 原点=砖组中心投影；底衬暗色基片（缺砖处露底），方砖错台排布（高度/偏移微差），
// 部分一角上翘（tilt 抬角）、部分缺角（chip 削角）。rng 驱动确定性变体。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'tilesUplift',
  place: 'floorDecal',
  tags: ['rubble'],
  footprint: { x: 4, z: 4 },
  behaviors: [],
  build({ tiles = 5, tiltAmp = 0.36, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('tilesUplift');
    // 缺砖处露出的暗底（缝间深色基面）
    g.add(K.plate({ color: shade(P.night, 0.1), w: 3.3, d: 3.3, th: 0.06 }));
    const slots = [
      [-1.0, -1.0], [1.0, -1.0], [-1.0, 1.0], [1.0, 1.0], [0.15, 0.2], [0.95, 0.05],
    ];
    const tones = [P.slab, shade(P.slab, 0.07), shade(P.slab, -0.09), shade(P.stone, 0.06)];
    for (const [x, z] of slots.slice(0, Math.max(1, Math.min(tiles, slots.length)))) {
      const tile = K.plate({ color: tones[Math.floor(r() * 4)], w: 1.66, d: 1.66, th: 0.26 });
      // 缺角：随机一角内削
      if (r() < 0.7) {
        K.chip(tile, { corner: [r() < 0.5 ? 1 : -1, 1, r() < 0.5 ? 1 : -1], amount: 0.14 + r() * 0.1 });
      }
      // 翘起（绕两水平轴小 tilt 抬角）+ 错台（少数砖整块垫高）
      const lift = r() < 0.4 ? 0.12 : 0.02;
      K.tilt(tile, (r() - 0.5) * tiltAmp * 2, (r() - 0.5) * 0.14, (r() - 0.5) * tiltAmp * 2);
      g.add(K.put(tile, x + (r() - 0.5) * 0.14, 0.13 + lift, z + (r() - 0.5) * 0.14));
    }
    return g;
  },
};
