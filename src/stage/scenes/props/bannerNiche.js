// 挂旗龛（CATALOG #70）：「内凹旗位，上沿挂钩」——wallStructure 类（stone+unlit+metal 三族）。
// 原点=墙脚挂点（z=0 贴墙面，+z 朝室内），占 1 墙段，全高约 13.7；龛位本身：石框内凹、
// unlit P.night 背板读龛深，暗色侧壁/龛顶压出进深，上缘挂两枚铁钩（旗面由 wallDecor
// 类挂旗资产另行挂入，本件只出「位」）。变体走 build(opts)：龛深/龛高/基座缺角。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'bannerNiche',
  place: 'wallStructure',
  bayWidth: 1,
  tags: ['stone'],
  behaviors: [],
  build({ depth = 1.3, nichH = 10.0, hooks = 2, chipped = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('bannerNiche');
    // 基座带（风化缺角）
    const pedestal = K.box({ color: shade(P.stone, -0.1), size: [4.0, 1.5, depth + 0.4] });
    if (chipped) K.chip(pedestal, { corner: [1, 1, 1], amount: 0.25 });
    g.add(K.put(pedestal, 0, 0.75, (depth + 0.4) / 2));
    // 龛口纵向范围：基座顶 1.5 → 楣下 1.5 + nichH
    const yLo = 1.5 + 0.3, yHi = 1.5 + nichH - 0.3; // 内凹净高（留框内衬余量）
    const jambH = nichH;
    for (const s of [-1, 1]) { // 两侧龛框（微错位手工感）
      const jamb = K.box({ color: P.stone, size: [0.85, jambH, depth + 0.15] });
      K.jitter(jamb, r, { rot: 0.008 });
      g.add(K.put(jamb, s * 1.575, 1.5 + jambH / 2, (depth + 0.15) / 2));
    }
    // 龛内：unlit 夜色背板读深 + 暗色侧壁/龛顶/龛台压出进深
    const midY = (yLo + yHi) / 2, innerH = yHi - yLo;
    g.add(K.put(K.box({ color: P.night, size: [2.3, innerH, 0.25], family: 'unlit' }), 0, midY, 0.13));
    for (const s of [-1, 1]) {
      g.add(K.put(K.box({ color: shade(P.stone, -0.45), size: [0.25, innerH, depth] }), s * 1.03, midY, 0.13 + depth / 2));
    }
    g.add(K.put(K.box({ color: shade(P.stone, -0.4), size: [2.3, 0.25, depth] }), 0, yHi - 0.125, 0.13 + depth / 2));
    g.add(K.put(K.box({ color: shade(P.stone, -0.25), size: [2.3, 0.3, depth + 0.05] }), 0, yLo + 0.15, 0.155 + depth / 2));
    // 檐部：线脚 + 出挑压顶（微错位）
    const yCor = 1.5 + nichH;
    const cornice = K.box({ color: shade(P.stone, 0.06), size: [4.3, 0.75, depth + 0.45] });
    K.jitter(cornice, r, { rot: 0.01 });
    g.add(K.put(cornice, 0, yCor + 0.375, (depth + 0.45) / 2));
    g.add(K.put(K.box({ color: shade(P.stone, -0.04), size: [4.6, 0.85, depth + 0.65] }), 0, yCor + 0.75 + 0.425, (depth + 0.65) / 2));
    // 上沿挂钩：龛顶内缘斜向下的铁杆，挂位在龛口内
    for (let i = 0; i < hooks; i++) {
      const hx = (i - (hooks - 1) / 2) * 1.4 + (r() - 0.5) * 0.2;
      const hook = K.cyl({ color: P.iron, r: 0.09, h: 0.8, seg: 5, family: 'metal' });
      g.add(K.put(K.tilt(hook, 1.9, 0, 0), hx, yHi - 0.45, 0.5 + depth * 0.25));
    }
    return g;
  },
};
