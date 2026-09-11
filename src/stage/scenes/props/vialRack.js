// 试管架（CATALOG2 编号 33）：「双排小管+一瓶歪倒」——容器类 prop/floor（wood 架 + glass 管瓶 双族）。
// 原点=底面中心（y=0 落地）；底板+双夹板+两道托条读作阶梯试管架，双排小管 glass 族
// 三色（P.potionGreen/Red/Blue）轮换深浅；另有一管带木塞歪倒架前。
// 变体走 build(opts)：管数 tubes（4~8，双排各四）/歪倒 fallen 有无。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

const COLORS = ['potionGreen', 'potionRed', 'potionBlue'];

export default {
  id: 'vialRack',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'glass', 'arcane'],
  footprint: { x: 1.9, z: 1.6 },
  behaviors: [],
  build({ tubes = 8, fallen = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('vialRack');
    const w = 1.7;
    // 底板 + 两侧夹板 + 双排托条（管自条孔穿出读作架）
    g.add(K.put(K.box({ color: P.wood, size: [w, 0.16, 1.0], family: 'wood' }), 0, 0.08, 0));
    for (const s of [-1, 1]) {
      g.add(K.put(K.box({ color: P.woodDark, size: [0.12, 0.56, 1.0], family: 'wood' }), s * (w / 2 - 0.06), 0.44, 0));
    }
    for (const sz of [-1, 1]) {
      g.add(K.put(K.box({ color: P.woodDark, size: [w - 0.2, 0.1, 0.2], family: 'wood' }), 0, 0.46, sz * 0.24));
    }
    // 双排小管：两排各至多四支，三色轮换深浅各异，rng 微歪微挪
    const xs = [-0.58, -0.2, 0.2, 0.58];
    const n = Math.min(Math.max(tubes, 4), 8);
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / 4), k = i % 4;
      const c = COLORS[i % 3];
      const tube = K.cyl({
        color: [P[c], shade(P[c], 0.12), shade(P[c], -0.1)][(i + 1) % 3],
        r: 0.085, rTop: 0.075, h: 0.6, seg: 5, family: 'glass',
      });
      K.tilt(tube, (r() - 0.5) * 0.1, 0, (r() - 0.5) * 0.1);
      g.add(K.put(tube, xs[k] + (r() - 0.5) * 0.08, 0.46, (row - 0.5) * 0.48 + (r() - 0.5) * 0.06));
    }
    // 一瓶歪倒：横卧架前 + 管口木塞
    if (fallen) {
      const c = COLORS[n % 3];
      const lie = K.cyl({ color: shade(P[c], 0.08), r: 0.105, h: 0.62, seg: 5, family: 'glass' });
      K.tilt(lie, 0, 0, Math.PI / 2 - 0.05);
      g.add(K.put(lie, 0.1, 0.11, 0.82));
      const cork = K.cyl({ color: P.woodDark, r: 0.06, h: 0.12, seg: 5, family: 'wood' });
      K.tilt(cork, 0, 0, Math.PI / 2 - 0.05);
      g.add(K.put(cork, 0.47, 0.11, 0.82));
    }
    return g;
  },
};
