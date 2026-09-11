// 墙体破洞（CATALOG #69）：「塌落开口露黑，缘口挂渣」——wallStructure 类（stone+unlit 双族）。
// 原点=墙脚挂点（z=0 贴墙面，+z 朝室内），占 1 墙段；叠放在房型墙体上：露黑用 unlit
// P.night 背板读洞深，塌口顶缘中间塌腰；缘口碎石参照 rubblePile 的 sphereLo 手法，
// 挂渣=小 box/chip 缺角碎块悬在顶缘下，基脚散落塌落碎石。变体走 build(opts)：洞宽/洞高/碎密度。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'wallGapRuin',
  place: 'wallStructure',
  bayWidth: 1,
  tags: ['ruin'],
  behaviors: [],
  build({ w = 4.2, h = 10, rim = 13, hangers = 3, spill = 5, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('wallGapRuin');
    const base = 0.6;
    // 塌口顶缘：两高一中塌腰（cos 腰线）
    const topAt = x => base + h - 0.9 * Math.cos((Math.PI / 2) * (x / (w / 2)));
    // 露黑背板（unlit 夜色，略前出于墙面防 z-fight）
    g.add(K.put(
      K.box({ color: P.night, size: [w + 0.5, h + 0.4, 0.3], family: 'unlit' }),
      0, base + (h + 0.4) / 2 - 0.2, 0.15));
    // 缘口碎石（rubblePile 手法：jitter 球岩 + 三色斑驳）
    const rock = (x, y, z, s) => {
      const m = K.sphereLo({
        color: [shade(P.rock, 0.14), P.rock, shade(P.slab, 0.08)][Math.floor(r() * 3)],
        r: s, seg: 0, jitter: 0.25, rng: r,
      });
      K.tilt(m, r() * 0.8, r() * Math.PI, r() * 0.8);
      g.add(K.put(m, x, y, z));
    };
    const edgeN = Math.max(2, Math.round(rim * 0.3));
    for (let i = 0; i < edgeN; i++) { // 左右缘：自下而上排岩
      const y = base + 0.6 + (h - 1.8) * (i / Math.max(1, edgeN - 1));
      rock(-w / 2, y, 0.3 + r() * 0.3, 0.55 + r() * 0.3);
      rock(w / 2, y, 0.3 + r() * 0.3, 0.55 + r() * 0.3);
    }
    const topN = Math.max(3, rim - edgeN * 2);
    for (let i = 0; i < topN; i++) { // 塌腰顶缘：沿腰线排岩
      const x = -w / 2 + w * (i / Math.max(1, topN - 1));
      rock(x, topAt(x) + 0.2, 0.3 + r() * 0.35, 0.5 + r() * 0.35);
    }
    // 缘口挂渣：缺角碎块悬在顶缘下，歪斜欲坠
    for (let i = 0; i < hangers; i++) {
      const x = -w / 2 + 0.7 + r() * (w - 1.4);
      const len = 0.5 + r() * 0.5;
      const shard = K.chip(
        K.box({ color: i % 2 ? P.slab : shade(P.rock, 0.1), size: [0.6 + r() * 0.7, len, 0.45] }),
        { corner: [1, -1, 1], amount: 0.18 });
      g.add(K.put(K.tilt(shard, 0.15 + r() * 0.2, 0, (r() - 0.5) * 0.5), x, topAt(x) - 0.55 - len * 0.3, 0.45));
    }
    // 基脚塌落堆：散岩 + 缺角断砖（洞口前散布）
    for (let i = 0; i < spill; i++) {
      const x = (r() * 2 - 1) * (w / 2 + 0.3);
      const z = 0.5 + r() * 1.2;
      if (i % 2 === 0) {
        const s = 0.4 + r() * 0.25;
        rock(x, s * 0.45, z, s);
      } else {
        const brick = K.chip(K.box({ color: P.slab, size: [0.8, 0.4, 0.5] }), { corner: [1, 1, 1], amount: 0.22 });
        g.add(K.put(K.tilt(brick, 0.1, r() * Math.PI, 0.08), x, 0.22, z));
      }
    }
    return g;
  },
};
