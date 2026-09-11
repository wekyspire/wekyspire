// 面包篮（CATALOG2 编号 71）：「藤篮+两三个圆面包」——prop/floor（wood+unlit 口内暗盘 双族）。
// 原点=底面中心（y=0 落地）；筐体是 basketWicker 的小号同构（敞口编织感：筐壁 lathe+口沿辫圈
// +横箍+竖经条，筐径约 2，S 档），篮里叠坐两三只圆面包（P.bread，顶上各一道划痕）。
// 变体走 build(opts)：面包数 breads / 箍数 hoops / 经条数 stakes。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 敞口环带 profile（同 basketWicker 的箍条语言：外凸圆弧截面的开口环，缠绕在壁面上）
const BAND = (rr) => [
  [rr - 0.02, 0], [rr + 0.05, 0.04], [rr + 0.07, 0.075], [rr + 0.05, 0.11], [rr - 0.02, 0.14],
];

// 三只面包的篮内落位（下层两只+上层一只骑缝）
const LOAF_POS = [[-0.33, 0.78, 0.12], [0.38, 0.82, -0.14], [0.04, 1.08, 0.3]];

export default {
  id: 'breadBasket',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'kitchen'],
  footprint: { x: 2.2, z: 2.2 },
  behaviors: [],
  build({ breads = 3, hoops = 1, stakes = 4, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('breadBasket');
    const rB = 0.58, rT = 0.92, h = 0.95;   // 筐壁：底小口大的敞口锥台
    const rad = y => rB + (rT - rB) * (y / h);
    // 筐壁（P.straw 柳条本色）+ 筐内暗盘（unlit 夜色读空腔）+ 口沿辫圈
    const wall = K.lathe({
      color: P.straw, seg: 7, family: 'wood',
      profile: [[0.03, 0], [rB, 0.05], [rB + 0.06, 0.28], [rad(0.75), 0.75], [rT, h]],
    });
    if (rng) K.jitter(wall, r, { rot: 0.015 });
    g.add(wall);
    g.add(K.put(K.cyl({ color: P.night, r: rT - 0.12, h: 0.05, seg: 7, family: 'unlit' }), 0, h - 0.22, 0));
    g.add(K.put(K.lathe({
      color: shade(P.straw, -0.1), seg: 7, family: 'wood',
      profile: BAND(rT + 0.02).map(([rr, y]) => [rr + 0.02, y]),
    }), 0, h - 0.09, 0));
    // 横箍：沿壁面外贴的缠箍条（明暗错一档）
    const n = Math.min(Math.max(hoops, 1), 2);
    for (let i = 0; i < n; i++) {
      const y = h * (0.32 + 0.4 * i);
      g.add(K.put(K.lathe({
        color: shade(P.wood, 0.05 * (i % 2)), seg: 7, family: 'wood', profile: BAND(rad(y) + 0.03),
      }), 0, y - 0.06, 0));
    }
    // 竖经条：随锥度外倾的细直杆（编篮经线骨架）
    const m = Math.min(Math.max(stakes, 3), 6);
    const lean = Math.atan2(rT - rB, h);
    for (let i = 0; i < m; i++) {
      const a = (i / m) * Math.PI * 2 + 0.35;
      const rc = (rB + rT) / 2 + 0.04;
      const stake = K.cyl({ color: shade(P.straw, -0.14), r: 0.045, h: h + 0.05, seg: 4, family: 'wood' });
      K.tilt(stake, 0, -a, -lean);
      g.add(K.put(stake, Math.cos(a) * rc, (h + 0.05) / 2, Math.sin(a) * rc));
    }
    // 圆面包：低模球压扁（P.bread 深浅交替），顶面一道深色划痕读出炉割包
    const nb = Math.min(Math.max(breads, 1), 3);
    for (let i = 0; i < nb; i++) {
      const [x, y, z] = LOAF_POS[i];
      const loaf = K.sphereLo({
        color: [P.bread, shade(P.bread, 0.09), shade(P.bread, -0.06)][i],
        r: 0.42, seg: 1, jitter: 0.1, rng: r,
      });
      K.scaleXYZ(loaf, 1.02, 0.66, 0.92);
      K.tilt(loaf, (r() - 0.5) * 0.1, r() * Math.PI, 0);
      g.add(K.put(loaf, x, y, z));
      const score = K.box({ color: shade(P.bread, -0.3), size: [0.5, 0.05, 0.1], family: 'wood' });
      K.tilt(score, 0, r() * Math.PI, 0);
      g.add(K.put(score, x, y + 0.24, z));
    }
    return g;
  },
};
