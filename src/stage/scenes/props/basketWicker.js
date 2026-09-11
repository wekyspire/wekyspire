// 柳条筐（CATALOG2 #27）：「敞口编织感+横箍两道」——容器类 prop/floor（wood + unlit 口内暗盘 双族）。
// 编织感=横向箍圈交叠：筐壁 lathe + 两道横箍环带 + 竖经条 + 口沿加粗辫圈。
// 原点=底面中心（y=0 落地）；变体走 build(opts)：箍数 hoops / 经条数 stakes。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 敞口环带 profile（外凸圆弧截面的开口环，读作缠绕在壁面上的箍条，无端盖）
const BAND = (rr) => [
  [rr - 0.03, 0], [rr + 0.06, 0.045], [rr + 0.08, 0.09], [rr + 0.06, 0.135], [rr - 0.03, 0.17],
];

export default {
  id: 'basketWicker',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'container', 'kitchen'],
  footprint: { x: 2.3, z: 2.3 },
  behaviors: [],
  build({ hoops = 2, stakes = 5, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('basketWicker');
    const rB = 0.72, rT = 1.0, h = 1.25;                 // 筐壁：底小口大的敞口锥台
    const rad = y => rB + (rT - rB) * (y / h);            // 壁面半径（沿高线性外扩）
    // 筐壁：lathe 微鼓的敞口壁面（P.straw 柳条本色）
    const wall = K.lathe({
      color: P.straw, seg: 7, family: 'wood',
      profile: [[0.03, 0], [rB, 0.06], [rB + 0.08, 0.35], [rad(0.8), 0.8], [rT, h]],
    });
    if (rng) K.jitter(wall, r, { rot: 0.015 });
    g.add(wall);
    // 筐内暗盘：口沿下缘的 unlit 夜色盘（读作空筐内腔，藏于口沿下不露边）
    g.add(K.put(K.cyl({ color: P.night, r: rT - 0.14, h: 0.06, seg: 7, family: 'unlit' }), 0, h - 0.16, 0));
    // 口沿辫圈：口外一圈加粗的圆弧环带（读作收口的加粗编织圈）
    g.add(K.put(K.lathe({
      color: shade(P.straw, -0.1), seg: 7, family: 'wood',
      profile: BAND(rT + 0.02).map(([rr, y]) => [rr + 0.03, y]),
    }), 0, h - 0.1, 0));
    // 横箍两道：沿壁面外贴的环箍（明暗错一档读作缠箍条的交叠）
    const n = Math.min(Math.max(hoops, 1), 3);
    for (let i = 0; i < n; i++) {
      const y = h * (0.3 + (0.45 * i) / Math.max(1, n - 1));
      g.add(K.put(K.lathe({
        color: shade(P.wood, 0.05 * (i % 2)), seg: 7, family: 'wood', profile: BAND(rad(y) + 0.04),
      }), 0, y - 0.08, 0));
    }
    // 竖经条：沿壁面外贴的细直杆（随锥度外倾，编篮的经线骨架）
    const m = Math.min(Math.max(stakes, 3), 7);
    const lean = Math.atan2(rT - rB, h);                  // 壁面锥角（经条外倾角）
    for (let i = 0; i < m; i++) {
      const a = (i / m) * Math.PI * 2 + 0.35;
      const rc = (rB + rT) / 2 + 0.05;
      const stake = K.cyl({ color: shade(P.straw, -0.14), r: 0.05, h: h + 0.06, seg: 4, family: 'wood' });
      K.tilt(stake, 0, -a, -lean);                        // 先外倾再转到各自方位
      g.add(K.put(stake, Math.cos(a) * rc, (h + 0.06) / 2, Math.sin(a) * rc));
    }
    return g;
  },
};
