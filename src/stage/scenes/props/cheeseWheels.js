// 奶酪轮（CATALOG2 编号 72）：「两轮叠+楔形切块」——prop/floor（wood 单族，全件 P.cheese 系）。
// 原点=底轮底面中心（y=0 落地）；下轮蜡皮环带+顶面切色，上轮略小微歪叠坐（径约 1.8，S 档）；
// 楔形切块=prism（三角剖面即楔），楔尖啃缺（chip 切角）+浅色切面贴片，斜倚在轮叠旁。
// 变体走 build(opts)：楔块数 wedges / 碎屑数 crumbs。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 轮廓（lathe）：扁轮+鼓缘，局部高 0.58、径 0.92（上轮按 0.86 缩放复用）
const WHEEL = [
  [0.03, 0], [0.78, 0], [0.89, 0.05], [0.92, 0.29],
  [0.89, 0.53], [0.78, 0.58], [0.03, 0.58],
];

export default {
  id: 'cheeseWheels',
  place: 'prop',
  mount: 'floor',
  tags: ['kitchen'],
  footprint: { x: 2.7, z: 2.2 },
  behaviors: [],
  build({ wedges = 1, crumbs = 2, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('cheeseWheels');
    // 底轮：轮体+蜡皮环带（压暗一档）+顶面切色盘（提亮读作刚切开）
    g.add(K.put(K.lathe({ color: P.cheese, profile: WHEEL, seg: 9 }), 0, 0, 0));
    g.add(K.put(K.cyl({ color: shade(P.cheese, -0.18), r: 0.94, h: 0.34, seg: 9 }), 0, 0.29, 0));
    g.add(K.put(K.cyl({ color: shade(P.cheese, 0.12), r: 0.66, h: 0.05, seg: 9 }), 0, 0.6, 0));
    // 上轮：0.86 缩放复用轮廓、微错位歪叠（rng 驱动各件姿态）+ 顶面切色盘
    const top = K.lathe({
      color: shade(P.cheese, 0.06), seg: 9,
      profile: WHEEL.map(([rr, y]) => [rr * 0.86, y * 0.88]),
    });
    K.tilt(top, (r() - 0.5) * 0.06, 0, (r() - 0.5) * 0.06);
    g.add(K.put(top, 0.16, 0.83, 0.1));
    g.add(K.put(K.cyl({ color: shade(P.cheese, 0.16), r: 0.52, h: 0.05, seg: 9 }), 0.16, 1.09, 0.1));
    // 楔形切块：prism 三角剖面即楔；楔尖啃缺（chip 切角）+浅色切面贴片（贴在前帽读作新切面）
    const nw = Math.min(Math.max(wedges, 0), 2);
    for (let i = 0; i < nw; i++) {
      const outer = K.prism({ color: P.cheese, size: [0.95, 0.62, 0.44] });
      K.chip(outer, { corner: [1, 1, 1], amount: 0.16 });
      const cut = K.put(K.prism({ color: shade(P.cheese, 0.14), size: [0.9, 0.57, 0.08] }), 0, 0, 0.2);
      const wedge = K.grp(outer, cut);
      K.tilt(wedge, 0, 0.3 + i * 1.1 + (r() - 0.5) * 0.2, -0.05);
      g.add(K.put(wedge, 1.32 + i * 0.12, 0.33, 0.42 - i * 0.5));
    }
    // 碎屑：楔块旁散落的奶酪渣（提亮小珠）
    const nc = Math.min(Math.max(crumbs, 0), 4);
    for (let i = 0; i < nc; i++) {
      g.add(K.put(
        K.sphereLo({ color: shade(P.cheese, 0.22), r: 0.06 + r() * 0.04, seg: 0, jitter: 0.3, rng: r }),
        0.9 + r() * 0.55, 0.07, -0.6 + r() * 1.2));
    }
    return g;
  },
};
