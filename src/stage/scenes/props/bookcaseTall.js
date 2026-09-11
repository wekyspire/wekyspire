// 通顶书柜（阶段四·大图书馆墙面主体）：「整墙排架，六层满布书脊」——wallStructure 类
// （wood 单族 + 书脊多色），bayWidth:2（一柱两跨，读作"一排排书柜"的排架单元）。
// 原点=墙脚挂点（z=0 贴墙面，+z 朝室内，同 pilasterHalf 约定）；侧板/背板嵌墙半进，
// 书脊前缘齐平。变体走 build(opts)：层高系数 lean（乱架程度，0=整齐 1=散乱）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 书脊色带（调色板内取色，冷月夜下的旧书堆——赭/暗红/青绿/羊皮/木深交替）
const SPINE = [P.clay, P.bannerRed, P.bannerBlue, P.parchment, P.woodDark, P.wine, shade(P.clay, 0.1)];

export default {
  id: 'bookcaseTall',
  place: 'wallStructure',
  bayWidth: 2,
  tags: ['wood', 'library'],
  behaviors: [],
  build({ lean = 0.3, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('bookcaseTall');
    const W = 9.6; const H = 50; const D = 1.8;
    // 框架：底座 + 两侧板 + 背板 + 顶冠（线脚两段的柜体语言）
    g.add(K.put(K.box({ color: P.woodDark, size: [W, 1.2, D + 0.3] }), 0, 0.6, D / 2));
    for (const s of [-1, 1]) {
      g.add(K.put(K.box({ color: shade(P.woodDark, 0.05), size: [0.5, H, D] }), s * (W / 2 - 0.25), H / 2, D / 2));
    }
    g.add(K.put(K.box({ color: shade(P.woodDark, -0.12), size: [W, H, 0.3] }), 0, H / 2, 0.15)); // 背板贴墙
    g.add(K.put(K.box({ color: shade(P.woodDark, 0.08), size: [W + 0.6, 1.0, D + 0.4] }), 0, H - 0.5, D / 2)); // 顶冠
    g.add(K.put(K.box({ color: shade(P.woodDark, -0.04), size: [W + 0.3, 0.6, D + 0.2] }), 0, H - 1.4, D / 2));
    // 五层搁板 + 满布书脊（宽书脊控网格预算 ≤40：契约测试网格数红线；
    // 粗书脊在战斗距离读作书排，lean 高时出缺档/斜插书/横堆）
    const SHELVES = 5;
    const innerW = W - 1.0;
    for (let s = 0; s < SHELVES; s++) {
      const y0 = 1.2 + (s * (H - 3.2)) / SHELVES; // 本层搁板面
      g.add(K.put(K.box({ color: shade(P.wood, -0.06), size: [innerW + 0.4, 0.35, D - 0.2] }), 0, y0 + 0.175, D / 2));
      if (s === SHELVES - 1) break; // 顶层之上是冠板，不再布书
      const shelfH = (H - 3.2) / SHELVES - 0.35;
      let x = -innerW / 2;
      while (x < innerW / 2 - 1.2) {
        if (r() < lean * 0.15) { x += 0.9 + r() * 1.0; continue; } // 缺档（抽走的书）
        const bw = 1.2 + r() * 0.8;
        const bh = Math.min(shelfH - 0.3, 2.6 + r() * 1.6);
        const col = SPINE[Math.floor(r() * SPINE.length) % SPINE.length];
        const leanBook = r() < lean * 0.22;
        const b = K.box({ color: shade(col, -0.06 + r() * 0.14), size: [bw, bh, 1.15] });
        if (leanBook) K.tilt(b, 0, 0, (r() - 0.5) * 0.35); // 斜插书
        g.add(K.put(b, x + bw / 2, y0 + 0.35 + bh / 2, D / 2 + 0.1));
        x += bw + 0.08;
      }
      if (r() < lean * 0.4) { // 横堆一两本在最右空档
        const stack = 1 + Math.floor(r() * 2);
        for (let k = 0; k < stack; k++) {
          const bh = 0.55 + r() * 0.2;
          g.add(K.put(K.box({
            color: shade(SPINE[(s + k) % SPINE.length], -0.04),
            size: [2.2 - k * 0.3, bh, 1.3],
          }), innerW / 2 - 1.5, y0 + 0.35 + bh / 2 + k * bh, D / 2 + 0.1));
        }
      }
    }
    return g;
  },
};
