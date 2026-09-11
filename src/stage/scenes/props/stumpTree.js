// 树桩（CATALOG2 编号 82）：「矮桩+年轮顶面+斧痕」——smallWall 宿主（纯 wood 单族）。
// 原点=底面中心（y=0 落地，桩径约 2.5、高约 2.5，S 档 topY 低）：八棱桶身（树皮
// woodDark 微收分）+浅根腿外扒三处；顶面=浅色横切板 + 同心年轮（2-3 圈薄环阶梯嵌顶，
// 色差交替读作年轮）；斧痕=楔形缺口 chip（桶身两口、错向咬进侧缘）。
// 变体走 build(opts)：年轮数/斧痕数/根腿数/桩高。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'stumpTree',
  place: 'smallWall',
  tags: ['wood', 'nature'],
  footprint: { x: 3.0, z: 3.0 },
  topY: 2.55, // 桶身 2.34 + 切面板顶 2.44 + 三圈年环阶梯至 2.556（实测与声明差 <0.5）
  behaviors: [],
  build({ h = 2.34, rings = 3, chips = 2, flares = 3, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('stumpTree');
    // 桶身：八棱微收分（树皮暗色），两口楔形斧痕（chip 错向咬进侧缘）
    const body = K.cyl({ color: P.woodDark, r: 1.25, rTop: 1.16, h, seg: 8, family: 'wood' });
    if (chips > 0) K.chip(body, { corner: [1, 1, 1], amount: 0.3 });
    if (chips > 1) K.chip(body, { corner: [-1, 1, -1], amount: 0.22 });
    K.jitter(body, r, { rot: 0.018 });
    g.add(K.put(body, 0, h / 2, 0));
    // 浅根腿：外扒的木墩（长边径向、微外倾下趴）
    const fn = Math.max(2, Math.min(4, flares));
    for (let i = 0; i < fn; i++) {
      const fa = (i / fn) * Math.PI * 2 + r() * 0.5;
      const leg = K.box({ color: shade(P.woodDark, -0.08), size: [0.8, 0.6, 0.55], family: 'wood' });
      K.tilt(leg, 0, -fa, -0.15 + (r() - 0.5) * 0.06);
      g.add(K.put(leg, Math.cos(fa) * 1.08, 0.28, Math.sin(fa) * 1.08));
    }
    // 顶面：浅色横切板（年轮底）+ 同心薄环阶梯嵌顶（逐圈抬高读作年轮）
    g.add(K.put(K.cyl({
      color: shade(P.wood, 0.14), r: 1.1, h: 0.1, seg: 8, family: 'wood',
    }), 0, h + 0.05, 0));
    const ringR = rings >= 3 ? [0.9, 0.6, 0.34] : [0.9, 0.38];
    const ringC = [shade(P.wood, -0.06), shade(P.wood, 0.22), shade(P.wood, 0.06)];
    ringR.forEach((rr, i) => {
      g.add(K.put(K.cyl({
        color: ringC[i % 3], r: rr, h: 0.06, seg: 8, family: 'wood',
      }), 0, h + 0.13 + i * 0.028, 0));
    });
    return g;
  },
};
