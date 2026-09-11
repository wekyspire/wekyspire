// 立式火把（CATALOG2 编号 36）：「落地铁杆+油盘+单焰」——照明类 prop/floor（metal 杆盘 + unlit 油面火苗 双族）。
// 原点=底面中心（y=0 落地），全高约 8（占地小、竖向高件）。
// 布光职责：tags 声明 lightSource/fire 即「这里有火」——不私设 PointLight（CATALOG §6 横切约定）；
// 火苗用 unlit 冷白双锥（外锥压暗+内芯微降，同 wallTorch/candleStand/brazierFire 语言）。
// 变体走 build(opts)：杆高 poleH/燃灭 lit/焰高 flameH。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 油盘轮廓（lathe profile：束腰→盘腹→外撇盘沿）
const PAN = [[0.16, 0], [0.5, 0.05], [0.9, 0.24], [1.0, 0.34]];

export default {
  id: 'torchStanding',
  place: 'prop',
  mount: 'floor',
  tags: ['metal', 'lightSource', 'fire', 'generic'],
  footprint: { x: 2.2, z: 2.2 },
  behaviors: [],
  build({ poleH = 5.5, lit = true, flameH = 1.9, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('torchStanding');
    const H = Math.min(Math.max(poleH, 4), 7.5);
    // 落地：厚重底盘双层 + 收分立杆 + 两道杆箍
    g.add(K.put(K.cyl({
      color: shade(P.iron, -0.12), r: 0.78, rTop: 0.66, h: 0.22, seg: 7, family: 'metal',
    }), 0, 0.11, 0));
    g.add(K.put(K.cyl({
      color: shade(P.iron, -0.02), r: 0.5, h: 0.1, seg: 6, family: 'metal',
    }), 0, 0.27, 0));
    const pole = K.cyl({ color: P.iron, r: 0.13, rTop: 0.09, h: H, seg: 5, family: 'metal' });
    K.jitter(pole, r, { rot: 0.006 });
    g.add(K.put(pole, 0, 0.3 + H / 2, 0));
    for (const y of [0.3 + H * 0.38, 0.3 + H * 0.72]) {
      g.add(K.put(K.cyl({
        color: shade(P.iron, 0.06), r: 0.17, h: 0.13, seg: 5, family: 'metal',
      }), 0, y, 0));
    }
    const poleTop = 0.3 + H;
    // 油盘：束腰盘体 + 沿口箍圈 + 暗油面（unlit 读作油）
    g.add(K.put(K.lathe({ color: P.iron, profile: PAN, seg: 8, family: 'metal' }), 0, poleTop, 0));
    g.add(K.put(K.cyl({
      color: shade(P.iron, 0.08), r: 1.02, rTop: 0.98, h: 0.12, seg: 8, family: 'metal',
    }), 0, poleTop + 0.3, 0));
    g.add(K.put(K.cyl({
      color: P.night, r: 0.86, h: 0.06, seg: 8, family: 'unlit',
    }), 0, poleTop + 0.27, 0));
    // 单焰：外锥压暗 + 内芯微降（冷白幽火防过曝）
    if (lit) {
      g.add(K.put(K.cone({
        color: shade(P.flameCore, -0.34), r: 0.5, h: flameH, seg: 6, family: 'unlit',
      }), 0, poleTop + 0.4 + flameH * 0.5, 0));
      g.add(K.put(K.cone({
        color: shade(P.flameCore, -0.12), r: 0.3, h: flameH * 0.62, seg: 5, family: 'unlit',
      }), 0, poleTop + 0.36 + flameH * 0.31, 0));
    }
    return g;
  },
};
