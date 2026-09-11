// 散骨（CATALOG #55）：「碎骨小堆，肋骨斜插」——floorDecal 撒印类（纯 stone 单族矮堆，总高 ≤1.5）。
// 原点=堆心投影（y=0 落地）；碎骨段（横躺短圆柱，骨色轮换）+ 散落骨节 + 细肋骨自堆心斜插。
// 变体走 build(opts)：骨段量/肋骨数/摊开度。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'boneScatter',
  place: 'floorDecal',
  tags: ['bone'],
  footprint: { x: 3, z: 2 },
  behaviors: [],
  build({ bones = 7, ribs = 3, spread = 1, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('boneScatter');
    // 碎骨段：横躺短圆柱，堆心密、外围疏（t 越大越外越短）
    for (let i = 0; i < bones; i++) {
      const t = i / Math.max(1, bones - 1);
      const bone = K.cyl({
        color: [P.bone, P.boneDark, shade(P.bone, -0.08)][i % 3],
        r: 0.075 + r() * 0.02, h: 0.5 + r() * 0.35, seg: 5,
      });
      K.tilt(bone, (r() - 0.5) * 0.2, r() * Math.PI * 2, Math.PI / 2 + (r() - 0.5) * 0.5);
      const a = r() * Math.PI * 2;
      const rad = (0.2 + r() * 0.45) * spread * (0.65 + t * 0.55);
      g.add(K.put(bone, Math.cos(a) * rad, 0.09 + t * 0.05, Math.sin(a) * rad * 0.7));
    }
    // 散落骨节：鼓包小球（断口关节），垫在堆缘
    for (let i = 0; i < 2; i++) {
      const knob = K.sphereLo({ color: shade(P.bone, -0.05), r: 0.13 + r() * 0.04, jitter: 0.2, rng: r });
      K.scaleXYZ(knob, 1, 0.75, 1);
      g.add(K.put(knob, (r() - 0.5) * 1.6 * spread, 0.1, (r() - 0.5) * 0.9));
    }
    // 肋骨斜插：细圆柱先向外倾、再随挂组转向（插向堆外侧）
    for (let i = 0; i < ribs; i++) {
      const a = (i / ribs) * Math.PI * 2 + r() * 0.7;
      const holder = new THREE.Group();
      const rib = K.cyl({ color: shade(P.bone, 0.04), r: 0.05, h: 1.15 + r() * 0.2, seg: 4 });
      K.tilt(rib, 0.6 + r() * 0.25, 0, (r() - 0.5) * 0.2);
      holder.add(rib);
      K.tilt(holder, 0, a, 0);
      g.add(K.put(holder, Math.cos(a + Math.PI) * 0.35, 0.42, Math.sin(a + Math.PI) * 0.3));
    }
    return g;
  },
};
