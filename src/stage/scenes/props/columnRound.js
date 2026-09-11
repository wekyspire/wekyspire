// 石立柱（CATALOG #9）：「圆柱身+柱头柱础，三段式」——smallWall 宿主类（纯 stone 单族）。
// 原点=底面中心（y=0 落地）；默认柱身 30，产物顶面 topY=33.2（=础 1.65+柱身 30+柱头 1.55），
// 陶瓮/烛台等柱顶小件按此高度准入（CATALOG §1.2 宿主层级）。变体走 build(opts)：柱身高/缺角。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'columnRound',
  place: 'smallWall',
  tags: ['stone', 'column'],
  footprint: { x: 4, z: 4 },
  topY: 33.2, // 础(1.65) + 柱身(30) + 颈环/钟形圆盘/冠板(0.3+0.75+0.5)
  behaviors: [],
  build({ shaftH = 30, chipped = true, rng } = {}) {
    const g = new THREE.Group();
    // 柱础：两阶收进 + 础环（线脚）
    g.add(K.put(K.cyl({ color: shade(P.stone, -0.1), r: 2.0, h: 0.7, seg: 8 }), 0, 0.35, 0));
    g.add(K.put(K.cyl({ color: P.stone, r: 1.7, rTop: 1.55, h: 0.6, seg: 8 }), 0, 1.0, 0));
    const ring = K.cyl({ color: shade(P.stone, 0.06), r: 1.44, rTop: 1.54, h: 0.35, seg: 8 });
    if (rng) K.jitter(ring, rng, { pos: 0.03, rot: 0.02 }); // 础环微错位的手工感
    g.add(K.put(ring, 0, 1.475, 0));
    // 柱身：微收分（底 1.32 → 顶 1.12），中段略鼓（卷杀 entasis）
    g.add(K.put(K.lathe({
      color: P.stone, seg: 8,
      profile: [[1.32, 0], [1.27, shaftH * 0.35], [1.12, shaftH]],
    }), 0, 1.65, 0));
    // 柱头：颈环 + 钟形圆盘（echinus 外扩）+ 方冠板（abacus，平整承放面）
    const shaftTop = 1.65 + shaftH;
    g.add(K.put(K.cyl({ color: shade(P.stone, 0.06), r: 1.16, rTop: 1.26, h: 0.3, seg: 8 }), 0, shaftTop + 0.15, 0));
    g.add(K.put(K.cyl({ color: P.stone, r: 1.14, rTop: 1.62, h: 0.75, seg: 8 }), 0, shaftTop + 0.675, 0));
    const abacus = K.box({ color: shade(P.stone, -0.06), size: [2.7, 0.5, 2.7] });
    if (chipped) K.chip(abacus, { corner: [1, 1, 1], amount: 0.3 }); // 冠板风化缺角
    g.add(K.put(abacus, 0, shaftTop + 1.3, 0));
    return g;
  },
};
