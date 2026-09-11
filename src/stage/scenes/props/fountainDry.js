// 干涸喷泉（CATALOG2 编号 81）：「小水池+断柱芯+苔」——自然侵蚀 prop/floor（纯 stone 单族）。
// 原点=池心（y=0 落地，池径约 9，XL 档）；盆体沿 fontStone 的收张盆身+外翻盆沿语汇
// （lathe 一体旋出，profile 自外翻沿口折回内壁读作盆腔），盆内无水——盆底压暗湿渍
// 两圈读作干涸残湿；断柱芯=收分柱础+断柱身（chip 双角劈茬）+斜顶残块+斜倚断节
// （aim 任意朝向）；苔沿 mossPatchFloor 压扁球语汇爬盆沿/柱脚/外壁半面。
// 变体走 build(opts)：柱高/苔块数/碎岩数。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'fountainDry',
  place: 'prop',
  mount: 'floor',
  tags: ['stone', 'nature'],
  footprint: { x: 10.4, z: 10.4 },
  behaviors: [],
  build({ stubH = 2.2, mossBlobs = 6, rocks = 4, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('fountainDry');
    // 盆体：厚沿深腔（外翻盆沿→内壁折回盆底，lathe 一体旋出）
    g.add(K.put(K.lathe({
      color: P.stone, seg: 10,
      profile: [
        [0, 0], [3.9, 0.12], [4.55, 0.5], [4.62, 1.35],
        [4.76, 1.72], [4.32, 1.78], [3.4, 1.14], [1.7, 1.02], [0, 0.98],
      ],
    }), 0, 0, 0));
    // 干涸盆底：压暗湿渍两圈（内圈更深，读作残水渍印）
    g.add(K.put(K.cyl({ color: shade(P.stone, -0.3), r: 3.1, h: 0.06, seg: 10 }), 0, 1.14, 0));
    g.add(K.put(K.cyl({ color: shade(P.stone, -0.44), r: 1.9, h: 0.06, seg: 9 }), 0, 1.05, 0));
    // 断柱芯：收分柱础 + 断柱身（chip 双角劈茬）+ 斜顶残块
    g.add(K.put(K.cyl({ color: shade(P.stone, -0.12), r: 1.05, rTop: 0.9, h: 0.5, seg: 8 }), 0, 1.3, 0));
    const shaft = K.cyl({ color: P.stone, r: 0.7, rTop: 0.6, h: stubH, seg: 8 });
    K.chip(shaft, { corner: [1, 1, 1], amount: 0.32 });
    K.chip(shaft, { corner: [-1, 1, -1], amount: 0.26 });
    K.jitter(shaft, r, { rot: 0.008 });
    g.add(K.put(shaft, 0, 1.55 + stubH / 2, 0));
    const cap = K.cyl({ color: shade(P.stone, 0.08), r: 0.5, h: 0.26, seg: 7 });
    K.tilt(cap, 0.22, r() * Math.PI, 0.16);
    g.add(K.put(cap, 0.1, 1.6 + stubH, 0));
    // 斜倚断节：倒下的柱段（aim 任意朝向，下端抵柱脚、上端翘起）
    const frag = K.cyl({ color: shade(P.stone, -0.06), r: 0.42, rTop: 0.38, h: 1.05, seg: 7 });
    K.aim(frag, 1, 0.4, 0.25);
    g.add(K.put(frag, 1.55, 1.6, 0.45));
    // 碎岩：盆底散两三块 + 盆外滚落一块（rubblePile 三色斑驳）
    const rk = Math.max(2, Math.min(6, rocks));
    for (let i = 0; i < rk; i++) {
      const out = i === rk - 1;
      const a = r() * Math.PI * 2;
      const rad = out ? 5.0 : 1.5 + r() * 1.4;
      const rock = K.sphereLo({
        color: [shade(P.rock, 0.14), P.rock, shade(P.slab, 0.08)][i % 3],
        r: out ? 0.34 : 0.2 + r() * 0.16, seg: 0, jitter: 0.25, rng: r,
      });
      K.tilt(rock, r() * 0.8, r() * Math.PI, r() * 0.8);
      g.add(K.put(rock, Math.cos(a) * rad, out ? 0.22 : 1.12, Math.sin(a) * rad));
    }
    // 苔：盆沿顶面半面簇 + 柱脚沿础 + 外壁纵扁贴壁（深浅两层压扁球）
    const tones = [P.mossDark, P.moss, shade(P.moss, 0.16), shade(P.moss, 0.26)];
    const blob = (ti, x, y, z, sx, sy, sz, ry) => {
      const b = K.sphereLo({ color: tones[ti % 4], r: 1, seg: 0, jitter: 0.2, rng: r });
      K.scaleXYZ(b, sx, sy, sz);
      K.tilt(b, 0, ry, (r() - 0.5) * 0.15);
      g.add(K.put(b, x, y, z));
    };
    const a0 = r() * Math.PI * 2;
    const rimN = Math.max(2, Math.min(4, mossBlobs - 3));
    for (let i = 0; i < rimN; i++) {
      const a = a0 + (i - (rimN - 1) / 2) * 0.5;
      blob(i, Math.cos(a) * 4.5, 1.82, Math.sin(a) * 4.5, 0.5 + r() * 0.2, 0.13, 0.35 + r() * 0.2, a);
    }
    for (let i = 0; i < 2; i++) {
      const a = a0 + 0.7 + i * 1.3;
      blob(i + 1, Math.cos(a) * 1.0, 1.1, Math.sin(a) * 1.0, 0.4 + r() * 0.2, 0.14, 0.3, a);
    }
    const aw = a0 + 0.3;
    blob(1, Math.cos(aw) * 4.68, 0.8, Math.sin(aw) * 4.68, 0.42, 0.75, 0.26, aw);
    return g;
  },
};
