// 法杖倚架（CATALOG2 编号 62）：「三杖斜倚+环架」——奥术类 prop/floor（wood+metal+unlit 三族）。
// 原点=底面中心（y=0 落地）：双层木踏台 + 后立木柱（高约 7，顶球收头）+ 柱侧承托横档 +
// 柱身单辐条撑一枚六边形环箍（六段直杆围成，staffs 自环中穿过斜倚）。杖=木杆→铁颚箍→
// 双锥扁棱晶首（unlit 幽光青，奥术语言同 crystalLamp）；斜倚一律走 K.aim（+Y 指向自杖底
// 到倚点的方向，杖长按两点距离反推，杖头恒落在承托横档上）。变体走 build(opts)：
// 杖数 staffs（2~4）/ 环箍高度 ringY / 晶首燃否 lit。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 单杆法杖（原点=杖底、轴 +y）：木杆 → 铁颚箍 → 双锥扁棱晶首（八面体感）
function buildStaff(len, lit) {
  const gem = K.grp(
    K.put(K.cone({ color: lit ? P.glowCyan : shade(P.glowCyan, -0.46), r: 0.2, h: 0.5, seg: 4, family: 'unlit' }), 0, 0.25, 0),
    K.put(K.tilt(K.cone({ color: lit ? shade(P.glowCyan, -0.26) : shade(P.glowCyan, -0.5), r: 0.2, h: 0.5, seg: 4, family: 'unlit' }), Math.PI, 0, 0), 0, -0.25, 0),
  );
  K.scaleXYZ(gem, 1, 1, 0.55); // 压扁读作切面宝石
  return K.grp(
    K.put(K.cyl({ color: P.wood, r: 0.1, rTop: 0.08, h: len, seg: 5, family: 'wood' }), 0, len / 2, 0),
    K.put(K.cyl({ color: shade(P.iron, -0.08), r: 0.14, h: 0.3, seg: 5, family: 'metal' }), 0, len - 0.5, 0),
    K.put(gem, 0, len + 0.18, 0),
  );
}

export default {
  id: 'staffRack',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'arcane'],
  footprint: { x: 3.0, z: 3.2 },
  behaviors: [],
  build({ staffs = 3, ringY = 3.1, lit = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('staffRack');
    // 双层木踏台（后柱与杖底的承放面）
    g.add(K.put(K.box({ color: P.woodDark, size: [2.0, 0.28, 1.5], family: 'wood' }), 0, 0.14, 0));
    g.add(K.put(K.box({ color: shade(P.wood, 0.04), size: [1.7, 0.16, 1.25], family: 'wood' }), 0, 0.36, 0.02));
    // 后立柱 + 顶球收头 + 承托横档（杖头倚点）
    g.add(K.put(K.cyl({ color: P.wood, r: 0.15, rTop: 0.12, h: 6.5, seg: 6, family: 'wood' }), 0, 3.61, -0.5));
    g.add(K.put(K.sphereLo({ color: shade(P.wood, 0.1), r: 0.22, seg: 0, family: 'wood' }), 0, 6.96, -0.5));
    g.add(K.put(K.box({ color: P.woodDark, size: [0.9, 0.18, 0.32], family: 'wood' }), 0, 5.35, -0.34));
    // 六边形环箍（六段直杆）+ 单辐条：自柱身水平撑到环心，杖身自环中穿过
    const R = 0.82, cx = 0, cz = 0.12;
    for (let k = 0; k < 6; k++) {
      const a0 = (k / 6) * Math.PI * 2 + 0.26, a1 = ((k + 1) / 6) * Math.PI * 2 + 0.26;
      const p0 = new THREE.Vector3(cx + Math.cos(a0) * R, ringY, cz + Math.sin(a0) * R);
      const p1 = new THREE.Vector3(cx + Math.cos(a1) * R, ringY, cz + Math.sin(a1) * R);
      const d = p1.clone().sub(p0);
      const seg = K.cyl({ color: shade(P.wood, k % 2 ? -0.04 : 0.06), r: 0.055, h: d.length() + 0.06, seg: 4, family: 'wood' });
      K.aim(seg, d.x, d.y, d.z);
      seg.position.copy(p0).addScaledVector(d, 0.5);
      g.add(seg);
    }
    const spoke = K.cyl({ color: shade(P.iron, -0.06), r: 0.06, h: 0.62, seg: 5, family: 'metal' });
    K.aim(spoke, 0, 0, 1);
    g.add(K.put(spoke, 0, ringY, -0.5));
    // 法杖斜倚：杖底散在踏台前缘、杖头倚向承托横档（aim 定向，杖长=两点距离）
    const ns = Math.min(Math.max(staffs, 2), 4);
    const feet = [
      { bx: -0.78, bz: 0.42, tx: -0.18 },
      { bx: 0.8, bz: 0.38, tx: 0.28 },
      { bx: 0.02, bz: 0.58, tx: 0.04 },
      { bx: -0.3, bz: 0.3, tx: -0.4 },
    ];
    const topY = 5.42, topZ = -0.3, baseY = 0.44;
    for (let i = 0; i < ns; i++) {
      const f = feet[i];
      const bx = f.bx + (r() - 0.5) * 0.12, bz = f.bz + (r() - 0.5) * 0.1;
      const tx = f.tx + (r() - 0.5) * 0.1;
      const d = new THREE.Vector3(tx - bx, topY - baseY + (r() - 0.5) * 0.3, topZ - bz);
      const sp = buildStaff(d.length(), lit);
      K.aim(sp, d.x, d.y, d.z);
      g.add(K.put(sp, bx, baseY, bz));
    }
    return g;
  },
};
