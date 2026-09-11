// 大沙漏（CATALOG2 编号 117）：「立架双球+沙线」——奥术小件 prop（wood+glass+stone 三族）。
// 原点=底面中心（y=0 落地），全高约 3.9（S 档）；木立架=底/顶厚板+双侧立柱+顶珠，
// 双球=玻璃族 sphereLo 上下双腹（y 拉长）+束腰短管衔接；沙=stone 族 P.straw：底腹沙堆
// （锥）+顶腹余沙+束腰垂落的细沙线（细 cyl，P.straw 提亮一档）。变体走 build(opts)：
// 沙量 sand（0~1 → 底堆高度/顶腹余沙/沙线长短）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'hourglassStand',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'glass', 'arcane'],
  footprint: { x: 1.9, z: 1.5 },
  behaviors: [],
  build({ sand = 0.55, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('hourglassStand');
    const s = Math.min(Math.max(sand, 0.12), 1);
    // 木立架：底板 + 双侧柱 + 顶板 + 顶珠（柱微外倾求老木感）
    g.add(K.plate({ color: P.woodDark, w: 1.8, d: 1.3, th: 0.24, family: 'wood' }));
    for (const sx of [-1, 1]) {
      const post = K.box({ color: P.wood, size: [0.22, 3.38, 0.22], family: 'wood' });
      K.tilt(post, 0, 0, sx * (0.015 + (r() - 0.5) * 0.01));
      g.add(K.put(post, sx * 0.79, 1.93, 0));
      g.add(K.put(K.sphereLo({ color: shade(P.wood, 0.12), r: 0.13, seg: 0, family: 'wood' }), sx * 0.79, 3.79, 0));
    }
    g.add(K.put(K.box({ color: P.woodDark, size: [1.8, 0.2, 1.3], family: 'wood' }), 0, 3.62, 0));
    // 玻璃双腹：上下 sphereLo（y 拉长 1.12）+ 束腰短管
    for (const cy of [1.04, 2.5]) {
      const bulb = K.sphereLo({ color: shade(P.glowCyan, -0.34), r: 0.6, seg: 1, family: 'glass' });
      K.scaleXYZ(bulb, 1, 1.12, 1);
      g.add(K.put(bulb, 0, cy, 0));
    }
    g.add(K.put(K.cyl({ color: shade(P.glowCyan, -0.3), r: 0.1, h: 0.34, seg: 6, family: 'glass' }), 0, 1.77, 0));
    // 底腹沙堆：P.straw 锥（沙量越高堆越高）
    const pileH = 0.22 + 0.5 * s;
    const pile = K.cone({ color: P.straw, r: 0.42, h: pileH, seg: 7, family: 'stone' });
    K.tilt(pile, 0, r() * 0.4, 0);
    g.add(K.put(pile, 0, 0.42 + pileH / 2, 0));
    // 顶腹余沙：束腰上方小锥（沙多堆高、沙少见底）
    const resH = 0.12 + 0.2 * s;
    const residual = K.cone({ color: shade(P.straw, 0.08), r: 0.24 + 0.1 * s, h: resH, seg: 6, family: 'stone' });
    K.tilt(residual, 0, r() * 0.5, 0);
    g.add(K.put(residual, 0, 1.94 + resH / 2, 0));
    // 细沙线：束腰底到沙堆顶的细圆柱（提亮一档读作流动沙流）
    const topPile = 0.42 + pileH;
    const stream = K.cyl({ color: shade(P.straw, 0.18), r: 0.045, h: 1.6 - topPile, seg: 5, family: 'stone' });
    g.add(K.put(stream, 0, topPile + (1.6 - topPile) / 2, 0));
    return g;
  },
};
