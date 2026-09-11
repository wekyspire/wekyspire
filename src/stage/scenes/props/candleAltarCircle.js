// 祭坛烛阵（CATALOG2 编号 39）：「一圈矮烛+中央高烛」——prop/floor（stone 蜡+unlit 焰 双族）。
// 原点=阵心（y=0 落地）；环烛坐小石托（一圈矮烛，高矮错落、燃残微歪），中央高烛坐
// 双层烛盘+盘沿垂凝烛泪，圈径约 4（M 档）。布光职责：tags 声明 lightSource/fire 即
// 「这里有火」——不私设 PointLight（CATALOG §6）；烛焰=unlit 冷白小锥（同 candleStand 语言）。
// 变体走 build(opts)：环烛数/圈径/中央烛高/燃灭。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'candleAltarCircle',
  place: 'prop',
  mount: 'floor',
  tags: ['wax', 'lightSource', 'fire', 'chapel'],
  footprint: { x: 4.5, z: 4.5 },
  behaviors: [],
  build({ candles = 6, ringR = 1.9, centerH = 1.6, lit = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('candleAltarCircle');
    // 环烛：小石托 + 蜡池 + 矮烛（高矮错落）+ 烛焰
    const n = Math.max(4, Math.min(8, candles));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.12;
      const cx = Math.cos(a) * ringR, cz = Math.sin(a) * ringR;
      const tile = K.box({ color: shade(P.stone, 0.1), size: [0.5, 0.09, 0.5] });
      K.tilt(tile, 0, a + r() * 0.2, 0);
      g.add(K.put(tile, cx, 0.045, cz));
      g.add(K.put(K.cyl({ color: P.wax, r: 0.2, rTop: 0.24, h: 0.06, seg: 6 }), cx, 0.12, cz)); // 蜡池
      const h = 0.4 + r() * 0.34;
      const cd = K.cyl({ color: P.wax, r: 0.12, h, seg: 6 });
      K.tilt(cd, r() * 0.07, 0, r() * 0.07); // 燃残微歪
      g.add(K.put(cd, cx, 0.15 + h / 2, cz));
      if (lit) g.add(K.put(K.cone({ color: shade(P.flameCore, -0.12), r: 0.065, h: 0.26, seg: 5, family: 'unlit' }), cx, 0.15 + h + 0.12, cz));
    }
    // 中央高烛：双层烛盘 + 蜡池 + 高烛 + 盘沿垂凝烛泪 + 烛焰
    g.add(K.put(K.cyl({ color: shade(P.stone, 0.16), r: 0.62, rTop: 0.55, h: 0.14, seg: 8 }), 0, 0.07, 0));
    g.add(K.put(K.cyl({ color: shade(P.stone, 0.24), r: 0.48, h: 0.1, seg: 7 }), 0, 0.19, 0));
    g.add(K.put(K.cyl({ color: P.wax, r: 0.34, rTop: 0.4, h: 0.08, seg: 7 }), 0, 0.28, 0)); // 蜡池
    const cc = K.cyl({ color: P.wax, r: 0.16, h: centerH, seg: 6 });
    K.tilt(cc, r() * 0.05, 0, r() * 0.05);
    g.add(K.put(cc, 0, 0.32 + centerH / 2, 0));
    for (let d = 0; d < 2; d++) { // 盘沿垂凝
      const a = r() * Math.PI * 2;
      g.add(K.put(K.cyl({ color: P.wax, r: 0.05, rTop: 0.035, h: 0.2, seg: 5 }), Math.cos(a) * 0.45, 0.18, Math.sin(a) * 0.45));
    }
    if (lit) g.add(K.put(K.cone({ color: shade(P.flameCore, -0.12), r: 0.1, h: 0.44, seg: 5, family: 'unlit' }), 0, 0.32 + centerH + 0.2, 0));
    return g;
  },
};
