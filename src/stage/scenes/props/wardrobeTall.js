// 高衣柜（CATALOG2 #8）：「双门带锁孔+顶冠」——起居家具 prop（wood 柜体 + metal 锁件 + unlit 锁孔 三族）。
// 与碗柜（cupboardClosed）区分：更高（总高约 9.5）、顶冠带三角山花与两角尖饰、门上锁孔；
// 原点=底面中心（y=0 落地），x=宽 z=深。锁件沿用 chestLocked 语言（压暗铁片 + unlit 锁孔
// 读作透空）。变体走 build(opts)：门缝宽 seam / 山花尺度 crest。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'wardrobeTall',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'container', 'quarters'],
  footprint: { x: 5.2, z: 3.0 },
  behaviors: [],
  build({ seam = 0.12, crest = 1, rng } = {}) {
    const g = new THREE.Group();
    const w = 4.5, h = 7.6, d = 2.5, base = 0.5;
    // 座脚（内收方座）+ 柜身
    g.add(K.put(K.box({ color: P.woodDark, size: [w - 0.6, base, d - 0.6], family: 'wood' }), 0, base / 2, 0));
    const body = K.box({ color: P.wood, size: [w, h, d], family: 'wood' });
    if (rng) K.jitter(body, rng, { rot: 0.01 });
    g.add(K.put(body, 0, base + h / 2, 0));
    // 双门：对缝留 seam，门板满高微凸
    const doorW = (w - 0.26 - seam) / 2;
    for (const s of [-1, 1]) {
      const door = K.box({ color: shade(P.wood, 0.06), size: [doorW, h - 0.7, 0.16], family: 'wood' });
      K.tilt(door, 0, 0, s * 0.004);
      g.add(K.put(door, s * (seam / 2 + doorW / 2), base + h / 2, d / 2 + 0.08));
    }
    // 锁片 + 锁孔（右上门缘，chestLocked 的透空读法）
    g.add(K.put(K.box({
      color: P.iron, size: [0.55, 0.75, 0.12], family: 'metal',
    }), seam / 2 + 0.3, base + h - 1.3, d / 2 + 0.16));
    g.add(K.put(K.box({
      color: P.night, size: [0.13, 0.3, 0.08], family: 'unlit',
    }), seam / 2 + 0.3, base + h - 1.25, d / 2 + 0.24));
    // 顶冠：檐板 + 三角山花（prism）+ 两角尖饰
    const top = base + h;
    g.add(K.put(K.box({
      color: shade(P.wood, 0.08), size: [w + 0.45, 0.42, d + 0.45], family: 'wood',
    }), 0, top + 0.21, 0));
    g.add(K.put(K.prism({
      color: shade(P.woodDark, 0.14), size: [2.2 * crest, 0.95 * crest, d - 0.7], family: 'wood',
    }), 0, top + 0.42 + 0.475 * crest, 0));
    for (const s of [-1, 1]) {
      g.add(K.put(K.cone({
        color: shade(P.woodDark, 0.14), r: 0.14, h: 0.42, seg: 5, family: 'wood',
      }), s * (w / 2 + 0.1), top + 0.63, 0));
    }
    return g;
  },
};
