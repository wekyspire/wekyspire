// 挂肉架（CATALOG2 编号 77）：「落地架+横杆垂肉两挂」——炊事晾挂件 prop（wood 框架 + cloth 绳肉 + stone 骨头 三族）。
// 原点=底面中心（y=0 落地）；落地架=双榀八字腿（z 向撇开，rx 单轴斜）+ 顶鞍木 + 出头横杆 + 低位系杆，
// 高约 6.9；每挂=横杆垂绳→露骨腿（P.bone 骨杆+球结）→火腿身（shade(P.blood, 0.25) 压扁 jitter 球）
// 外缠两道 P.boneDark 脂纹箍（膘层）。变体走 build(opts)：肉挂数 hangs（1~3）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 单挂腿肉（局部 y=0 为绳顶挂点）：垂绳→露骨腿→火腿身→两道脂纹箍
function ham(r, tone) {
  const h = new THREE.Group();
  // 吊绳：自横杆垂下
  h.add(K.put(K.cyl({ color: P.rope, r: 0.05, h: 0.85, seg: 4, family: 'cloth' }), 0, -0.42, 0));
  // 露骨腿：骨杆 + 顶端球结（绳拴处，骨色 stone 族）
  h.add(K.put(K.cyl({ color: P.bone, r: 0.09, rTop: 0.07, h: 0.55, seg: 5 }), 0, -1.1, 0));
  h.add(K.put(K.sphereLo({ color: P.bone, r: 0.14, seg: 0 }), 0, -0.82, 0));
  // 火腿身：压扁 jitter 球（肉色 = shade(P.blood, 0.25)，深浅逐挂微差）
  const meat = K.sphereLo({
    color: shade(P.blood, 0.25 + tone * 0.04),
    r: 0.56, seg: 1, jitter: 0.13, rng: r, family: 'cloth',
  });
  K.scaleXYZ(meat, 0.82, 1.38, 0.72);
  K.tilt(meat, (r() - 0.5) * 0.14, r() * Math.PI, (r() - 0.5) * 0.1);
  h.add(K.put(meat, 0, -1.95, 0));
  // 脂纹箍：两道 P.boneDark 细环缠在腿肉上（读作膘层），半径随腿肉弧度收
  for (const dy of [-0.28, 0.14]) {
    h.add(K.put(K.cyl({
      color: P.boneDark, r: 0.46 - Math.abs(dy) * 0.06, h: 0.1, seg: 6, family: 'cloth',
    }), 0, -1.95 + dy, 0));
  }
  return h;
}

export default {
  id: 'meatRackHang',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'kitchen'],
  footprint: { x: 5.0, z: 2.2 },
  behaviors: [],
  build({ hangs = 2, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('meatRackHang');
    // 双榀八字腿：脚外撇、顶向中心收拢（rx 单轴斜，前后腿深浅差一档）
    for (const sx of [-1.75, 1.75]) {
      for (const sz of [-1, 1]) {
        const leg = K.box({
          color: sz < 0 ? P.woodDark : shade(P.wood, -0.04),
          size: [0.26, 6.7, 0.2], family: 'wood',
        });
        K.tilt(leg, -sz * 0.1, 0, 0);
        K.jitter(leg, r, { rot: 0.008 });
        g.add(K.put(leg, sx, 3.2, sz * 0.34));
      }
      // 顶鞍木：托住横杆
      g.add(K.put(K.box({ color: P.wood, size: [0.34, 0.26, 0.5], family: 'wood' }), sx, 6.62, 0));
    }
    // 横杆：担在两顶鞍上、两端出头（高位），低位系杆连系两榀
    const bar = K.box({ color: shade(P.wood, 0.08), size: [4.7, 0.2, 0.17], family: 'wood' });
    K.jitter(bar, r, { rot: 0.006 });
    g.add(K.put(bar, 0, 6.82, 0));
    g.add(K.put(K.box({ color: P.woodDark, size: [3.3, 0.15, 0.14], family: 'wood' }), 0, 1.5, 0));
    // 垂挂腿肉：沿横杆错开分布，微歪微挪
    const xs = [-1.2, 0, 1.2];
    const n = Math.min(Math.max(hangs, 1), 3);
    for (let i = 0; i < n; i++) {
      const hm = ham(r, i);
      K.tilt(hm, (r() - 0.5) * 0.1, 0, (r() - 0.5) * 0.08);
      g.add(K.put(hm, xs[i] + (r() - 0.5) * 0.24, 6.78, 0));
    }
    return g;
  },
};
