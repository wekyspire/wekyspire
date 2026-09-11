// 圣徽立像（CATALOG2 编号 65）：「竖立圆徽+翼饰浮雕」——圣所礼拜立像 prop（纯 stone 单族）。
// 原点=底面中心（y=0 落地），全高约 7：两级阶座 + 方身收分柱（cyl seg=4 转 45°，statuePedestal
// 手法）+ 檐冠板；柱顶承一面竖立圆徽（低模圆盘 seg=8 立起 + 外沿边环高浮雕），徽面浮起
// 十字圣记（竖横双条 + 中央圆凸），徽侧两翼=三道渐短的翼羽石板自徽缘向外上扬（aim 定向，
// 读作翼饰浮雕）。变体走 build(opts)：每侧翼羽数 feathers（2~4）/ 徽面记号 sigil
// （'cross' 十字 | 'ring' 环十字）/ 檐板缺角 chipped。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'symbolFaith',
  place: 'prop',
  mount: 'floor',
  tags: ['stone', 'chapel'],
  footprint: { x: 4.8, z: 2.6 },
  behaviors: [],
  build({ feathers = 3, sigil = 'cross', chipped = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('symbolFaith');
    // 两级阶座 + 方身收分柱 + 檐冠板
    g.add(K.put(K.box({ color: shade(P.stone, -0.12), size: [3.0, 0.4, 2.1] }), 0, 0.2, 0));
    g.add(K.put(K.box({ color: P.stone, size: [2.5, 0.32, 1.75] }), 0, 0.56, 0));
    const shaft = K.cyl({ color: shade(P.stone, 0.02), r: 1.0, rTop: 0.86, h: 3.1, seg: 4 });
    K.tilt(shaft, 0, Math.PI / 4 + r() * 0.06, 0);
    if (rng) K.jitter(shaft, r, { rot: 0.008 });
    g.add(K.put(shaft, 0, 2.27, 0));
    const cap = K.box({ color: shade(P.stone, 0.04), size: [1.95, 0.28, 1.4] });
    if (chipped) K.chip(cap, { corner: [-1, 1, 1], amount: 0.18 }); // 檐板风化缺角
    g.add(K.put(cap, 0, 3.96, 0));
    // 柱顶垫石（衔接檐冠与圆徽下缘）
    g.add(K.put(K.box({ color: shade(P.stone, -0.06), size: [0.62, 0.62, 0.5] }), 0, 4.28, -0.32));
    // 竖立圆徽：立起圆盘（cyl rx=90°）+ 外沿边环（读作高浮雕边框）
    const discY = 5.72;
    const rim = K.cyl({ color: shade(P.stone, 0.06), r: 1.72, h: 0.18, seg: 8 });
    K.tilt(rim, Math.PI / 2, 0, 0);
    g.add(K.put(rim, 0, discY, 0));
    const disc = K.cyl({ color: shade(P.stone, 0.14), r: 1.5, h: 0.26, seg: 8 });
    K.tilt(disc, Math.PI / 2, 0, 0);
    g.add(K.put(disc, 0, discY, 0));
    // 徽面记号：十字（竖横双条+中央圆凸）或环十字（小环+竖条+圆凸），浮雕浮出徽面
    const bar = K.box({ color: shade(P.stone, 0.28), size: [0.4, 2.0, 0.16] });
    g.add(K.put(bar, 0, discY, 0.16));
    if (sigil === 'ring') {
      const ring = K.cyl({ color: shade(P.stone, 0.28), r: 0.58, h: 0.14, seg: 7 });
      K.tilt(ring, Math.PI / 2, 0, 0);
      g.add(K.put(ring, 0, discY + 0.32, 0.16));
    } else {
      g.add(K.put(K.box({ color: shade(P.stone, 0.28), size: [1.3, 0.4, 0.16] }), 0, discY + 0.25, 0.16));
    }
    g.add(K.put(K.sphereLo({ color: shade(P.stone, 0.34), r: 0.3, seg: 0 }), 0, discY, 0.2));
    // 翼饰浮雕：徽侧两翼，各三道渐短翼羽自徽缘向外上扬（aim 定向：+y 指向外扬方向）
    const nf = Math.min(Math.max(feathers, 2), 4);
    const lens = [1.35, 1.15, 0.95, 0.8];
    const angs = [0.3, 0.56, 0.82, 1.02];
    for (const s of [-1, 1]) {
      for (let k = 0; k < nf; k++) {
        const dir = new THREE.Vector3(s * Math.cos(angs[k]), Math.sin(angs[k]), 0);
        const L = lens[k];
        const f = K.box({ color: shade(P.stone, k % 2 ? 0.12 : -0.02), size: [0.26, L, 0.18] });
        K.aim(f, dir.x, dir.y, dir.z);
        f.position.set(s * 1.5 + dir.x * L / 2, discY - 0.18 + dir.y * L / 2, 0);
        g.add(f);
      }
    }
    return g;
  },
};
