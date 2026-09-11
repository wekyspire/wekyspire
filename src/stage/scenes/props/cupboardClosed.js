// 碗柜（CATALOG2 #7）：「双门高柜+顶檐线脚」——起居家具 prop（纯 wood 单族）。
// 原点=底面中心（y=0 落地），x=宽 z=深；柜身 4.4×2.3，总高约 8.5（座脚 0.42 + 柜身 7.2 +
// 檐口两阶 0.86）。双门闭合：门板微凸出柜面、中缝一线，双木钮对缝；顶檐线脚沿用
// statuePedestal 的两阶收放手法定义。变体走 build(opts)：门缝宽 seam / 檐口出挑 eave。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'cupboardClosed',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'container', 'quarters'],
  footprint: { x: 5.0, z: 2.9 },
  behaviors: [],
  build({ seam = 0.1, eave = 1, rng } = {}) {
    const g = new THREE.Group();
    const w = 4.4, h = 7.2, d = 2.3, base = 0.42;
    // 座脚（内收方座）+ 柜身
    g.add(K.put(K.box({ color: P.woodDark, size: [w - 0.7, base, d - 0.7], family: 'wood' }), 0, base / 2, 0));
    const body = K.box({ color: P.wood, size: [w, h, d], family: 'wood' });
    if (rng) K.jitter(body, rng, { rot: 0.01 });
    g.add(K.put(body, 0, base + h / 2, 0));
    // 双门：对缝留 seam 细缝，门板凸出柜面一档；木钮对缝而立
    const doorW = (w - 0.24 - seam) / 2;
    for (const s of [-1, 1]) {
      const door = K.box({ color: shade(P.wood, 0.06), size: [doorW, h - 0.9, 0.16], family: 'wood' });
      K.tilt(door, 0, 0, s * 0.004);
      g.add(K.put(door, s * (seam / 2 + doorW / 2), base + h / 2, d / 2 + 0.08));
      g.add(K.put(K.box({
        color: shade(P.woodDark, 0.1), size: [0.18, 0.18, 0.14], family: 'wood',
      }), s * (seam / 2 + 0.25), base + h / 2 + 0.5, d / 2 + 0.19));
    }
    // 顶檐线脚：束颈一阶收进 + 檐板出挑（两阶收放）
    const top = base + h;
    g.add(K.put(K.box({ color: P.woodDark, size: [w - 0.3, 0.36, d - 0.3], family: 'wood' }), 0, top + 0.18, 0));
    g.add(K.put(K.box({
      color: shade(P.wood, 0.08), size: [w + 0.5 * eave, 0.5, d + 0.5 * eave], family: 'wood',
    }), 0, top + 0.61, 0));
    return g;
  },
};
