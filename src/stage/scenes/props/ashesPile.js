// 灰烬堆（CATALOG2 编号 98）：「灰白小堆+焦木残段」——floorDecal 矮堆（纯 stone 单族，总高 ≤1.5）。
// 原点=堆心投影（y=0 落地）；灰白冷灰走 shade(P.ember, 提亮)——批3 对比度红线：深色地面上
// 灰堆必须读得出。三层压扁 jitter 球（暗灰裙脚→主丘→亮灰丘顶）叠出松散灰堆（rubblePile
// 堆语汇）；焦木残段=深色断头短柱 aim 斜插半埋（rTop 收尖=烧断茬，首根平躺灰裙上），
// 暗色结渣与最亮浮灰块点缀表面。变体走 build(opts)：堆量 pile/焦木段数 sticks/摊开度 spread。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'ashesPile',
  place: 'floorDecal',
  tags: ['generic'],
  footprint: { x: 2.5, z: 2.5 },
  behaviors: [],
  build({ pile = 1, sticks = 3, spread = 1, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('ashesPile');
    const s = Math.min(Math.max(pile, 0.7), 1.3) * spread;
    // 灰堆三层：暗灰裙脚（铺得开）→ 主丘 → 亮灰丘顶（浮灰最亮）
    const skirt = K.sphereLo({ color: shade(P.ember, -0.14), r: 1.12 * s, seg: 1, jitter: 0.16, rng: r });
    K.scaleXYZ(skirt, 1.12, 0.2, 0.94);
    g.add(K.put(skirt, 0, 0.21 * s, 0));
    const mound = K.sphereLo({ color: shade(P.ember, 0.12), r: 0.86 * s, seg: 1, jitter: 0.18, rng: r });
    K.scaleXYZ(mound, 1.06, 0.44, 0.88);
    K.tilt(mound, 0, r() * Math.PI, 0);
    g.add(K.put(mound, (r() - 0.5) * 0.15, 0.42 * s, (r() - 0.5) * 0.12));
    const top = K.sphereLo({ color: shade(P.ember, 0.26), r: 0.46 * s, seg: 0, jitter: 0.2, rng: r });
    K.scaleXYZ(top, 1, 0.5, 0.9);
    g.add(K.put(top, (r() - 0.5) * 0.3, 0.7 * s, (r() - 0.5) * 0.25));
    // 焦木残段：深色断头短柱 aim 斜插灰堆（rTop 收尖=烧断茬），首根平躺灰裙上
    const sn = Math.max(1, Math.min(5, sticks));
    for (let i = 0; i < sn; i++) {
      const a = (i / sn) * Math.PI * 2 + r() * 0.9;
      const len = 0.75 + r() * 0.4;
      const stick = K.cyl({
        color: [shade(P.woodDark, -0.32), shade(P.night, 0.1)][i % 2],
        r: 0.1 + r() * 0.035, rTop: 0.05, h: len, seg: 5,
      });
      const lying = i === 0;
      K.aim(stick, Math.cos(a) * 0.95, lying ? 0.04 : 0.4 + r() * 0.2, Math.sin(a) * 0.95);
      const rad = (lying ? 1.0 : 0.55 + r() * 0.25) * s;
      g.add(K.put(stick, Math.cos(a) * rad, lying ? 0.12 : 0.42 * s, Math.sin(a) * rad * 0.8));
    }
    // 表面点缀：暗色结渣（压进灰面）+ 最亮浮灰碎块
    for (let i = 0; i < 3; i++) {
      const a = r() * Math.PI * 2;
      const clink = K.sphereLo({
        color: i === 2 ? shade(P.ember, 0.34) : shade(P.night, 0.16),
        r: 0.12 + r() * 0.06, seg: 0, jitter: 0.24, rng: r,
      });
      g.add(K.put(clink, Math.cos(a) * 0.5 * s, 0.5 * s + r() * 0.3 * s, Math.sin(a) * 0.42 * s));
    }
    return g;
  },
};
