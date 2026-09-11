// 卷轴堆（CATALOG2 #30）：「成捆卷轴+皮带头+一根散开」——容器类 prop/floor（wood 单族，羊皮纸色系）。
// 原点=底面中心（y=0 落地）；单卷=横 cyl 轴身 + 端头圆片 + 木轴头，P.woodDark 环箍+小带头读作皮带束环。
// 变体走 build(opts)：卷数 rolls / 束环数 straps / 散开卷 loose。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

const LEN = 1.2, RAD = 0.22;                              // 单卷：长 1.2、卷径 0.44（轴向 x 横放）
const TONES = () => [P.parchment, shade(P.parchment, 0.06), shade(P.parchment, -0.08)];

// 单根卷轴（局部原点=卷轴轴心）：纸卷轴身 + 两端略大的螺旋端面圆片 +（可选）探出的木轴头
function makeRoll(tone = 0, rod = true) {
  const g = new THREE.Group();
  const body = K.cyl({ color: TONES()[tone % 3], r: RAD, h: LEN, seg: 6, family: 'wood' });
  K.tilt(body, 0, 0, Math.PI / 2);
  g.add(body);
  for (const s of [-1, 1]) {
    const cap = K.cyl({ color: shade(P.parchment, -0.12), r: RAD + 0.015, h: 0.05, seg: 6, family: 'wood' });
    K.tilt(cap, 0, 0, Math.PI / 2);
    g.add(K.put(cap, s * (LEN / 2 - 0.02), 0, 0));
  }
  if (rod) {
    const knob = K.cyl({ color: P.wood, r: 0.055, h: 0.22, seg: 5, family: 'wood' });
    K.tilt(knob, 0, 0, Math.PI / 2);
    g.add(K.put(knob, LEN / 2 + 0.06, 0, 0));
  }
  return g;
}

// 皮带束环：中段一圈 P.woodDark 深色环 + 上翻的小带头（读作捆卷的皮带扣头）
function strapRoll(g, x0) {
  const ring = K.cyl({ color: P.woodDark, r: RAD + 0.045, h: 0.18, seg: 6, family: 'wood' });
  K.tilt(ring, 0, 0, Math.PI / 2);
  g.add(K.put(ring, x0, 0, 0));
  g.add(K.put(K.tilt(
    K.box({ color: shade(P.woodDark, 0.08), size: [0.15, 0.26, 0.11], family: 'wood' }), 0, 0, 0.35,
  ), x0, 0.3, 0.04));
}

export default {
  id: 'scrollRolls',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'parchment', 'library'],
  footprint: { x: 3.2, z: 2.2 },
  behaviors: [],
  build({ rolls = 4, straps = 2, loose = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('scrollRolls');
    // 成捆：底排三卷并肩 + 顶排一卷落沟（错落微转的手工堆放感）
    const spots = [
      { x: 0, y: RAD, z: -0.46, ry: 0 },
      { x: 0.02, y: RAD, z: 0, ry: 0.05 },
      { x: -0.03, y: RAD, z: 0.46, ry: -0.04 },
      { x: 0.05, y: 0.6, z: -0.23, ry: 0.12 },
    ];
    // 皮带束环：优先捆顶层卷与无载底的卷（带头朝上不被压）
    const ns = Math.min(Math.max(straps, 0), 2);
    const n = Math.min(Math.max(rolls, 3), 4);
    for (let i = 0; i < n; i++) {
      const sp = spots[i];
      const roll = makeRoll(i % 3, i % 2 === 0);
      if (ns > 0 && i >= n - ns) strapRoll(roll, i === n - ns ? -0.1 : 0.18);
      K.tilt(roll, 0, sp.ry + (r() - 0.5) * 0.06, 0);
      g.add(K.put(roll, sp.x + (r() - 0.5) * 0.05, sp.y, sp.z + (r() - 0.5) * 0.05));
    }
    // 一根散开：半展开的卷轴——展开纸面 + 一端卷起的半卷芯 + 前导木杆
    if (loose) {
      const sheet = K.box({ color: P.parchment, size: [1.3, 0.05, 0.9], family: 'wood' });
      K.tilt(sheet, 0.05, -0.25, 0.02);
      g.add(K.put(sheet, 1.15, 0.07, 0.45));
      const curl = K.cyl({ color: shade(P.parchment, -0.06), r: 0.17, h: 0.92, seg: 6, family: 'wood' });
      K.tilt(curl, Math.PI / 2, 0, 0);
      g.add(K.put(curl, 0.45, 0.2, 0.45));
      const core = K.cyl({ color: P.wood, r: 0.05, h: 1.06, seg: 5, family: 'wood' });
      K.tilt(core, Math.PI / 2, 0, 0);
      g.add(K.put(core, 0.45, 0.2, 0.45));
      const lead = K.cyl({ color: P.wood, r: 0.045, h: 0.98, seg: 5, family: 'wood' });
      K.tilt(lead, Math.PI / 2, -0.25, 0);
      g.add(K.put(lead, 1.78, 0.1, 0.45));
    }
    return g;
  },
};
