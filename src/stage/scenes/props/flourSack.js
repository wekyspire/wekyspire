// 面粉袋（CATALOG2 编号 76）：「矮胖袋+袋口扑粉」——炊事储物小件 prop（cloth 单族，DoubleSide 软轮廓）。
// 原点=底面中心（y=0 落地）；袋身=压扁 jitter 球（矮胖剪影，约 2.6×1.55×2.1，参照 sacksGrain 单袋语汇），
// 袋口束颈+绳箍扎口；扑粉=袋口溢出的 P.flour 面粉堆（压扁球半嵌束颈上口）+ 袋肩面粉尘圈 + 袋边洒落粉扑。
// 变体走 build(opts)：洒点数 spills（0~5）/丰满度 fat。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'flourSack',
  place: 'prop',
  mount: 'floor',
  tags: ['cloth', 'kitchen'],
  footprint: { x: 3.2, z: 2.6 },
  behaviors: [],
  build({ spills = 3, fat = 1, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('flourSack');
    // 袋身：矮胖压扁 jitter 球（jitter 出软鼓轮廓，fat 控丰满度）
    const body = K.sphereLo({
      color: P.sack, r: 1, seg: 1, jitter: 0.13, rng: r, family: 'cloth',
    });
    K.scaleXYZ(body, 1.3 * fat, 0.78, 1.05);
    K.tilt(body, 0, r() * Math.PI, 0);
    g.add(K.put(body, 0, 0.72, 0));
    // 袋口束颈 + 绳箍（微歪读过口扎紧）
    const neck = K.cyl({ color: shade(P.sack, -0.05), r: 0.27, rTop: 0.2, h: 0.42, seg: 5, family: 'cloth' });
    K.tilt(neck, 0.06, 0, -0.12);
    g.add(K.put(neck, 0.14, 1.62, 0.08));
    g.add(K.put(K.cyl({ color: P.rope, r: 0.31, h: 0.15, seg: 5, family: 'cloth' }), 0.12, 1.44, 0.07));
    // 扑粉：袋口溢出的面粉堆（压扁球半嵌束颈上口）+ 袋肩面粉尘圈
    const puff = K.sphereLo({ color: P.flour, r: 0.3, seg: 1, jitter: 0.1, rng: r, family: 'cloth' });
    K.scaleXYZ(puff, 1.25, 0.6, 1.1);
    K.tilt(puff, 0.06, 0, -0.12);
    g.add(K.put(puff, 0.17, 1.84, 0.1));
    g.add(K.put(K.cyl({ color: shade(P.flour, -0.08), r: 0.5, h: 0.05, seg: 6, family: 'cloth' }), 0.05, 1.32, 0.03));
    // 袋边洒落粉扑：贴地小压扁球，绕袋身散布
    for (let i = 0; i < spills; i++) {
      const a = 0.9 + r() * 3.9;
      const d = 1.3 + r() * 0.25;
      const s = K.sphereLo({
        color: shade(P.flour, i % 2 ? 0.05 : -0.06),
        r: 0.16 + r() * 0.1, seg: 0, family: 'cloth',
      });
      K.scaleXYZ(s, 1.3, 0.4, 1.1);
      g.add(K.put(s, Math.cos(a) * d, 0.07, Math.sin(a) * d * 0.8));
    }
    return g;
  },
};
