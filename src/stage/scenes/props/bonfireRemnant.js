// 篝火余烬（CATALOG2 编号 41）：「交叉柴+炭堆+一点残焰」——prop/floor（wood+stone 炭+unlit 焰 三族）。
// 原点=火堆心（y=0 落地）；交叉柴=脚外撇、梢向心上方错开搭拢的斜架柴（余烬倒伏感），
// 中间压暗炭堆+暗红余烬，一点残焰=单簇双锥（unlit 冷白压暗，同 wallTorch 语言）。
// 口径约 4.5（M 档）。布光职责：tags 声明 lightSource/fire 即「这里有火」——
// 不私设 PointLight（CATALOG §6）。变体走 build(opts)：柴数/烬数/残焰有无。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'bonfireRemnant',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'lightSource', 'fire', 'generic'],
  footprint: { x: 4.6, z: 4.6 },
  behaviors: [],
  build({ logs = 5, embers = 3, lit = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('bonfireRemnant');
    // 炭堆：两块压扁暗石（烧过的黑芯）
    const mound = K.sphereLo({ color: shade(P.rock, -0.38), r: 0.78, seg: 0, jitter: 0.22, rng: r });
    K.scaleXYZ(mound, 1.25, 0.5, 1.25);
    g.add(K.put(mound, 0, 0.34, 0));
    const mound2 = K.sphereLo({ color: shade(P.rock, -0.22), r: 0.5, seg: 0, jitter: 0.25, rng: r });
    K.scaleXYZ(mound2, 1.15, 0.55, 1.15);
    g.add(K.put(mound2, 0.42, 0.4, -0.3));
    // 交叉柴：脚外撇、梢向心上方聚拢（余烬感：梢端错开不完全搭拢，同 fireplaceBig 柴语言）
    const n = Math.max(3, Math.min(6, logs));
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.4 + r() * 0.35;
      const footR = 1.5 + r() * 0.35;
      const bx = Math.cos(a) * footR, bz = Math.sin(a) * footR;
      const tipY = 1.3 + r() * 0.45;
      const tipR = 0.15 + r() * 0.4;
      const tx = Math.cos(a + 1.1) * tipR, tz = Math.sin(a + 1.1) * tipR;
      const dx = tx - bx, dy = tipY - 0.3, dz = tz - bz;
      const len = Math.hypot(dx, dy, dz) + 0.3;
      const log = K.cyl({
        color: i % 2 ? shade(P.woodDark, 0.08) : P.woodDark,
        r: 0.2 + (i % 2) * 0.05, h: len, seg: 5, family: 'wood',
      });
      K.tilt(log, Math.atan2(dz, dy), 0, -Math.atan2(dx, dy));
      g.add(K.put(log, bx + dx / 2, 0.3 + dy / 2, bz + dz / 2));
    }
    // 余烬：暗红炭星自柴缝露头
    const e = Math.max(2, Math.min(5, embers));
    for (let i = 0; i < e; i++) {
      const aa = r() * Math.PI * 2, rad = 0.2 + r() * 0.55;
      g.add(K.put(K.sphereLo({ color: shade(P.ember, -0.3), r: 0.13 + r() * 0.08, seg: 0, jitter: 0.3, rng: r, family: 'unlit' }), Math.cos(aa) * rad, 0.5 + r() * 0.2, Math.sin(aa) * rad));
    }
    // 一点残焰：单簇双锥（外锥压暗+内芯，unlit 冷白防过曝）
    if (lit) {
      const fh = 0.7;
      g.add(K.put(K.cone({ color: shade(P.flameCore, -0.34), r: 0.2, h: fh, seg: 6, family: 'unlit' }), -0.3, 0.72 + fh * 0.5, 0.28));
      g.add(K.put(K.cone({ color: shade(P.flameCore, -0.12), r: 0.12, h: fh * 0.62, seg: 5, family: 'unlit' }), -0.3, 0.7 + fh * 0.31, 0.28));
    }
    return g;
  },
};
