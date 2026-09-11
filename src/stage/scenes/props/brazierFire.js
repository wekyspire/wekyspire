// 火盆（CATALOG #40）：「三足立式火盆，炭堆余焰」——prop 类（metal+stone 炭+unlit 焰 三族）。
// 原点=底面中心（y=0 落地）；三足外撇托举炭盆，全高约 4（M 档）。
// 布光职责：tags 声明 lightSource/fire 即"这里有火"——不私设 PointLight（CATALOG §6）；
// 余焰用 unlit 族冷白压暗锥 + P.ember 炭星（同 wallTorch/candleStand 语言）。
// 变体走 build(opts)：炭块数/火苗数/燃灭。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 炭盆轮廓（lathe profile：束腰→鼓腹→外撇盆沿），盆体高约 1.05
const BOWL = [
  [0.32, 0], [0.62, 0.1], [1.08, 0.42], [1.46, 0.8], [1.58, 1.0], [1.64, 1.05],
];

export default {
  id: 'brazierFire',
  place: 'prop',
  mount: 'floor',
  tags: ['metal', 'lightSource', 'fire'],
  footprint: { x: 4, z: 4 },
  behaviors: [],
  build({ coals = 5, flames = 2, lit = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('brazierFire');
    // 三足：120° 环布，自盆底外撇斜插落地（足端粗、根端细）
    for (let i = 0; i < 3; i++) {
      const a = i * (Math.PI * 2 / 3) + 0.5;
      const rootR = 0.4, footR = 1.22, drop = 1.6;
      const leg = K.cyl({ color: shade(P.iron, -0.08), r: 0.15, rTop: 0.11, h: Math.hypot(footR - rootR, drop), seg: 5, family: 'metal' });
      K.tilt(leg, 0, -a, -Math.atan2(footR - rootR, drop));
      const midR = (rootR + footR) / 2;
      g.add(K.put(leg, Math.cos(a) * midR, drop / 2, Math.sin(a) * midR));
    }
    // 炭盆：束腰鼓腹 + 盆沿箍圈（盆底离地约 1.6）；口内暗盘读作火塘空腔（同 vaseClay 瓮口）
    g.add(K.put(K.lathe({ color: P.iron, profile: BOWL, seg: 8, family: 'metal' }), 0, 1.6, 0));
    g.add(K.put(K.cyl({ color: shade(P.iron, 0.08), r: 1.72, h: 0.14, seg: 8, family: 'metal' }), 0, 2.68, 0));
    g.add(K.put(K.cyl({ color: P.night, r: 1.5, h: 0.08, seg: 8, family: 'unlit' }), 0, 2.62, 0));
    // 炭堆：黑灰炭块小丘（越高越收拢），炭星自缝里露头
    for (let i = 0; i < coals; i++) {
      const t = i / Math.max(1, coals - 1);
      const rad = 0.95 * (1 - t * 0.6);
      const aa = r() * Math.PI * 2;
      const coal = K.sphereLo({
        color: [shade(P.rock, -0.3), shade(P.rock, -0.15), P.rock][i % 3],
        r: 0.5 - t * 0.14, seg: 0, jitter: 0.25, rng: r,
      });
      K.tilt(coal, r() * 0.7, r() * Math.PI, r() * 0.7);
      g.add(K.put(coal, Math.cos(aa) * rad * r(), 2.62 + t * 0.4, Math.sin(aa) * rad * r()));
    }
    for (let i = 0; i < 3; i++) {
      const aa = r() * Math.PI * 2, rad = 0.25 + r() * 0.6;
      g.add(K.put(K.sphereLo({ color: P.ember, r: 0.16 + r() * 0.1, seg: 0, jitter: 0.3, rng: r, family: 'unlit' }), Math.cos(aa) * rad, 3.0 + r() * 0.18, Math.sin(aa) * rad));
    }
    // 余焰：两簇高低火苗（外锥压暗 + 内芯，unlit 冷白防过曝）
    if (lit) for (let i = 0; i < flames; i++) {
      const fx = i === 0 ? 0.35 : -0.5, fz = i === 0 ? -0.2 : 0.45;
      const h = i === 0 ? 1.1 : 0.8;
      g.add(K.put(K.cone({ color: shade(P.flameCore, -0.34), r: 0.34, h, seg: 6, family: 'unlit' }), fx, 3.02 + h * 0.5, fz));
      g.add(K.put(K.cone({ color: shade(P.flameCore, -0.12), r: 0.2, h: h * 0.62, seg: 5, family: 'unlit' }), fx, 2.98 + h * 0.31, fz));
    }
    return g;
  },
};
