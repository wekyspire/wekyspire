// 壁灯笼（CATALOG #84）：「铁框提灯，罩内暖光」——wallDecor（metal+unlit+stone 蜡 三族）。
// 原点=墙面挂点（z=0 贴墙，+z 朝室内，同 wallTorch 约定）；band=mid；全高约 4。
// 结构=壁座板 + 三角托臂 + 交替链环 + 四棱锥顶铁笼（四角柱/上下框/笼底板）。
// 罩内暖光=unlit 暖白薄片两片十字交叉（任何角度可读）；笼内立烛 + 小焰（火之实证）。
// 布光职责：tags 声明 lightSource/fire——不私设 PointLight（CATALOG §6）。
// 变体走 build(opts)：吊链长/燃灭。

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
  id: 'lanternWall',
  place: 'wallDecor',
  band: 'mid',
  tags: ['metal', 'lightSource', 'fire'],
  behaviors: [],
  build({ drop = 1.3, lit = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('lanternWall');
    // 壁座板 + 斜臂 + 下撑（三角托架，吊点 (0, 3.9, 1.15)）
    g.add(K.put(K.box({ color: shade(P.iron, -0.12), size: [0.7, 0.95, 0.16], family: 'metal' }), 0, 3.55, 0.08));
    g.add(strut([0, 3.5, 0.16], [0, 3.9, 1.15], 0.09, P.iron));
    g.add(strut([0, 3.25, 0.16], [0, 3.78, 0.9], 0.06, shade(P.iron, -0.08)));
    // 吊链：交替 90° 的链环自吊点垂挂（同 chandelierChain 语言）
    const links = 3, step = drop / links;
    for (let i = 0; i < links; i++) {
      g.add(K.put(K.tilt(K.cyl({ color: P.iron, r: 0.06, h: step + 0.2, seg: 5, family: 'metal' }), 0, i * Math.PI / 2, 0), 0, 3.9 - step * (i + 0.5), 1.15));
    }
    // 灯笼体（自链底悬垂，整体微歪的悬挂感；原点=笼身中心）
    const lamp = new THREE.Group();
    K.tilt(lamp, 0, 0, 0.03 + r() * 0.04);
    g.add(K.put(lamp, 0, 3.9 - drop - 1.45, 1.15));
    const hw = 0.72; // 笼半宽
    // 笼顶：顶球钮 + 四棱锥顶（挑出笼宽）
    lamp.add(K.put(K.sphereLo({ color: shade(P.iron, 0.06), r: 0.17, seg: 0, family: 'metal' }), 0, 1.4, 0));
    lamp.add(K.put(K.cone({ color: shade(P.iron, 0.06), r: 1.0, h: 0.55, seg: 4, family: 'metal' }), 0, 0.98, 0));
    // 笼框：四角柱 + 上下框（各四根 rail）+ 笼底板
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      lamp.add(K.put(K.cyl({ color: P.iron, r: 0.075, h: 1.45, seg: 5, family: 'metal' }), sx * hw, 0, sz * hw));
    }
    for (const ry of [0.7, -0.7]) {
      for (const s of [-1, 1]) {
        lamp.add(K.put(K.box({ color: shade(P.iron, -0.06), size: [hw * 2 + 0.16, 0.12, 0.14], family: 'metal' }), 0, ry, s * hw));
        lamp.add(K.put(K.box({ color: shade(P.iron, -0.06), size: [0.14, 0.12, hw * 2 + 0.16], family: 'metal' }), s * hw, ry, 0));
      }
    }
    lamp.add(K.put(K.box({ color: shade(P.iron, -0.15), size: [hw * 2 + 0.16, 0.14, hw * 2 + 0.16], family: 'metal' }), 0, -0.78, 0));
    // 罩内暖光：unlit 暖白薄片两片十字交叉（各角度读到「罩内亮」）+ 立烛 + 小焰
    lamp.add(K.put(K.box({ color: shade(P.flameCore, -0.12), size: [1.3, 1.15, 0.06], family: 'unlit' }), 0, 0, 0));
    lamp.add(K.put(K.box({ color: shade(P.flameCore, -0.12), size: [0.06, 1.15, 1.3], family: 'unlit' }), 0, 0, 0));
    const cd = K.cyl({ color: P.wax, r: 0.16, h: 1.0, seg: 6 });
    K.tilt(cd, r() * 0.05, 0, r() * 0.05);
    lamp.add(K.put(cd, 0, -0.14, 0));
    if (lit) lamp.add(K.put(K.cone({ color: shade(P.flameCore, -0.12), r: 0.085, h: 0.32, seg: 5, family: 'unlit' }), 0, 0.52, 0));
    return g;
  },
};
