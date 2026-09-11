// 集水桶（CATALOG2 编号 78）：「半满桶+搭木瓢」——炊事集水件 prop（stone 木色桶身+木瓢 + metal 铁箍 + glass 水面 三族，
// 桶身旋法沿用 barrelWood：木色走默认 stone 族低粗糙哑面）。
// 原点=底面中心（y=0 落地）；桶身沿用 barrelWood 旋法（竖放鼓腰板桶，高约 3.5、口径约 1.6，无出酒嘴）；
// 半满=口沿内嵌 P.water 玻璃水面片（puddleWater 主洼语汇：水面亮一档、窝在口沿之下），水面下垫压暗
// 木色暗盘托深读法；桶壁两道溢流湿痕（贴壁细流）。木瓢=半球壳（sphereLo 球心落口沿平面=半嵌）+
// 外伸木柄斜搭口沿。变体走 build(opts)：桶高 h/箍数 hoops/木瓢有无 ladle。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'barrelRainwater',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'kitchen'],
  footprint: { x: 2.6, z: 2.4 },
  behaviors: [],
  build({ h = 3.5, hoops = 3, ladle = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('barrelRainwater');
    const rEnd = 0.8, rMid = 0.96;                      // 口径 / 鼓腰径
    const rad = y => y <= h / 2                          // 桶壁半径（贴箍用，同 profile 分段）
      ? rEnd + (rMid - rEnd) * Math.min(1, Math.max(0, (y - 0.1) / (h / 2 - 0.1)))
      : rMid - (rMid - rEnd) * Math.min(1, Math.max(0, (y - h / 2) / (h / 2 - 0.28)));
    // 桶身：lathe 一体旋出（平收底→鼓腰→口沿微内收），seg=9 读作九块拼板
    const body = K.lathe({
      color: P.wood, seg: 9,
      profile: [[0, 0], [rEnd, 0.1], [rMid, h / 2], [rEnd, h - 0.28], [rEnd - 0.07, h]],
    });
    K.jitter(body, r, { rot: 0.015 });
    g.add(body);
    // 口沿唇圈 + 水下暗盘（托深读法）+ 半满水面：P.water 玻璃片窝在口沿之下
    g.add(K.put(K.cyl({ color: P.woodDark, r: rEnd - 0.02, h: 0.1, seg: 9 }), 0, h - 0.08, 0));
    g.add(K.put(K.cyl({ color: shade(P.woodDark, -0.3), r: rEnd - 0.1, h: 0.12, seg: 9 }), 0, h - 0.36, 0));
    g.add(K.put(K.cyl({
      color: shade(P.water, 0.16), r: rEnd - 0.14, h: 0.14, seg: 9, family: 'glass',
    }), 0, h - 0.24, 0));
    // 铁箍：沿桶壁等距贴身环箍（半径贴壁 +0.05，明暗错一档）
    for (let i = 0; i < hoops; i++) {
      const y = 0.3 + (h - 0.6) * (i / Math.max(1, hoops - 1));
      g.add(K.put(K.cyl({
        color: shade(P.iron, 0.06 * (i % 2) - 0.04),
        r: rad(y) + 0.05, h: 0.3, seg: 9, family: 'metal',
      }), 0, y, 0));
    }
    // 溢流湿痕：口沿下两道贴壁细流（压暗水色，集雨溢出的读法）
    for (const [dx, dz, len] of [[0.8, 0.45, 1.1], [-0.58, -0.68, 0.8]]) {
      g.add(K.put(K.cyl({
        color: shade(P.water, -0.25), r: 0.05, h: len, seg: 4, family: 'glass',
      }), dx, h - 0.5 - len / 2, dz));
    }
    // 木瓢：半球壳（球心落在口沿平面 = 半嵌）+ 外伸木柄斜搭口沿
    if (ladle) {
      const bowl = K.sphereLo({
        color: shade(P.wood, 0.06), r: 0.34, seg: 1, jitter: 0.05, rng: r,
      });
      K.scaleXYZ(bowl, 1, 0.82, 1);
      g.add(K.put(bowl, 0.24, h - 0.02, 0.16));
      const handle = K.box({ color: shade(P.wood, 0.12), size: [1.15, 0.09, 0.13] });
      K.tilt(handle, 0, 0.1, -0.22);
      g.add(K.put(handle, 0.98, h + 0.12, 0.1));
    }
    return g;
  },
};
