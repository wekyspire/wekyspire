// 敞口袋（CATALOG2 #26）：「袋口外翻漏出谷粒」——容器类 prop/floor（cloth 单族，DoubleSide 软轮廓）。
// 原点=底面中心（y=0 落地）；谷粒=P.straw 小 jitter 球（袋口冒尖+落地一堆+沿线散粒）。
// 变体走 build(opts)：散粒量 spill / 袋身丰满度 fat。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 袋身轮廓（lathe profile：束底→鼓肚→收腰到袋口），袋高约 1.65
const SACK = [
  [0.03, 0], [0.5, 0], [0.68, 0.22], [0.82, 0.7], [0.78, 1.15], [0.6, 1.45], [0.55, 1.62],
];

export default {
  id: 'sackOpen',
  place: 'prop',
  mount: 'floor',
  tags: ['cloth', 'container', 'quarters'],
  footprint: { x: 2.6, z: 2.6 },
  behaviors: [],
  build({ spill = 6, fat = 1, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('sackOpen');
    // 袋身：lathe 软轮廓（cloth 内壁可见），fat 控丰满度，微歪的软袋感
    const body = K.lathe({
      color: P.sack, seg: 7, family: 'cloth',
      profile: SACK.map(([rad, y]) => [rad * fat, y]),
    });
    if (rng) K.jitter(body, rng, { rot: 0.02 });
    g.add(body);
    // 外翻袋口：口沿向外翻折的短颈圈（内面布色略浅读作翻边）
    const cuff = K.lathe({
      color: shade(P.sack, 0.08), seg: 7, family: 'cloth',
      profile: [[0.55 * fat, 0], [0.66 * fat, 0.05], [0.72 * fat, 0.2], [0.62 * fat, 0.3]],
    });
    K.tilt(cuff, 0.02, 0.3, 0.02);
    g.add(K.put(cuff, 0, 1.6, 0));
    // 谷粒堆：袋口冒尖的谷堆（压扁 jitter 球读作颗粒隆起）
    const heap = K.sphereLo({ color: P.straw, r: 0.46, seg: 1, jitter: 0.16, rng: r, family: 'cloth' });
    K.scaleXYZ(heap, 1, 0.55, 1);
    g.add(K.put(heap, 0, 1.52, 0));
    // 落地谷堆：袋边一小撮倒出来的谷子
    const pile = K.sphereLo({ color: shade(P.straw, -0.06), r: 0.3, seg: 1, jitter: 0.2, rng: r, family: 'cloth' });
    K.scaleXYZ(pile, 1.3, 0.4, 1);
    g.add(K.put(pile, 0.85, 0.13, 0.45));
    // 散粒：袋口到谷堆一线洒落的小谷粒
    for (let i = 0; i < spill; i++) {
      const grain = K.sphereLo({
        color: [P.straw, shade(P.straw, 0.08), shade(P.straw, -0.08)][i % 3],
        r: 0.1, seg: 0, jitter: 0.25, rng: r, family: 'cloth',
      });
      const t = (i + 0.5) / spill;
      g.add(K.put(grain,
        0.35 + t * 1.45 + (r() - 0.5) * 0.2, 0.09,
        0.2 + t * 0.35 + (r() - 0.5) * 0.5));
    }
    return g;
  },
};
