// 挂兽角（CATALOG2 编号 109）：「盾板+弯角一对+额饰」——wallDecor 中带（wood+stone+unlit 三族）。
// 原点=墙面挂点投影（z=0 贴墙、+z 朝室内，y 向上，主体正 y 近原点）；band=mid，全高约 5.3。
// 木盾板缺角风化 + 四枚骨色角钉；弯角一对=分段 cyl 折弯攀升（蛇形火把座 strut 手法：
// 逐段连折点、半径递减、aim 锥尖收头，段接处窄环读角环节）；额饰=角根间菱形饰板
// （unlit 夜色凹面 + 骨色饰珠读凸嵌，mountedHead 眼窝嵌石语汇）。
// 变体走 build(opts)：bends 弯数（2~4）/spread 角展幅（0.7~1.35）/ridges 角环节有无。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 折线段：连接两折点的 cyl（轴向对齐连线、中点定位）——弯角逐段搭建的零件（torchSerpent 手法）
function strut(p0, p1, rad, color) {
  const a = new THREE.Vector3(p0[0], p0[1], p0[2]);
  const b = new THREE.Vector3(p1[0], p1[1], p1[2]);
  const d = b.clone().sub(a);
  const m = K.cyl({ color, r: rad, h: d.length(), seg: 5 });
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  m.position.copy(a).addScaledVector(d, 0.5);
  return m;
}

export default {
  id: 'hornMounted',
  place: 'wallDecor',
  band: 'mid',
  tags: ['bone', 'nature'],
  behaviors: [],
  build({ bends = 3, spread = 1, ridges = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('hornMounted');
    const nb = Math.min(4, Math.max(2, Math.round(bends)));
    const sp = Math.min(1.35, Math.max(0.7, spread));
    // 木盾板：厚板缺角（战利品钉板），四枚骨色角钉钉住四角
    const board = K.box({ color: shade(P.woodDark, 0.06), size: [3.4, 4.3, 0.35], family: 'wood' });
    K.chip(board, { corner: [1, 1, 1], amount: 0.28 });
    K.jitter(board, r, { rot: 0.006 });
    g.add(K.put(board, 0, 2.55, 0.175));
    for (const sx of [-1.42, 1.42]) for (const sy of [0.9, 4.2]) {
      g.add(K.put(K.sphereLo({ color: shade(P.bone, -0.06), r: 0.13, seg: 0 }), sx, sy, 0.4));
    }
    // 额饰：角根间菱形饰板（unlit 夜色凹面 + 骨色饰珠）
    const plate = K.box({ color: shade(P.bone, -0.08), size: [1.15, 1.15, 0.2] });
    K.tilt(plate, 0, 0, Math.PI / 4);
    g.add(K.put(plate, 0, 3.75, 0.42));
    const pit = K.box({ color: P.night, size: [0.58, 0.58, 0.08], family: 'unlit' });
    K.tilt(pit, 0, 0, Math.PI / 4);
    g.add(K.put(pit, 0, 3.75, 0.55));
    const boss = K.sphereLo({ color: shade(P.bone, 0.32), r: 0.16, seg: 0 });
    K.scaleXYZ(boss, 1, 1, 0.6);
    g.add(K.put(boss, 0, 3.75, 0.6));
    // 弯角一对：根起额饰两侧，先沉后扬外撇（分段 cyl 折弯 + 窄环节 + aim 锥尖）
    for (const s of [-1, 1]) {
      const pts = [[s * 0.62, 3.92, 0.42]];
      for (let i = 1; i <= nb; i++) {
        const t = i / nb;
        pts.push([
          s * (0.62 + (2.05 + r() * 0.12) * sp * t),
          3.92 - 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.1)) + 1.05 * t * t,
          0.42 + 0.22 * Math.sin(Math.PI * t) - 0.12 * t + r() * 0.03,
        ]);
      }
      for (let i = 0; i < pts.length - 1; i++) {
        g.add(strut(pts[i], pts[i + 1], 0.25 - 0.04 * i, shade(P.bone, -0.12 - 0.05 * i)));
      }
      if (ridges) {
        for (let i = 1; i < pts.length - 1; i++) {          // 段接处窄环（角环节）
          const a = new THREE.Vector3(...pts[i - 1]);
          const dir = new THREE.Vector3(...pts[i]).sub(a).normalize();
          const ring = K.cyl({ color: shade(P.bone, -0.32), r: 0.29 - 0.04 * i, h: 0.14, seg: 5 });
          ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
          ring.position.set(...pts[i]);
          g.add(ring);
        }
      }
      const lp = pts[pts.length - 1], lm = pts[pts.length - 2];
      const tipDir = new THREE.Vector3(lp[0] - lm[0], lp[1] - lm[1], lp[2] - lm[2]).normalize();
      const tip = K.cone({ color: shade(P.bone, -0.34), r: 0.11, h: 0.6, seg: 5 });
      K.aim(tip, tipDir.x, tipDir.y, tipDir.z);
      tip.position.set(lp[0] + tipDir.x * 0.24, lp[1] + tipDir.y * 0.24, lp[2] + tipDir.z * 0.24);
      g.add(tip);
    }
    return g;
  },
};
