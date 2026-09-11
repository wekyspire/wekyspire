// 捆绑骨堆（CATALOG2 编号 92）：「交叉骨+绳捆+断链」——prop/floor 矮堆
// （stone 骨 + cloth 绳捆 + metal 断链 三族）。原点=堆底中心（y=0 落地）；
// 长骨两三根交叉架起（aim 对向躺姿、一端微抬，骨节鼓头收两端），交叉点上下
// 两道绳匝缠紧（ropeCoil 的切向段语汇），断链自捆侧垂落地面——末环断口张开翻倒。
// 变体走 build(opts)：骨数/绳匝道数/链环数。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 一根长骨：细杆两端各一对鼓球节（局部原点=骨心中点，轴沿 y、经 aim 摆向）
function longBone(len, r) {
  const b = new THREE.Group();
  b.add(K.cyl({ color: shade(P.bone, -0.04), r: 0.085, rTop: 0.07, h: len, seg: 5 }));
  for (const e of [-1, 1]) {
    for (const s of [-1, 1]) {
      const knob = K.sphereLo({
        color: e * s > 0 ? P.bone : shade(P.bone, 0.08),
        r: 0.13, seg: 0, jitter: 0.12, rng: r,
      });
      b.add(K.put(knob, s * 0.12, e * (len / 2 - 0.06), 0));
    }
  }
  return b;
}

export default {
  id: 'bonesBound',
  place: 'prop',
  mount: 'floor',
  tags: ['bone', 'crypt'],
  footprint: { x: 2.5, z: 2.5 },
  behaviors: [],
  build({ bones = 3, wraps = 2, links = 3, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('bonesBound');
    // 交叉长骨：走向散开互搭，逐根垫高（aim 带小 dy = 一端微抬的堆势）
    const n = Math.min(Math.max(bones, 2), 4);
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (0.2 + 0.6 * (i / Math.max(1, n - 1))) + (r() - 0.5) * 0.24;
      const len = 1.8 + r() * 0.3;
      const bone = longBone(len, r);
      K.aim(bone, Math.cos(a), 0.2 + (i % 2) * 0.14, Math.sin(a));
      g.add(K.put(bone, (r() - 0.5) * 0.2, 0.22 + i * 0.15, (r() - 0.5) * 0.2));
    }
    // 绳捆：交叉点上下两道绳匝（切向段围环缠紧，一道微斜读作缠绕）
    const wn = Math.min(Math.max(wraps, 1), 2);
    for (let k = 0; k < wn; k++) {
      const R = 0.3, y = 0.24 + k * 0.16;
      for (let i = 0; i < 5; i++) {
        const chord = 2 * R * Math.sin(Math.PI / 5);
        const piv = new THREE.Group();
        piv.rotation.y = (i / 5) * Math.PI * 2 + 0.4;
        if (k === 1) K.tilt(piv, 0.1, 0, 0.14);
        const seg = K.cyl({
          color: i % 2 ? shade(P.rope, -0.07) : P.rope, r: 0.07, h: chord + 0.06, seg: 4, family: 'cloth',
        });
        K.tilt(seg, 0, 0, Math.PI / 2);
        piv.add(K.put(seg, R, y, 0));
        g.add(piv);
      }
    }
    // 断链：自捆侧垂落地面（环环交替 90°），末环断口张开翻倒在地
    const ln = Math.min(Math.max(links, 2), 5);
    const a0 = 2.4;
    let cx = Math.cos(a0) * 0.44, cz = Math.sin(a0) * 0.44;
    for (let i = 0; i < ln; i++) {
      const last = i === ln - 1;
      const link = K.cyl({
        color: shade(P.iron, -0.05), r: 0.055, h: last ? 0.17 : 0.24, seg: 5, family: 'metal',
      });
      if (last) {
        cx += Math.cos(a0) * 0.16; cz += Math.sin(a0) * 0.16; // 断口脱开一截
        K.tilt(link, 1.2, r() * Math.PI, 0.5);
      } else {
        K.tilt(link, (r() - 0.5) * 0.24, i * Math.PI / 2, Math.PI / 2 - 0.1);
      }
      g.add(K.put(link, cx, last ? 0.07 : 0.09, cz));
      cx += Math.cos(a0) * 0.3; cz += Math.sin(a0) * 0.3;
    }
    return g;
  },
};
