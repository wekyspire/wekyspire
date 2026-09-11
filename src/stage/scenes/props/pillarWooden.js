// 木柱（CATALOG2 编号 85）：「粗木柱带疤+箍铁」——smallWall 宿主类（wood 柱身 + metal 铁箍 双族）。
// 柱式三段同 columnRound（础→身→头）的木语言版：双盘木础 + 七棱砍削柱身（侧面半嵌疤节瘤 +
// 两道暗铁箍贴身箍紧）+ 颈环外展木帽与方顶板。原点=底面中心（y=0 落地）；默认全高 26，
// 顶面 topY=26（平整承放面，陶瓮/烛台等柱顶小件按此准入）。变体走 build(opts)：
// 柱身高/疤节数/箍数/顶板缺角。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 柱身半径（分段线性，同 lathe profile）：底 1.3 → 0.4H 处 1.24 → 顶 1.1（微收分+中段微鼓）
const shaftR = (y, H) => (y <= H * 0.4
  ? 1.3 - 0.06 * (y / (H * 0.4))
  : 1.24 - 0.14 * ((y - H * 0.4) / (H * 0.6)));

export default {
  id: 'pillarWooden',
  place: 'smallWall',
  tags: ['wood', 'generic'],
  footprint: { x: 4.2, z: 4.2 },
  topY: 26, // 木础(1.2) + 柱身(23.25) + 颈环(0.3) + 外展帽(0.55) + 方顶板(0.7)
  behaviors: [],
  build({ shaftH = 23.25, knots = 2, hoops = 2, chipped = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('pillarWooden');
    // 木础：两阶收进的双盘（压暗木色读作垫础）
    g.add(K.put(K.cyl({ color: shade(P.woodDark, -0.12), r: 2.0, rTop: 1.85, h: 0.7, seg: 7, family: 'wood' }), 0, 0.35, 0));
    g.add(K.put(K.cyl({ color: shade(P.woodDark, 0.08), r: 1.7, rTop: 1.56, h: 0.5, seg: 7, family: 'wood' }), 0, 0.95, 0));
    // 柱身：七棱砍削感（seg=7 读作斧劈面）+ 微收分与卷杀（同 columnRound 的木版）
    const body = K.lathe({
      color: P.wood, seg: 7, family: 'wood',
      profile: [[1.3, 0], [1.24, shaftH * 0.4], [1.1, shaftH]],
    });
    K.jitter(body, r, { rot: 0.012 }); // 立柱微歪的手工感
    g.add(K.put(body, 0, 1.2, 0));
    // 箍铁：暗铁环贴身箍紧（半径随柱身收分 +0.07），上下等距各一道
    const hn = Math.max(1, Math.min(3, hoops));
    for (let i = 0; i < hn; i++) {
      const y = 2.6 + (shaftH - 4.6) * (i / Math.max(1, hn - 1));
      g.add(K.put(K.cyl({
        color: shade(P.iron, -0.16 + 0.08 * (i % 2)),
        r: shaftR(y, shaftH) + 0.07, h: 0.45, seg: 7, family: 'metal',
      }), 0, 1.2 + y, 0));
    }
    // 疤节：侧面半嵌的低模球瘤（球心藏进柱身一半，读作树疤鼓包）
    const kn = Math.max(0, Math.min(4, knots));
    for (let i = 0; i < kn; i++) {
      const y = 3.5 + r() * (shaftH - 7.5);
      const a = r() * Math.PI * 2;
      const rad = shaftR(y, shaftH) * 0.72;
      g.add(K.put(
        K.sphereLo({ color: shade(P.wood, -0.18), r: 0.38 + r() * 0.12, seg: 0, jitter: 0.22, rng: r, family: 'wood' }),
        Math.cos(a) * rad, 1.2 + y, Math.sin(a) * rad,
      ));
    }
    // 柱头：颈环 + 外展木帽（echinus 木版）+ 方顶板（平整承放面，可缺角风化）
    const shaftTop = 1.2 + shaftH;
    g.add(K.put(K.cyl({ color: shade(P.woodDark, 0.12), r: 1.14, rTop: 1.26, h: 0.3, seg: 7, family: 'wood' }), 0, shaftTop + 0.15, 0));
    g.add(K.put(K.cyl({ color: P.wood, r: 1.2, rTop: 1.62, h: 0.55, seg: 7, family: 'wood' }), 0, shaftTop + 0.575, 0));
    const cap = K.box({ color: shade(P.woodDark, 0.04), size: [3.0, 0.7, 3.0], family: 'wood' });
    if (chipped) K.chip(cap, { corner: [-1, 1, 1], amount: 0.28 }); // 顶板风化缺角（不动 topY）
    g.add(K.put(cap, 0, shaftTop + 1.2, 0));
    return g;
  },
};
