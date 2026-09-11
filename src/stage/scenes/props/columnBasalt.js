// 玄武岩柱（CATALOG2 编号 86）：「黑石棱柱+断茬」——smallWall 宿主类（纯 stone 单族）。
// 柱式三段同 columnRound 的黑石版：双盘暗础 + 五/六棱黑石柱身（顶点级绕轴微捻，棱线随高度旋移）
// + 顶部断茬短棱块群（高低错落的断口，最高块顶面=承放面）+ 根部两块散石。
// 原点=底面中心（y=0 落地）；默认全高 15，顶面 topY=15（断口可摆物）。
// 变体走 build(opts)：棱数（5~6）/捻角/断茬块数/柱身高/散石有无。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 绕轴微扭：顶点随高度绕 y 捻转 k 弧度（flatShading 法线由片元导数计算，扭后无需重算）
function twist(mesh, h, k) {
  const pos = mesh.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = ((y + h / 2) / h) * k;
    pos.setXYZ(i, x * Math.cos(a) - z * Math.sin(a), y, x * Math.sin(a) + z * Math.cos(a));
  }
  pos.needsUpdate = true;
  return mesh;
}

// 断茬块几何（局部腿）：半径/高/暗度偏移，顶角内削读作崩断面
function chunk({ segs, rad, h, dk, corner, rng }) {
  const m = K.cyl({ color: shade(P.stone, -0.4 + dk), r: rad, rTop: rad * 0.82, h, seg: segs });
  K.chip(m, { corner, amount: rad * 0.42 });
  K.jitter(m, rng, { rot: 0.03 });
  return m;
}

export default {
  id: 'columnBasalt',
  place: 'smallWall',
  tags: ['stone', 'crypt'],
  footprint: { x: 3.6, z: 3.6 },
  topY: 15, // 暗础(1.05) + 柱身(11.95) + 断茬块群（最高块 2.1）
  behaviors: [],
  build({ shaftH = 11.95, segs = 6, twistK = 0.42, chunks = 4, rocks = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('columnBasalt');
    const sg = Math.max(5, Math.min(6, segs));
    // 暗础：两阶收进的黑石盘
    g.add(K.put(K.cyl({ color: shade(P.stone, -0.5), r: 1.7, rTop: 1.58, h: 0.6, seg: sg }), 0, 0.3, 0));
    g.add(K.put(K.cyl({ color: shade(P.stone, -0.44), r: 1.42, rTop: 1.32, h: 0.45, seg: sg }), 0, 0.825, 0));
    // 柱身：黑石棱柱（shade 压暗四成），顶点级微捻——棱线自下而上缓缓旋移
    const shaftTopY = 1.05 + shaftH;
    const body = twist(K.cyl({
      color: shade(P.stone, -0.4), r: 1.18, rTop: 1.0, h: shaftH, seg: sg,
    }), shaftH, twistK);
    g.add(K.put(body, 0, 1.05 + shaftH / 2, 0));
    // 断茬：柱顶崩断的短棱块群（嵌入柱顶 0.15，朝向接续捻角；最高块顶面=承放面）
    const cn = Math.max(3, Math.min(5, chunks));
    const specs = [
      { rad: 0.62, h: 2.1, dk: 0 }, { rad: 0.5, h: 1.65, dk: -0.05 },
      { rad: 0.42, h: 1.25, dk: 0.05 }, { rad: 0.32, h: 0.85, dk: -0.08 },
      { rad: 0.26, h: 0.6, dk: 0.04 },
    ].slice(0, cn);
    const offs = [[0.15, 0.1], [-0.42, 0.28], [0.32, -0.45], [-0.22, -0.15], [0.05, 0.5]];
    specs.forEach((s, i) => {
      const m = chunk({ segs: sg, rad: s.rad, h: s.h, dk: s.dk, corner: [i % 2 ? -1 : 1, 1, i % 3 ? -1 : 1], rng: r });
      K.tilt(m, 0, twistK + i * 0.35 + r() * 0.2, 0);
      g.add(K.put(m, offs[i][0] + (r() - 0.5) * 0.08, shaftTopY - 0.15 + s.h / 2, offs[i][1] + (r() - 0.5) * 0.08));
    });
    // 根部散石：柱脚崩落的碎岩两块
    if (rocks) {
      const rock1 = K.sphereLo({ color: shade(P.stone, -0.32), r: 0.3, seg: 0, jitter: 0.3, rng: r });
      K.scaleXYZ(rock1, 1.3, 0.7, 1.1);
      g.add(K.put(rock1, 1.35, 0.18, 0.7));
      const rock2 = K.sphereLo({ color: shade(P.stone, -0.26), r: 0.24, seg: 0, jitter: 0.3, rng: r });
      K.scaleXYZ(rock2, 1.15, 0.65, 1.25);
      g.add(K.put(rock2, -1.25, 0.15, -0.55));
    }
    return g;
  },
};
