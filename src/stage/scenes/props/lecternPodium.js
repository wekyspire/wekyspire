// 讲经台（CATALOG2 #12）：「斜面经书+侧链坠」——圣所小件 prop（wood 台身 + cloth 纸页 + metal 链坠 三族）。
// 原点=底面中心（y=0 落地），总高约 4.8：座墩 + 六棱收分柱 + 斜面书台（带挡书唇与台底衬），
// 台上翻开双页经书（P.parchment，双页微外张 V 形），台侧垂小链坠（cyl 链段交替 90°，
// chandelierChain 的链环手法）链尾倒锥坠。变体走 build(opts)：链段数 links / 斜面倾角 slant。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'lecternPodium',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'chapel'],
  footprint: { x: 2.1, z: 1.9 },
  behaviors: [],
  build({ links = 4, slant = 0.42, rng } = {}) {
    const g = new THREE.Group();
    // 座墩 + 六棱收分柱
    g.add(K.put(K.box({ color: P.woodDark, size: [1.9, 0.45, 1.7], family: 'wood' }), 0, 0.225, 0));
    const stem = K.cyl({ color: P.wood, r: 0.6, rTop: 0.45, h: 3.2, seg: 6, family: 'wood' });
    if (rng) K.jitter(stem, rng, { rot: 0.01 });
    g.add(K.put(stem, 0, 2.05, 0));
    // 台底衬（衔接柱与斜面）+ 斜面书台 + 挡书唇（正 slant 使 +z 前缘落低）
    g.add(K.put(K.box({ color: P.woodDark, size: [0.9, 0.9, 0.55], family: 'wood' }), 0, 3.75, -0.2));
    const deskY = 4.3;
    const desk = K.box({ color: shade(P.wood, 0.05), size: [1.75, 0.2, 1.35], family: 'wood' });
    K.tilt(desk, slant, 0, 0);
    g.add(K.put(desk, 0, deskY, 0.05));
    const lip = K.box({ color: P.woodDark, size: [1.75, 0.17, 0.15], family: 'wood' });
    K.tilt(lip, slant, 0, 0);
    g.add(K.put(lip, 0, deskY - Math.sin(slant) * 0.62, 0.05 + Math.cos(slant) * 0.62));
    // 翻开经书：封皮 + 左右双页（P.parchment，微外张出 V 形书口）
    const cover = K.box({ color: shade(P.woodDark, 0.12), size: [1.4, 0.1, 1.05], family: 'wood' });
    K.tilt(cover, slant, 0, 0);
    g.add(K.put(cover, 0, deskY + 0.15, -0.06));
    for (const s of [-1, 1]) {
      const page = K.box({ color: P.parchment, size: [0.62, 0.05, 0.92], family: 'cloth' });
      K.tilt(page, slant, 0, s * 0.13);
      g.add(K.put(page, s * 0.33, deskY + 0.23, -0.05));
    }
    // 侧链坠：自台侧垂挂的小链（交替 90° 链段）+ 链尾倒锥
    let cy = deskY - 0.55;
    for (let i = 0; i < links; i++) {
      const link = K.cyl({ color: P.iron, r: 0.07, h: 0.26, seg: 5, family: 'metal' });
      K.tilt(link, 0, i * Math.PI / 2, 0);
      g.add(K.put(link, 0.92, cy, 0.3));
      cy -= 0.22;
    }
    const pendant = K.cone({ color: shade(P.iron, 0.06), r: 0.11, h: 0.3, seg: 5, family: 'metal' });
    K.tilt(pendant, Math.PI, 0, 0); // 倒置：锥尖朝下读作坠子
    g.add(K.put(pendant, 0.92, cy - 0.12, 0.3));
    return g;
  },
};
