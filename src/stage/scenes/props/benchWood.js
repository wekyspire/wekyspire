// 长凳（CATALOG #27）：「板面长凳，两端凳腿斜撑」——家具类 prop（纯 wood 单族）。
// 原点=底面中心（y=0 落地），x=长 z=深，凳面高约 2.4；两端各一对腿 + 底横档，
// 斜撑自横档上托凳面。变体走 build(opts)：凳长 / 拼板数 / 腿外撇角。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'benchWood',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'furniture'],
  footprint: { x: 7.5, z: 1.9 },
  behaviors: [],
  build({ len = 7, planks = 2, splay = 0.06, rng } = {}) {
    const g = new THREE.Group();
    // 凳面：拼板（板色微差 + rng 微翘，读出旧板面）
    const depth = 1.5 / planks;
    for (let i = 0; i < planks; i++) {
      const plank = K.box({ color: i % 2 ? shade(P.wood, 0.06) : P.wood, size: [len, 0.28, depth - 0.04], family: 'wood' });
      if (rng) K.jitter(plank, rng, { rot: 0.012 });
      g.add(K.put(plank, 0, 2.26, -0.75 + depth / 2 + i * depth));
    }
    const legX = len / 2 - 0.4;
    for (const sx of [-1, 1]) {
      // 端腿对：前后两腿微外撇
      for (const sz of [-1, 1]) {
        const leg = K.box({ color: P.woodDark, size: [0.34, 2.4, 0.34], family: 'wood' });
        K.tilt(leg, -sz * splay, 0, sx * splay * 0.6);
        if (rng) K.jitter(leg, rng, { rot: 0.015 });
        g.add(K.put(leg, sx * legX, 1.2, sz * 0.55));
      }
      // 底横档 + 斜撑（自档上托凳面中央，两端对称）
      g.add(K.put(K.box({ color: shade(P.woodDark, 0.08), size: [0.26, 0.22, 1.35], family: 'wood' }), sx * legX, 0.85, 0));
      const brace = K.box({ color: shade(P.woodDark, 0.08), size: [0.2, 1.55, 0.2], family: 'wood' });
      K.tilt(brace, 0, 0, sx * 0.58);
      if (rng) K.jitter(brace, rng, { rot: 0.02 });
      g.add(K.put(brace, sx * (legX - 0.42), 1.61, 0));
    }
    return g;
  },
};
