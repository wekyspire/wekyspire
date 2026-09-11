// 弓架（CATALOG2 编号 51）：「立弓两张+插箭筒」——军事类 prop/floor（架/弓/箭杆 wood + 弦/皮件 cloth + 箭镞 metal 三族）。
// 原点=底面中心；矮门架（双柱+顶横档+前伸脚木）承两张立弓：弓=浅弧四段细圆柱（弧感剪影）+
// 竖直细弦（细 box 抵两梢）+ 皮缠握把，两弓左右对影（右弓镜像）；架侧落地箭筒
//（开口皮筒=筒身+上沿环口+暗色内衬盘）+ 箭杆束斜插外露。变体走 build(opts)：
// 弓数（1~3）/箭数（2~6）/倚靠角。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 平面斜柱：连接 (x1,y1)→(x2,y2) 的圆柱段（弓臂分段，z=0 平面；同高足罐环耳手法）
function bar(color, r, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const m = K.cyl({ color, r: r, h: Math.hypot(dx, dy), seg: 5, family: 'wood' });
  return K.put(K.tilt(m, 0, 0, Math.atan2(-dx, dy)), (x1 + x2) / 2, (y1 + y2) / 2, 0);
}

// 单张立弓（高约 5.3，弓面 x-y 平面、面朝 +z，原点=下弓梢投影）：浅弧弓臂（四段圆柱弧，
// 弦端近竖直、弧腹外凸约 1.6）+ 竖直细弦（略前移避共面）+ 皮缠握把（弧腹最凸处）
function buildBow() {
  const b = new THREE.Group();
  const cx = 1.3, cy = 2.65, R = 2.96, half = 1.081;
  const pts = [];
  for (let i = 0; i <= 4; i++) {
    const f = -half + (i * (half * 2)) / 4;
    pts.push([cx - R * Math.cos(f), cy - R * Math.sin(f)]);
  }
  for (let i = 0; i < 4; i++) {
    b.add(bar(P.woodDark, 0.09, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  }
  b.add(K.put(K.box({ color: P.rope, size: [0.07, 5.1, 0.07], family: 'cloth' }), pts[0][0], cy, 0.13));
  b.add(K.put(K.cyl({
    color: shade(P.rope, -0.1), r: 0.16, h: 0.95, seg: 6, family: 'cloth',
  }), pts[2][0] + 0.02, cy, 0));
  return b;
}

// 一支箭（原点=杆底、轴 +y）：提亮细箭杆 + 深色小镞
function buildArrow() {
  return K.grp(
    K.put(K.cyl({ color: shade(P.wood, 0.3), r: 0.05, h: 2.3, seg: 5, family: 'wood' }), 0, 1.15, 0),
    K.put(K.cone({ color: shade(P.iron, -0.05), r: 0.09, h: 0.32, seg: 4, family: 'metal' }), 0, 2.44, 0),
  );
}

export default {
  id: 'bowRack',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'barrack'],
  footprint: { x: 5.6, z: 2 },
  behaviors: [],
  build({ bows = 2, arrows = 4, lean = 0.14, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('bowRack');
    // 矮门架：双立柱 + 顶横档 + 前伸脚木（承弓倚点，同兵器架语言）
    for (const s of [-1, 1]) {
      g.add(K.put(K.box({ color: P.woodDark, size: [0.3, 2.5, 0.3], family: 'wood' }), s * 1.55, 1.25, 0));
      g.add(K.put(K.box({ color: P.woodDark, size: [0.55, 0.26, 1.7], family: 'wood' }), s * 1.45, 0.13, 0.4));
    }
    g.add(K.put(K.box({ color: P.wood, size: [3.7, 0.28, 0.26], family: 'wood' }), 0, 2.42, 0));
    // 立弓：倚在横档前，弓梢落地、握把抵档；两弓左右对影（右弓镜像），三弓则第三张垫后
    const nb = Math.min(Math.max(bows, 1), 3);
    const xs = nb === 1 ? [0] : nb === 2 ? [-0.58, 0.58] : [-0.95, 0.75, -0.05];
    const zs = nb === 3 ? [0.72, 0.72, 0.5] : [0.72, 0.72, 0.72];
    for (let i = 0; i < nb; i++) {
      const bow = buildBow();
      const side = Math.sign(xs[i]) || -1;
      if (side > 0) K.mirror(bow, 'x');
      K.tilt(bow, -(lean + r() * 0.03), 0, (r() - 0.5) * 0.06);
      g.add(K.put(bow, xs[i], 0.04, zs[i]));
    }
    // 箭筒：架侧落地皮筒（开口=上沿环口 + 暗色内衬盘读作空腔），箭杆束斜插外露
    const quiver = K.grp(
      K.put(K.cyl({ color: P.rope, r: 0.5, rTop: 0.56, h: 1.8, seg: 7, family: 'cloth' }), 0, 0.95, 0),
      K.put(K.cyl({ color: shade(P.rope, -0.14), r: 0.6, rTop: 0.5, h: 0.22, seg: 7, family: 'cloth' }), 0, 1.86, 0),
      K.put(K.cyl({ color: shade(P.rope, -0.62), r: 0.46, h: 0.06, seg: 7, family: 'cloth' }), 0, 1.8, 0),
    );
    K.tilt(quiver, -0.06, 0.1, 0.05);
    g.add(K.put(quiver, 2.6, 0.05, 0.15));
    const na = Math.min(Math.max(arrows, 2), 6);
    for (let i = 0; i < na; i++) {
      const ar = buildArrow();
      K.tilt(ar, -0.1 - r() * 0.08, (r() - 0.5) * 0.2, (r() - 0.5) * 0.3);
      g.add(K.put(ar, 2.6 + (r() - 0.5) * 0.5, 1.05, 0.15 + (r() - 0.5) * 0.5));
    }
    return g;
  },
};
