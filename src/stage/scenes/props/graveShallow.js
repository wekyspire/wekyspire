// 浅坟（CATALOG2 编号 100）：「土包+歪木牌+一撮花」——floorDecal 矮堆（stone+wood 双族，总高 ≤1.5）。
// 原点=坟心投影（y=0 落地）；土包=压扁 sphereLo 主丘+副丘+丘顶（clay 提亮读出新鲜翻土，
// 深色地面上必须亮于地面；skullPile/rubblePile 的堆语汇）+根脚散土；歪木牌=木柱+chip 缺角
// 牌板整组 tilt 歪出一档（歪木牌即剪影记忆点）；一撮花=P.herb 花茎几根+冷白 P.wax/P.parchment
// 花点，坟缘压两粒灰石。变体走 build(opts)：坟包大小 mound/木牌歪度 lean/花数 blooms。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'graveShallow',
  place: 'floorDecal',
  tags: ['crypt'],
  footprint: { x: 3, z: 2 },
  behaviors: [],
  build({ mound = 1, lean = 0.2, blooms = 3, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('graveShallow');
    const s = Math.min(Math.max(mound, 0.75), 1.3);
    // 土包：主丘+副丘+丘顶，压扁 jitter 球
    const hill = K.sphereLo({ color: shade(P.clay, 0.18), r: 1.12 * s, seg: 1, jitter: 0.15, rng: r });
    K.scaleXYZ(hill, 1.12, 0.4, 0.76);
    K.tilt(hill, 0, r() * Math.PI, 0);
    g.add(K.put(hill, 0, 0.43 * s, 0));
    const lobe = K.sphereLo({ color: shade(P.clay, 0.08), r: 0.62 * s, seg: 1, jitter: 0.16, rng: r });
    K.scaleXYZ(lobe, 1, 0.42, 0.85);
    g.add(K.put(lobe, -0.6 * s, 0.3 * s, 0.3 * s));
    const crown = K.sphereLo({ color: shade(P.clay, 0.28), r: 0.4 * s, seg: 0, jitter: 0.18, rng: r });
    K.scaleXYZ(crown, 1.05, 0.48, 0.9);
    g.add(K.put(crown, 0.12 * s, 0.68 * s, -0.08 * s));
    // 根脚散土：坟缘几捧翻土（压暗贴地）
    for (let i = 0; i < 3; i++) {
      const a = r() * Math.PI * 2;
      const dirt = K.sphereLo({
        color: shade(P.clay, -0.08 - r() * 0.1), r: 0.22 + r() * 0.1, seg: 0, jitter: 0.2, rng: r,
      });
      K.scaleXYZ(dirt, 1.2, 0.4, 1);
      g.add(K.put(dirt, Math.cos(a) * 1.02 * s, 0.09, Math.sin(a) * 0.78 * s));
    }
    // 歪木牌：木柱+缺角牌板，整组 tilt 歪出一档
    const board = new THREE.Group();
    board.add(K.put(K.box({ color: shade(P.wood, -0.06), size: [0.15, 0.95, 0.15], family: 'wood' }), 0, 0.47, 0));
    const plate = K.box({ color: shade(P.wood, 0.12), size: [0.62, 0.45, 0.1], family: 'wood' });
    K.chip(plate, { corner: [1, 1, 1], amount: 0.12 });
    K.tilt(plate, 0, 0, 0.04);
    board.add(K.put(plate, 0, 1.03, 0));
    const ln = Math.min(Math.max(lean, 0), 0.4);
    K.tilt(board, ln, r() * Math.PI * 2, ln * 0.8);
    g.add(K.put(board, -0.95 * s, 0.12, 0.55 * s));
    // 一撮花：P.herb 花茎（aim 微外倾）+ 冷白/灰黄花点，坟前另一侧
    const bn = Math.max(2, Math.min(6, blooms));
    for (let i = 0; i < bn; i++) {
      const a = -0.6 + (r() - 0.5) * 0.8;
      const rad = 0.28 + r() * 0.3;
      const hgt = 0.42 + r() * 0.24;
      const stem = K.cyl({ color: P.herb, r: 0.028, h: hgt, seg: 4, family: 'wood' });
      K.aim(stem, Math.cos(a) * 0.3, 1, Math.sin(a) * 0.3);
      const fx = 0.75 * s + Math.cos(a) * rad, fz = -0.6 * s + Math.sin(a) * rad;
      g.add(K.put(stem, fx, hgt * 0.45, fz));
      const bloom = K.sphereLo({
        color: [P.wax, shade(P.wax, 0.14), P.parchment][i % 3], r: 0.09, seg: 0, jitter: 0.1, rng: r,
      });
      g.add(K.put(bloom, fx + Math.cos(a) * 0.08, hgt * 0.9, fz + Math.sin(a) * 0.08));
    }
    // 坟缘压两粒灰石
    for (const [sx, sz] of [[0.9, -0.5], [-0.4, -0.85]]) {
      const st = K.sphereLo({ color: shade(P.rock, 0.06), r: 0.16 + r() * 0.06, seg: 0, jitter: 0.2, rng: r });
      K.scaleXYZ(st, 1.15, 0.6, 1);
      g.add(K.put(st, sx * s, 0.1, sz * s));
    }
    return g;
  },
};
