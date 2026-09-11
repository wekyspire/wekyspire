// 扶壁（CATALOG #66）：「斜撑墙垛，压顶石」——wallStructure 类（纯 stone 单族）。
// 原点=墙脚挂点（z=0 贴墙面，+z 朝室内，同 pilasterHalf 约定），占 1 墙段，全高约 18。
// 斜撑=prism 侧转的直角楔（垂直背贴墙、斜面自墩面收到墙面，入墙半藏）；
// 压顶石=双坡尖顶 prism 盖，四向出挑。变体走 build(opts)：墩身高/斜撑高/基座缺角。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'buttressWall',
  place: 'wallStructure',
  bayWidth: 1,
  tags: ['stone'],
  behaviors: [],
  build({ shaftH = 7.6, slopeH = 5.4, upperH = 2.9, chipped = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('buttressWall');
    const capH = 1.1;
    // 基座（plinth，前伸最宽的承台），风化缺角
    const plinth = K.box({ color: shade(P.stone, -0.12), size: [2.5, 0.9, 3.0] });
    if (chipped) K.chip(plinth, { corner: [1, 1, 1], amount: 0.3 });
    g.add(K.put(plinth, 0, 0.45, 1.5));
    // 主墩身：微错位的手工砌感 + 半高腰线（略出挑）
    const y1 = 0.9;
    const shaft = K.box({ color: P.stone, size: [2.0, shaftH, 2.6] });
    K.jitter(shaft, r, { rot: 0.008 });
    g.add(K.put(shaft, 0, y1 + shaftH / 2, 1.3));
    g.add(K.put(K.box({ color: shade(P.stone, 0.05), size: [2.25, 0.4, 2.85] }), 0, y1 + shaftH * 0.55, 1.425));
    // 斜撑楔（prism 绕 y 转 90°：等腰三角剖面立起来，脊贴墙面，半边入墙藏掉）
    const y2 = y1 + shaftH;
    const wedge = K.tilt(K.prism({ color: shade(P.stone, -0.04), size: [5.2, slopeH, 2.0] }), 0, -Math.PI / 2, 0);
    g.add(K.put(wedge, 0, y2 + slopeH / 2, 0));
    // 上墩（收细）+ 压顶石（双坡尖顶盖，四向出挑）
    const y3 = y2 + slopeH;
    g.add(K.put(K.box({ color: P.stone, size: [1.8, upperH, 1.4] }), 0, y3 + upperH / 2, 0.7));
    g.add(K.put(K.prism({ color: shade(P.stone, 0.08), size: [2.4, capH, 2.1] }), 0, y3 + upperH + capH / 2, 0.7));
    return g;
  },
};
