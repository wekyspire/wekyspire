// 半壁柱（CATALOG #61）：「附墙半柱带柱头，线脚三段」——wallStructure 类（纯 stone 单族）。
// 原点=墙脚挂点（z=0 贴墙面，+z 朝室内，同 wallTorch 约定）；圆件后半埋入墙体露出半柱剪影，
// 占 1 墙段（bayWidth:1）。变体走 build(opts)：柱身高/冠板缺角。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'pilasterHalf',
  place: 'wallStructure',
  bayWidth: 1,
  tags: ['stone'],
  behaviors: [],
  build({ shaftH = 17.5, chipped = true, rng } = {}) {
    const g = new THREE.Group();
    // 柱础：方座 + 半础鼓（圆心落在墙面 z=0，后半入墙）
    g.add(K.put(K.box({ color: shade(P.stone, -0.1), size: [2.7, 0.55, 2.4] }), 0, 0.275, 0));
    const drum = K.cyl({ color: P.stone, r: 1.08, rTop: 0.98, h: 0.5, seg: 7 });
    if (rng) K.jitter(drum, rng, { rot: 0.015 }); // 础鼓微错位的手工感
    g.add(K.put(drum, 0, 0.8, 0));
    // 柱身：微收分半柱（底 0.95 → 顶 0.88，圆心在墙面）
    const shaftTop = 1.05 + shaftH;
    g.add(K.put(K.cyl({ color: P.stone, r: 0.95, rTop: 0.88, h: shaftH, seg: 7 }), 0, 1.05 + shaftH / 2, 0));
    // 柱头：颈环 + 钟形圆盘（echinus 外扩）+ 方冠板（线脚三段收束）
    g.add(K.put(K.cyl({ color: shade(P.stone, 0.06), r: 0.9, rTop: 0.98, h: 0.3, seg: 7 }), 0, shaftTop + 0.15, 0));
    g.add(K.put(K.cyl({ color: P.stone, r: 0.86, rTop: 1.3, h: 0.6, seg: 7 }), 0, shaftTop + 0.6, 0));
    const abacus = K.box({ color: shade(P.stone, -0.06), size: [2.7, 0.45, 2.6] });
    if (chipped) K.chip(abacus, { corner: [1, 1, 1], amount: 0.25 }); // 冠板风化缺角
    g.add(K.put(abacus, 0, shaftTop + 1.075, 0));
    return g;
  },
};
