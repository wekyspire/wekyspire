// 双耳瓶（CATALOG #34）：「细颈双耳，釉色斑驳」——prop 类（陶器 stone + 瓮口 unlit 双族）。
// 原点=底面中心（y=0 落地）；mount 双宿主 ['floor','smallWallTop']（S 档常上柱顶/基座顶，
// 宿主准入见 CATALOG §1.2）。变体走 build(opts)：丰满度/釉斑条数。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 瓶身轮廓（lathe profile：圈足→垂腹→收肩→细长颈→外撇喇叭口），高约 2.72，腹径约 1.84
const BODY = [
  [0.02, 0], [0.34, 0], [0.44, 0.1], [0.66, 0.42], [0.9, 0.95],
  [0.92, 1.25], [0.78, 1.6], [0.44, 1.95], [0.3, 2.1], [0.29, 2.5], [0.46, 2.62], [0.5, 2.72],
];
// 釉斑条带：瓶身 profile 的下标区间（贴身凸出，深浅交替读作釉色斑驳）
const GLAZE = [[3, 6], [5, 8], [8, 10]];

// 平面斜柱：连接 (x1,y1)→(x2,y2) 的圆柱段（双耳把手，z=0 平面）
function bar(color, r, x1, y1, x2, y2) {
  const dx = x2 - x1, dy = y2 - y1;
  const m = K.cyl({ color, r, h: Math.hypot(dx, dy), seg: 5 });
  return K.put(K.tilt(m, 0, 0, Math.atan2(-dx, dy)), (x1 + x2) / 2, (y1 + y2) / 2, 0);
}

export default {
  id: 'vaseTwinEar',
  place: 'prop',
  mount: ['floor', 'smallWallTop'],
  tags: ['pottery', 'container', 'brittle'],
  footprint: { x: 2.4, z: 2.4 },
  behaviors: [],
  build({ fat = 1, drips = 2, rng } = {}) {
    const g = new THREE.Group();
    // 瓶身：lathe 一体拉坯，fat 控丰满度（0.85 修长 ~ 1.15 圆润）
    const body = K.lathe({
      color: P.clay, seg: 7,
      profile: BODY.map(([r, y]) => [r * fat, y]),
    });
    if (rng) K.jitter(body, rng, { rot: 0.02 }); // 窑烧微歪的手工感
    g.add(body);
    // 釉色斑驳：贴身垂釉条带（不同高度/深浅交替，半径交错防共面）
    for (let i = 0; i < Math.min(drips, GLAZE.length); i++) {
      const [a, b] = GLAZE[i];
      const off = i % 2 ? 0.05 : 0.02;
      g.add(K.lathe({
        color: i % 2 ? shade(P.clay, 0.14) : P.clayDark, seg: 7,
        profile: BODY.slice(a, b).map(([r, y]) => [r * fat + off, y]),
      }));
    }
    // 口沿唇圈 + 颈内暗盘（unlit 夜色读作空腔，同 vaseClay 瓮口手法）
    g.add(K.put(K.cyl({ color: P.clayDark, r: 0.55 * fat, h: 0.1, seg: 7 }), 0, 2.67, 0));
    g.add(K.put(K.cyl({ color: P.night, r: 0.29 * fat - 0.02, h: 0.06, seg: 7, family: 'unlit' }), 0, 2.5, 0));
    // 双耳：肩腹→外鼓→口沿 两段圆柱把手，左右对称
    for (const s of [-1, 1]) {
      g.add(bar(P.clayDark, 0.09, s * 0.52, 1.82, s * 1.0, 2.36));
      g.add(bar(P.clayDark, 0.09, s * 1.0, 2.36, s * 0.44, 2.64));
    }
    return g;
  },
};
