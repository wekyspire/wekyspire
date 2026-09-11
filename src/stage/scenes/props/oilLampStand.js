// 油灯立架（CATALOG2 编号 38）：「细杆悬油碗+芯焰」——prop/floor（metal+unlit 双族）。
// 原点=底面中心（y=0 落地）；双盘配重座+收分细杆+斜出吊臂+两环悬链吊油碗，全高约 6（S 档）。
// 油碗=lathe 束腰浅碗，碗面暗油盘（unlit P.night）+ 芯焰（unlit 冷白小锥）。
// 布光职责：tags 声明 lightSource/fire 即「这里有火」——不私设 PointLight（CATALOG §6）。
// 变体走 build(opts)：杆高/芯数/燃灭。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 折线铁条：连接两折点的 cyl（轴向对齐连线、中点定位）——吊臂搭建零件
function strut(p0, p1, rad, color) {
  const a = new THREE.Vector3(p0[0], p0[1], p0[2]);
  const b = new THREE.Vector3(p1[0], p1[1], p1[2]);
  const d = b.clone().sub(a);
  const m = K.cyl({ color, r: rad, h: d.length(), seg: 5, family: 'metal' });
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  m.position.copy(a).addScaledVector(d, 0.5);
  return m;
}

// 油碗轮廓（lathe profile：束腰→鼓腹→外撇碗沿），碗体高约 0.5
const BOWL = [
  [0.07, 0], [0.36, 0.07], [0.58, 0.26], [0.68, 0.44], [0.72, 0.5],
];

export default {
  id: 'oilLampStand',
  place: 'prop',
  mount: 'floor',
  tags: ['metal', 'lightSource', 'fire', 'quarters'],
  footprint: { x: 2.4, z: 2.4 },
  behaviors: [],
  build({ stemH = 4.7, wicks = 2, lit = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('oilLampStand');
    // 座：双盘配重（同 candelabraFloor 座语言）
    g.add(K.put(K.cyl({ color: shade(P.iron, -0.12), r: 0.55, h: 0.22, seg: 7, family: 'metal' }), 0, 0.11, 0));
    g.add(K.put(K.cyl({ color: P.iron, r: 0.38, rTop: 0.32, h: 0.14, seg: 7, family: 'metal' }), 0, 0.29, 0));
    // 细杆：收分高杆 + 杆顶套箍
    g.add(K.put(K.cyl({ color: P.iron, r: 0.09, rTop: 0.055, h: stemH, seg: 6, family: 'metal' }), 0, 0.33 + stemH / 2, 0));
    const topY = 0.33 + stemH;
    g.add(K.put(K.cyl({ color: shade(P.iron, 0.08), r: 0.12, h: 0.14, seg: 6, family: 'metal' }), 0, topY - 0.07, 0));
    // 斜出吊臂（自杆顶向侧上方挑出，臂端悬链）
    const tipX = 0.85, tipY = topY + 0.82;
    g.add(strut([0, topY - 0.12, 0], [tipX, tipY, 0], 0.06, P.iron));
    // 悬链：两环交替 90°（同 lanternWall 吊链语言），链下小盖帽
    const drop = 0.5, step = drop / 2;
    for (let i = 0; i < 2; i++) {
      g.add(K.put(K.tilt(K.cyl({ color: P.iron, r: 0.05, h: step + 0.16, seg: 5, family: 'metal' }), 0, i * Math.PI / 2, 0), tipX, tipY - step * (i + 0.5), 0));
    }
    g.add(K.put(K.cyl({ color: shade(P.iron, 0.08), r: 0.15, h: 0.08, seg: 6, family: 'metal' }), tipX, tipY - drop - 0.04, 0));
    // 油碗：自盖帽下悬；碗面暗油盘 + 芯焰（冷白小锥自油面立起）
    const bowlTop = tipY - drop - 0.08;
    g.add(K.put(K.lathe({ color: shade(P.iron, 0.04), profile: BOWL, seg: 7, family: 'metal' }), tipX, bowlTop - 0.5, 0));
    g.add(K.put(K.cyl({ color: P.night, r: 0.5, h: 0.05, seg: 7, family: 'unlit' }), tipX, bowlTop - 0.16, 0));
    const w = Math.max(1, Math.min(2, wicks));
    for (let i = 0; i < w; i++) {
      const wx = tipX + (i === 0 ? -0.2 : 0.22), wz = i === 0 ? 0.08 : -0.1;
      if (lit) g.add(K.put(K.cone({ color: shade(P.flameCore, -0.12), r: 0.075, h: 0.32, seg: 5, family: 'unlit' }), wx, bowlTop - 0.08, wz));
    }
    return g;
  },
};
