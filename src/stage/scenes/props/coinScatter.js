// 散落金币（CATALOG #57）：「十几枚金币洒地，微反光」——floorDecal 撒印类（纯 metal 单族贴地）。
// 原点=币群中心投影（y=0 落地）；薄六边圆柱金币 rng 洒地（头密尾疏），两小摞叠币，个别翻边
// 斜立；微反光来自 metal 族 + 币面明暗微差。总高 ≤0.4。
// 变体走 build(opts)：币数/摊开度/摞数。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 单枚金币：薄六边圆柱，明暗微差读作反光；edge=true 时翻边斜立
function coin(r, { edge = false } = {}) {
  const c = K.cyl({
    color: shade(P.gold, 0.22 + (r() - 0.5) * 0.26),
    r: 0.26 + r() * 0.05, h: 0.09, seg: 6, family: 'metal',
  });
  if (edge) {
    K.tilt(c, Math.PI / 2 - 0.12 + (r() - 0.5) * 0.24, r() * Math.PI, 0);
  } else {
    K.tilt(c, (r() - 0.5) * 0.3, r() * Math.PI, (r() - 0.5) * 0.3);
  }
  return c;
}

export default {
  id: 'coinScatter',
  place: 'floorDecal',
  tags: ['decal', 'metal'],
  footprint: { x: 4, z: 3 },
  behaviors: [],
  build({ coins = 14, spread = 1, stacks = 2, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('coinScatter');
    for (let i = 0; i < coins; i++) {             // 洒币：幂次半径=头密尾疏
      const a = r() * Math.PI * 2;
      const rad = Math.pow(r(), 1.5) * 1.75 * spread;
      const edge = r() < 0.14;                    // 个别翻边立起
      g.add(K.put(coin(r, { edge }), Math.cos(a) * rad, edge ? 0.17 : 0.05, Math.sin(a) * rad * 0.75));
    }
    // 叠币小摞：两三枚错位堆起（读作洒落后又滚落成摞）
    for (let s = 0; s < stacks; s++) {
      const a = r() * Math.PI * 2;
      const cx = Math.cos(a) * (0.4 + r() * 0.5) * spread;
      const cz = Math.sin(a) * (0.4 + r() * 0.5) * spread * 0.75;
      const n = 2 + Math.floor(r() * 2);
      for (let k = 0; k < n; k++) {
        const c = K.cyl({ color: shade(P.gold, 0.22 + k * 0.05), r: 0.28, h: 0.09, seg: 6, family: 'metal' });
        K.tilt(c, (r() - 0.5) * 0.1, r() * Math.PI, (r() - 0.5) * 0.1);
        g.add(K.put(c, cx + (r() - 0.5) * 0.07, 0.04 + k * 0.062, cz + (r() - 0.5) * 0.07));
      }
    }
    return g;
  },
};
