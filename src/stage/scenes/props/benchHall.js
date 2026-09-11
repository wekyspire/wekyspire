// 大厅长凳（CATALOG2 #21）：「厚板+雕卷腿，比长凳更重」——家具类 prop（纯 wood 单族）。
// 原点=底面中心（y=0 落地），x=长 z=深；比 benchWood 更重：厚板凳面+底沿牙板、
// 两端方柱粗腿+座墩、三段收径圆柱勾出的卷涡托架抵住凳底、重梁穿档+中撑。
// 变体走 build(opts)：len 凳长（7~9）/strut 有无中撑；rng 驱动确定性。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'benchHall',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'furniture', 'generic'],
  footprint: { x: 8.4, z: 2.4 },
  behaviors: [],
  build({ len = 8, strut = 1, rng } = {}) {
    const g = new THREE.Group();
    const L = Math.min(Math.max(len, 7), 9);
    // 凳面：厚板 + 底沿牙板（体量感）
    const seat = K.box({ color: P.wood, size: [L, 0.5, 1.9], family: 'wood' });
    if (rng) K.jitter(seat, rng, { rot: 0.004 });
    g.add(K.put(seat, 0, 2.35, 0));
    g.add(K.put(K.box({ color: shade(P.wood, -0.06), size: [L - 1.3, 0.24, 1.62], family: 'wood' }), 0, 2.02, 0));
    const legX = L / 2 - 0.85;
    for (const s of [-1, 1]) {
      // 粗腿：方柱 + 着地座墩
      const post = K.box({ color: P.woodDark, size: [0.55, 1.7, 0.55], family: 'wood' });
      if (rng) K.jitter(post, rng, { rot: 0.006 });
      g.add(K.put(post, s * legX, 0.85, 0));
      g.add(K.put(K.box({ color: shade(P.woodDark, -0.05), size: [0.9, 0.3, 0.9], family: 'wood' }), s * legX, 0.15, 0));
      // 雕卷腿：三段收径圆柱自柱顶向外上方卷（卷涡托架，抵进凳面底）
      const curls = [[0.2, 1.95, 0.3], [0.5, 2.04, 0.22], [0.64, 1.84, 0.15]];
      for (const [dx, y, cr] of curls) {
        const c = K.cyl({ color: shade(P.woodDark, 0.12), r: cr, h: 0.56, seg: 7, family: 'wood' });
        K.tilt(c, Math.PI / 2, 0, 0);
        if (rng) K.jitter(c, rng, { rot: 0.008 });
        g.add(K.put(c, s * (legX + dx), y, 0));
      }
    }
    // 重梁穿档 + 中撑（自穿档上托凳面底）
    g.add(K.put(K.box({ color: shade(P.woodDark, 0.08), size: [L - 2.0, 0.42, 0.52], family: 'wood' }), 0, 0.85, 0));
    if (strut) {
      g.add(K.put(K.box({ color: shade(P.woodDark, 0.08), size: [0.46, 1.2, 0.46], family: 'wood' }), 0, 1.5, 0));
    }
    return g;
  },
};
