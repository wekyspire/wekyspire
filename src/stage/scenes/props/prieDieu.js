// 祈祷跪凳（CATALOG2 #13）：「跪板+斜倚架+垂布」——圣所家具 prop（wood+cloth 双族）。
// 前部跪凳（侧板承跪板+软布垫），后部斜倚经架（双侧柱+顶横枋+前低后高斜面搁板），
// 架上摊一本经书（封皮+页芯两片），垂布一幅自斜架前缘垂下、另一幅垂过跪凳前板曳地
// （底角缺切=磨损布边）。原点=底面中心（y=0 落地），x=宽 z=深（+z 朝跪者/室内）。
// 变体走 build(opts)：斜面角/有无经书/垂布曳地幅有无。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'prieDieu',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'cloth', 'chapel'],
  footprint: { x: 2.7, z: 3.6 },
  behaviors: [],
  build({ slope = 0.42, book = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('prieDieu');
    // 跪凳：两侧矮板承跪板，跪板上一条软布垫（读出跪垫）
    for (const s of [-1, 1]) {
      const slab = K.box({ color: P.woodDark, size: [0.22, 1.35, 1.05], family: 'wood' });
      K.jitter(slab, r, { rot: 0.008 });
      g.add(K.put(slab, s * 1.0, 0.675, 1.15));
    }
    g.add(K.put(K.box({ color: shade(P.wood, 0.05), size: [2.4, 0.26, 1.15], family: 'wood' }), 0, 1.48, 1.15));
    g.add(K.put(K.box({ color: shade(P.bannerRed, 0.04), size: [2.2, 0.2, 0.95], family: 'cloth' }), 0, 1.71, 1.15));
    // 斜倚架：双侧柱 + 顶横枋 + 前低后高斜面搁板（供摊经书）
    for (const s of [-1, 1]) {
      const post = K.box({ color: P.woodDark, size: [0.26, 3.7, 0.3], family: 'wood' });
      K.jitter(post, r, { rot: 0.008 });
      g.add(K.put(post, s * 1.06, 1.85, -1.25));
    }
    g.add(K.put(K.box({ color: shade(P.woodDark, 0.08), size: [2.38, 0.2, 0.22], family: 'wood' }), 0, 3.58, -1.25));
    const desk = K.box({ color: P.wood, size: [2.5, 0.22, 1.5], family: 'wood' });
    K.tilt(desk, slope, 0, 0);
    K.jitter(desk, r, { rot: 0.01 });
    g.add(K.put(desk, 0, 2.85, -0.8));
    // 经书：皮面封底 + 羊皮纸页芯两片略错开，随斜面同角摊放
    if (book) {
      const tome = K.grp(
        K.put(K.box({ color: shade(P.woodDark, 0.1), size: [1.35, 0.1, 0.95], family: 'wood' }), 0, 0.05, 0),
        K.put(K.box({ color: P.parchment, size: [1.22, 0.1, 0.82], family: 'wood' }), 0.03, 0.13, 0.02),
      );
      K.tilt(tome, slope + 0.03, 0, 0.015);
      g.add(K.put(tome, -0.25, 2.92, -0.78));
    }
    // 垂布：一幅自斜架前缘垂下，另一幅垂过跪凳前板曳地（底角缺切出磨破布边）
    const drape = K.box({ color: shade(P.bannerRed, -0.04), size: [2.3, 1.5, 0.09], family: 'cloth' });
    K.tilt(drape, 0, 0, 0.012);
    g.add(K.put(drape, 0, 2.0, -0.08));
    const hem = K.box({ color: shade(P.bannerRed, -0.1), size: [2.1, 1.45, 0.09], family: 'cloth' });
    K.chip(hem, { corner: [1, -1, 1], amount: 0.14 });
    K.tilt(hem, -0.035, 0, 0.01);
    g.add(K.put(hem, 0, 0.73, 1.79));
    return g;
  },
};
