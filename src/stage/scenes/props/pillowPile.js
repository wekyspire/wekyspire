// 靠垫堆（CATALOG2 #20）：「三两只叠压歪斜」——起居类 prop（cloth 单族，bannerBlue 被褥色系）。
// 原点=底面中心（y=0 落地）；靠垫=压扁 jitter 软球（cloth 软鼓轮廓，同 sacksGrain 手法），
// 底垫宽大 → 二垫压缝歪斜 → 三垫斜倚身旁 → 四垫小只压顶，深浅交替。
// 变体走 build(opts)：pillows 垫数（2~4）；rng 驱动确定性。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'pillowPile',
  place: 'prop',
  mount: 'floor',
  tags: ['cloth', 'quarters'],
  footprint: { x: 2.8, z: 2.6 },
  behaviors: [],
  build({ pillows = 3, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('pillowPile');
    const tones = [shade(P.bannerBlue, 0.12), P.bannerBlue, shade(P.bannerBlue, -0.14)];
    // 叠压位：位置/三轴半尺寸/歪斜角（第三只为斜倚，第四只小只压顶）
    const spots = [
      { x: 0.05, y: 0.52, z: 0.1, s: [1.5, 0.52, 1.2], ry: 0.25, rz: 0.02 },
      { x: 0.22, y: 1.06, z: -0.12, s: [1.28, 0.46, 1.02], ry: -0.4, rz: -0.06 },
      { x: -0.95, y: 0.6, z: 0.18, s: [0.95, 0.4, 0.85], ry: 0.5, rz: 0.6 },
      { x: -0.05, y: 1.5, z: 0.05, s: [1.0, 0.4, 0.8], ry: 0.9, rz: -0.1 },
    ];
    const n = Math.min(Math.max(pillows, 2), 4);
    for (let i = 0; i < n; i++) {
      const sp = spots[i];
      const pil = K.sphereLo({
        color: tones[i % 3], r: 1, seg: 1, jitter: 0.12, rng: r, family: 'cloth',
      });
      K.scaleXYZ(pil, sp.s[0], sp.s[1], sp.s[2]);
      K.tilt(pil, 0, sp.ry + (r() - 0.5) * 0.2, sp.rz + (r() - 0.5) * 0.08);
      g.add(K.put(pil, sp.x + (r() - 0.5) * 0.1, sp.y, sp.z + (r() - 0.5) * 0.1));
    }
    return g;
  },
};
