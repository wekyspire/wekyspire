// 散落干草（CATALOG2 编号 96）：「乱草撒地+草屑」——撒印类 floorDecal（cloth 单族）。
// 原点=撒布中心投影；无整垫的散草（区别于 strawBedding 的整片草垫）：细长草梗
// 随机走向撒布（少数搭翘离地）+ 小草撮（压扁 jitter 球聚撮）+ 细碎草屑点缀，
// 草色 P.straw 深浅微差。总高 ≤0.4。变体走 build(opts)：草梗数/草屑量/铺开规模。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'hayScatter',
  place: 'floorDecal',
  tags: ['quarters'],
  footprint: { x: 5.5, z: 4 },
  behaviors: [],
  build({ stalks = 13, chaff = 7, clumps = 3, spread = 1, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('hayScatter');
    const tones = [shade(P.straw, 0.1), P.straw, shade(P.straw, -0.09)];
    // 乱草梗：细长条随机撒布（每五根一根搭翘离地，余者贴地微倾）
    const sn = Math.min(Math.max(stalks, 8), 16);
    for (let i = 0; i < sn; i++) {
      const lifted = i % 5 === 4;
      const stalk = K.box({ color: tones[i % 3], size: [1.0 + r() * 0.6, 0.06, 0.09], family: 'cloth' });
      K.tilt(stalk, (r() - 0.5) * 0.14, r() * Math.PI * 2, lifted ? 0.16 + r() * 0.1 : (r() - 0.5) * 0.1);
      const a = r() * Math.PI * 2, q = Math.pow(r(), 0.85); // 向心聚拢
      g.add(K.put(stalk, Math.cos(a) * q * 2.1 * spread, lifted ? 0.14 : 0.05, Math.sin(a) * q * 1.55 * spread));
    }
    // 小草撮：压扁 jitter 球（散草聚成的小撮）
    const cn = Math.min(Math.max(clumps, 2), 4);
    for (let i = 0; i < cn; i++) {
      const clump = K.sphereLo({
        color: tones[(i + 1) % 3], r: 0.42 + r() * 0.14, seg: 1, jitter: 0.18, rng: r, family: 'cloth',
      });
      K.scaleXYZ(clump, 1.15, 0.24, 0.85);
      K.tilt(clump, 0, r() * Math.PI, 0);
      g.add(K.put(clump, (r() - 0.5) * 3.2 * spread, 0.11, (r() - 0.5) * 2.2 * spread));
    }
    // 草屑：细碎小片散缀
    const kn = Math.min(Math.max(chaff, 5), 9);
    for (let i = 0; i < kn; i++) {
      const bit = K.box({
        color: tones[i % 3], size: [0.14 + r() * 0.08, 0.04, 0.1 + r() * 0.05], family: 'cloth',
      });
      K.tilt(bit, (r() - 0.5) * 0.3, r() * Math.PI * 2, (r() - 0.5) * 0.3);
      const a = r() * Math.PI * 2, q = 0.3 + r() * 0.7;
      g.add(K.put(bit, Math.cos(a) * q * 2.3 * spread, 0.03, Math.sin(a) * q * 1.7 * spread));
    }
    return g;
  },
};
