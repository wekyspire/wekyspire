// 黄铜星仪（CATALOG2 编号 118）：「环架+错落小球」——奥术小件 prop（metal 单族）。
// 原点=底面中心（y=0 落地），环径约 2.5、全高约 3.3（S 档）；mount 双宿主 ['floor','smallWallTop']。
// 铜器=P.copper：三足外撇托束腰柱础，斜轴（P.silver）穿金色日球（P.gold）；多环交错=
// 赤道环/黄道环/子午环（lathe 矩形截面闭合环，环组带姿态整体倾斜），copper/silver 小球
// 错落骑在环上（挂在环组内、随环倾斜）。变体走 build(opts)：环数 rings（2~4，含外倾环）/
// 小球数 planets（2~6）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 环截面：外半径 R、管半宽 tw、半高 th——闭合矩形轮廓旋出的低模圆环
function ringMesh(R, tone) {
  const tw = 0.07, th = 0.05;
  return K.lathe({
    color: tone,
    profile: [[R - tw, -th], [R + tw, -th], [R + tw, th], [R - tw, th], [R - tw, -th]],
    seg: 12, family: 'metal',
  });
}

export default {
  id: 'orreryMini',
  place: 'prop',
  mount: ['floor', 'smallWallTop'],
  tags: ['metal', 'arcane'],
  footprint: { x: 2.8, z: 2.8 },
  behaviors: [],
  build({ rings = 3, planets = 4, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('orreryMini');
    // 三足：120° 环布外撇落地（同 brazierFire 足语言，足端粗根端细）
    for (let i = 0; i < 3; i++) {
      const a = i * (Math.PI * 2 / 3) + 0.5;
      const rootR = 0.2, footR = 0.6, drop = 0.72;
      const leg = K.cyl({
        color: shade(P.copper, -0.06), r: 0.09, rTop: 0.07,
        h: Math.hypot(footR - rootR, drop), seg: 5, family: 'metal',
      });
      K.tilt(leg, 0, -a, -Math.atan2(footR - rootR, drop));
      const midR = (rootR + footR) / 2;
      g.add(K.put(leg, Math.cos(a) * midR, drop / 2, Math.sin(a) * midR));
    }
    // 柱础（束腰 lathe）+ 承轴盘
    g.add(K.put(K.lathe({
      color: P.copper,
      profile: [[0.2, 0], [0.32, 0.07], [0.17, 0.2], [0.26, 0.32], [0.32, 0.4]],
      seg: 8, family: 'metal',
    }), 0, 0.68, 0));
    g.add(K.put(K.cyl({ color: shade(P.copper, 0.08), r: 0.32, rTop: 0.28, h: 0.12, seg: 8, family: 'metal' }), 0, 1.12, 0));
    // 斜轴（P.silver）+ 轴顶小球；日球金色悬在轴腰
    const axis = K.cyl({ color: P.silver, r: 0.055, h: 2.05, seg: 5, family: 'metal' });
    K.tilt(axis, 0, 0, 0.3);
    g.add(K.put(axis, 0, 2, 0));
    g.add(K.put(K.sphereLo({ color: shade(P.silver, 0.1), r: 0.1, seg: 0, family: 'metal' }), -0.3, 2.98, 0));
    g.add(K.put(K.sphereLo({ color: P.gold, r: 0.3, seg: 1, family: 'metal' }), 0, 1.98, 0));
    // 多环交错：赤道环（平）/ 黄道环（斜）/ 子午环（立）/ 外倾环（第 4 环），
    // 各环自成 Group（环+骑球），带姿态整体倾斜——球位随环走
    const defs = [
      { R: 1.02, tilt: [0, 0, 0] },
      { R: 1.18, tilt: [0.42, 0.7, 0] },
      { R: 1.18, tilt: [Math.PI / 2, 0.35, 0] },
      { R: 1.3, tilt: [0.9, -0.4, 0] },
    ];
    const tones = [P.copper, shade(P.copper, 0.1), shade(P.copper, -0.08)];
    const nR = Math.min(Math.max(rings, 2), 4);
    const ringGroups = [];
    for (let i = 0; i < nR; i++) {
      const rg = K.grp(ringMesh(defs[i].R, tones[i % 3]));
      K.tilt(rg, ...defs[i].tilt);
      K.put(rg, 0, 1.98, 0);
      g.add(rg);
      ringGroups.push(rg);
    }
    // 错落小球：copper/silver 交替，散骑各环（半径各异、深浅轮换）
    const nP = Math.min(Math.max(planets, 2), 6);
    for (let i = 0; i < nP; i++) {
      const rg = ringGroups[i % nR];
      const R = defs[i % nR].R;
      const a = r() * Math.PI * 2 + i * 1.3;
      const ball = K.sphereLo({
        color: [P.copper, P.silver, shade(P.copper, 0.12)][i % 3],
        r: 0.1 + r() * 0.07, seg: 0, family: 'metal',
      });
      rg.add(K.put(ball, Math.cos(a) * R, 0, Math.sin(a) * R));
    }
    return g;
  },
};
