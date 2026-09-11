// 桌面五枝烛台（CATALOG2 编号 43）：「矮座展枝五烛」——prop 类（metal 铁架 + stone 蜡 + unlit 焰 三族）。
// 原点=底面中心（y=0 落地）；mount 双宿主 ['floor','smallWallTop']（S 档常上桌沿/断柱顶）。
// 布光职责：tags 声明 lightSource/fire 即"这里有火"——不私设 PointLight（CATALOG §6），
// 烛焰用 unlit 族冷白小锥（同 candleStand/candelabraFloor 语言）。
// 变体走 build(opts)：枝数 arms（中烛外的环枝数）/杆高 stemH /燃灭 lit。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'candelabraTable',
  place: 'prop',
  mount: ['floor', 'smallWallTop'],
  tags: ['metal', 'lightSource', 'fire', 'quarters'],
  footprint: { x: 3, z: 3 },
  behaviors: [],
  build({ arms = 4, stemH = 0.9, lit = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('candelabraTable');
    // 矮座：双层宽底盘压重心 + 座面蜡池（矮座展枝剪影，全高约 2.3）
    g.add(K.put(K.cyl({ color: shade(P.iron, -0.12), r: 0.78, rTop: 0.66, h: 0.2, seg: 8, family: 'metal' }), 0, 0.1, 0));
    g.add(K.put(K.cyl({ color: P.iron, r: 0.58, rTop: 0.5, h: 0.1, seg: 8, family: 'metal' }), 0, 0.25, 0));
    g.add(K.put(K.cyl({ color: P.wax, r: 0.46, rTop: 0.4, h: 0.07, seg: 7 }), 0, 0.335, 0));
    // 短主杆：杆身一叠烛泪垂挂
    g.add(K.put(K.cyl({ color: P.iron, r: 0.1, rTop: 0.07, h: stemH, seg: 6, family: 'metal' }), 0, 0.33 + stemH / 2, 0));
    g.add(K.put(K.cyl({ color: P.wax, r: 0.14, rTop: 0.1, h: 0.14, seg: 5 }), 0, 0.74, 0));
    const stemTop = 0.33 + stemH;
    // 展枝：环布斜出（同 candelabraFloor 环枝语言），枝头烛杯+蜡烛+焰
    const n = Math.max(0, Math.min(6, arms));
    for (let i = 0; i < n; i++) {
      const a = i * (Math.PI * 2 / n) + 0.4;
      const rootR = 0.13, tipR = 1.02, rise = 0.5;
      const armLen = Math.hypot(tipR - rootR, rise);
      const t = Math.atan2(tipR - rootR, rise);
      const arm = K.cyl({ color: P.iron, r: 0.065, h: armLen, seg: 5, family: 'metal' });
      K.tilt(arm, 0, -a, -t);
      const midR = (rootR + tipR) / 2;
      const aY = stemTop - 0.34;
      g.add(K.put(arm, Math.cos(a) * midR, aY + rise / 2, Math.sin(a) * midR));
      const tx = Math.cos(a) * tipR, tz = Math.sin(a) * tipR, ty = aY + rise;
      g.add(K.put(K.cyl({ color: shade(P.iron, 0.08), r: 0.11, rTop: 0.16, h: 0.14, seg: 6, family: 'metal' }), tx, ty + 0.07, tz));
      const cd = K.cyl({ color: P.wax, r: 0.1, h: 0.52, seg: 6 });
      K.tilt(cd, r() * 0.07, 0, r() * 0.07); // 燃残微歪
      g.add(K.put(cd, tx, ty + 0.4, tz));
      if (lit) g.add(K.put(K.cone({ color: shade(P.flameCore, -0.12), r: 0.06, h: 0.24, seg: 5, family: 'unlit' }), tx, ty + 0.76, tz));
    }
    // 中烛：杆顶烛杯 + 蜡烛（燃残微歪）+ 焰（第五烛）
    g.add(K.put(K.cyl({ color: shade(P.iron, 0.08), r: 0.13, rTop: 0.19, h: 0.18, seg: 6, family: 'metal' }), 0, stemTop + 0.09, 0));
    const mid = K.cyl({ color: P.wax, r: 0.11, h: 0.62, seg: 6 });
    K.tilt(mid, r() * 0.05, 0, r() * 0.05);
    g.add(K.put(mid, 0, stemTop + 0.49, 0));
    if (lit) g.add(K.put(K.cone({ color: shade(P.flameCore, -0.12), r: 0.07, h: 0.28, seg: 5, family: 'unlit' }), 0, stemTop + 0.94, 0));
    return g;
  },
};
