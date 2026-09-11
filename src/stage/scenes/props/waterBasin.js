// 积水潭（CATALOG2 编号 102）：「大水洼+同心波纹圈」——floorDecal 撒印类（纯 glass 单族，总高 ≤0.4）。
// 原点=潭心投影（y=0 落地）；大水洼=湿边垫底压暗大椭圆（浸湿外圈）+主潭水色厚片（puddleWater
// 同语汇放大）；同心波纹=亮暗交替环片（批3 红线：波纹必须读得出）——最外圈断裂亮弧段（波纹
// 起圈）→暗环片→亮环片→反色心点，逐圈微抬防 z-fight。卫星小水洼点缀潭缘。
// 变体走 build(opts)：潭面尺寸 size/波纹环数 rings/溅点数 drops。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'waterBasin',
  place: 'floorDecal',
  tags: ['decal', 'water'],
  footprint: { x: 7, z: 5 },
  behaviors: [],
  build({ size = 1, rings = 2, drops = 3, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('waterBasin');
    const yaw = r() * Math.PI * 2;
    // 湿边垫底：大一圈压暗水色（读作浸湿外圈，边缘湿深）
    const halo = K.cyl({ color: shade(P.water, -0.38), r: 3.35 * size, h: 0.06, seg: 9, family: 'glass' });
    K.scaleXYZ(halo, 1.12, 1, 0.8);
    K.tilt(halo, 0, yaw + (r() - 0.5) * 0.4, 0);
    g.add(K.put(halo, 0, 0.03, 0));
    // 主潭面：半透明水色厚片（微反光来自 glass 族低粗糙）
    const pool = K.cyl({ color: shade(P.water, 0.08), r: 3.0 * size, h: 0.18, seg: 9, family: 'glass' });
    K.scaleXYZ(pool, 1.08, 1, 0.8);
    K.tilt(pool, 0, yaw, 0);
    g.add(K.put(pool, 0, 0.09, 0));
    // 最外圈波纹：断裂亮弧段（亮环起圈，切向排布，随机缺段读作波纹荡开）
    const arcR = 2.2 * size;
    const NARC = 9;
    const segLen = (2 * Math.PI * arcR / NARC) * 1.15;
    for (let i = 0; i < NARC; i++) {
      const a = (i / NARC) * Math.PI * 2 + r() * 0.15;
      if (r() < 0.18) continue;                     // 断裂：缺段
      const arc = K.box({ color: shade(P.water, 0.32), size: [segLen, 0.06, 0.24], family: 'glass' });
      K.tilt(arc, 0, Math.PI / 2 - a, (r() - 0.5) * 0.1);
      g.add(K.put(arc, Math.cos(a) * arcR * 1.08, 0.21, Math.sin(a) * arcR * 0.8));
    }
    // 内圈同心环片：亮暗交替（暗→亮→暗），逐圈微抬防 z-fight
    const rn = Math.max(1, Math.min(3, rings));
    const fr = [0.52, 0.34, 0.2];
    for (let k = 0; k < rn; k++) {
      const tone = k % 2 ? shade(P.water, 0.28) : shade(P.water, -0.24);
      const disc = K.cyl({ color: tone, r: 3.0 * fr[k] * size, h: 0.05, seg: 8, family: 'glass' });
      K.scaleXYZ(disc, 1.08, 1, 0.8);
      K.tilt(disc, 0, yaw, 0);
      g.add(K.put(disc, 0, 0.22 + k * 0.045, 0));
    }
    // 心点：与末环反色的中央小片（波纹圆心）
    const cTone = rn % 2 ? shade(P.water, -0.24) : shade(P.water, 0.3);
    const core = K.cyl({ color: cTone, r: 0.3 * size, h: 0.05, seg: 6, family: 'glass' });
    K.scaleXYZ(core, 1.08, 1, 0.8);
    K.tilt(core, 0, yaw, 0);
    g.add(K.put(core, 0, 0.22 + rn * 0.045, 0));
    // 卫星小水洼：潭缘外小湿点
    const dn = Math.max(0, Math.min(6, drops));
    for (let i = 0; i < dn; i++) {
      const a = r() * Math.PI * 2;
      const rad = (3.15 + r() * 0.3) * size;
      const dot = K.cyl({
        color: shade(P.water, -0.12), r: (0.12 + r() * 0.09) * size, h: 0.07, seg: 6, family: 'glass',
      });
      g.add(K.put(dot, Math.cos(a) * rad * 1.1, 0.035, Math.sin(a) * rad * 0.8));
    }
    return g;
  },
};
