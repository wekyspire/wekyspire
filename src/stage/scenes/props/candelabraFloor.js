// 落地烛台（CATALOG #38）：「高杆三枝，枝头蜡烛」——prop 类（metal+stone 蜡+unlit 焰 三族）。
// 原点=底面中心（y=0 落地）；mount 双宿主 ['floor','smallWallTop']（S 档可上断柱/矮墩顶）。
// 布光职责：tags 声明 lightSource/fire 即"这里有火"——不私设 PointLight（CATALOG §6），
// 火苗用 unlit 族冷白幽火（同 candleStand/wallTorch 语言）。变体走 build(opts)：枝数/杆高/燃灭。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'candelabraFloor',
  place: 'prop',
  mount: ['floor', 'smallWallTop'],
  tags: ['metal', 'lightSource', 'fire'],
  footprint: { x: 2, z: 2 },
  behaviors: [],
  build({ arms = 3, stemH = 6.7, lit = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('candelabraFloor');
    // 底座：双盘配重（落地件，全高约 8.5）
    g.add(K.put(K.cyl({ color: shade(P.iron, -0.12), r: 0.85, h: 0.25, seg: 7, family: 'metal' }), 0, 0.125, 0));
    g.add(K.put(K.cyl({ color: P.iron, r: 0.6, rTop: 0.5, h: 0.14, seg: 7, family: 'metal' }), 0, 0.32, 0));
    // 主杆：细收分高杆，杆身两叠垂挂烛泪
    g.add(K.put(K.cyl({ color: P.iron, r: 0.12, rTop: 0.08, h: stemH, seg: 6, family: 'metal' }), 0, 0.35 + stemH / 2, 0));
    for (const y of [2.0, 3.6]) {
      g.add(K.put(K.cyl({ color: P.wax, r: 0.17, rTop: 0.12, h: 0.18, seg: 5 }), 0, y, 0));
    }
    // 顶烛：杆顶烛杯 + 蜡烛（燃残微歪）+ 火苗
    const stemTop = 0.35 + stemH;
    g.add(K.put(K.cyl({ color: shade(P.iron, 0.08), r: 0.16, rTop: 0.23, h: 0.2, seg: 6, family: 'metal' }), 0, stemTop + 0.1, 0));
    const top = K.cyl({ color: P.wax, r: 0.14, h: 0.95, seg: 6 });
    K.tilt(top, r() * 0.05, 0, r() * 0.05);
    g.add(K.put(top, 0, stemTop + 0.675, 0));
    if (lit) g.add(K.put(K.cone({ color: shade(P.flameCore, -0.12), r: 0.08, h: 0.42, seg: 5, family: 'unlit' }), 0, stemTop + 1.36, 0));
    // 三枝：120° 环布逐枝抬高，枝头烛杯 + 蜡烛 + 火苗（高杆三枝剪影）
    for (let i = 0; i < arms; i++) {
      const a = i * (Math.PI * 2 / arms) + 0.35;
      const rootR = 0.14, tipR = 0.98, rise = 0.85;
      const armLen = Math.hypot(tipR - rootR, rise);
      const t = Math.atan2(tipR - rootR, rise); // 偏出角（自竖直）
      const arm = K.cyl({ color: P.iron, r: 0.075, h: armLen, seg: 5, family: 'metal' });
      K.tilt(arm, 0, -a, -t);
      const midR = (rootR + tipR) / 2;
      const aY = stemTop - 1.7 + (i % 3) * 0.42;
      g.add(K.put(arm, Math.cos(a) * midR, aY + rise / 2, Math.sin(a) * midR));
      const tx = Math.cos(a) * tipR, tz = Math.sin(a) * tipR, ty = aY + rise;
      g.add(K.put(K.cyl({ color: shade(P.iron, 0.08), r: 0.13, rTop: 0.19, h: 0.18, seg: 6, family: 'metal' }), tx, ty + 0.09, tz));
      const cd = K.cyl({ color: P.wax, r: 0.12, h: 0.75, seg: 6 });
      K.tilt(cd, r() * 0.07, 0, r() * 0.07);
      g.add(K.put(cd, tx, ty + 0.555, tz));
      if (lit) g.add(K.put(K.cone({ color: shade(P.flameCore, -0.12), r: 0.07, h: 0.36, seg: 5, family: 'unlit' }), tx, ty + 1.12, tz));
    }
    return g;
  },
};
