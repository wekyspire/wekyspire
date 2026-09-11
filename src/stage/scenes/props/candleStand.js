// 烛台立架（CATALOG #37）：「多枝立式烛台，烛泪堆叠」——prop 类（metal+stone 蜡+unlit 焰 三族）。
// 原点=底面中心（y=0 落地）；mount 双宿主 ['floor','smallWallTop']（S 档常上柱顶/基座顶）。
// 布光职责：tags 声明 lightSource/fire 即"这里有火"——不私设 PointLight（CATALOG §6），
// 火苗用 unlit 族冷白幽火（同 wallTorch 语言）。变体走 build(opts)：枝数/杆高/燃灭。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'candleStand',
  place: 'prop',
  mount: ['floor', 'smallWallTop'],
  tags: ['metal', 'lightSource', 'fire'],
  footprint: { x: 1.8, z: 1.8 },
  behaviors: [],
  build({ arms = 2, stemH = 1.5, lit = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('candleStand');
    // 立架：底盘 + 承烛托盘 + 收分主杆
    g.add(K.put(K.cyl({ color: shade(P.iron, -0.12), r: 0.62, rTop: 0.5, h: 0.2, seg: 7, family: 'metal' }), 0, 0.1, 0));
    g.add(K.put(K.cyl({ color: P.iron, r: 0.8, rTop: 0.72, h: 0.08, seg: 7, family: 'metal' }), 0, 0.24, 0));
    g.add(K.put(K.cyl({ color: P.stone, r: 0.6, rTop: 0.52, h: 0.1, seg: 6 }), 0, 0.33, 0)); // 托盘蜡池
    g.add(K.put(K.cyl({ color: P.iron, r: 0.09, rTop: 0.07, h: stemH, seg: 5, family: 'metal' }), 0, 0.28 + stemH / 2, 0));
    // 烛泪堆叠：杆身两叠蜡泪垂挂
    for (const y of [0.55, 0.95]) {
      g.add(K.put(K.cyl({ color: P.wax, r: 0.15, rTop: 0.1, h: 0.16, seg: 5 }), 0, y, 0));
    }
    // 中烛：烛杯 + 蜡烛（燃残微歪）+ 火苗
    const stemTop = 0.28 + stemH;
    g.add(K.put(K.cyl({ color: shade(P.iron, 0.08), r: 0.14, rTop: 0.2, h: 0.2, seg: 6, family: 'metal' }), 0, stemTop + 0.1, 0));
    const mid = K.cyl({ color: P.wax, r: 0.12, h: 0.65, seg: 6 });
    K.tilt(mid, r() * 0.06, 0, r() * 0.06);
    g.add(K.put(mid, 0, stemTop + 0.525, 0));
    if (lit) g.add(K.put(K.cone({ color: shade(P.flameCore, -0.12), r: 0.07, h: 0.3, seg: 5, family: 'unlit' }), 0, stemTop + 1.0, 0));
    // 侧枝：左右斜出（第 3/4 枝逐层抬高），枝头烛杯 + 蜡烛 + 火苗
    for (let i = 0; i < arms; i++) {
      const s = i % 2 === 0 ? 1 : -1;
      const aY = stemTop - 0.6 + Math.floor(i / 2) * 0.5;
      const t = 0.78 + r() * 0.12;        // 斜出角（弧度）
      const ax = 0.16 + r() * 0.05;       // 枝根横距
      const arm = K.cyl({ color: P.iron, r: 0.06, h: 0.62, seg: 5, family: 'metal' });
      K.tilt(arm, 0, 0, -s * t);
      g.add(K.put(arm, s * ax, aY, 0));
      const tipX = s * (ax + Math.sin(t) * 0.31);
      const tipY = aY + Math.cos(t) * 0.31;
      g.add(K.put(K.cyl({ color: shade(P.iron, 0.08), r: 0.1, rTop: 0.15, h: 0.16, seg: 6, family: 'metal' }), tipX, tipY + 0.08, 0));
      const cd = K.cyl({ color: P.wax, r: 0.09, h: 0.5, seg: 6 });
      K.tilt(cd, r() * 0.08, 0, r() * 0.08);
      g.add(K.put(cd, tipX, tipY + 0.41, 0));
      if (lit) g.add(K.put(K.cone({ color: shade(P.flameCore, -0.12), r: 0.06, h: 0.26, seg: 5, family: 'unlit' }), tipX, tipY + 0.79, 0));
    }
    return g;
  },
};
