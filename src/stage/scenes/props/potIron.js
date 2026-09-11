// 铁锅（CATALOG2 #24）：「三足黑锅+锅盖斜搭」——炊事类 prop（metal 主体 + unlit 锅口暗面 双族）。
// 原点=底面中心（y=0 落地）；三足 120° 外撇承起锅身（lathe 宽浅锅腹，径约 2.5），
// 浅穹锅盖+盖钮斜搭锅沿：低侧沉入锅口、高侧翘起，露出一线锅口暗色。
// 变体走 build(opts)：askew 盖子斜搭幅度（0.02 盖正 ~ 0.25 大斜）；rng 驱动确定性。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 锅身轮廓（lathe profile 自下而上）：锅底→宽浅鼓腹→收拢锅口，局部高约 1.32
const POT = [
  [0.32, 0], [0.72, 0.06], [1.02, 0.28], [1.2, 0.7],
  [1.25, 1.02], [1.16, 1.26], [1.08, 1.32],
];
// 锅盖轮廓：浅穹 + 收顶（顶上配盖钮）
const LID = [[1.06, 0], [1.0, 0.16], [0.82, 0.36], [0.5, 0.54], [0.16, 0.62]];

export default {
  id: 'potIron',
  place: 'prop',
  mount: 'floor',
  tags: ['metal', 'container', 'kitchen'],
  footprint: { x: 3.0, z: 3.0 },
  behaviors: [],
  build({ askew = 0.16, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('potIron');
    const lift = 0.3; // 锅身离地（三足承起）
    // 锅身 + 沿口唇圈 + 腹部浇铸凸箍（烟色更深一档）
    g.add(K.put(K.lathe({ color: P.iron, seg: 7, profile: POT, family: 'metal' }), 0, lift, 0));
    g.add(K.put(K.cyl({ color: shade(P.iron, 0.08), r: 1.3, h: 0.09, seg: 7, family: 'metal' }), 0, lift + 1.3, 0));
    g.add(K.put(K.cyl({ color: shade(P.iron, -0.14), r: 1.26, h: 0.16, seg: 7, family: 'metal' }), 0, lift + 0.62, 0));
    // 锅口暗面：unlit 夜色盘（锅盖斜搭露出的那一线）
    g.add(K.put(K.cyl({ color: P.night, r: 1.12, h: 0.06, seg: 7, family: 'unlit' }), 0, lift + 1.24, 0));
    // 三足：120° 分布，外撇细锥腿（顶斜向锅底、脚向外撇）
    for (let i = 0; i < 3; i++) {
      const a = i * (Math.PI * 2 / 3) + Math.PI / 6;
      const dx = Math.cos(a), dz = Math.sin(a);
      const leg = K.cyl({ color: shade(P.iron, -0.06), r: 0.15, rTop: 0.1, h: 0.9, seg: 5, family: 'metal' });
      K.tilt(leg, 0.3 * dz, 0, -0.3 * dx);
      if (rng) K.jitter(leg, rng, { rot: 0.01 });
      g.add(K.put(leg, dx * 0.7, 0.43, dz * 0.7));
    }
    // 锅盖：浅穹+盖钮，斜搭锅沿（盖心高度随斜角抬升，低缘恒沉到锅口沿线）
    const lid = new THREE.Group();
    lid.add(K.lathe({ color: shade(P.iron, 0.12), seg: 7, profile: LID, family: 'metal' }));
    lid.add(K.put(K.cyl({ color: shade(P.iron, 0.2), r: 0.13, rTop: 0.18, h: 0.24, seg: 6, family: 'metal' }), 0, 0.68, 0));
    const t = Math.min(Math.max(askew, 0.02), 0.25);
    const cy = lift + 1.26 + 1.06 * Math.sin(t);
    K.tilt(lid, 0, r() * Math.PI * 2, t);
    g.add(K.put(lid, 0.16, cy, 0.05));
    // 双侧提耳：扣在沿口唇圈上
    for (const s of [-1, 1]) {
      g.add(K.put(K.box({ color: shade(P.iron, -0.02), size: [0.36, 0.13, 0.16], family: 'metal' }), s * 1.33, lift + 1.26, 0));
    }
    return g;
  },
};
