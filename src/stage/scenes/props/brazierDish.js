// 矮盆油灯（CATALOG2 编号 42）：「石盆+芯焰+沿口焦色」——prop/floor（stone+unlit 双族）。
// 原点=盆心（y=0 落地）；圈足+宽浅石盆（lathe 外撇沿），沿口一圈焦色环（压暗岩色），
// 盆面暗油盘（unlit P.night）+ 芯焰（unlit 冷白小锥，同 candleStand 语言）。
// 全高约 1.3、口径约 2.9（S 档）。布光职责：tags 声明 lightSource/fire 即「这里有火」
// ——不私设 PointLight（CATALOG §6）。变体走 build(opts)：芯数/燃灭。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 石盆轮廓（lathe profile：束腰→鼓腹→外撇盆沿），盆体高约 0.7
const DISH = [
  [0.5, 0], [0.88, 0.08], [1.2, 0.36], [1.38, 0.62], [1.42, 0.7],
];

export default {
  id: 'brazierDish',
  place: 'prop',
  mount: 'floor',
  tags: ['stone', 'lightSource', 'fire', 'chapel'],
  footprint: { x: 3.2, z: 3.2 },
  behaviors: [],
  build({ wicks = 2, lit = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('brazierDish');
    // 圈足 + 宽浅石盆
    g.add(K.put(K.cyl({ color: shade(P.stone, -0.12), r: 0.78, rTop: 0.88, h: 0.26, seg: 8 }), 0, 0.13, 0));
    g.add(K.put(K.lathe({ color: P.stone, profile: DISH, seg: 8 }), 0, 0.26, 0));
    // 沿口焦色：贴着盆沿的焦色环带（压暗岩色 lathe 环圈，长年烟熏）
    g.add(K.put(K.lathe({ color: shade(P.rock, -0.34), profile: [[1.16, 0], [1.44, 0.06], [1.42, 0.18]], seg: 8 }), 0, 0.86, 0));
    // 盆面暗油盘 + 芯焰（冷白小锥自油面立起）
    g.add(K.put(K.cyl({ color: P.night, r: 1.0, h: 0.06, seg: 8, family: 'unlit' }), 0, 0.84, 0));
    const w = Math.max(1, Math.min(3, wicks));
    for (let i = 0; i < w; i++) {
      const aa = (i / w) * Math.PI * 2 + 0.7 + r() * 0.4;
      const rad = 0.34 + r() * 0.18;
      if (lit) g.add(K.put(K.cone({ color: shade(P.flameCore, -0.12), r: 0.085, h: 0.36, seg: 5, family: 'unlit' }), Math.cos(aa) * rad, 1.08, Math.sin(aa) * rad));
    }
    return g;
  },
};
