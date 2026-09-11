// 简陋床铺（CATALOG #47）：「木框草垫，毯子半搭」——家具类 prop（wood 框 + cloth 垫毯 双族）。
// 原点=底面中心（y=0 落地），x=长(约 10) z=宽；草垫=压扁 jitter 球堆（干草蓬），
// 毯子半搭床尾、一侧垂过床沿。变体走 build(opts)：草垫蓬数 / 毯子垂搭侧（±1）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'cotBed',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'cloth'],
  footprint: { x: 10, z: 4.4 },
  behaviors: [],
  build({ straw = 3, side = 1, rng } = {}) {
    const g = new THREE.Group();
    const len = 10, half = len / 2;
    // 木框：两侧长栏 + 头尾横板 + 四短腿 + 承垫横枋
    for (const sz of [-1, 1]) {
      g.add(K.put(K.box({ color: P.woodDark, size: [len, 0.55, 0.38], family: 'wood' }), 0, 1.22, sz * 1.8));
    }
    for (const sx of [-1, 1]) {
      g.add(K.put(K.box({ color: shade(P.woodDark, 0.05), size: [0.4, 0.62, 3.6], family: 'wood' }), sx * (half - 0.2), 1.2, 0));
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = K.box({ color: P.woodDark, size: [0.36, 0.95, 0.36], family: 'wood' });
      if (rng) K.jitter(leg, rng, { rot: 0.012 });
      g.add(K.put(leg, sx * (half - 0.5), 0.475, sz * 1.55));
    }
    for (const z of [-1.0, 0, 1.0]) {
      g.add(K.put(K.box({ color: P.wood, size: [len - 1.1, 0.14, 0.55], family: 'wood' }), 0, 1.57, z));
    }
    // 草垫：压扁 jitter 球相接成蓬草铺（深浅草色微差，均布床身）
    const tones = [shade(P.straw, 0.06), P.straw, shade(P.straw, -0.07)];
    const step = straw === 1 ? 0 : len * 0.46 / (straw - 1); // 相邻草蓬中心距（相互搭接）
    for (let i = 0; i < straw; i++) {
      const x = (i - (straw - 1) / 2) * step;
      const pad = K.sphereLo({
        color: tones[i % 3], r: 1, seg: 1, jitter: 0.16,
        rng: rng ?? K.createRng('cotBed'), family: 'cloth',
      });
      K.scaleXYZ(pad, 2.05, 0.62, 1.7);
      g.add(K.put(pad, x, 1.95, 0));
    }
    // 毯子：半搭床尾（上片）+ 垂过一侧床沿（垂片微外斜）+ 搭过床尾板（尾片）
    const cloak = K.box({ color: P.bannerRed, size: [4.7, 0.22, 3.5], family: 'cloth' });
    K.tilt(cloak, 0.02, 0, side * 0.02);
    g.add(K.put(cloak, 2.2, 2.62, side * 0.08));
    const drape = K.box({ color: shade(P.bannerRed, -0.05), size: [4.5, 1.2, 0.2], family: 'cloth' });
    K.tilt(drape, side * 0.05, 0, 0);
    g.add(K.put(drape, 2.2, 2.0, side * 1.86));
    g.add(K.put(K.box({ color: shade(P.bannerRed, -0.05), size: [0.2, 0.95, 3.3], family: 'cloth' }), 4.5, 2.1, 0));
    return g;
  },
};
