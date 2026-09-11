// 地图桌（CATALOG2 编号 119）：「摊图+压石+旗标」——家具类 prop（wood+stone+cloth 三族）。
// 原点=底面中心（y=0 落地），约 5×3、桌面高约 4.3（M 档）；四腿厚板桌+双侧望板
// （同 tableWriting 骨架），桌面摊开双页羊皮地图（P.parchment，中缝微拱+压暗缝线），
// 页上压角卵石（stone 族 sphereLo jitter）+小旗标（木钉+cloth 族小尖旗，一面微歪），
// 后沿一卷备图（横卧卷轴）。变体走 build(opts)：旗数 flags（2~4）/压石数 stones（2~4）/
// 备图卷轴 rolled。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 旗标槽位（图上散布）与压石槽位（页角页缘）
const FLAG_SPOTS = [[-1.5, 0.3], [0.6, -0.5], [1.35, 0.12], [-0.45, -0.85]];
const STONE_SPOTS = [[-1.92, -0.72], [1.88, 0.68], [-0.5, 0.95], [1.6, -1.0]];

export default {
  id: 'mapTable',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'parchment', 'quarters'],
  footprint: { x: 5.3, z: 3.2 },
  behaviors: [],
  build({ flags = 3, stones = 3, rolled = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('mapTable');
    const w = 5.0, d = 3.0;
    // 四腿（微外撇）+桌面厚板+双侧望板
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = K.box({ color: P.woodDark, size: [0.34, 3.9, 0.34], family: 'wood' });
      K.tilt(leg, -sz * 0.03, 0, sx * 0.03);
      if (rng) K.jitter(leg, rng, { rot: 0.012 });
      g.add(K.put(leg, sx * (w / 2 - 0.3), 1.95, sz * (d / 2 - 0.35)));
    }
    g.add(K.put(K.box({ color: P.wood, size: [w, 0.36, d], family: 'wood' }), 0, 4.08, 0));
    for (const sz of [-1, 1]) {
      g.add(K.put(K.box({ color: shade(P.woodDark, 0.08), size: [w - 0.7, 0.26, 0.2], family: 'wood' }), 0, 3.72, sz * 1.22));
    }
    // 摊开双页羊皮地图：左右两页（内侧微翘成中缝拱）+压暗缝线
    const pageL = K.box({ color: P.parchment, size: [2.2, 0.05, 2.0], family: 'wood' });
    K.tilt(pageL, 0.01, 0.04, 0.06);
    g.add(K.put(pageL, -1.12, 4.3, 0));
    const pageR = K.box({ color: shade(P.parchment, -0.05), size: [2.2, 0.05, 2.0], family: 'wood' });
    K.tilt(pageR, -0.008, -0.03, -0.05);
    g.add(K.put(pageR, 1.12, 4.3, 0));
    g.add(K.put(K.box({ color: shade(P.parchment, -0.28), size: [0.2, 0.06, 2.0], family: 'wood' }), 0, 4.35, 0));
    // 压石：页角页缘卵石（大小错落、鼓包各异）
    const nS = Math.min(Math.max(stones, 2), 4);
    for (let i = 0; i < nS; i++) {
      const [sx, sz] = STONE_SPOTS[i];
      const rad = 0.16 + r() * 0.1;
      const stone = K.sphereLo({ color: [P.rock, shade(P.rock, 0.1)][i % 2], r: rad, seg: 0, jitter: 0.25, rng: r, family: 'stone' });
      K.tilt(stone, r() * 0.4, r() * Math.PI, r() * 0.4);
      g.add(K.put(stone, sx, 4.33 + rad * 0.7, sz));
    }
    // 旗标：木钉+cloth 族小尖旗（prism 三角旗面），末一支微歪倒
    const nF = Math.min(Math.max(flags, 2), 4);
    for (let i = 0; i < nF; i++) {
      const [fx, fz] = FLAG_SPOTS[i];
      const tipped = i === nF - 1 && r() > 0.4;
      const pin = K.cyl({ color: P.woodDark, r: 0.035, h: 0.62, seg: 5, family: 'wood' });
      if (tipped) K.tilt(pin, 0.5, r() * Math.PI, 0);
      g.add(K.put(pin, fx, 4.6, fz));
      const pennant = K.prism({
        color: i % 2 ? P.bannerBlue : P.bannerRed, size: [0.4, 0.2, 0.035], family: 'cloth',
      });
      K.tilt(pennant, 0, r() * Math.PI * 2, tipped ? 0.4 : 0);
      g.add(K.put(pennant, fx + 0.2, tipped ? 4.52 : 4.72, fz));
    }
    // 备图卷轴：后沿横卧一卷（羊皮色圆柱）
    if (rolled) {
      const scroll = K.cyl({ color: shade(P.parchment, -0.1), r: 0.16, h: 1.7, seg: 7, family: 'wood' });
      K.tilt(scroll, Math.PI / 2, 0, 0.02);
      g.add(K.put(scroll, 1.72, 4.44, -1.08));
    }
    return g;
  },
};
