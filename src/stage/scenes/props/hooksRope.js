// 墙钩挂绳（CATALOG #83）：「铁钩两枚垂绳索，绳结粗大」——wallDecor 低带挂件（metal+cloth 双族）。
// 原点=墙面低位挂点（z=0 贴墙，+z 朝室内）；壁座铁钩两枚（横臂+下弯钩尖的 J 形），
// 绳索=小圆柱链段交错微倾自钩尖垂坠，末端双箍大结（结径 ~3 倍绳径）。
// 变体走 build(opts)：钩数（2~3）/绳长/结径倍率；rng 驱动确定性。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 单枚铁钩：壁座 + 外伸横臂 + 下弯钩尖（J 形），返回挂点在局部原点的 Group（板面贴 z=0）
function makeHook() {
  const h = new THREE.Group();
  h.add(K.put(K.box({ color: shade(P.iron, -0.12), size: [0.5, 0.72, 0.14], family: 'metal' }), 0, 0, 0.07));
  const arm = K.cyl({ color: P.iron, r: 0.1, h: 0.85, seg: 5, family: 'metal' });
  K.tilt(arm, Math.PI / 2, 0, 0);
  h.add(K.put(arm, 0, 0.1, 0.07 + 0.425));
  h.add(K.put(K.cyl({ color: shade(P.iron, 0.06), r: 0.09, h: 0.5, seg: 5, family: 'metal' }), 0, -0.15, 0.92));
  return h;
}

// 一条绳索：小圆柱链段微倾相接成束（深浅交替=绳股感），末端双箍大结；自局部原点垂下
function makeRope(len, knot) {
  const rope = new THREE.Group();
  const segs = Math.max(3, Math.round(len / 1.05));
  const step = len / segs;
  for (let i = 0; i < segs; i++) {
    const sway = Math.sin(i * 0.9) * 0.09;
    const seg = K.cyl({
      color: i % 2 ? shade(P.rope, -0.07) : P.rope,
      r: 0.095, h: step + 0.1, seg: 5, family: 'cloth',
    });
    K.tilt(seg, 0, 0, sway);
    rope.add(K.put(seg, sway * 0.4, -step * (i + 0.5), sway * 0.5));
  }
  // 末端绳结：上箍收拢 + 下箍胀大（粗大结块）
  rope.add(K.put(K.cyl({ color: shade(P.rope, -0.12), r: 0.26 * knot, rTop: 0.2 * knot, h: 0.42, seg: 5, family: 'cloth' }), 0, -len - 0.21, 0));
  rope.add(K.put(K.cyl({ color: shade(P.rope, -0.05), r: 0.3 * knot, rTop: 0.18 * knot, h: 0.5, seg: 5, family: 'cloth' }), 0, -len - 0.65, 0));
  return rope;
}

export default {
  id: 'hooksRope',
  place: 'wallDecor',
  band: 'low',
  tags: ['metal', 'cloth'],
  behaviors: [],
  build({ hooks = 2, ropeLen = 3.8, knot = 1, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('hooksRope');
    const n = Math.min(Math.max(hooks, 2), 3);
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * 1.15;
      const hook = makeHook();
      K.tilt(hook, 0, 0, (r() - 0.5) * 0.05);
      g.add(K.put(hook, x, 1.7, 0));
      // 绳索搭过钩尖垂下（绳长/相位各钩微差）
      const rope = makeRope(ropeLen * (0.85 + r() * 0.3), knot);
      g.add(K.put(rope, x, 1.35, 0.92));
    }
    return g;
  },
};
