// 酒瓶箱（CATALOG2 #29）：「格挡内卧瓶+稻草垫」——容器类 prop/floor（wood 箱体 + glass 卧瓶 + unlit 酒液 三族）。
// 原点=底面中心（y=0 落地），x=长；卧瓶=横放 lathe 瓶（瓶口同向 +x），瓶口内一点 P.wine 暗红读作酒液。
// 变体走 build(opts)：瓶数 bottles / 十字格挡 dividers / 稻草茬 tufts。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 瓶身轮廓（lathe profile：底→圆肚→收肩→细颈→瓶口），高约 1.36、肚径约 0.88
const BOTTLE = [
  [0.03, 0], [0.3, 0.03], [0.42, 0.35], [0.44, 0.62],
  [0.26, 0.92], [0.12, 1.08], [0.12, 1.3], [0.17, 1.36],
];

export default {
  id: 'bottleCase',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'container', 'kitchen'],
  footprint: { x: 4.0, z: 2.4 },
  behaviors: [],
  build({ bottles = 4, dividers = true, tufts = 2, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('bottleCase');
    const w = 3.4, d = 1.9, wh = 0.85, bt = 0.22;         // 箱宽/深/壁高/底板厚
    // 箱体：底板 + 两长壁 + 两端壁（浅壁敞箱，端壁压住长壁转角）
    g.add(K.put(K.box({ color: shade(P.wood, -0.05), size: [w, bt, d], family: 'wood' }), 0, bt / 2, 0));
    for (const sx of [-1, 1]) {
      g.add(K.put(K.box({ color: P.wood, size: [0.18, wh, d], family: 'wood' }), sx * (w / 2 - 0.09), bt + wh / 2, 0));
    }
    for (const sz of [-1, 1]) {
      g.add(K.put(K.box({ color: P.woodDark, size: [w, wh, 0.18], family: 'wood' }), 0, bt + wh / 2, sz * (d / 2 - 0.09)));
    }
    // 格挡：纵中隔 + 横中隔（十字分四格，隔板低于壁沿）
    if (dividers) {
      g.add(K.put(K.box({ color: P.woodDark, size: [w - 0.4, 0.66, 0.13], family: 'wood' }), 0, bt + 0.33, 0));
      g.add(K.put(K.box({ color: P.woodDark, size: [0.13, 0.66, d - 0.4], family: 'wood' }), 0, bt + 0.33, 0));
    }
    // 稻草垫：箱底满铺的草垫
    g.add(K.put(K.plate({ color: P.straw, w: w - 0.3, d: d - 0.3, th: 0.1, family: 'wood' }), 0, bt + 0.05, 0));
    // 卧瓶：四格各一，横放瓶口同向 +x（圆肚半径 0.44 垫在草垫上，瓶颈略探出壁沿）
    const cells = [[-0.85, -0.45], [-0.85, 0.45], [0.85, -0.45], [0.85, 0.45]];
    const n = Math.min(Math.max(bottles, 2), 4);
    for (let i = 0; i < n; i++) {
      const [cx, cz] = cells[i % 4];
      const by = bt + 0.1 + 0.44, bx = cx - 0.68;
      const b = K.lathe({ color: P.potionGreen, profile: BOTTLE, seg: 7, family: 'glass' });
      K.tilt(b, 0, 0, -Math.PI / 2);
      if (rng) K.jitter(b, rng, { rot: 0.02 });
      g.add(K.put(b, bx, by, cz));
      // 酒液：瓶口内一点深红酒色小盘（unlit 暗底读作卧瓶口里的酒面）
      const wine = K.cyl({ color: P.wine, r: 0.09, h: 0.05, seg: 6, family: 'unlit' });
      K.tilt(wine, 0, 0, Math.PI / 2);
      g.add(K.put(wine, bx + 1.33, by, cz));
    }
    // 稻草茬：格子间戳出的草茬（压扁 jitter 球探出壁沿）
    for (let i = 0; i < tufts; i++) {
      const tuft = K.sphereLo({
        color: shade(P.straw, 0.05 * (i % 2)), r: 0.32, seg: 1, jitter: 0.2, rng: r, family: 'wood',
      });
      K.scaleXYZ(tuft, 0.9, 0.7, 0.7);
      g.add(K.put(K.tilt(tuft, (r() - 0.5) * 0.2, r() * Math.PI, 0), i % 2 ? 0.2 : -0.25, bt + 0.75, i % 2 ? 0.5 : -0.55));
    }
    return g;
  },
};
