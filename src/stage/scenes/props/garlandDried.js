// 干花花环（CATALOG2 编号 67）：「环圈垂+干穗残花」——wallDecor 高带垂挂件（wood+cloth 双族）。
// 原点=墙面高位挂点投影（z=0 贴墙，+z 朝室内，y=0 即挂点）：短绳自挂点垂下系住束扎花环，
// 环体垂挂向下（bbox 主体在负 y，band=high 垂挂语义，同 bannerLong 约定），总垂长约 3.9。
// 环圈=lathe 环带翻起正对室内（herb 束扎感），下弧垂干麦穗、上弧缀褪色残花，底系暗红缎带。
// 变体走 build(opts)：穗数 ears / 残花数 blooms / 绑扎点数 wraps。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 花环束圈轮廓（lathe 环带：内缘留孔挂墙、外缘鼓成束），束厚约 0.4、外半径 1.24
const RING = [
  [0.98, -0.2], [1.17, -0.13], [1.24, 0], [1.17, 0.13], [0.98, 0.2],
];

export default {
  id: 'garlandDried',
  place: 'wallDecor',
  band: 'high',
  tags: ['herb', 'chapel'],
  behaviors: [],
  build({ ears = 5, blooms = 4, wraps = 3, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('garlandDried');
    const R = 1.11;                       // 环圈中心半径
    const cy = -1.85;                     // 环心高度（环顶约 -0.74）
    const cz = 0.34;                      // 环面离墙（束圈厚度中心）
    // 挂绳：自 y=0 挂点垂到环顶的短绳
    g.add(K.put(K.cyl({ color: P.rope, r: 0.05, h: 0.78, seg: 4, family: 'wood' }), 0, -0.39, cz));
    // 环圈：束扎花环（cloth 族 DoubleSide，环孔内壁也读得出厚度）
    const ring = K.lathe({ color: P.herb, seg: 8, family: 'cloth', profile: RING });
    K.tilt(ring, Math.PI / 2, 0, 0);      // 翻起：环面正对室内（+z）
    if (rng) K.jitter(ring, r, { rot: 0.02 });
    g.add(K.put(ring, 0, cy, cz));
    // 绑扎点：环上一圈细绳缠腰（径向窄条，随手扎感）
    const nw = Math.min(Math.max(wraps, 2), 4);
    for (let i = 0; i < nw; i++) {
      const th = (i / nw) * Math.PI * 2 + 0.9;
      const wrap = K.box({ color: shade(P.rope, 0.06), size: [0.2, 0.38, 0.46], family: 'wood' });
      K.tilt(wrap, 0, 0, th - Math.PI / 2);
      g.add(K.put(wrap, Math.cos(th) * R, cy + Math.sin(th) * R, cz));
    }
    // 干麦穗：下弧倒垂的麦穗锥（宽底贴环、穗尖朝下），麦色深浅交替
    const ne = Math.min(Math.max(ears, 3), 7);
    for (let i = 0; i < ne; i++) {
      const th = (200 + (140 * i) / (ne - 1)) * Math.PI / 180 + (r() - 0.5) * 0.12;
      const ear = K.cone({ color: i % 2 ? P.straw : shade(P.straw, -0.12), r: 0.14, h: 0.58, seg: 5, family: 'wood' });
      K.tilt(ear, 0, 0, Math.PI);         // 穗尖朝下
      g.add(K.put(ear, Math.cos(th) * R + (r() - 0.5) * 0.08, cy + Math.sin(th) * R - 0.29, cz + (r() - 0.5) * 0.1));
    }
    // 残花：上弧外缘几粒褪色干花苞（暗红/灰白/冷蓝的陈旧花色）
    const BLOOM_C = [shade(P.blood, 0.08), P.parchment, shade(P.potionBlue, -0.16), shade(P.blood, -0.1)];
    const nb = Math.min(Math.max(blooms, 2), 6);
    for (let i = 0; i < nb; i++) {
      const th = (35 + (110 * i) / (nb - 1)) * Math.PI / 180 + (r() - 0.5) * 0.15;
      const bud = K.sphereLo({ color: BLOOM_C[i % 4], r: 0.15 + r() * 0.05, seg: 0, jitter: 0.28, rng: r, family: 'cloth' });
      g.add(K.put(bud, Math.cos(th) * 1.2, cy + Math.sin(th) * 1.2, cz + (r() - 0.5) * 0.12));
    }
    // 缎带蝶结：环底系结，两条尾带垂挂（褪色暗红，cloth）
    const ribbon = shade(P.blood, -0.16);
    g.add(K.put(K.box({ color: ribbon, size: [0.36, 0.28, 0.2], family: 'cloth' }), 0, cy - 1.2, cz));
    for (const s of [-1, 1]) {
      const tail = K.box({ color: shade(ribbon, s > 0 ? 0.05 : 0), size: [0.2, 0.78, 0.12], family: 'cloth' });
      K.tilt(tail, 0, 0, s * 0.32);
      g.add(K.put(tail, s * 0.17, cy - 1.72, cz));
    }
    return g;
  },
};
