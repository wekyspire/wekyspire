// 书写桌（CATALOG2 #2）：「斜面稿架+侧抽+墨水瓶」——家具类 prop（wood + glass 双族）。
// 原点=底面中心（y=0 落地），x=宽 z=深，桌面高约 4.45（书桌尺度口径）；
// 稿架=桌面后部斜板+前止条+一张羊皮稿纸，墨水瓶用 P.night 冷墨色（玻璃族矮瓶）。
// 变体走 build(opts)：桌宽 / 侧抽屉数 / 是否摆墨水瓶。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 墨水瓶轮廓（lathe profile：底→矮肚→收肩→细口），高约 0.49
const INK_BOTTLE = [
  [0.02, 0], [0.19, 0.02], [0.26, 0.14], [0.25, 0.3],
  [0.11, 0.36], [0.1, 0.46], [0.15, 0.49],
];

export default {
  id: 'tableWriting',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'furniture', 'library'],
  footprint: { x: 4.4, z: 2.7 },
  behaviors: [],
  build({ w = 4.2, d = 2.5, drawers = 2, ink = true, rng } = {}) {
    const g = new THREE.Group();
    // 四腿 + 桌面厚板（同 tableWood 骨架，面高矮到书桌一档）
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = K.box({ color: P.woodDark, size: [0.32, 4.05, 0.32], family: 'wood' });
      K.tilt(leg, -sz * 0.04, 0, sx * 0.04);
      if (rng) K.jitter(leg, rng, { rot: 0.012 });
      g.add(K.put(leg, sx * (w / 2 - 0.3), 2.02, sz * (d / 2 - 0.28)));
    }
    g.add(K.put(K.box({ color: P.wood, size: [w, 0.42, d], family: 'wood' }), 0, 4.24, 0));
    // 斜面稿架：后部斜板（前缘贴桌面、后缘翘起）+ 前止条（压住稿纸不滑落）
    const plank = K.box({ color: shade(P.wood, 0.06), size: [w - 1.3, 0.14, 1.3], family: 'wood' });
    K.tilt(plank, 0.3, 0, 0);
    g.add(K.put(plank, 0, 4.64, -0.25));
    const stop = K.box({ color: P.woodDark, size: [w - 1.3, 0.1, 0.16], family: 'wood' });
    K.tilt(stop, 0.3, 0, 0);
    g.add(K.put(stop, 0, 4.6, 0.25));
    // 一张摊开的羊皮稿纸（顺坡微歪）
    const sheet = K.box({ color: P.parchment, size: [2.1, 0.05, 0.9], family: 'wood' });
    K.tilt(sheet, 0.3, 0.04, 0);
    g.add(K.put(sheet, -0.15, 4.7, -0.1));
    // 侧抽：右侧面成摞下挂抽屉匣（匣身+外抽脸+拉钮）
    for (let i = 0; i < drawers; i++) {
      const y = 3.5 - i * 0.95;
      g.add(K.put(K.box({ color: shade(P.woodDark, 0.08), size: [1.1, 0.75, d - 0.8], family: 'wood' }), w / 2 - 0.75, y, 0));
      g.add(K.put(K.box({ color: P.wood, size: [0.09, 0.85, d - 0.68], family: 'wood' }), w / 2 - 0.06, y, 0));
      const knob = K.cyl({ color: shade(P.woodDark, 0.14), r: 0.09, rTop: 0.07, h: 0.16, seg: 5, family: 'wood' });
      K.tilt(knob, 0, 0, -Math.PI / 2);
      g.add(K.put(knob, w / 2 + 0.06, y, 0));
    }
    // 墨水瓶：桌面左前一只矮瓶（冷墨色 P.night，玻璃族）
    if (ink) {
      const bottle = K.lathe({ color: P.night, profile: INK_BOTTLE, seg: 6, family: 'glass' });
      if (rng) K.jitter(bottle, rng, { rot: 0.02 });
      g.add(K.put(bottle, -(w / 2 - 1.1), 4.45, 0.62));
    }
    return g;
  },
};
