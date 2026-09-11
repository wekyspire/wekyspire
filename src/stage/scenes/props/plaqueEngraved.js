// 铭碑石（CATALOG2 编号 113）：「刻字石板+边框线」——wallStructure（stone+unlit 双族）。
// 原点=墙脚挂点（z=0 贴墙面、+z 朝室内，自地面向上）；占 1 墙段，碑面约 4×6、全高约 7.2。
// 石碑=基座 + 厚碑板（一角风化崩缺）+ 顶檐线脚条；边框线=unlit 夜色细条在碑面围出
// 内框（刻槽读深洞）；刻字=短横条阵（runesScratch 语言但更规整：行距均一、行首对齐、
// 行宽渐收，首行居中题铭条 + 其下分隔细线）。变体走 build(opts)：rows 刻行数（3~6）/
// chipped 碑角崩缺。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'plaqueEngraved',
  place: 'wallStructure',
  bayWidth: 1,
  tags: ['stone', 'crypt'],
  behaviors: [],
  build({ rows = 5, chipped = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('plaqueEngraved');
    const n = Math.min(6, Math.max(3, Math.round(rows)));
    // 基座 + 碑板 + 顶檐条（碑面 4×6，崩缺一角读风化）
    g.add(K.put(K.box({ color: shade(P.stone, -0.12), size: [4.5, 0.85, 0.85] }), 0, 0.425, 0.425));
    const slab = K.box({ color: P.stone, size: [4.0, 6.0, 0.55] });
    if (chipped) K.chip(slab, { corner: [1, 1, 1], amount: 0.2 });
    K.jitter(slab, r, { rot: 0.005 });
    g.add(K.put(slab, 0, 3.85, 0.275));
    g.add(K.put(K.box({ color: shade(P.stone, 0.06), size: [4.35, 0.38, 0.72] }), 0, 7.04, 0.36));
    // 边框线：夜色细条围出内框（比刻字浅一档提亮，读浅刻槽）
    const trim = shade(P.night, 0.12), cz = 0.56;
    for (const fy of [1.45, 6.25]) {
      g.add(K.put(K.box({ color: trim, size: [2.84, 0.09, 0.07], family: 'unlit' }), 0, fy, cz));
    }
    for (const fx of [-1.42, 1.42]) {
      g.add(K.put(K.box({ color: trim, size: [0.09, 4.89, 0.07], family: 'unlit' }), fx, 3.85, cz));
    }
    // 题铭：居中题条 + 分隔细线
    g.add(K.put(K.box({ color: P.night, size: [1.7, 0.2, 0.07], family: 'unlit' }), 0.08, 5.7, cz));
    g.add(K.put(K.box({ color: shade(P.night, 0.18), size: [2.2, 0.07, 0.06], family: 'unlit' }), 0, 5.3, cz));
    // 刻字短横条阵：行距均一、行首对齐、行宽渐收（末行半宽收尾）
    const yTop = 4.85, yBot = 1.85;
    const step = n > 1 ? (yTop - yBot) / (n - 1) : 0;
    for (let row = 0; row < n; row++) {
      const cy = n > 1 ? yTop - row * step : (yTop + yBot) / 2;
      const last = row === n - 1;
      const bars = last ? 1 + Math.floor(r() * 2) : 3 + Math.floor(r() * 2);
      let x = -1.2 + r() * 0.08;                           // 行首对齐（微缩进差）
      for (let i = 0; i < bars; i++) {
        const w = last ? 0.4 + r() * 0.3 : 0.5 + r() * 0.25;
        g.add(K.put(K.box({
          color: i % 3 === 2 ? shade(P.night, 0.05) : P.night,
          size: [w, 0.13, 0.06], family: 'unlit',
        }), x + w / 2, cy, cz));
        x += w + 0.13;
      }
    }
    return g;
  },
};
