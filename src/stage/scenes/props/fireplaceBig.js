// 壁炉（CATALOG #65）：「石框火塘，柴堆余焰」——wallStructure 类（stone+wood+unlit 三族）。
// 原点=墙脚挂点（z=0 贴墙面，+z 朝室内，同 pilasterHalf 约定），占 2 墙段；全宽约 9、全高约 12。
// 火塘暗腔用 unlit P.night 体块读深；柴堆=woodDark 交叉圆木；余焰参照 wallTorch 的
// shade(P.flameCore, 压暗) 双锥。布光职责：tags 声明 lightSource/fire 即"这里有火"，
// 不私设 PointLight（CATALOG §6）。变体走 build(opts)：柴量/火星数/燃灭/压顶缺角。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'fireplaceBig',
  place: 'wallStructure',
  bayWidth: 2,
  tags: ['stone', 'lightSource', 'fire'],
  behaviors: [],
  build({ logs = 4, embers = 3, lit = true, chipped = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('fireplaceBig');
    // 地垛（前伸石台）+ 火塘暗腔（unlit 黑体读深，腔口约 4.8 宽 × 5.7 高）
    g.add(K.put(K.box({ color: shade(P.stone, -0.12), size: [8.8, 0.6, 3.2] }), 0, 0.3, 1.6));
    g.add(K.put(K.box({ color: P.night, size: [5.0, 5.7, 1.4], family: 'unlit' }), 0, 3.45, 0.7));
    // 两侧石框（jamb）：微错位的手工砌感
    for (const s of [-1, 1]) {
      const jamb = K.box({ color: P.stone, size: [1.85, 7.8, 2.65] });
      K.jitter(jamb, r, { rot: 0.01 });
      g.add(K.put(jamb, s * 3.325, 4.4, 1.325));
    }
    // 横楣 + 出挑线脚带 + 搁板（mantel）+ 两端托架
    g.add(K.put(K.box({ color: shade(P.stone, 0.05), size: [8.6, 1.5, 2.65] }), 0, 7.05, 1.325));
    g.add(K.put(K.box({ color: shade(P.stone, -0.06), size: [8.9, 0.35, 2.9] }), 0, 6.475, 1.45));
    const mantel = K.box({ color: shade(P.stone, 0.1), size: [9.2, 0.75, 3.1] });
    if (chipped) K.chip(mantel, { corner: [1, 1, 1], amount: 0.3 }); // 搁板风化缺角
    g.add(K.put(mantel, 0, 8.175, 1.55));
    for (const s of [-1, 1]) {
      g.add(K.put(K.box({ color: shade(P.stone, -0.18), size: [0.8, 1.3, 2.75] }), s * 3.55, 7.55, 1.375));
    }
    // 上烟道（收窄的墙 breasts），收束到全高约 12
    g.add(K.put(K.box({ color: P.stone, size: [7.4, 3.4, 2.0] }), 0, 10.25, 1.0));
    // 柴堆：交叉圆木架成锥（脚在垛面上散开、梢在腔口前聚拢）
    for (let i = 0; i < logs; i++) {
      const a = (i / logs) * Math.PI * 2 + 0.4 + r() * 0.3;
      const bx = Math.cos(a) * 1.15, bz = 1.6 + Math.sin(a) * 0.45;
      const tipY = 3.9 + r() * 0.4;
      const dx = Math.cos(a + 2.8) * 0.12 - bx, dy = tipY - 0.85, dz = 1.62 - bz;
      const len = Math.hypot(dx, dy, dz) + 0.35;
      const log = K.cyl({
        color: i % 2 ? P.woodDark : shade(P.woodDark, 0.07),
        r: 0.26 + (i % 2) * 0.05, h: len, seg: 5, family: 'wood',
      });
      K.tilt(log, Math.atan2(dz, dy), 0, -Math.atan2(dx, dy));
      g.add(K.put(log, bx + dx / 2, 0.85 + dy / 2, bz + dz / 2));
    }
    // 余焰：两簇高低火苗（外锥压暗 + 内芯，unlit 冷白防过曝，同 wallTorch 语言）
    if (lit) {
      for (const [fx, fz, fh] of [[0.5, 1.72, 1.35], [-0.45, 1.55, 0.95]]) {
        g.add(K.put(K.cone({ color: shade(P.flameCore, -0.34), r: 0.36, h: fh, seg: 6, family: 'unlit' }), fx, 0.95 + fh * 0.5, fz));
        g.add(K.put(K.cone({ color: shade(P.flameCore, -0.12), r: 0.21, h: fh * 0.62, seg: 5, family: 'unlit' }), fx, 0.92 + fh * 0.31, fz));
      }
    }
    // 炭星：柴脚缝里露头的余烬
    for (let i = 0; i < embers; i++) {
      g.add(K.put(
        K.sphereLo({ color: P.ember, r: 0.13 + r() * 0.09, seg: 0, jitter: 0.3, rng: r, family: 'unlit' }),
        (r() * 2 - 1) * 1.1, 0.78 + r() * 0.15, 1.55 + r() * 0.5));
    }
    return g;
  },
};
