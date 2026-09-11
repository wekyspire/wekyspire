// 血渍（CATALOG #54）：「暗红泼溅渍，边缘沉色」——floorDecal 撒印类（纯 stone 单族贴地薄片）。
// 原点=渍心投影（y=0 落地）；中心渍片 + 垫底暗晕（露出主体外缘读作边缘沉色）+ rng 泼溅点
// （越远越暗，每第三点拉长为滴痕），总高 ≤0.2。变体走 build(opts)：渍面尺寸/泼溅点数。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'bloodStain',
  place: 'floorDecal',
  tags: ['decal', 'gore'],
  footprint: { x: 3, z: 3 },
  behaviors: [],
  build({ size = 1, drops = 9, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('bloodStain');
    // 垫底暗晕：大一圈的压暗血色薄片，读作边缘沉积
    const halo = K.cyl({ color: shade(P.blood, -0.42), r: 1.5 * size, h: 0.06, seg: 8 });
    K.scaleXYZ(halo, 1.22, 1, 0.92);
    K.tilt(halo, 0, r() * Math.PI * 2, 0);
    g.add(K.put(halo, 0, 0.03, 0));
    // 中心渍片：椭圆厚片（泼溅主体）
    const core = K.cyl({ color: shade(P.blood, 0.5), r: 1.24 * size, h: 0.14, seg: 8 });
    K.scaleXYZ(core, 1.18, 1, 0.86);
    K.tilt(core, 0, halo.rotation.y + (r() - 0.5) * 0.4, 0);
    g.add(K.put(core, (r() - 0.5) * 0.3, 0.1, (r() - 0.5) * 0.25));
    // 泼溅点：环带 rng 洒落，越远越小越暗；长条滴痕与圆点交替
    for (let i = 0; i < drops; i++) {
      const a = r() * Math.PI * 2;
      const rad = (0.85 + r() * 0.5) * size;
      const dot = K.cyl({
        color: shade(P.blood, -0.18 - r() * 0.16),
        r: (0.14 + r() * 0.1) * size, h: 0.08, seg: 6,
      });
      if (i % 3 === 0) K.scaleXYZ(dot, 2.2, 1, 0.6);
      K.tilt(dot, (r() - 0.5) * 0.16, r() * Math.PI * 2, (r() - 0.5) * 0.16);
      g.add(K.put(dot, Math.cos(a) * rad, 0.04, Math.sin(a) * rad * 0.85));
    }
    return g;
  },
};
