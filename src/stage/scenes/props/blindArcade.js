// 盲拱连排（CATALOG #68）：「纯装饰拱洞三连，龛内阴影」——wallStructure 类（stone + unlit 双族）。
// 原点=墙脚挂点（z=0 贴墙面，+z 朝室内，同 pilasterHalf）；占 2 墙段（bayWidth:2），总宽 ~10.4。
// 每跨 = 石环盘在前 + unlit P.night 暗片更前压盘心 = 拱洞环 + 龛内阴影（vaseClay 手法），
// 墩柱与冠带压边收形。纯装饰不开洞。变体走 build(opts)：bays（拱洞数 2~3）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'blindArcade',
  place: 'wallStructure',
  bayWidth: 2,
  tags: ['stone', 'arcade'],
  behaviors: [],
  build({ bays = 3, rng } = {}) {
    const g = new THREE.Group();
    const n = Math.min(3, Math.max(2, Math.round(bays)));
    const W = 10.4;            // 总宽（2 墙段）
    const pierW = 0.85;        // 墩柱宽
    const bayW = (W - (n + 1) * pierW) / n;
    const springY = 8.2;       // 起拱线
    const voidR = Math.min(1.05, bayW * 0.38); // 拱洞半径（暗片）
    const ringR = voidR + 0.28;                // 石环盘半径
    const archTop = springY + ringR;

    // 底带 + 冠带（压顶，front 最凸）
    g.add(K.put(K.box({ color: shade(P.stone, -0.1), size: [W + 0.4, 2.0, 1.15] }), 0, 1.0, 0.575));
    g.add(K.put(K.box({ color: shade(P.stone, -0.06), size: [W + 0.4, 1.0, 1.25] }), 0, archTop + 0.5, 0.625));

    // 逐跨布置：墩柱 + 拱洞（暗矩形龛身 + 暗半圆 + 石环盘）+ 起拱垫块
    let x = -W / 2 + pierW / 2;
    for (let i = 0; i < n; i++) {
      const cx = x + pierW / 2 + bayW / 2; // 本跨中心
      g.add(K.put(K.box({ color: P.night, size: [voidR * 2, springY - 2.0, 0.3], family: 'unlit' }), cx, (2.0 + springY) / 2, 0.2));
      g.add(K.put(K.tilt(K.cyl({ color: P.stone, r: ringR, h: 0.35, seg: 9 }), Math.PI / 2), cx, springY, 0.625));
      g.add(K.put(K.tilt(K.cyl({ color: P.night, r: voidR, h: 0.12, seg: 9, family: 'unlit' }), Math.PI / 2), cx, springY, 0.875));
      x += pierW + bayW;
    }
    // 墩柱与起拱垫块（后置：横跨柱距，垫块 front 出盘一档读作承拱）
    x = -W / 2 + pierW / 2;
    for (let i = 0; i <= n; i++) {
      const pier = K.box({ color: shade(P.stone, i % 2 ? -0.04 : 0.04), size: [pierW, springY - 2.0, 1.0] });
      if (rng) K.jitter(pier, rng, { rot: 0.008 });
      g.add(K.put(pier, x, (2.0 + springY) / 2, 0.5));
      g.add(K.put(K.box({ color: shade(P.stone, 0.1), size: [pierW + 0.2, 0.5, 1.05] }), x, springY + 0.15, 0.55));
      x += pierW + bayW;
    }
    return g;
  },
};
