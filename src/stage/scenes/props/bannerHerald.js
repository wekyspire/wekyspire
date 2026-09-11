// 纹章旗（CATALOG #75）：「家徽方旗，双穗垂坠」——wallDecor 中带挂件（cloth+wood 双族）。
// 原点=墙面挂点（z=0 贴墙，+z 朝室内，同 wallTorch 约定）；band=mid：横杆装于挂点上方，
// ~6 见方的家徽旗自杆垂挂向下，双穗自底角垂坠。家徽=对比旗色经 shade 拉出的色块
// （菱形 diamond / 十字 cross 双形）。变体走 build(opts)：旗色/徽形/穗长；rng 驱动确定性。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'bannerHerald',
  place: 'wallDecor',
  band: 'mid',
  tags: ['cloth'],
  behaviors: [],
  build({ hue = 'blue', size = 6, emblem = 'diamond', tasselLen = 1.9, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('bannerHerald');
    const base = hue === 'blue' ? P.bannerBlue : P.bannerRed;
    const crest = hue === 'blue' ? shade(P.bannerRed, 0.05) : shade(P.bannerBlue, 0.05);
    const half = size / 2;
    // 挂杆：木质横杆 + 两端方头
    const rod = K.cyl({ color: P.woodDark, r: 0.16, h: size + 1.0, seg: 5, family: 'wood' });
    K.tilt(rod, 0, 0, Math.PI / 2);
    g.add(K.put(rod, 0, 0.5, 0.2));
    for (const sx of [-1, 1]) {
      g.add(K.put(K.box({ color: shade(P.woodDark, 0.07), size: [0.3, 0.44, 0.3], family: 'wood' }), sx * (half + 0.5), 0.5, 0.2));
    }
    // 方旗：旗面自杆垂挂（上缘搭进杆下），微倾出布感
    const flag = K.box({ color: base, size: [size, size, 0.14], family: 'cloth' });
    K.tilt(flag, 0.015, 0, (r() - 0.5) * 0.03);
    const topY = 0.42, ctrY = topY - half;
    g.add(K.put(flag, 0, ctrY, 0.24));
    // 上下压暗饰边（勾出方旗轮廓）
    for (const oy of [topY - 0.5, topY - size + 0.5]) {
      g.add(K.put(K.box({ color: shade(base, -0.22), size: [size, 0.9, 0.16], family: 'cloth' }), 0, oy, 0.3));
    }
    // 家徽色块：菱形（45° 方块+提亮内芯）或十字（竖横两杆）
    if (emblem === 'cross') {
      g.add(K.put(K.box({ color: crest, size: [1.0, 3.5, 0.18], family: 'cloth' }), 0, ctrY, 0.34));
      g.add(K.put(K.box({ color: crest, size: [3.5, 1.0, 0.18], family: 'cloth' }), 0, ctrY + 0.2, 0.34));
    } else {
      const dia = K.box({ color: crest, size: [2.7, 2.7, 0.18], family: 'cloth' });
      K.tilt(dia, 0, 0, Math.PI / 4);
      g.add(K.put(dia, 0, ctrY, 0.34));
      const core = K.box({ color: shade(base, 0.18), size: [1.15, 1.15, 0.2], family: 'cloth' });
      K.tilt(core, 0, 0, Math.PI / 4);
      g.add(K.put(core, 0, ctrY, 0.4));
    }
    // 双穗：自底角垂坠（绳段 + 双箍大结 + 散穗锥），左右各带微摆
    for (const sx of [-1, 1]) {
      const sway = (r() - 0.5) * 0.14;
      const tx = sx * (half - 0.42);
      const top = topY - size + 0.35;
      const strand = K.cyl({ color: P.gold, r: 0.1, h: tasselLen * 0.45, seg: 5, family: 'cloth' });
      K.tilt(strand, 0, 0, sway);
      g.add(K.put(strand, tx, top - tasselLen * 0.22, 0.26));
      const knot = K.cyl({ color: shade(P.gold, -0.14), r: 0.24, rTop: 0.17, h: 0.42, seg: 5, family: 'cloth' });
      K.tilt(knot, 0, 0, sway * 1.6);
      g.add(K.put(knot, tx + sway * 0.6, top - tasselLen * 0.45 - 0.21, 0.26));
      const fringe = K.cyl({ color: shade(P.gold, -0.05), r: 0.3, rTop: 0.12, h: tasselLen * 0.55, seg: 5, family: 'cloth' });
      K.tilt(fringe, 0, 0, sway * 2.2);
      g.add(K.put(fringe, tx + sway * 1.2, top - tasselLen * 0.45 - 0.42 - tasselLen * 0.275, 0.26));
    }
    return g;
  },
};
