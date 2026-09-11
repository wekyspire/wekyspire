// 异神小像（CATALOG2 编号 66）：「歪头石像+底座」——墓窟神秘小件 prop（stone+unlit 双族）。
// 原点=底面中心（y=0 落地），全高约 2.5（S 档柱顶件）；mount 双宿主 ['floor','smallWallTop']。
// 结构=两级石座 + lathe 丰满躯身（束腰收肩）+ 双短臂stub + 短颈 + 低模球头：头部 tilt 一档
// 歪出（歪头即剪影记忆点），头顶双小角斜出（aim 定向）；眼窝=unlit 深洞一对 + 细缝嘴
// （altarDark 骷髅同手法），随头组一起歪。变体走 build(opts)：歪头幅度 headTilt /
// 角数 horns（0~2）/ 眼窝燃否 lit。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'idolSmall',
  place: 'prop',
  mount: ['floor', 'smallWallTop'],
  tags: ['stone', 'crypt'],
  footprint: { x: 1.7, z: 1.5 },
  behaviors: [],
  build({ headTilt = 0.22, horns = 2, lit = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('idolSmall');
    // 两级石座（底层收暗读作垫层）
    g.add(K.put(K.box({ color: shade(P.stone, -0.14), size: [1.25, 0.35, 1.05] }), 0, 0.175, 0));
    g.add(K.put(K.box({ color: P.stone, size: [1.05, 0.16, 0.9] }), 0, 0.43, 0));
    // 躯身：丰满束腰轮廓（lathe 自闭底，鼓腹收肩的邪神像剪影）
    const torso = K.lathe({
      color: shade(P.stone, 0.04),
      profile: [[0.02, 0], [0.36, 0.08], [0.5, 0.26], [0.53, 0.55], [0.4, 0.8], [0.26, 0.96]],
      seg: 7,
    });
    K.tilt(torso, 0, r() * 0.24, 0);
    g.add(K.put(torso, 0, 0.5, 0.02));
    // 双短臂 stub：自肩斜下垂（aim 定向）
    for (const s of [-1, 1]) {
      const arm = K.cyl({ color: shade(P.stone, -0.02), r: 0.11, rTop: 0.08, h: 0.46, seg: 5 });
      K.aim(arm, s * 0.42, -0.86, 0.1);
      g.add(K.put(arm, s * 0.42, 1.24, 0.06));
    }
    // 短颈 + 头组（歪头一档：头/角/眼/嘴随组一起歪）
    g.add(K.put(K.cyl({ color: shade(P.stone, -0.08), r: 0.13, h: 0.2, seg: 5 }), 0, 1.5, 0.04));
    const head = new THREE.Group();
    const tilt = Math.min(Math.max(headTilt, 0), 0.35);
    K.tilt(head, tilt * 0.6, 0.3, tilt);
    g.add(K.put(head, 0, 1.76, 0.04));
    const skullCap = K.sphereLo({ color: shade(P.stone, 0.1), r: 0.36, seg: 1, jitter: 0.06, rng: r });
    K.scaleXYZ(skullCap, 0.95, 1.12, 1.0);
    head.add(K.put(skullCap, 0, 0.04, 0));
    // 头顶小角：斜出双锥（aim 定向，异神感）
    const nh = Math.min(Math.max(horns, 0), 2);
    for (let i = 0; i < nh; i++) {
      const s = i === 0 ? -1 : 1;
      const horn = K.cone({ color: shade(P.stone, -0.08), r: 0.09, h: 0.44, seg: 5 });
      K.aim(horn, s * 0.55, 1, -0.1);
      head.add(K.put(horn, s * 0.24, 0.3, 0));
    }
    // 眼窝 + 细缝嘴：unlit 深洞一对（燃时透 P.night 幽黑，灭时压暗石色同族）
    const eyeC = lit ? P.night : shade(P.night, 0.06);
    for (const ex of [-0.14, 0.14]) {
      const eye = K.cyl({ color: eyeC, r: 0.055, h: 0.1, seg: 5, family: 'unlit' });
      K.tilt(eye, Math.PI / 2, 0, 0);
      head.add(K.put(eye, ex, 0.08, 0.33));
    }
    head.add(K.put(K.box({ color: P.night, size: [0.18, 0.05, 0.05], family: 'unlit' }), 0, -0.12, 0.34));
    return g;
  },
};
