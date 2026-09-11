// 水洼（CATALOG #59）：「浅洼微反光，边缘湿深」——floorDecal 撒印类（纯 glass 单族贴地薄片）。
// 原点=洼心投影（y=0 落地）；微反光= glass 族半透明低粗糙自带反光感；边缘湿深= 垫底大一圈的
// 压暗水色薄片露出主洼外缘。总高 ≤0.2。变体走 build(opts)：洼面尺寸/溅点数。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'puddleWater',
  place: 'floorDecal',
  tags: ['decal', 'water'],
  footprint: { x: 5, z: 4 },
  behaviors: [],
  build({ size = 1, drops = 3, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('puddleWater');
    // 垫底湿边：大一圈压暗水色（读作浸湿外圈，边缘湿深）
    const wet = K.cyl({ color: shade(P.water, -0.34), r: 1.85 * size, h: 0.06, seg: 8, family: 'glass' });
    K.scaleXYZ(wet, 1.26, 1, 0.9);
    K.tilt(wet, 0, r() * Math.PI * 2, 0);
    g.add(K.put(wet, 0, 0.03, 0));
    // 主洼面：半透明水色厚片（微反光来自 glass 族低粗糙）
    const pool = K.cyl({ color: shade(P.water, 0.16), r: 1.7 * size, h: 0.2, seg: 8, family: 'glass' });
    K.scaleXYZ(pool, 1.22, 1, 0.84);
    K.tilt(pool, 0, wet.rotation.y + (r() - 0.5) * 0.5, 0);
    g.add(K.put(pool, (r() - 0.5) * 0.2, 0.09, (r() - 0.5) * 0.2));
    // 卫星小洼 + 溅点：rng 洒在主洼外缘（首点大=小卫星洼，余为细溅点）
    for (let i = 0; i < drops; i++) {
      const a = r() * Math.PI * 2;
      const rad = (1.5 + r() * 0.35) * size;
      const s = (0.1 + r() * 0.08) * size * (i === 0 ? 3 : 1);
      const dot = K.cyl({ color: shade(P.water, -0.12), r: s, h: 0.07, seg: 6, family: 'glass' });
      g.add(K.put(dot, Math.cos(a) * rad, 0.035, Math.sin(a) * rad * 0.85));
    }
    return g;
  },
};
