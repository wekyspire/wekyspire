// 高足罐（CATALOG2 #22）：「细高陶罐+双环耳+环带纹」——容器类 prop（陶器 stone + 罐口 unlit 双族）。
// 原点=底面中心（y=0 落地）；细高剪影：圈足→高足束胫→鼓腹→长收肩→直颈外撇口，
// 高约 3.5、腹径约 1.6；肩颈间双环耳（三段圆柱勾环）+ 腹部贴身环带纹。
// 变体走 build(opts)：fat 丰满度（0.85 修长 ~ 1.15 圆胖）/bands 环带数（2~4）。

import * as THREE from 'three';
import { P, K } from '../kit/index.js';

// 罐身轮廓（lathe profile 自下而上），总高 3.5
const BODY = [
  [0.02, 0], [0.3, 0], [0.37, 0.08],
  [0.24, 0.28], [0.2, 0.5],
  [0.52, 1.15], [0.72, 1.8], [0.78, 2.2],
  [0.7, 2.6], [0.48, 3.0], [0.33, 3.2],
  [0.31, 3.32], [0.42, 3.42], [0.45, 3.5],
];
// 环带纹候选高度（贴身半径由 radiusAt 插值，永远凸过罐身）
const BAND_Y = [1.55, 1.95, 2.3, 2.6];

// 轮廓插值：y 处罐身半径（未乘 fat）
function radiusAt(y) {
  for (let i = 1; i < BODY.length; i++) {
    const [r1, y1] = BODY[i - 1], [r2, y2] = BODY[i];
    if (y <= y2) return r1 + (r2 - r1) * ((y - y1) / (y2 - y1 || 1));
  }
  return BODY[BODY.length - 1][0];
}

// 平面斜柱：连接 (x1,y1)→(x2,y2) 的圆柱段（环耳分段，z=0 平面；同 vaseTwinEar 手法）
function bar(color, r, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const m = K.cyl({ color, r, h: Math.hypot(dx, dy), seg: 5 });
  return K.put(K.tilt(m, 0, 0, Math.atan2(-dx, dy)), (x1 + x2) / 2, (y1 + y2) / 2, 0);
}

export default {
  id: 'amphoraTall',
  place: 'prop',
  mount: 'floor',
  tags: ['pottery', 'container', 'generic'],
  footprint: { x: 2.1, z: 2.1 },
  behaviors: [],
  build({ fat = 1, bands = 3, rng } = {}) {
    const g = new THREE.Group();
    // 罐身：lathe 一体拉坯，fat 控丰满度
    const body = K.lathe({
      color: P.clay, seg: 7,
      profile: BODY.map(([r, y]) => [r * fat, y]),
    });
    if (rng) K.jitter(body, rng, { rot: 0.015 }); // 窑烧微歪的手工感
    g.add(body);
    // 环带纹：腹部贴身凸弦（偏腹部最宽处取位，半径随轮廓插值）
    const nb = Math.min(Math.max(bands, 2), 4);
    for (let i = 0; i < nb; i++) {
      const y = BAND_Y[i + (BAND_Y.length - nb)];
      g.add(K.put(K.cyl({ color: P.clayDark, r: radiusAt(y) * fat + 0.05, h: 0.1, seg: 7 }), 0, y, 0));
    }
    // 口沿唇圈 + 颈内暗盘（unlit 夜色读作空腔）
    g.add(K.put(K.cyl({ color: P.clayDark, r: 0.48 * fat, h: 0.09, seg: 7 }), 0, 3.46, 0));
    g.add(K.put(K.cyl({ color: P.night, r: 0.3 * fat, h: 0.06, seg: 7, family: 'unlit' }), 0, 3.34, 0));
    // 双环耳：肩→外鼓→回颈 三段勾环，左右对称
    for (const s of [-1, 1]) {
      g.add(bar(P.clayDark, 0.09, s * 0.56, 2.52, s * 1.0, 2.86));
      g.add(bar(P.clayDark, 0.09, s * 1.0, 2.86, s * 0.95, 3.2));
      g.add(bar(P.clayDark, 0.09, s * 0.95, 3.2, s * 0.3, 3.3));
    }
    return g;
  },
};
