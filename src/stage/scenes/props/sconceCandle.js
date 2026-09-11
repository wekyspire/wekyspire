// 壁烛台（CATALOG #73）：「单/双烛铁托，烛泪垂凝」——wallDecor（metal+stone 蜡+unlit 焰 三族）。
// 原点=墙面挂点（z=0 贴墙，+z 朝室内，同 wallTorch 约定）；band=['low','mid'] 双带。
// 铁托=斜出臂 + 端头烛杯（多烛左右摊开）；烛泪=P.wax 小 cyl 自托沿下垂挂（垂凝残迹）。
// 布光职责：tags 声明 lightSource/fire——不私设 PointLight（CATALOG §6）；烛焰=unlit
// 冷白小锥（同 candleStand 语言）。变体走 build(opts)：烛数 1~3 / 燃灭。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 折线铁条：连接两折点的 cyl（轴向对齐连线、中点定位）——托臂搭建零件
function strut(p0, p1, rad, color) {
  const a = new THREE.Vector3(p0[0], p0[1], p0[2]);
  const b = new THREE.Vector3(p1[0], p1[1], p1[2]);
  const d = b.clone().sub(a);
  const m = K.cyl({ color, r: rad, h: d.length(), seg: 5, family: 'metal' });
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  m.position.copy(a).addScaledVector(d, 0.5);
  return m;
}

export default {
  id: 'sconceCandle',
  place: 'wallDecor',
  band: ['low', 'mid'],
  tags: ['metal', 'lightSource', 'fire'],
  behaviors: [],
  build({ candles = 2, lit = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('sconceCandle');
    // 壁座板（同 wallTorch 座板语言）
    g.add(K.put(K.box({ color: shade(P.iron, -0.12), size: [0.75, 0.95, 0.16], family: 'metal' }), 0, 1.05, 0.08));
    // 铁托臂：自座板斜出，端头烛杯 + 蜡池 + 蜡烛 + 烛泪 + 烛焰
    const arms = Math.max(1, Math.min(3, candles));
    for (let i = 0; i < arms; i++) {
      const s = arms === 1 ? 0 : -1 + i * (2 / (arms - 1)); // -1..1 左右摊开
      const ex = s * 0.55, ey = 1.75, ez = 0.9;
      g.add(strut([0, 1.0, 0.16], [ex, ey, ez], 0.09, P.iron));
      g.add(K.put(K.cyl({ color: shade(P.iron, 0.08), r: 0.17, rTop: 0.27, h: 0.18, seg: 6, family: 'metal' }), ex, ey + 0.09, ez));
      g.add(K.put(K.cyl({ color: P.wax, r: 0.21, h: 0.06, seg: 6 }), ex, ey + 0.21, ez)); // 蜡池
      const cd = K.cyl({ color: P.wax, r: 0.13, h: 0.62, seg: 6 });
      K.tilt(cd, r() * 0.06, 0, r() * 0.06); // 燃残微歪
      g.add(K.put(cd, ex, ey + 0.55, ez));
      // 烛泪垂凝：两道自托沿下缘垂挂的凝蜡
      for (let d = 0; d < 2; d++) {
        const a = r() * Math.PI * 2;
        const len = 0.16 + r() * 0.18;
        g.add(K.put(K.cyl({ color: P.wax, r: 0.045, rTop: 0.03, h: len, seg: 5 }), ex + Math.cos(a) * 0.24, ey - len / 2, ez + Math.sin(a) * 0.24));
      }
      if (lit) g.add(K.put(K.cone({ color: shade(P.flameCore, -0.12), r: 0.075, h: 0.32, seg: 5, family: 'unlit' }), ex, ey + 1.02, ez));
    }
    return g;
  },
};
