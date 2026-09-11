// 落座提灯（CATALOG2 编号 37）：「铁提灯罩内亮片+提环」——prop/floor（metal+unlit+stone 蜡 三族）。
// 原点=底面中心（y=0 落地搁置）；厚底盘+四角柱+顶框+四棱锥顶+顶钮，全高约 3（S 档）。
// 罩内亮片=两片 unlit 冷白十字交叉薄片（lanternWall 先例，各角度可读）+笼内立烛小焰；
// 提环=四段铁条围成的立式吊环。布光职责：tags 声明 lightSource/fire 即「这里有火」——
// 不私设 PointLight（CATALOG §6）。变体走 build(opts)：燃灭/搁置微倾。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 折线铁条：连接两折点的 cyl（轴向对齐连线、中点定位）——提环搭建零件
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
  id: 'lanternFloor',
  place: 'prop',
  mount: 'floor',
  tags: ['metal', 'lightSource', 'fire', 'generic'],
  footprint: { x: 2, z: 2 },
  behaviors: [],
  build({ lit = true, lean = 0.05, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('lanternFloor');
    // 笼体：整体微倾的搁置感（随机方位角）
    const body = new THREE.Group();
    K.tilt(body, 0, r() * Math.PI * 2, lean * (0.6 + r() * 0.8));
    g.add(body);
    const hw = 0.55; // 笼半宽
    // 厚底盘 + 四角柱 + 顶框（两向双 rail）
    body.add(K.put(K.box({ color: shade(P.iron, -0.15), size: [1.5, 0.16, 1.5], family: 'metal' }), 0, 0.08, 0));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      body.add(K.put(K.cyl({ color: P.iron, r: 0.06, h: 1.5, seg: 5, family: 'metal' }), sx * hw, 0.91, sz * hw));
    }
    for (const s of [-1, 1]) {
      body.add(K.put(K.box({ color: shade(P.iron, -0.06), size: [hw * 2 + 0.18, 0.12, 0.14], family: 'metal' }), 0, 1.68, s * hw));
      body.add(K.put(K.box({ color: shade(P.iron, -0.06), size: [0.14, 0.12, hw * 2 + 0.18], family: 'metal' }), s * hw, 1.68, 0));
    }
    // 四棱锥顶 + 顶钮
    body.add(K.put(K.cone({ color: shade(P.iron, 0.06), r: 0.95, h: 0.55, seg: 4, family: 'metal' }), 0, 1.98, 0));
    body.add(K.put(K.sphereLo({ color: shade(P.iron, 0.06), r: 0.14, seg: 0, family: 'metal' }), 0, 2.28, 0));
    // 提环：四段铁条围成菱形吊环（立于顶钮上方）
    const cy = 2.62, rr = 0.32;
    const pts = [[rr, cy], [0, cy + rr], [-rr, cy], [0, cy - rr]];
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) % 4];
      body.add(strut([a[0], a[1], 0], [b[0], b[1], 0], 0.05, shade(P.iron, 0.04)));
    }
    // 罩内亮片：unlit 冷白十字交叉薄片（各角度读到「罩内亮」）+ 立烛 + 小焰
    body.add(K.put(K.box({ color: shade(P.flameCore, -0.12), size: [1.0, 0.95, 0.06], family: 'unlit' }), 0, 0.92, 0));
    body.add(K.put(K.box({ color: shade(P.flameCore, -0.12), size: [0.06, 0.95, 1.0], family: 'unlit' }), 0, 0.92, 0));
    const cd = K.cyl({ color: P.wax, r: 0.13, h: 0.78, seg: 6 });
    K.tilt(cd, r() * 0.05, 0, r() * 0.05);
    body.add(K.put(cd, 0, 0.55, 0));
    if (lit) body.add(K.put(K.cone({ color: shade(P.flameCore, -0.12), r: 0.07, h: 0.28, seg: 5, family: 'unlit' }), 0, 1.08, 0));
    return g;
  },
};
