// 刻痕涂鸦（CATALOG #85）：「石刻文字与符文涂划，笔画生涩」——wallDecor 低/中双带（stone+unlit 双族）。
// 原点=刻痕板底缘中点（z=0 贴墙面，+z 朝室内，y 向上）；band=['low','mid']。贴墙薄石片
// （th 0.14，微亮出「后补石面」差 + 缺角崩口）上窄棱刻线生涩排布：每枚符文=主竖 + 斜臂
// （偶发短第二笔），歪斜、深浅（明暗 tone）不一；unlit 夜色读作刻槽深洞，底部几道斜长涂划。
// 变体走 build(opts)：刻痕密度 density（每行符文数）与涂划数 scratches。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'runesScratch',
  place: 'wallDecor',
  band: ['low', 'mid'],
  tags: ['decal'],
  behaviors: [],
  build({ density = 1, scratches = 3, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('runesScratch');
    // 贴墙薄石片：一角缺崩
    const slab = K.box({ color: shade(P.wall, 0.09), size: [4.2, 6, 0.14] });
    K.chip(slab, { corner: [1, 1, 1], amount: 0.22 });
    g.add(K.put(slab, 0, 3, 0.07));
    // 符文刻线：两行窄棱（unlit 夜色系明暗轮换 = 深浅不一）
    const perRow = Math.min(6, Math.max(3, Math.round(4 + density)));
    const tones = [P.night, shade(P.night, 0.14), shade(P.night, 0.26)];
    for (let row = 0; row < 2; row++) {
      const cy = 4.35 - row * 2.1;
      const n = perRow - (row % 2);                    // 第二行少一枚，排布不齐整
      for (let i = 0; i < n; i++) {
        const cx = -1.7 + (i + 0.5) * (3.4 / n) + (r() - 0.5) * 0.18;
        const tone = tones[Math.floor(r() * 3)];
        const sl = 1.05 + r() * 0.5;                   // 主竖长
        const stem = K.box({ color: tone, size: [0.16, sl, 0.09], family: 'unlit' });
        K.tilt(stem, 0, 0, (r() - 0.5) * 0.24);        // 歪斜
        g.add(K.put(stem, cx, cy + sl * 0.5, 0.21));
        const aa = (r() < 0.5 ? 1 : -1) * (0.45 + r() * 0.5);
        const arm = K.box({ color: tone, size: [0.72 + r() * 0.2, 0.13, 0.08], family: 'unlit' });
        K.tilt(arm, 0, 0, aa);
        g.add(K.put(arm, cx + Math.cos(aa) * 0.32, cy + sl * 0.74, 0.21));
        if (r() < 0.45) {                              // 偶发短第二笔（生涩感）
          const arm2 = K.box({ color: tone, size: [0.5, 0.12, 0.07], family: 'unlit' });
          const a2 = -aa * 0.7;
          K.tilt(arm2, 0, 0, a2);
          g.add(K.put(arm2, cx - Math.cos(a2) * 0.2, cy + sl * 0.45, 0.21));
        }
      }
    }
    // 底部长涂划：斜长刻痕（乱笔涂鸦）
    const ns = Math.max(0, Math.min(5, Math.round(scratches)));
    for (let i = 0; i < ns; i++) {
      const sc = K.box({ color: shade(P.night, 0.18 + r() * 0.12), size: [1.3 + r() * 0.8, 0.15, 0.08], family: 'unlit' });
      K.tilt(sc, 0, 0, (r() - 0.5) * 0.9);
      g.add(K.put(sc, (r() - 0.5) * 2.4, 0.75 + r() * 0.7, 0.21));
    }
    return g;
  },
};
