// 磨损小地毯（CATALOG2 编号 95）：「织纹矩形+流苏+磨白」——floorDecal 贴地薄片
// （cloth 单族）。原点=毯心投影（y=0 落地）；毯底=暗红整片薄板（th 0.1 贴地），
// 面上纵排色差织带（深浅条带读出织纹）+ 四边压暗框带收边，两端短边流苏小条外探，
// 毯面散提亮磨白斑（shade 提亮的压扁斑块=踩秃磨白）。总高 ≤0.25。
// 变体走 build(opts)：织带数/磨白斑数/流苏密度。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'rugWorn',
  place: 'floorDecal',
  tags: ['cloth', 'quarters'],
  footprint: { x: 5, z: 3.5 },
  behaviors: [],
  build({ bands = 6, wear = 4, fringe = 5, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('rugWorn');
    const W = 4.6, D = 3.0, TH = 0.1, inset = 0.34;
    const field = [shade(P.bannerRed, 0.12), P.bannerRed, shade(P.bannerRed, -0.1)];
    // 毯底：暗红整片薄板（贴地薄片）
    g.add(K.put(
      K.plate({ color: shade(P.bannerRed, -0.04), w: W, d: D, th: TH, family: 'cloth' }),
      0, TH / 2, 0));
    // 织带：纵排色差条带（中段留边，条宽微差读出手织）
    const bn = Math.min(Math.max(bands, 4), 8);
    const bw = (D - inset * 2) / bn;
    for (let i = 0; i < bn; i++) {
      g.add(K.put(
        K.plate({
          color: field[i % 3], w: W - inset * 2 + (r() - 0.5) * 0.05, d: bw + 0.02, th: 0.045, family: 'cloth',
        }),
        0, TH + 0.02, -D / 2 + inset + bw * (i + 0.5)));
    }
    // 边框：四边压暗框带（两侧窄条 + 两端宽条）
    const frame = shade(P.bannerRed, -0.28);
    for (const sz of [-1, 1]) {
      g.add(K.put(
        K.plate({ color: frame, w: W, d: inset - 0.02, th: 0.055, family: 'cloth' }),
        0, TH + 0.03, sz * (D / 2 - inset / 2)));
    }
    for (const sx of [-1, 1]) {
      g.add(K.put(
        K.plate({
          color: shade(P.bannerRed, -0.22), w: inset - 0.02, d: D - (inset - 0.02) * 2, th: 0.055, family: 'cloth',
        }),
        sx * (W / 2 - inset / 2), TH + 0.03, 0));
    }
    // 流苏：两端短边外探的小条（微垂微斜）
    const fn = Math.min(Math.max(fringe, 4), 7);
    for (let i = 0; i < fn; i++) {
      const z = -D / 2 + 0.24 + (D - 0.48) * (i / (fn - 1));
      for (const sx of [-1, 1]) {
        const t = K.box({
          color: i % 2 ? shade(P.bannerRed, 0.2) : shade(P.bannerRed, 0.12),
          size: [0.34, 0.055, 0.11], family: 'cloth',
        });
        K.tilt(t, 0, 0, (r() - 0.5) * 0.12);
        g.add(K.put(t, sx * (W / 2 + 0.12), 0.062, z + (r() - 0.5) * 0.06));
      }
    }
    // 磨白斑：提亮压扁斑块（踩秃的磨白，散在毯面中段）
    const wn = Math.min(Math.max(wear, 2), 6);
    for (let i = 0; i < wn; i++) {
      const patch = K.sphereLo({
        color: shade(P.bannerRed, 0.34 + r() * 0.14), r: 0.24 + r() * 0.2, seg: 1, jitter: 0.22, rng: r, family: 'cloth',
      });
      K.scaleXYZ(patch, 1.25, 0.14, 0.95);
      K.tilt(patch, 0, r() * Math.PI, 0);
      g.add(K.put(patch, (r() - 0.5) * (W - 1.6), 0.15, (r() - 0.5) * (D - 1.2)));
    }
    return g;
  },
};
