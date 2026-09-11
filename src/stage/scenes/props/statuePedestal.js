// 雕像基座（CATALOG #14）：「高石基座带线脚（顶放雕像/瓶）」——smallWall 宿主类（纯 stone 单族）。
// 原点=底面中心（y=0 落地）；默认基身 10.9，产物顶面 topY=13.8（=座 1.9+基身 10.9+檐口 1.0），
// 顶冠板平整可承雕像/双耳瓶等柱顶小件。变体走 build(opts)：基身高/檐板缺角。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'statuePedestal',
  place: 'smallWall',
  tags: ['stone', 'pedestal'],
  footprint: { x: 3.5, z: 3.5 },
  topY: 13.8, // 座(1.9) + 基身(10.9) + 檐口两阶(0.45+0.55)
  behaviors: [],
  build({ dadoH = 10.9, chipped = true, rng } = {}) {
    const g = new THREE.Group();
    // 座与线脚：三阶收进的方座（下大上小）
    g.add(K.put(K.box({ color: shade(P.stone, -0.1), size: [3.4, 1.0, 3.4] }), 0, 0.5, 0));
    g.add(K.put(K.box({ color: P.stone, size: [3.0, 0.5, 3.0] }), 0, 1.25, 0));
    g.add(K.put(K.box({ color: shade(P.stone, 0.05), size: [2.7, 0.4, 2.7] }), 0, 1.7, 0));
    // 基身（dado）：四方柱微收分（cyl seg=4 转 45° 即方台，边长 r√2）
    const dado = K.cyl({ color: P.stone, r: 1.52, rTop: 1.44, h: dadoH, seg: 4 });
    K.tilt(dado, 0, Math.PI / 4, 0);
    if (rng) K.jitter(dado, rng, { rot: 0.012 }); // 石作微歪（不动檐口，topY 稳定）
    g.add(K.put(dado, 0, 1.9 + dadoH / 2, 0));
    // 檐口（cornice）：两阶出挑 + 顶冠板（平整承放面）
    const dadoTop = 1.9 + dadoH;
    g.add(K.put(K.box({ color: shade(P.stone, 0.05), size: [2.45, 0.45, 2.45] }), 0, dadoTop + 0.225, 0));
    const cornice = K.box({ color: shade(P.stone, -0.06), size: [3.15, 0.55, 3.15] });
    if (chipped) K.chip(cornice, { corner: [-1, 1, 1], amount: 0.25 }); // 檐板风化缺角
    g.add(K.put(cornice, 0, dadoTop + 0.725, 0));
    return g;
  },
};
