// 弩炮残架（CATALOG2 编号 56）：「残木架+断臂+散矢」——军营军事类 prop（wood+metal+cloth 三族）。
// 原点=底面中心（y=0 落地），x=炮身长 z=横宽：轮已脱落的残架坐地（双纵梁+横托+斜脚），
// 前弭横枧一侧余整臂外撇、一侧只余劈裂短茬，断落的臂段弃于架侧；绞盘横轴残存，
// 断弦两段自弭松垂到绞盘，粗弩矢三四支斜插架周地面。变体走 build(opts)：
// 散矢数 bolts / 断臂段落有无 snapped / 摇柄有无 crank。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 把沿 y 的细柱精确对齐到任意方向（弦/绳斜向垂挂用；tilt 只适合近竖直姿态）
function aimCyl(mesh, dx, dy, dz) {
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(dx, dy, dz).normalize(),
  );
  return mesh;
}

export default {
  id: 'ballistaRemnant',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'metal', 'barrack'],
  footprint: { x: 7.8, z: 4.9 },
  behaviors: [],
  build({ bolts = 4, snapped = true, crank = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('ballistaRemnant');
    // 炮架残部：双纵梁 + 两道横托 + 四条斜脚（轮轴已脱落，架子坐地）
    for (const s of [-1, 1]) {
      const rail = K.box({ color: P.woodDark, size: [5.6, 0.45, 0.45], family: 'wood' });
      K.tilt(rail, 0, 0, s * 0.012);
      g.add(K.put(rail, 0, 1.05, s * 0.55));
    }
    for (const x of [-1.7, 1.5]) {
      g.add(K.put(K.box({ color: P.wood, size: [0.45, 0.35, 1.7], family: 'wood' }), x, 0.82, 0));
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const leg = K.box({ color: shade(P.woodDark, -0.06), size: [0.3, 1.15, 0.3], family: 'wood' });
      K.tilt(leg, -sz * 0.2, 0, -sx * 0.14);
      g.add(K.put(leg, sx * 2.2, 0.5, sz * 0.42));
    }
    // 前弭（横枧臂座）+ 两端铁包角
    g.add(K.put(K.box({ color: shade(P.wood, 0.06), size: [0.4, 0.4, 3.1], family: 'wood' }), 2.55, 1.28, 0));
    for (const s of [-1, 1]) {
      g.add(K.put(K.box({ color: P.iron, size: [0.46, 0.5, 0.24], family: 'metal' }), 2.55, 1.28, s * 1.32));
    }
    // 断臂：-z 侧余整臂前伸外撇；+z 侧只余劈裂短茬（斜茬 box+chip）
    const arm = K.box({ color: P.wood, size: [2.5, 0.3, 0.26], family: 'wood' });
    K.tilt(arm, 0.12, -0.5, 0.06);
    g.add(K.put(arm, 3.7, 1.52, -1.6));
    const stump = K.box({ color: P.wood, size: [1.0, 0.3, 0.26], family: 'wood' });
    K.chip(stump, { corner: [1, 1, 1], amount: 0.2 });
    K.tilt(stump, 0.1, 0.42, -0.05);
    g.add(K.put(stump, 3.1, 1.44, 1.42));
    // 断落的臂段：弃于架前地面（末端同样劈裂）
    if (snapped) {
      const frag = K.box({ color: shade(P.wood, -0.04), size: [2.1, 0.28, 0.24], family: 'wood' });
      K.chip(frag, { corner: [1, 1, 1], amount: 0.18 });
      K.tilt(frag, 0, 1.1, 0.1);
      g.add(K.put(frag, 2.3, 0.16, 2.2));
    }
    // 绞盘：后位横轴（轴向 z）+ 铁棘轮垫块 + 下垂摇柄
    const axle = K.cyl({ color: shade(P.wood, 0.04), r: 0.17, h: 1.9, seg: 6, family: 'wood' });
    K.tilt(axle, Math.PI / 2, 0, 0);
    g.add(K.put(axle, -1.9, 1.32, 0));
    g.add(K.put(K.box({ color: P.iron, size: [0.34, 0.42, 0.3], family: 'metal' }), -1.55, 1.05, 0.72));
    if (crank) {
      const armC = K.box({ color: shade(P.iron, 0.1), size: [0.12, 0.7, 0.12], family: 'metal' });
      K.tilt(armC, 0.5, 0, 0);
      g.add(K.put(armC, -1.9, 0.95, 0.95));
      g.add(K.put(K.cyl({ color: shade(P.iron, 0.2), r: 0.08, h: 0.42, seg: 5, family: 'metal' }), -1.9, 0.6, 1.2));
    }
    // 断弦残段：两段细绳自弭中点松垂过地、搭上绞盘（读作崩断后垂落）
    const hang = (x0, y0, z0, x1, y1, z1) => {
      const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
      const seg = K.cyl({
        color: P.rope, r: 0.05, h: Math.hypot(dx, dy, dz) + 0.1, seg: 4, family: 'cloth',
      });
      g.add(K.put(aimCyl(seg, dx, dy, dz), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
    };
    hang(2.4, 1.28, 0, 0.5, 0.42, 0.12);
    hang(0.5, 0.42, 0.12, -1.7, 1.26, 0.05);
    // 散矢：粗弩矢斜插架周地面（木杆+草羽，镞端没入土）；另有一支平倒带铁镞
    const slots = [[-3.3, -1.3], [-2.5, 1.4], [3.2, -1.6], [1.3, 2.1]];
    for (let i = 0; i < bolts; i++) {
      const [bx, bz] = slots[i % slots.length];
      const x = bx + (r() - 0.5) * 0.4, z = bz + (r() - 0.5) * 0.4;
      const lean = 0.5 + r() * 0.15;
      const shaft = K.cyl({ color: P.woodDark, r: 0.08, h: 2.4, seg: 5, family: 'wood' });
      K.tilt(shaft, lean, (r() - 0.5) * 0.6, 0);
      g.add(K.put(shaft, x, -0.15 + Math.cos(lean) * 1.2, z + Math.sin(lean) * 1.2));
      const fletch = K.box({ color: P.straw, size: [0.05, 0.45, 0.24], family: 'cloth' });
      K.tilt(fletch, lean, (r() - 0.5) * 0.6, 0);
      g.add(K.put(fletch, x, -0.15 + Math.cos(lean) * 2.15, z + Math.sin(lean) * 2.15));
    }
    // 平倒散矢：带铁镞一支（quaternion 对向躺姿，指向斜前）
    const dir = new THREE.Vector3(Math.cos(0.5), 0.04, Math.sin(0.5));
    const lying = K.cyl({ color: shade(P.woodDark, 0.06), r: 0.08, h: 2.3, seg: 5, family: 'wood' });
    lying.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    g.add(K.put(lying, -0.7, 0.1, -1.5));
    const tip = K.cone({ color: shade(P.iron, 0.15), r: 0.09, h: 0.3, seg: 5, family: 'metal' });
    tip.quaternion.copy(lying.quaternion);
    g.add(K.put(tip, -0.7 + dir.x * 1.3, 0.1, -1.5 + dir.z * 1.3));
    return g;
  },
};
