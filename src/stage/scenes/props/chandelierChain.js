// 吊灯（CATALOG #39）：「链挂多枝环烛台，微斜」——纯 ceiling 顶挂件（metal+stone 蜡+unlit 焰 三族）。
// 原点=天花板锚点：锚座顶面即 y=0，链与灯体自锚点垂挂向下（bbox.max.y≈0、身体在负 y）。
// 布光职责：tags 声明 lightSource/fire 即"这里有火"——不私设 PointLight（CATALOG §6），
// 火苗用 unlit 族冷白幽火（同 candleStand/wallTorch 语言）。变体走 build(opts)：链长/枝数/环径/歪斜。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'chandelierChain',
  place: 'prop',
  mount: 'ceiling',
  tags: ['metal', 'lightSource', 'fire'],
  footprint: { x: 7, z: 7 },
  behaviors: [],
  build({ chainLen = 12.5, arms = 6, ringR = 3, lean = 0.09, lit = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('chandelierChain');
    // 天花板锚座（顶面贴原点 y=0）
    g.add(K.put(K.cyl({ color: shade(P.iron, -0.12), r: 0.55, rTop: 0.4, h: 0.55, seg: 7, family: 'metal' }), 0, -0.28, 0));
    // 吊链：交替 90° 的链环自锚座底垂挂（环长含搭接，首环藏进锚座）
    const links = 7;
    const step = (chainLen - 0.5) / links;
    for (let i = 0; i < links; i++) {
      const link = K.cyl({ color: P.iron, r: 0.13, h: step + 0.25, seg: 5, family: 'metal' });
      K.tilt(link, 0, i * Math.PI / 2, 0);
      g.add(K.put(link, 0, -0.5 - step * (i + 0.5), 0));
    }
    // 灯体：挂点建子组再整体微斜（链保持竖直，灯体绕挂点歪出 lean）
    const lamp = new THREE.Group();
    K.tilt(lamp, 0, 0, lean);
    g.add(K.put(lamp, 0, -chainLen, 0));
    // 中毂 + 环枝：六枝自毂外扬至环位，枝头烛杯 + 蜡烛 + 火苗（环烛台剪影）
    lamp.add(K.put(K.cyl({ color: shade(P.iron, 0.06), r: 0.42, rTop: 0.34, h: 0.6, seg: 6, family: 'metal' }), 0, -0.3, 0));
    for (let i = 0; i < arms; i++) {
      const a = i * (Math.PI * 2 / arms) + 0.3;
      const rootR = 0.3, rise = 0.9;
      const armLen = Math.hypot(ringR - rootR, rise);
      const t = Math.atan2(ringR - rootR, rise); // 外扬角（自竖直）
      const arm = K.cyl({ color: P.iron, r: 0.07, h: armLen, seg: 5, family: 'metal' });
      K.tilt(arm, 0, -a, -t);
      const midR = (rootR + ringR) / 2;
      lamp.add(K.put(arm, Math.cos(a) * midR, -0.5 + rise / 2, Math.sin(a) * midR));
      const tx = Math.cos(a) * ringR, tz = Math.sin(a) * ringR, ty = -0.5 + rise;
      lamp.add(K.put(K.cyl({ color: shade(P.iron, 0.08), r: 0.14, rTop: 0.21, h: 0.18, seg: 6, family: 'metal' }), tx, ty + 0.09, tz));
      const cd = K.cyl({ color: P.wax, r: 0.12, h: 0.8, seg: 6 });
      K.tilt(cd, r() * 0.06, 0, r() * 0.06);
      lamp.add(K.put(cd, tx, ty + 0.56, tz));
      if (lit) lamp.add(K.put(K.cone({ color: shade(P.flameCore, -0.12), r: 0.08, h: 0.4, seg: 5, family: 'unlit' }), tx, ty + 1.16, tz));
    }
    return g;
  },
};
