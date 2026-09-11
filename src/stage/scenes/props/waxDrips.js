// 地面烛泪（CATALOG2 编号 101）：「蜡痕点串+烛头」——floorDecal 撒印类（stone+unlit 双族，总高 ≤0.5）。
// 原点=蜡痕串中点投影（y=0 落地）；一截翻倒燃尽的烛头横卧 -x 端（+x 端面嵌 unlit 焦坑暗盘+
// 歪黑芯），烛头下垫一摊漫开蜡池；自蜡池沿 +x 拖出点串蜡痕——近头大远尾小、圆点与拉长舌
// 交替，蜡色 P.wax 冷白在深色地面上高对比。变体走 build(opts)：蜡痕点数 drips/串长 length。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'waxDrips',
  place: 'floorDecal',
  tags: ['chapel'],
  footprint: { x: 3, z: 1.8 },
  behaviors: [],
  build({ drips = 9, length = 1, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('waxDrips');
    // 翻倒烛头：横卧短烛（轴向 x），+x 端焦坑暗盘（内嵌收径）+ 歪黑芯
    const candle = K.cyl({ color: shade(P.wax, -0.06), r: 0.25, h: 0.9, seg: 7 });
    K.tilt(candle, 0, 0, Math.PI / 2);
    g.add(K.put(candle, -1.05 * length, 0.25, 0));
    const cap = K.cyl({ color: P.night, r: 0.21, h: 0.1, seg: 7, family: 'unlit' });
    K.tilt(cap, 0, 0, Math.PI / 2);
    g.add(K.put(cap, -1.05 * length + 0.47, 0.25, 0));
    const wick = K.box({ color: shade(P.night, 0.3), size: [0.05, 0.16, 0.05], family: 'unlit' });
    K.tilt(wick, 0, 0, 0.35);
    g.add(K.put(wick, -1.05 * length + 0.5, 0.27, 0.02));
    // 烛头下漫开蜡池：大一圈压扁蜡片（近头最厚）
    const pool = K.sphereLo({ color: shade(P.wax, 0.06), r: 0.5, seg: 1, jitter: 0.15, rng: r });
    K.scaleXYZ(pool, 1.3, 0.22, 1);
    g.add(K.put(pool, -0.55 * length, 0.1, 0.05));
    // 蜡痕点串：自蜡池向 +x 拖出，近头大远尾小，圆点/拉长舌交替
    const n = Math.max(4, Math.min(14, drips));
    for (let i = 0; i < n; i++) {
      const t = i / Math.max(1, n - 1);
      const x = (-0.35 + t * 1.7) * length + (r() - 0.5) * 0.12;
      const z = (r() - 0.5) * (0.5 - t * 0.25);
      const dot = K.sphereLo({
        color: [P.wax, shade(P.wax, 0.12), shade(P.wax, -0.1)][i % 3],
        r: 0.19 - t * 0.09 + r() * 0.05, seg: 0, jitter: 0.18, rng: r,
      });
      if (i % 3 === 1) K.scaleXYZ(dot, 1.9, 0.5, 0.9);    // 拉长舌痕
      else K.scaleXYZ(dot, 1, 0.55, 1);
      g.add(K.put(dot, x, 0.05, z));
    }
    return g;
  },
};
