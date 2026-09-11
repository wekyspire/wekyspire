// 倚墙梯（CATALOG2 #17）：「斜靠双杆横档+磨损」——通用 prop（wood 为主+绳头 cloth 点缀）。
// 双立杆微八字 + 六道横档等距，整梯绕 x 轴后仰斜靠（梯脚原地贴地、梯顶向 -z 抵墙，
// 倚角约 0.35 rad、梯长约 12）；磨损读法：横档深浅交替+逐档微歪、一档缺角、杆头削茬、
// 顶档垂一截绳头。原点=底面中心（y=0 落地）。变体走 build(opts)：横档数/倚角/缺档序号。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'ladderLean',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'generic'],
  footprint: { x: 2.1, z: 4.8 },
  behaviors: [],
  build({ rungs = 6, lean = 0.35, skip = -1, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('ladderLean');
    const ladder = new THREE.Group();
    const len = 12;
    // 双杆：微八字外撇，顶端磨秃削茬（chip 削杆头一角）
    for (const s of [-1, 1]) {
      const rail = K.box({ color: P.woodDark, size: [0.26, len, 0.2], family: 'wood' });
      K.chip(rail, { corner: [s, 1, -1], amount: 0.1 });
      K.tilt(rail, 0, 0, s * 0.012);
      K.jitter(rail, r, { rot: 0.006 });
      ladder.add(K.put(rail, s * 0.78, len / 2, 0));
    }
    // 横档：等距深浅交替、逐档微歪（rng），第 2 档缺角=磨豁口；skip 指定档整根缺失
    const n = Math.min(Math.max(rungs, 4), 8);
    const span = (len - 3) / (n - 1); // 顶档之上留约 1.5 杆头
    for (let i = 0; i < n; i++) {
      if (i === skip) continue;
      const rung = K.box({
        color: i % 2 ? shade(P.wood, -0.06) : P.wood,
        size: [1.85, 0.16, 0.14], family: 'wood',
      });
      if (i === 2) K.chip(rung, { corner: [1, 1, 1], amount: 0.12 });
      K.tilt(rung, 0, 0, (r() - 0.5) * 0.05);
      K.jitter(rung, r, { pos: 0.02, rot: 0.01 });
      ladder.add(K.put(rung, 0, 1.5 + i * span, 0));
    }
    // 顶档垂一截绳头（用过即弃的小信号）
    const tail = K.cyl({ color: P.rope, r: 0.05, h: 0.9, seg: 5, family: 'cloth' });
    K.tilt(tail, 0.06, 0, 0.05);
    ladder.add(K.put(tail, 0.3, 1.5 + (len - 3) - 0.45, 0.08));
    // 整梯后仰斜靠：梯脚绕原点原地、梯顶向 -z 抵墙
    ladder.rotation.x = -lean;
    ladder.rotation.z = 0.015;
    g.add(ladder);
    return g;
  },
};
