// 木酒桶（CATALOG #29）：「竖放铁箍桶，桶板微凸」——prop 类（wood 桶身 + metal 铁箍 双族）。
// 原点=底面中心（y=0 落地），x=宽 z=深；变体走 build(opts)：桶高/桶板凸度/箍数/出酒嘴。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'barrelWood',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'container'],
  footprint: { x: 2.3, z: 2.5 },
  behaviors: [],
  build({ h = 4.4, bulge = 1, hoops = 3, tap = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('barrelWood');
    const rEnd = 0.88, rMid = 1.08 * bulge;           // 桶板微凸：腰径外扩
    const rad = y => y <= h / 2                        // 桶壁半径（分段线性，同 profile）
      ? rEnd + (rMid - rEnd) * Math.min(1, Math.max(0, (y - 0.12) / (h / 2 - 0.12)))
      : rMid - (rMid - rEnd) * Math.min(1, Math.max(0, (y - h / 2) / (h / 2 - 0.3)));
    // 桶身：lathe 一体旋出（平收底→鼓腰→平收口，口沿微内收），seg=9 读作九块拼板
    const body = K.lathe({
      color: P.wood, seg: 9,
      profile: [[0, 0], [rEnd, 0.12], [rMid, h / 2], [rEnd, h - 0.3], [rEnd - 0.08, h]],
    });
    K.jitter(body, r, { rot: 0.015 });                 // 立桶微歪的手工感
    g.add(body);
    // 桶头：口内凹嵌的顶板（半径收小读作窝进口沿里）
    g.add(K.put(K.cyl({ color: P.woodDark, r: rEnd - 0.18, h: 0.18, seg: 9 }), 0, h - 0.2, 0));
    // 铁箍：沿桶壁等距环箍（半径贴壁 +0.05，明暗错一档读作铁件接缝）
    for (let i = 0; i < hoops; i++) {
      const y = 0.32 + (h - 0.64) * (i / Math.max(1, hoops - 1));
      g.add(K.put(K.cyl({
        color: shade(P.iron, 0.06 * (i % 2) - 0.04),
        r: rad(y) + 0.05, h: 0.32, seg: 9, family: 'metal',
      }), 0, y, 0));
    }
    // 出酒嘴：桶腰下方斜插的铁塞（朝 +z 观众侧）
    if (tap) {
      const spigot = K.cyl({ color: P.iron, r: 0.1, rTop: 0.13, h: 0.55, seg: 5, family: 'metal' });
      K.tilt(spigot, Math.PI / 2 - 0.12, 0, 0);
      g.add(K.put(spigot, 0, 0.62, rad(0.62) + 0.18));
    }
    return g;
  },
};
