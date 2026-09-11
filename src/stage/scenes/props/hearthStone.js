// 小火塘（CATALOG2 编号 40）：「石砌矮圈+炭堆余温」——prop/floor（stone+unlit 双族）。
// 原点=塘心（y=0 落地）；单圈毛石+断续二层加砌读作石砌矮圈（塘径约 3.5，M 档）；
// 塘内暗床（unlit P.night）+压暗炭块小丘+暗红余温炭块（shade(P.ember, 压暗)）。
// 布光职责：tags 声明 lightSource/fire 即「这里有火」——不私设 PointLight（CATALOG §6）；
// 余温只埋炭不点焰（与火盆 brazierFire 的明焰拉开差距）。变体走 build(opts)：
// 圈石数/加砌数/余温炭块数/圈外散石。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'hearthStone',
  place: 'prop',
  mount: 'floor',
  tags: ['stone', 'lightSource', 'fire', 'kitchen'],
  footprint: { x: 4, z: 4 },
  behaviors: [],
  build({ blocks = 9, topBlocks = 3, embers = 3, spill = 2, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('hearthStone');
    const ringR = 1.38;
    // 石砌矮圈：毛石环排（长边切向、微错位出手工砌感），断续二层加砌
    const n = Math.max(8, Math.min(11, blocks));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const blk = K.box({ color: [shade(P.stone, -0.08), P.stone, shade(P.stone, 0.06)][i % 3], size: [0.82, 0.5, 0.52] });
      K.tilt(blk, 0, a + Math.PI / 2 + (r() - 0.5) * 0.06, (r() - 0.5) * 0.03);
      g.add(K.put(blk, Math.cos(a) * ringR, 0.25, Math.sin(a) * ringR));
    }
    const m = Math.max(0, Math.min(5, topBlocks));
    for (let i = 0; i < m; i++) {
      const a = (i / m) * Math.PI * 2 + 0.5 + r() * 0.3;
      const blk = K.box({ color: shade(P.stone, i % 2 ? -0.14 : 0.02), size: [0.72, 0.42, 0.5] });
      K.tilt(blk, 0, a + Math.PI / 2 + (r() - 0.5) * 0.08, (r() - 0.5) * 0.04);
      g.add(K.put(blk, Math.cos(a) * ringR, 0.71, Math.sin(a) * ringR));
    }
    // 塘内暗床（unlit 黑体读深，同 brazierFire 空腔语言）+ 压暗炭块小丘（越高越收拢）
    g.add(K.put(K.cyl({ color: P.night, r: 1.12, h: 0.1, seg: 9, family: 'unlit' }), 0, 0.05, 0));
    for (let i = 0; i < 3; i++) {
      const t = i / 2;
      const aa = r() * Math.PI * 2, rad = 0.45 * (1 - t * 0.6);
      const coal = K.sphereLo({ color: [shade(P.rock, -0.3), shade(P.rock, -0.16), shade(P.rock, -0.05)][i], r: 0.5 - t * 0.12, seg: 0, jitter: 0.25, rng: r });
      K.tilt(coal, r() * 0.5, r() * Math.PI, r() * 0.5);
      g.add(K.put(coal, Math.cos(aa) * rad, 0.38 + t * 0.2, Math.sin(aa) * rad));
    }
    // 余温炭块：暗红（shade(P.ember, 压暗)，unlit 读作埋在炭堆里的余温）
    const e = Math.max(2, Math.min(5, embers));
    for (let i = 0; i < e; i++) {
      const aa = r() * Math.PI * 2, rad = 0.15 + r() * 0.6;
      g.add(K.put(K.sphereLo({ color: shade(P.ember, -0.34), r: 0.16 + r() * 0.1, seg: 0, jitter: 0.3, rng: r, family: 'unlit' }), Math.cos(aa) * rad, 0.58 + r() * 0.16, Math.sin(aa) * rad));
    }
    // 圈外散石：溅出的两小块毛石
    const s = Math.max(0, Math.min(3, spill));
    for (let i = 0; i < s; i++) {
      const aa = r() * Math.PI * 2;
      g.add(K.put(K.sphereLo({ color: shade(P.stone, -0.05), r: 0.16 + r() * 0.08, seg: 0, jitter: 0.3, rng: r }), Math.cos(aa) * 1.72, 0.12, Math.sin(aa) * 1.72));
    }
    return g;
  },
};
