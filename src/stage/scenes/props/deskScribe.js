// 抄写台（CATALOG2 #3）：「高斜面+书堆压角+留烛位」——家具类 prop（纯 wood 单族）。
// 原点=底面中心（y=0 落地），x=宽 z=深；立式抄写台：两侧板足 + 高斜面（立姿书写，
// 面顶约 5.7），书堆压在斜面一角、另一角留一烛位（空环座无焰，不承担布光职责）。
// 变体走 build(opts)：书堆册数 / 斜面倾角 / 是否留烛位。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 书堆尺寸阶梯（大册垫底、小册在上，封面深浅相间）
const BOOKS = [
  { w: 1.15, h: 0.22, d: 0.8, k: 0 },
  { w: 1.0, h: 0.18, d: 0.72, k: 0.08 },
  { w: 0.9, h: 0.16, d: 0.66, k: -0.1 },
];

export default {
  id: 'deskScribe',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'furniture', 'library'],
  footprint: { x: 3.2, z: 2.4 },
  behaviors: [],
  build({ books = 3, slopeA = 0.35, socket = true, rng } = {}) {
    const g = new THREE.Group();
    // 板足：两侧厚板 + 一根底横档（立式台架，比坐姿书桌高一档）
    for (const sx of [-1, 1]) {
      const panel = K.box({ color: P.woodDark, size: [0.3, 4.9, 1.8], family: 'wood' });
      if (rng) K.jitter(panel, rng, { rot: 0.01 });
      g.add(K.put(panel, sx * 0.92, 2.45, 0));
    }
    g.add(K.put(K.box({ color: shade(P.woodDark, 0.06), size: [1.6, 0.24, 0.3], family: 'wood' }), 0, 0.8, 0.25));
    // 高斜面：前缘搭板足顶、后缘翘起（立姿书写坡度），前口止条压住纸物
    const plank = K.box({ color: P.wood, size: [3.0, 0.18, 2.2], family: 'wood' });
    K.tilt(plank, slopeA, 0, 0);
    g.add(K.put(plank, 0, 5.25, 0));
    const stop = K.box({ color: P.woodDark, size: [3.0, 0.16, 0.18], family: 'wood' });
    K.tilt(stop, slopeA, 0, 0);
    g.add(K.put(stop, 0, 5.08, 0.9));
    // 斜面坡上的落点高度（沿 z 偏移的坡度抬升），书堆/烛位共用
    const onSlope = zOff => 5.25 - Math.sin(slopeA) * zOff + 0.1;
    // 书堆压角：左后角横叠数册（羊皮封面深浅相间，最上一册微歪）
    let stackY = onSlope(-0.35);
    for (let i = 0; i < books; i++) {
      const b = BOOKS[i % 3];
      const book = K.box({ color: shade(P.parchment, b.k), size: [b.w, b.h, b.d], family: 'wood' });
      K.tilt(book, slopeA, i === books - 1 ? 0.16 : 0, 0);
      if (rng) K.jitter(book, rng, { rot: 0.015 });
      g.add(K.put(book, -0.68, stackY + b.h / 2, -0.35));
      stackY += b.h + 0.02;
    }
    // 留烛位：斜面右前一枚低环座（空位，供摆烛，无焰）
    if (socket) {
      const ring = K.cyl({ color: P.woodDark, r: 0.3, rTop: 0.36, h: 0.14, seg: 6, family: 'wood' });
      K.tilt(ring, slopeA, 0, 0);
      if (rng) K.jitter(ring, rng, { rot: 0.02 });
      g.add(K.put(ring, 0.9, onSlope(0.1), 0.1));
    }
    return g;
  },
};
