// 箭靶（CATALOG2 编号 52）：「草环靶+三支插箭」——军事类 prop/floor（草环/绳沿/箭羽 cloth + 靶架/箭杆 wood 双族）。
// 原点=底面中心；靶面=同心短圆柱层层微凸（外绳沿箍 + 三档草色环 + 暗红靶心，径约 4），
// 靶心微后仰；三脚靶架（后二腿外撇 + 前腿藏靶后探前 + 双腿拉撑与托靶横档）托靶离地；
// 插箭入靶端不见，外露提亮箭杆 + 皮色箭羽，姿态各异。变体走 build(opts)：
// 箭数（0~5）/靶面后仰角。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 三维斜柱：连接 a→b 的圆柱段（靶架腿用，轴向自动对位）
function strut(color, r, a, b) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length();
  const m = K.cyl({ color, r: r, h: len, seg: 5, family: 'wood' });
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return K.put(m, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}

export default {
  id: 'arrowTarget',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'barrack'],
  footprint: { x: 4.4, z: 3.6 },
  behaviors: [],
  build({ arrows = 3, lean = 0.06, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('arrowTarget');
    const cy = 4.4;
    // 靶面：外绳沿箍 + 三档草色同心环 + 暗红靶心，环环微凸（面向 +z，同挂盾盘语言）
    const rings = [
      { c: P.rope, rr: 2.02, h: 0.42, z: 0 },
      { c: shade(P.straw, 0.08), rr: 1.74, h: 0.36, z: 0.02 },
      { c: shade(P.straw, -0.12), rr: 1.28, h: 0.36, z: 0.06 },
      { c: P.straw, rr: 0.85, h: 0.36, z: 0.1 },
      { c: P.potionRed, rr: 0.46, h: 0.36, z: 0.14 },
    ];
    const face = new THREE.Group();
    for (const { c, rr, h, z } of rings) {
      const ring = K.cyl({ color: c, r: rr, h, seg: 9, family: 'cloth' });
      K.tilt(ring, Math.PI / 2);
      face.add(K.put(ring, 0, 0, z));
    }
    K.tilt(face, -Math.min(Math.max(lean, 0), 0.2), 0, 0);
    g.add(K.put(face, 0, cy, 0));
    // 三脚靶架：后二腿外撇后撑 + 前腿自靶后探前 + 双腿拉撑 + 托靶横档（靶底正好歇在档上）
    g.add(strut(P.woodDark, 0.16, [-0.3, 6.1, -0.5], [-1.85, 0, -1.55]));
    g.add(strut(P.woodDark, 0.16, [0.3, 6.1, -0.5], [1.85, 0, -1.55]));
    g.add(strut(P.woodDark, 0.14, [0, 5.9, -0.55], [0, 0, 1.5]));
    g.add(K.put(K.box({ color: P.woodDark, size: [3.3, 0.22, 0.22], family: 'wood' }), 0, 1.15, -1.32));
    g.add(K.put(K.box({ color: P.wood, size: [2.3, 0.26, 0.5], family: 'wood' }), 0, 2.26, -0.8));
    // 插箭：入靶端藏于靶面后，外露箭杆 + 皮色箭羽，近靶心一发+余发散落（姿态各异）
    const hits = [[0.32, 0.42], [-1.02, -0.7], [0.95, -0.85], [-0.5, 0.95], [1.45, 0.35]];
    const na = Math.min(Math.max(arrows, 0), 5);
    for (let i = 0; i < na; i++) {
      const [hx, hy] = hits[i];
      const ar = new THREE.Group();
      ar.add(K.put(K.cyl({
        color: shade(P.wood, 0.3), r: 0.05, h: 1.4, seg: 5, family: 'wood',
      }), 0, 0.7, 0));
      ar.add(K.put(K.box({ color: P.parchment, size: [0.07, 0.55, 0.36], family: 'cloth' }), 0, 1.18, 0));
      K.tilt(ar, 1.22 + r() * 0.18, (r() - 0.5) * 0.2, (r() - 0.5) * 0.3);
      g.add(K.put(ar, hx, cy + hy, 0.24));
    }
    return g;
  },
};
