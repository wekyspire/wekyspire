// 石祭坛（CATALOG2 编号 58）：「台面垂布+四角烛位」——圣所家具 prop（stone+cloth 双族）。
// 原点=底面中心（y=0 落地），x=宽 z=深，台面高约 3.45：两级阶座（statuePedestal 收放手法）
// + 台身块 + 出挑台面（mensa 厚板带下衬线脚）；冷白祭布（P.wax 布）覆台面三面垂落，
// 垂帘角 chip 读作磨破。四角烛位=石台小座低环（tableLong 先例），无火无 lightSource 声明，
// 一角可残留熄烛头。变体走 build(opts)：烛位数 sockets / 熄烛头 stub / 垂布磨破 worn。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'altarStone',
  place: 'prop',
  mount: 'floor',
  tags: ['stone', 'cloth', 'chapel'],
  footprint: { x: 5.4, z: 3.4 },
  behaviors: [],
  build({ sockets = 4, stub = true, worn = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('altarStone');
    // 两级阶座 + 台身块 + 下衬线脚 + 出挑台面（mensa）
    g.add(K.put(K.box({ color: shade(P.stone, -0.1), size: [4.4, 0.45, 2.5], family: 'stone' }), 0, 0.225, 0));
    g.add(K.put(K.box({ color: P.stone, size: [3.95, 0.35, 2.2], family: 'stone' }), 0, 0.625, 0));
    const body = K.box({ color: shade(P.stone, 0.02), size: [3.4, 1.85, 1.75], family: 'stone' });
    if (rng) K.jitter(body, r, { rot: 0.008 });
    g.add(K.put(body, 0, 1.725, 0));
    g.add(K.put(K.box({ color: shade(P.stone, -0.06), size: [4.35, 0.3, 2.35], family: 'stone' }), 0, 2.8, 0));
    const slab = K.box({ color: shade(P.stone, 0.07), size: [5.0, 0.5, 2.9], family: 'stone' });
    if (rng) K.jitter(slab, r, { rot: 0.006 });
    g.add(K.put(slab, 0, 3.2, 0));
    // 暗腔手法：出挑线脚下沿嵌一条 unlit 夜色（fireplaceBig 火塘读深的同语汇）
    g.add(K.put(K.box({ color: P.night, size: [3.1, 0.26, 0.06], family: 'unlit' }), 0, 2.5, 0.88));
    // 台面垂布：冷白织布覆台面（衬垫）+ 前后三面垂帘（角上 chip 读作磨破）
    g.add(K.put(K.box({ color: P.wax, size: [4.3, 0.1, 2.2], family: 'cloth' }), 0, 3.5, 0));
    const front = K.box({ color: shade(P.wax, -0.04), size: [4.3, 1.6, 0.08], family: 'cloth' });
    if (worn) K.chip(front, { corner: [-1, -1, 1], amount: 0.22 });
    g.add(K.put(front, 0, 2.7, 1.49));
    for (const s of [-1, 1]) {
      const side = K.box({ color: shade(P.wax, -0.07), size: [0.08, 1.6, 2.0], family: 'cloth' });
      if (worn && s === 1) K.chip(side, { corner: [1, -1, 1], amount: 0.2 });
      g.add(K.put(side, s * 2.49, 2.7, 0));
    }
    // 四角烛位：台面小座低环（空位为主，无火苗；与 tableLong 烛位同语汇）
    const n = Math.min(4, Math.max(1, sockets));
    const spots = [[-1.85, -0.9], [1.85, -0.9], [1.85, 0.9], [-1.85, 0.9]];
    for (let i = 0; i < n; i++) {
      const [x, z] = spots[i];
      const ring = K.cyl({ color: shade(P.stone, 0.1), r: 0.27, rTop: 0.32, h: 0.16, seg: 6, family: 'stone' });
      if (rng) K.jitter(ring, r, { rot: 0.02 });
      g.add(K.put(ring, x, 3.58, z));
      // 末位残留一枚燃残熄烛头（歪斜蜡柱，无焰）
      if (stub && i === n - 1) {
        const waxStub = K.cyl({ color: P.wax, r: 0.13, h: 0.42, seg: 5, family: 'stone' });
        K.tilt(waxStub, 0.08, 0.3, 0.05);
        g.add(K.put(waxStub, x, 3.87, z));
      }
    }
    return g;
  },
};
