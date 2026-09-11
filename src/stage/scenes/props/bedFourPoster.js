// 四柱床（CATALOG2 #9）：「立柱+华盖布幔半垂」——大件家具 prop（wood 床架 + cloth 垫幔 双族）。
// 原点=底面中心（y=0 落地），x=长 z=宽；比简陋床铺（cotBed，10×4.4）大一号：床长 11.2、
// 宽 5.2，四柱通高 10.6 承华盖框，盖顶铺布。幔=多片错位叠出垂褶：床头三片长幔半垂、
// 床尾两片短幔、两侧束垂片微外斜。变体走 build(opts)：幔垂度 drape（0.3 提起 ~ 0.95 长垂）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'bedFourPoster',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'cloth', 'quarters'],
  footprint: { x: 12, z: 6 },
  behaviors: [],
  build({ drape = 0.65, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('bedFourPoster');
    const len = 11.2, wid = 5.2, postH = 10.6, half = len / 2, zw = wid / 2;
    const drapeCol = [P.bannerBlue, shade(P.bannerBlue, -0.06), shade(P.bannerBlue, 0.05)];
    // 四柱通高 + 柱尖饰
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const post = K.box({ color: P.woodDark, size: [0.55, postH, 0.55], family: 'wood' });
      if (rng) K.jitter(post, rng, { rot: 0.008 });
      g.add(K.put(post, sx * (half - 0.6), postH / 2, sz * (zw - 0.6)));
      g.add(K.put(K.cone({
        color: shade(P.woodDark, 0.12), r: 0.2, h: 0.45, seg: 5, family: 'wood',
      }), sx * (half - 0.6), postH + 0.22, sz * (zw - 0.6)));
    }
    // 床架：两侧长枋 + 床头/床尾横板（框在柱间）
    for (const sz of [-1, 1]) {
      g.add(K.put(K.box({
        color: P.woodDark, size: [len - 1.2, 0.75, 0.42], family: 'wood',
      }), 0, 1.75, sz * (zw - 0.4)));
    }
    for (const sx of [-1, 1]) {
      g.add(K.put(K.box({
        color: shade(P.woodDark, 0.05), size: [0.42, 2.4, wid - 1.2], family: 'wood',
      }), sx * (half - 0.6), 1.5, 0));
    }
    // 垫褥 + 靠枕 + 搭毯（cotBed 的铺盖语言：毯压被、错层加深色折片）
    g.add(K.put(K.box({ color: P.sack, size: [len - 1.5, 0.72, wid - 1.4], family: 'cloth' }), 0, 2.35, 0));
    g.add(K.put(K.box({ color: P.flour, size: [1.9, 0.5, wid - 2.6], family: 'cloth' }), -3.3, 2.95, 0));
    g.add(K.put(K.box({ color: P.bannerRed, size: [len * 0.5, 0.26, wid - 1.5], family: 'cloth' }), 2.0, 2.85, 0));
    g.add(K.put(K.box({
      color: shade(P.bannerRed, -0.06), size: [len * 0.28, 0.22, wid - 1.7], family: 'cloth',
    }), 3.3, 3.0, 0));
    // 华盖框（四枋）+ 盖顶铺布
    for (const sz of [-1, 1]) {
      g.add(K.put(K.box({
        color: P.woodDark, size: [len - 1.2, 0.3, 0.3], family: 'wood',
      }), 0, postH - 0.15, sz * (zw - 0.6)));
    }
    for (const sx of [-1, 1]) {
      g.add(K.put(K.box({
        color: P.woodDark, size: [0.3, 0.3, wid - 1.2], family: 'wood',
      }), sx * (half - 0.6), postH - 0.15, 0));
    }
    g.add(K.put(K.box({
      color: shade(P.bannerBlue, 0.02), size: [len - 0.9, 0.2, wid - 0.9], family: 'cloth',
    }), 0, postH - 0.05, 0));
    // 床头三片错叠长幔（半垂，逐片外错出褶）
    const hangHead = (postH - 1.4) * drape;
    for (let i = 0; i < 3; i++) {
      const panel = K.box({ color: drapeCol[i % 3], size: [0.2, hangHead, 2.5], family: 'cloth' });
      K.tilt(panel, 0, (r() - 0.5) * 0.1, (r() - 0.5) * 0.04);
      g.add(K.put(panel, -(half - 0.52) - i * 0.1, postH - 0.4 - hangHead / 2, (i - 1) * 1.55));
    }
    // 床尾两片短幔（垂得浅，露出床尾板）
    const hangFoot = (postH - 1.4) * drape * 0.45;
    for (let i = 0; i < 2; i++) {
      const panel = K.box({ color: drapeCol[(i + 1) % 3], size: [0.18, hangFoot, 2.2], family: 'cloth' });
      K.tilt(panel, 0, (r() - 0.5) * 0.1, (r() - 0.5) * 0.04);
      g.add(K.put(panel, half - 0.52 - i * 0.09, postH - 0.4 - hangFoot / 2, (i - 0.5) * 1.3));
    }
    // 两侧束垂片（半垂侧幔，微外斜出束带感）
    const hangSide = 1.2 + drape * 2.6;
    for (const sz of [-1, 1]) {
      const side = K.box({ color: drapeCol[1], size: [len * 0.42, hangSide, 0.2], family: 'cloth' });
      K.tilt(side, sz * 0.06, 0, (r() - 0.5) * 0.05);
      g.add(K.put(side, 0, postH - 0.5 - hangSide / 2, sz * (zw - 0.5)));
    }
    return g;
  },
};
