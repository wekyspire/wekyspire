// 武器架（CATALOG #41）：「倚靠剑斧的木架，兵器交错」——prop 类（木架 stone + 兵刃 metal 双族）。
// 原点=底面中心（y=0 落地），x=宽 z=深；门框式立架 + 前伸脚木，兵器底抵前脚、身倚中横档，
// 相邻反向倾搭读作「交错」。兵器为剪影级 lowpoly（几段 box/cyl/prism 组合，不做雕刻）。
// 变体走 build(opts)：剑数/斧数/倚靠角。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 直刃长剑（剪影级）：提亮剑刃 + 铁横格 + 缠柄 + 圆首，原点=剑根（y=0 立式），全长约 4.5
function buildSword() {
  return K.grp(
    K.put(K.sphereLo({ color: shade(P.iron, -0.12), r: 0.15, seg: 0, family: 'metal' }), 0, 0.15, 0),
    K.put(K.cyl({ color: P.woodDark, r: 0.1, h: 0.74, seg: 5 }), 0, 0.64, 0),
    K.put(K.box({ color: P.iron, size: [0.7, 0.15, 0.2], family: 'metal' }), 0, 1.06, 0),
    K.put(K.box({ color: shade(P.iron, 0.3), size: [0.18, 3.0, 0.07], family: 'metal' }), 0, 2.63, 0),
    K.put(K.scaleXYZ(K.cone({ color: shade(P.iron, 0.3), r: 0.09, h: 0.42, seg: 4, family: 'metal' }), 1, 1, 0.4), 0, 4.33, 0),
  );
}

// 长柄战斧（剪影级）：木柄 + 铁颅 + 楔形刃外伸（prism 三角剖面转向 +x），全长约 3.2
function buildAxe() {
  const blade = K.prism({ color: shade(P.iron, 0.18), size: [0.72, 0.6, 0.1], family: 'metal' });
  K.tilt(blade, 0, 0, -Math.PI / 2); // 三角剖面尖角转向 +x，读作外伸斧刃
  return K.grp(
    K.put(K.cyl({ color: P.woodDark, r: 0.11, h: 3.2, seg: 5 }), 0, 1.6, 0),
    K.put(K.box({ color: P.iron, size: [0.42, 0.56, 0.24], family: 'metal' }), 0.08, 2.86, 0),
    K.put(blade, 0.52, 2.86, 0),
  );
}

export default {
  id: 'weaponRack',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'metal'],
  footprint: { x: 4, z: 2 },
  behaviors: [],
  build({ swords = 2, axes = 1, lean = 0.26, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('weaponRack');
    // 门框式木架：两立柱微外撇 + 三道横档（兵器倚中横档）
    for (const s of [-1, 1]) {
      const post = K.box({ color: P.woodDark, size: [0.34, 6.8, 0.34] });
      g.add(K.put(K.tilt(post, 0, 0, s * 0.015), s * 1.72, 3.4, 0));
    }
    for (const y of [1.1, 3.0, 4.9]) {
      g.add(K.put(K.box({ color: P.wood, size: [3.6, 0.3, 0.22] }), 0, y, 0));
    }
    // 前伸脚木：柱根向 +z 伸出，兵器底端抵脚
    for (const s of [-1, 1]) {
      g.add(K.put(K.box({ color: P.woodDark, size: [0.55, 0.3, 1.9] }), s * 1.6, 0.15, 0.5));
    }
    // 兵器：底抵前脚、身倚中横档（rx 后仰），相邻反向倾搭（rz 交错，剑长斧短高低错落）
    const weapons = [];
    for (let i = 0; i < swords; i++) weapons.push(buildSword());
    for (let i = 0; i < axes; i++) weapons.push(buildAxe());
    const n = weapons.length;
    weapons.forEach((w, i) => {
      const x = n === 1 ? 0 : -0.85 + i * (1.7 / (n - 1));
      K.tilt(w, -(lean + r() * 0.04), 0, (i % 2 ? 1 : -1) * (0.15 + r() * 0.06));
      g.add(K.put(w, x, 0, 0.9));
    });
    return g;
  },
};
