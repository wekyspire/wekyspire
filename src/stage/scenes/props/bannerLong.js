// 长挂旗（CATALOG #74）：「垂地布旗，底缘撕裂」——wallDecor 高带挂件（cloth+wood 双族）。
// 原点=墙面高位挂点（z=0 贴墙，+z 朝室内，同 wallTorch 约定）；band=high 挂点在上、
// 布体自挂杆垂挂向下（bbox 主体在负 y，垂地总长 ~18）。撕裂底缘=多条窄片错位长短垂挂。
// 变体走 build(opts)：旗色 hue（red/blue）/总长/撕裂数/撕裂幅度；rng 驱动确定性。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'bannerLong',
  place: 'wallDecor',
  band: 'high',
  tags: ['cloth'],
  behaviors: [],
  build({ hue = 'red', len = 18, strips = 4, tear = 1, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('bannerLong');
    const base = hue === 'blue' ? P.bannerBlue : P.bannerRed;
    const w = 3.4, tail = 4.6;                        // 旗幅宽 / 底缘撕裂带长
    const ns = Math.min(Math.max(strips, 3), 6);
    // 挂杆：木质横杆（横置圆柱）+ 两端托座
    const rod = K.cyl({ color: P.woodDark, r: 0.17, h: w + 0.9, seg: 5, family: 'wood' });
    K.tilt(rod, 0, 0, Math.PI / 2);
    g.add(K.put(rod, 0, 0.08, 0.2));
    for (const sx of [-1, 1]) {
      g.add(K.put(K.box({ color: shade(P.woodDark, 0.06), size: [0.34, 0.5, 0.18], family: 'wood' }), sx * (w / 2 + 0.28), 0.02, 0.1));
    }
    // 旗身主体：自杆下垂到撕裂带上缘（微倾出布感）
    const bodyH = len - tail;
    const body = K.box({ color: base, size: [w, bodyH, 0.12], family: 'cloth' });
    K.tilt(body, 0.02, 0, (r() - 0.5) * 0.03);
    g.add(K.put(body, 0, -bodyH / 2 - 0.1, 0.24));
    // 顶部压暗饰带（勾出旗头）
    g.add(K.put(K.box({ color: shade(base, -0.2), size: [w, 1.15, 0.14], family: 'cloth' }), 0, -1.05, 0.3));
    // 底缘撕裂：窄片错位长短垂挂（长短差 = 撕裂度 tear）
    const tones = [shade(base, 0.07), base, shade(base, -0.1)];
    for (let i = 0; i < ns; i++) {
      const sw = w / ns - 0.12;
      const x = -w / 2 + (w / ns) * i + sw / 2 + 0.06;
      const sl = tail - 1.2 + r() * 1.9 * tear;
      const piece = K.box({ color: tones[i % 3], size: [sw, sl, 0.1], family: 'cloth' });
      K.tilt(piece, 0, 0, (r() - 0.5) * 0.08 * tear);
      g.add(K.put(piece, x + (r() - 0.5) * 0.1, -bodyH + 0.35 - sl / 2, 0.26 + (r() - 0.5) * 0.08));
    }
    return g;
  },
};
