// 搅乳桶（CATALOG2 编号 79）：「高桶+直木杆+盖孔」——居室炊事 prop（wood+metal+unlit 三族）。
// 原点=底面中心（y=0 落地）；桶身沿 barrelWood 的拼板 lathe 语汇（九板拼合、腰微鼓、
// 口径收小），铁箍两道束腰；上覆桶盖（woodDark 盖板+盖缘磕缺），盖孔=unlit 夜色小圆片
// 读作穿孔；直木杆下段没入桶内、自盖孔穿出，顶端横杆读作 T 形搅柄。
// 变体走 build(opts)：桶高/箍数/杆高/盖缘磕缺。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'churnButter',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'kitchen'],
  footprint: { x: 1.9, z: 1.9 },
  behaviors: [],
  build({ h = 4.1, hoops = 2, rodH = 1.5, chipped = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('churnButter');
    // 桶身：九板拼合的高桶（腰微鼓、口径收小），微歪的手工感
    const body = K.lathe({
      color: P.wood, seg: 9, family: 'wood',
      profile: [[0, 0], [0.66, 0.1], [0.82, h / 2], [0.7, h - 0.28], [0.64, h]],
    });
    K.jitter(body, r, { rot: 0.015 });
    g.add(body);
    // 铁箍：沿桶壁两三道（明暗错一档读作铁件接缝）
    const n = Math.max(1, Math.min(3, hoops));
    for (let i = 0; i < n; i++) {
      const y = 0.32 + (h - 0.8) * (i / Math.max(1, n - 1));
      g.add(K.put(K.cyl({
        color: shade(P.iron, 0.06 * (i % 2) - 0.04),
        r: 0.78, h: 0.3, seg: 9, family: 'metal',
      }), 0, y, 0));
    }
    // 桶盖：盖板略大于口径（盖缘磕缺一角）；盖孔=夜色圆片（杆从中穿过）
    const lid = K.cyl({ color: P.woodDark, r: 0.74, h: 0.16, seg: 9, family: 'wood' });
    if (chipped) K.chip(lid, { corner: [-1, 1, 1], amount: 0.12 });
    K.jitter(lid, r, { rot: 0.02 });
    g.add(K.put(lid, 0, h + 0.08, 0));
    g.add(K.put(K.cyl({ color: P.night, r: 0.13, h: 0.05, seg: 6, family: 'unlit' }), 0, h + 0.18, 0));
    // 直木杆：自盖孔穿出（下段没入桶内），顶端横杆=T 形搅柄
    const rod = K.cyl({ color: shade(P.wood, 0.08), r: 0.095, h: rodH + 0.8, seg: 5, family: 'wood' });
    K.tilt(rod, 0.012, 0, 0.015);
    g.add(K.put(rod, 0, h + (rodH - 0.8) / 2, 0));
    const bar = K.cyl({ color: shade(P.wood, 0.14), r: 0.08, h: 0.92, seg: 5, family: 'wood' });
    K.tilt(bar, 0, 0, Math.PI / 2);
    g.add(K.put(bar, 0, h + rodH, 0));
    return g;
  },
};
