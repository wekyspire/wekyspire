// 门徽浮雕（CATALOG #63）：「家族纹章圆雕，缎带环绕」——wallStructure 类（纯 stone 单族）。
// 原点=墙脚挂点（z=0 贴墙面，+z 朝室内，同 pilasterHalf）；占 1 墙段（bayWidth:1），高 ~10。
// 圆雕大盾盘 + 环盘缎带珠串 + 盘心塔形/剑形纹章（shade 分层：盘心最亮、底板最暗）。
// 变体走 build(opts)：beads（缎带珠数）、crest（'tower' 塔徽 / 'sword' 剑徽）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'reliefSigil',
  place: 'wallStructure',
  bayWidth: 1,
  tags: ['stone', 'relief'],
  behaviors: [],
  build({ beads = 8, crest = 'tower', rng } = {}) {
    const g = new THREE.Group();
    // 底座 + 底板
    g.add(K.put(K.box({ color: shade(P.stone, -0.12), size: [5.2, 1.3, 1.05] }), 0, 0.65, 0.525));
    g.add(K.put(K.box({ color: shade(P.stone, -0.08), size: [4.8, 8.8, 0.55] }), 0, 5.7, 0.275));
    // 盾盘（圆雕主盘，圆面朝 +z）与盘心（更亮一档内凹感反做：内盘外凸）
    const cy = 6.5;
    g.add(K.put(K.tilt(K.cyl({ color: shade(P.stone, 0.04), r: 2.05, h: 0.5, seg: 9 }), Math.PI / 2), 0, cy, 0.75));
    g.add(K.put(K.tilt(K.cyl({ color: shade(P.stone, 0.14), r: 1.3, h: 0.3, seg: 9 }), Math.PI / 2), 0, cy, 1.0));
    // 缎带环绕：珠串沿盘缘一圈（切向摆放、明暗相间）
    const n = Math.max(6, Math.round(beads));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const bead = K.box({ color: shade(P.stone, i % 2 ? 0.1 : 0.18), size: [0.6, 0.32, 0.3] });
      K.tilt(bead, 0, 0, a + Math.PI / 2);
      if (rng) K.jitter(bead, rng, { rot: 0.02 });
      g.add(K.put(bead, Math.cos(a) * 2.5, cy + Math.sin(a) * 2.5, 0.78));
    }
    // 缎带尾：盘底两侧垂坠两条
    for (const s of [-1, 1]) {
      const tail = K.box({ color: shade(P.stone, 0.15), size: [0.55, 2.3, 0.2] });
      K.tilt(tail, 0, 0, 0.14 * s);
      g.add(K.put(tail, 0.95 * s, 3.55, 0.85));
    }
    // 盘心纹章：塔徽（堡身 + 三垛口）/ 剑徽（刃 + 横格 + 圆首）
    if (crest === 'sword') {
      g.add(K.put(K.box({ color: shade(P.stone, 0.24), size: [0.2, 2.1, 0.2] }), 0, cy - 0.1, 1.3));
      g.add(K.put(K.box({ color: shade(P.stone, 0.2), size: [0.85, 0.18, 0.2] }), 0, cy - 0.75, 1.3));
      g.add(K.put(K.sphereLo({ color: shade(P.stone, 0.28), r: 0.16 }), 0, cy + 0.85, 1.3));
    } else {
      g.add(K.put(K.box({ color: shade(P.stone, 0.24), size: [1.15, 1.5, 0.35] }), 0, cy - 0.15, 1.3));
      for (const dx of [-0.4, 0, 0.4]) {
        g.add(K.put(K.box({ color: shade(P.stone, 0.24), size: [0.3, 0.32, 0.3] }), dx, cy + 0.76, 1.3));
      }
    }
    return g;
  },
};
