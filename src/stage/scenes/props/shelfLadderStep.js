// 阶梯架（CATALOG2 #18）：「三级阶格+散置杂物」——起居大件 prop（wood+stone 双族）。
// 阶梯式敞架：三级阶板自前向后逐级升高（每级前立一块挡板读出「阶」），两侧斜梁
// 自前脚贯通托到末级后缘；每格散置 1~2 件杂物：书堆（横叠数册、顶册皮面）与小陶罐
// （cyl 罐身+口沿暗盘），逐层左右换位、rng 微歪。原点=底面中心（y=0 落地，+z 为前），
// 三级总高约 7。变体走 build(opts)：级数（2~4）/每格杂物件数（1~2）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

const RISE = 2.2;   // 每级升高
const DEPTH = 2.3;  // 每级进深
const WIDTH = 5.8;  // 阶板宽

export default {
  id: 'shelfLadderStep',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'container', 'quarters'],
  footprint: { x: 6.3, z: 7.5 },
  behaviors: [],
  build({ tiers = 3, items = 2, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('shelfLadderStep');
    const n = Math.min(Math.max(tiers, 2), 4);
    const per = Math.min(Math.max(items, 1), 2);
    const topY = i => 2.1 + i * RISE;
    const zc = i => 2.3 - i * DEPTH;
    // 阶板 + 前挡板：逐级升高读出「阶」，首级挡板落地、其余落在下一级顶上
    for (let i = 0; i < n; i++) {
      const plank = K.box({ color: shade(P.wood, 0.05), size: [WIDTH, 0.26, DEPTH], family: 'wood' });
      K.jitter(plank, r, { rot: 0.006 });
      g.add(K.put(plank, 0, topY(i) - 0.13, zc(i)));
      const rh = i === 0 ? topY(0) - 0.26 : RISE;
      const riser = K.box({ color: P.woodDark, size: [WIDTH, rh, 0.2], family: 'wood' });
      K.jitter(riser, r, { rot: 0.006 });
      g.add(K.put(riser, 0, topY(i) - 0.26 - rh / 2, zc(i) + DEPTH / 2 - 0.1));
    }
    // 两侧斜梁：自前脚贴地贯通到末级后缘上托（敞架的「架」骨）
    const zFront = zc(0) + DEPTH / 2, zBack = zc(n - 1) - DEPTH / 2;
    const dz = zFront - zBack, dy = topY(n - 1);
    const beam = Math.hypot(dz, dy);
    for (const s of [-1, 1]) {
      const rail = K.box({ color: P.woodDark, size: [0.22, 0.5, beam], family: 'wood' });
      rail.rotation.x = Math.atan2(dy, dz);
      K.jitter(rail, r, { rot: 0.008 });
      g.add(K.put(rail, s * 2.72, dy / 2, (zFront + zBack) / 2));
    }
    // 每格散置杂物：书堆与小罐逐层左右换位（books=横叠册+顶册皮面；jar=cyl 罐+口沿暗盘）
    for (let i = 0; i < n; i++) {
      const y = topY(i), z = zc(i);
      const booksOnLeft = i % 2 === 0;
      if (per >= 1) {
        const count = i === 0 ? 3 : 2;
        for (let b = 0; b < count; b++) {
          const bk = K.box({
            color: b === count - 1 ? shade(P.woodDark, 0.06)
              : (b % 2 ? shade(P.parchment, -0.06) : P.parchment),
            size: [1.15, 0.16, 0.82], family: 'wood',
          });
          K.tilt(bk, 0, (r() - 0.5) * 0.3, 0);
          g.add(K.put(bk,
            (booksOnLeft ? -1.5 : 1.5) + (r() - 0.5) * 0.12,
            y + 0.08 + b * 0.16,
            z + (r() - 0.5) * 0.12));
        }
      }
      if (per >= 2) {
        const jx = booksOnLeft ? 1.55 : -1.55;
        const jar = K.cyl({ color: P.clay, r: 0.42, rTop: 0.33, h: 0.85, seg: 6, family: 'stone' });
        K.tilt(jar, (r() - 0.5) * 0.06, 0, (r() - 0.5) * 0.06);
        g.add(K.put(jar, jx, y + 0.425, z + (r() - 0.5) * 0.1));
        g.add(K.put(K.cyl({ color: P.clayDark, r: 0.3, h: 0.06, seg: 6, family: 'stone' }), jx, y + 0.83, z));
      }
    }
    return g;
  },
};
