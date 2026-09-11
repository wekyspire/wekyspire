// 铁砧（CATALOG2 编号 46）：「双角砧+砧座+砧面锤痕」——prop 类（metal 铁体 + unlit 锤痕 双族）。
// 原点=底面中心（y=0 落地），x=长（双角向）z=厚；全高约 2.6（铁砧参照 anvilStone 高 2.95 略矮一档）。
// 双角=砧身两端接 prism 尖角（box+prism 剪影，rz ∓90° 把三角剖面的尖角转向 ±x）；
// 锤痕=砧面 unlit 暗色小圆坑（同 anvilStone 磨坑手法），wear 档位换砧面缺角。
// 变体走 build(opts)：锤痕数 marks / 磨损度 wear（砧面崩边）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'anvilIron',
  place: 'prop',
  mount: 'floor',
  tags: ['metal', 'smith'],
  footprint: { x: 4.6, z: 2.4 },
  behaviors: [],
  build({ marks = 4, wear = 1, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('anvilIron');
    const w = Math.min(Math.max(wear, 0), 2); // 磨损三档：0 无崩边 → 2 双崩边
    // 砧座：两级阶梯基座（下宽上窄压重心）
    g.add(K.put(K.box({ color: shade(P.iron, -0.2), size: [3.2, 0.45, 2.2], family: 'metal' }), 0, 0.225, 0));
    g.add(K.put(K.box({ color: shade(P.iron, -0.1), size: [2.5, 0.65, 1.8], family: 'metal' }), 0, 0.775, 0));
    // 砧腰：收腰过渡（窄腰承重读作锻铁一体）
    g.add(K.put(K.box({ color: shade(P.iron, -0.04), size: [1.45, 0.6, 1.0], family: 'metal' }), 0, 1.4, 0));
    // 砧身 + 砧面：工作面出挑宽板、提亮一档（长期锤打的亮面）
    g.add(K.put(K.box({ color: P.iron, size: [2.3, 0.64, 1.3], family: 'metal' }), 0, 2.02, 0));
    const face = K.box({ color: shade(P.iron, 0.14), size: [3.3, 0.28, 1.42], family: 'metal' });
    if (w >= 1) K.chip(face, { corner: [1, 1, 1], amount: 0.1 + 0.04 * w });
    if (w >= 2) K.chip(face, { corner: [-1, 1, -1], amount: 0.14 });
    g.add(K.put(face, 0, 2.48, 0));
    // 双角：砧身两端 prism 尖角（根部略嵌砧身防共面闪面），角长 1.05
    for (const s of [-1, 1]) {
      const horn = K.prism({ color: shade(P.iron, 0.08), size: [0.6, 1.05, 1.1], family: 'metal' });
      K.tilt(horn, 0, 0, -s * Math.PI / 2);
      g.add(K.put(horn, s * 1.6, 2.02, 0));
    }
    // 锤痕：砧面散布的暗色小圆坑（unlit 暗盘读作凹坑，避开缺角一端）
    const n = Math.max(0, Math.min(6, marks));
    for (let i = 0; i < n; i++) {
      const mx = n === 1 ? 0 : -0.85 + (i * 1.7) / (n - 1);
      const pit = K.cyl({ color: P.night, r: 0.11 + r() * 0.07, h: 0.05, seg: 6, family: 'unlit' });
      g.add(K.put(pit, mx, 2.645, (r() - 0.5) * 0.8));
    }
    return g;
  },
};
