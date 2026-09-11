// 微光蘑菇簇（CATALOG2 编号 94）：「冷绿幽光小伞三五成群」——撒印类 floorDecal
// （stone 茎/衬苔 + unlit 伞帽 两族）。原点=簇心投影（y=0 落地）；三五小群环布，
// 每群一大数小：伞帽=unlit P.glowCyan 压扁穹顶（自发色即「这里有光」——lightSource
// 只进 tags，不私设 PointLight），伞下暗衬盘压出帽厚，苍白细茎自 ground 微倾，
// 群脚衬暗苔斑压出群界（mossPatchFloor 的对比度范式，深色地面上读得出）。
// 总高 ≤1。变体走 build(opts)：伞数/铺开半径。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 单株蘑菇：苍白细茎 + unlit 幽光穹帽 + 伞下暗衬盘（局部原点=茎基 y=0，整体微倾）
function shroom(scale, lean, r) {
  const m = new THREE.Group();
  const stemH = 0.5 * scale;
  m.add(K.put(
    K.cyl({ color: shade(P.wax, -0.18), r: 0.075 * scale, rTop: 0.055 * scale, h: stemH, seg: 5 }),
    0, stemH / 2, 0));
  const capR = 0.36 * scale;
  // 伞下暗衬盘（帽沿下的鳃影，压出帽厚）
  m.add(K.put(
    K.cyl({ color: shade(P.glowCyan, -0.52), r: capR * 0.82, h: 0.07 * scale, seg: 6, family: 'unlit' }),
    0, stemH - 0.02, 0));
  // 幽光穹帽：低模球压扁（unlit glowCyan 冷绿幽光）
  const cap = K.sphereLo({ color: P.glowCyan, r: capR, seg: 1, jitter: 0.06, rng: r, family: 'unlit' });
  K.scaleXYZ(cap, 1, 0.62, 1);
  m.add(K.put(cap, 0, stemH + capR * 0.18, 0));
  K.tilt(m, lean * 0.28, r() * Math.PI * 2, 0);
  return m;
}

export default {
  id: 'mushroomsGlow',
  place: 'floorDecal',
  tags: ['herb', 'lightSource', 'nature'],
  footprint: { x: 2.5, z: 2.5 },
  behaviors: [],
  build({ caps = 7, spread = 1, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('mushroomsGlow');
    const total = Math.min(Math.max(caps, 4), 9);
    const clusters = total >= 8 ? 4 : 3;
    // 群心环布（三五成群）
    const centers = [];
    for (let i = 0; i < clusters; i++) {
      const a = (i / clusters) * Math.PI * 2 + 0.5 + r() * 0.4;
      const q = (0.45 + r() * 0.35) * spread;
      centers.push([Math.cos(a) * q, Math.sin(a) * q * 0.85]);
    }
    // 每群：暗苔衬斑 + 一大数小（大株居中、小株环侍）
    let left = total;
    for (const [cx, cz] of centers) {
      const pad = K.sphereLo({ color: P.mossDark, r: 0.5, seg: 1, jitter: 0.2, rng: r });
      K.scaleXYZ(pad, 1.15, 0.13, 0.95);
      K.tilt(pad, 0, r() * Math.PI, 0);
      g.add(K.put(pad, cx, 0.07, cz));
      if (left <= 0) continue;
      g.add(K.put(
        shroom(0.95 + r() * 0.2, (r() - 0.5) * 0.8, r),
        cx + (r() - 0.5) * 0.16, 0, cz + (r() - 0.5) * 0.16));
      left--;
      const smalls = Math.min(left, 1 + Math.floor(r() * 2));
      for (let k = 0; k < smalls; k++) {
        const aa = r() * Math.PI * 2, rr = 0.22 + r() * 0.3;
        g.add(K.put(
          shroom(0.45 + r() * 0.25, r() - 0.5, r),
          cx + Math.cos(aa) * rr, 0, cz + Math.sin(aa) * rr * 0.9));
        left--;
      }
    }
    return g;
  },
};
