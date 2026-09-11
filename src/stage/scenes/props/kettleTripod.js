// 吊锅三脚架（CATALOG2 编号 69）：「三脚架+悬锅+底柴堆」——prop/floor（metal+wood+unlit 三族）。
// 原点=架心地面（y=0 落地）：三根铁脚外撇、顶端交叉捆扎成架顶（连脚高约 4.5，M 档），
// 架顶垂短链吊起圆肚悬锅（双提耳拱成吊梁），锅下 teepee 柴堆交叉搭拢+一簇暗焰。
// 布光职责：tags 声明 lightSource/fire 即「这里有火」——不私设 PointLight（CATALOG §6）；
// 暗焰=unlit 冷白压暗双锥（同 wallTorch/brazierFire 语言）。变体走 build(opts)：柴数/炭星数/燃灭。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 悬锅轮廓（lathe 自下而上）：圆肚收颈敞口，局部高约 1.16
const KETTLE = [
  [0.3, 0], [0.62, 0.08], [0.95, 0.35], [1.02, 0.68],
  [0.9, 0.98], [0.6, 1.1], [0.52, 1.16],
];

export default {
  id: 'kettleTripod',
  place: 'prop',
  mount: 'floor',
  tags: ['metal', 'wood', 'lightSource', 'kitchen'],
  footprint: { x: 4, z: 4 },
  behaviors: [],
  build({ logs = 4, embers = 3, lit = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('kettleTripod');
    const apex = 4.25;                    // 架顶交叉点高度
    // 三脚架：三根铁脚外撇、顶端向心交叉（足端粗、梢端细，brazierFire 足语言放大）
    for (let i = 0; i < 3; i++) {
      const a = i * (Math.PI * 2 / 3) + 0.3;
      const rootR = 0.1, footR = 1.65;
      const leg = K.cyl({
        color: shade(P.iron, -0.05), r: 0.14, rTop: 0.1,
        h: Math.hypot(footR - rootR, apex), seg: 5, family: 'metal',
      });
      K.tilt(leg, 0, -a, -Math.atan2(footR - rootR, apex));
      const midR = (rootR + footR) / 2;
      g.add(K.put(leg, Math.cos(a) * midR, apex / 2, Math.sin(a) * midR));
    }
    // 架顶捆扎：铁箍套住交叉点 + 绳绕两匝读出绑扎
    g.add(K.put(K.cyl({ color: shade(P.iron, 0.05), r: 0.2, h: 0.5, seg: 6, family: 'metal' }), 0, apex - 0.05, 0));
    g.add(K.put(K.cyl({ color: P.rope, r: 0.23, h: 0.16, seg: 6, family: 'wood' }), 0, apex - 0.3, 0));
    // 短链：自架顶垂下（细铁杆读作链），链尾即悬锅挂点
    g.add(K.put(K.cyl({ color: shade(P.iron, -0.1), r: 0.05, h: 0.65, seg: 4, family: 'metal' }), 0, 3.62, 0));
    // 悬锅：圆肚锅身+沿口唇圈+锅口暗面，双提耳自沿口拱起汇到链尾（吊在火上、离焰留空）
    const ky = 2.45;                      // 锅底高度
    g.add(K.put(K.lathe({ color: P.iron, profile: KETTLE, seg: 7, family: 'metal' }), 0, ky, 0));
    g.add(K.put(K.cyl({ color: shade(P.iron, 0.08), r: 0.56, h: 0.1, seg: 7, family: 'metal' }), 0, ky + 1.13, 0));
    g.add(K.put(K.cyl({ color: P.night, r: 0.44, h: 0.05, seg: 7, family: 'unlit' }), 0, ky + 1.08, 0));
    for (const s of [-1, 1]) {
      const arm = K.cyl({ color: shade(P.iron, -0.02), r: 0.06, h: 0.85, seg: 4, family: 'metal' });
      K.tilt(arm, 0, 0, s * 1.25);
      g.add(K.put(arm, s * 0.3, ky + 1.32, 0));
    }
    // 底柴堆：交叉搭拢的 teepee 柴（脚外撇、梢在锅底下方错开搭拢，同 bonfireRemnant 柴语言）
    const n = Math.min(Math.max(logs, 3), 6);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.4 + r() * 0.3;
      const footR2 = 1.2 + r() * 0.2;
      const bx = Math.cos(a) * footR2, bz = Math.sin(a) * footR2;
      const tipY = 1.75 + r() * 0.3;
      const tx = Math.cos(a + 1.2) * 0.18, tz = Math.sin(a + 1.2) * 0.18;
      const dx = tx - bx, dy = tipY - 0.22, dz = tz - bz;
      const log = K.cyl({
        color: i % 2 ? P.woodDark : shade(P.woodDark, 0.08),
        r: 0.18 + (i % 2) * 0.04, h: Math.hypot(dx, dy, dz) + 0.25, seg: 5, family: 'wood',
      });
      K.tilt(log, Math.atan2(dz, dy), 0, -Math.atan2(dx, dy));
      g.add(K.put(log, bx + dx / 2, 0.22 + dy / 2, bz + dz / 2));
    }
    // 暗焰：单簇双锥（外锥压暗+内芯，unlit 冷白防过曝，比火盆再压一档读「暗焰」）
    if (lit) {
      const fh = 1.0;
      g.add(K.put(K.cone({ color: shade(P.flameCore, -0.4), r: 0.3, h: fh, seg: 6, family: 'unlit' }), 0, 0.55 + fh * 0.5, 0));
      g.add(K.put(K.cone({ color: shade(P.flameCore, -0.16), r: 0.17, h: fh * 0.62, seg: 5, family: 'unlit' }), 0, 0.52 + fh * 0.31, 0));
    }
    // 炭星：柴脚缝里露头的余烬
    const e = Math.min(Math.max(embers, 2), 5);
    for (let i = 0; i < e; i++) {
      const aa = r() * Math.PI * 2, rad = 0.25 + r() * 0.55;
      g.add(K.put(
        K.sphereLo({ color: P.ember, r: 0.11 + r() * 0.07, seg: 0, jitter: 0.3, rng: r, family: 'unlit' }),
        Math.cos(aa) * rad, 0.45 + r() * 0.2, Math.sin(aa) * rad));
    }
    return g;
  },
};
