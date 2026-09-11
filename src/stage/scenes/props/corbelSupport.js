// 牛腿托（CATALOG2 编号 111）：「墙挑托石+卷叶雕」——wallStructure（纯 stone 单族）。
// 原点=墙脚挂点（z=0 贴墙面，+z 朝室内，自地面向上，同 pilasterHalf）；占 1 墙段，
// 全高约 3.9、挑出约 2.6。挑石=贴墙竖背 + 逐层加深的三级托身（阶梯收分、微错位砌感）
// + 出挑托板与压顶条（缺角风化）；卷叶雕=底端横卷涡（双叠横圆柱读螺旋卷）+ 前缘斜升
// 叶板（提亮读雕件，tilt rx 让叶梢探向托板底）。变体走 build(opts)：courses 托身级数
// （2~3）/leaves 叶板数（1~2）/chipped 托板缺角。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'corbelSupport',
  place: 'wallStructure',
  bayWidth: 1,
  tags: ['stone', 'generic'],
  behaviors: [],
  build({ courses = 3, leaves = 1, chipped = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('corbelSupport');
    const n = Math.min(3, Math.max(2, Math.round(courses)));
    // 基座 + 贴墙竖背（承力背条，自地面升到托板下）
    g.add(K.put(K.box({ color: shade(P.stone, -0.12), size: [1.75, 0.7, 0.95] }), 0, 0.35, 0.475));
    g.add(K.put(K.box({ color: P.stone, size: [1.5, 2.4, 0.4] }), 0, 0.7 + 1.2, 0.2));
    // 托身：逐层加深收分的级配石（阶梯出挑），微错位的手工砌感
    const spanY = 3.1 - 0.7;
    for (let i = 0; i < n; i++) {
      const d = 1.0 + ((i + 1) / n) * 1.2;
      const w = 1.7 - i * 0.09;
      const course = K.box({ color: shade(P.stone, i % 2 ? -0.05 : 0.03), size: [w, spanY / n, d] });
      K.jitter(course, r, { rot: 0.008 });
      g.add(K.put(course, 0, 0.7 + spanY / n * (i + 0.5), d / 2));
    }
    // 托板 + 压顶条（四向出挑，风化缺角）
    const slab = K.box({ color: shade(P.stone, 0.06), size: [2.15, 0.55, 2.6] });
    if (chipped) K.chip(slab, { corner: [1, 1, 1], amount: 0.24 });
    g.add(K.put(slab, 0, 3.1 + 0.275, 1.3));
    g.add(K.put(K.box({ color: shade(P.stone, 0.12), size: [2.25, 0.22, 2.45] }), 0, 3.65 + 0.11, 1.225));
    // 卷涡：底端双叠横圆柱（大卷在下、小卷在前上 = 螺旋收头）
    const roll1 = K.cyl({ color: shade(P.stone, 0.02), r: 0.3, h: 1.3, seg: 7 });
    K.tilt(roll1, 0, 0, Math.PI / 2);
    g.add(K.put(roll1, 0, 0.62, 0.85));
    const roll2 = K.cyl({ color: shade(P.stone, 0.12), r: 0.17, h: 1.05, seg: 6 });
    K.tilt(roll2, 0, 0, Math.PI / 2);
    g.add(K.put(roll2, 0, 0.94, 1.1));
    // 卷叶雕：前缘斜升叶板（提亮读雕件，叶梢探向托板底；可叠窄副叶）
    const nl = Math.min(2, Math.max(1, Math.round(leaves)));
    const leafTilt = 0.46;
    for (let i = 0; i < nl; i++) {
      const leaf = K.box({
        color: shade(P.stone, i ? 0.09 : 0.16),
        size: [i ? 0.62 : 1.12, i ? 2.1 : 2.62, 0.15],
      });
      K.tilt(leaf, leafTilt - i * 0.08, 0, 0);
      g.add(K.put(leaf, i ? -0.42 : 0, 2.0 - i * 0.22, 1.5 + i * 0.12));
    }
    return g;
  },
};
