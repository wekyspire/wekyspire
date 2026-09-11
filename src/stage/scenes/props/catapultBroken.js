// 破投石机（CATALOG2 编号 57）：「残臂+垂吊兜+断辐」——军营军事类 XL prop（wood+cloth 双族）。
// 原点=底面中心（y=0 落地），x=投射向 z=横宽：底盘双纵梁坐地，前轴折断只余轴头，
// 后轴一侧挂断轮（轮辋缺段+余辐两根，断辐=残轮）、轮圈残段落在一旁；A 形立架聚顶，
// 投掷残臂自前枢后仰、顶端劈裂（斜茬 box+chip），断落的臂梢弃于架前，吊兜两绳自臂梢垂挂。
// 变体走 build(opts)：断辐余段 rimSegs / 臂仰角 armLean / 吊兜有无 sling。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 把沿 y 的柱体精确对齐到任意方向（弦绳斜向挂装用；tilt 只适合近竖直姿态）
function aimCyl(mesh, dx, dy, dz) {
  mesh.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(dx, dy, dz).normalize(),
  );
  return mesh;
}

// 断轮：轮毂 + 余辐 spokes 根 + 轮辋 rimSegs 段（8 槽位连续缺口，断辐残轮），辐面在 xy 平面
function brokenWheel(r, spokes, rimSegs) {
  const w = new THREE.Group();
  const hub = K.cyl({ color: P.woodDark, r: 0.3, h: 0.46, seg: 6, family: 'wood' });
  K.tilt(hub, Math.PI / 2, 0, 0); // 轴向 z
  w.add(hub);
  const base = r() * Math.PI;
  for (let k = 0; k < 8; k++) {
    const phi = base + (k / 8) * Math.PI * 2;
    if (k < rimSegs) { // 轮辋：缺段留口（断口即缺口）
      const seg = K.box({ color: k % 2 ? P.wood : shade(P.wood, 0.08), size: [0.95, 0.22, 0.2], family: 'wood' });
      K.tilt(seg, 0, 0, phi + Math.PI / 2); // 切向摆位
      w.add(K.put(seg, Math.cos(phi) * 1.5, Math.sin(phi) * 1.5, 0));
    }
    if (k < spokes) { // 余辐：自毂外伸（辐向摆位，只在有辁段的弧上）
      const sp = K.box({ color: P.woodDark, size: [0.16, 1.5, 0.15], family: 'wood' });
      if (r() > 0.6) K.chip(sp, { corner: [1, 1, 1], amount: 0.12 }); // 断辐劈茬
      K.tilt(sp, 0, 0, phi - Math.PI / 2);
      w.add(K.put(sp, Math.cos(phi) * 0.75, Math.sin(phi) * 0.75, 0));
    }
  }
  return w;
}

export default {
  id: 'catapultBroken',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'barrack'],
  footprint: { x: 10.6, z: 6.2 },
  behaviors: [],
  build({ rimSegs = 5, spokes = 2, armLean = 0.68, sling = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('catapultBroken');
    // 底盘：双纵梁（x 向长）+ 两道横梁坐地
    for (const s of [-1, 1]) {
      const sill = K.box({ color: P.woodDark, size: [8.4, 0.5, 0.5], family: 'wood' });
      K.tilt(sill, 0, 0, s * 0.01);
      g.add(K.put(sill, 0.4, 0.67, s * 1.5));
    }
    for (const x of [-2.6, 2.6]) {
      g.add(K.put(K.box({ color: P.wood, size: [0.5, 0.42, 3.6], family: 'wood' }), x, 0.21, 0));
    }
    // 后轴整轴（轴向 z）+ 断轮挂一端；前轴折断只余单侧轴头
    const axle = K.cyl({ color: shade(P.wood, 0.05), r: 0.15, h: 4.4, seg: 6, family: 'wood' });
    K.tilt(axle, Math.PI / 2, 0, 0);
    g.add(K.put(axle, -2.4, 1.08, 0));
    const wheel = brokenWheel(r, Math.min(3, Math.max(0, spokes)), Math.min(6, Math.max(2, rimSegs)));
    K.jitter(wheel, r, { rot: 0.02 });
    g.add(K.put(wheel, -2.4, 1.08, -1.95));
    const stub = K.cyl({ color: P.woodDark, r: 0.13, h: 0.9, seg: 5, family: 'wood' });
    K.tilt(stub, Math.PI / 2, 0, 0);
    K.chip(stub, { corner: [1, 1, 1], amount: 0.08 }); // 折断轴头劈茬
    g.add(K.put(stub, 2.6, 0.95, 0.95));
    // 掉落的轮圈残段：两段辁 + 一根断辐平躺一旁
    const arcs = new THREE.Group();
    const a1 = K.box({ color: P.wood, size: [0.95, 0.22, 0.2], family: 'wood' });
    K.tilt(a1, 0, 0, 0.3);
    arcs.add(K.put(a1, 0, 0.9, 0));
    const a2 = K.box({ color: shade(P.wood, 0.08), size: [0.95, 0.22, 0.2], family: 'wood' });
    K.tilt(a2, 0, 0, 1.2);
    arcs.add(K.put(a2, 0.8, -0.4, 0));
    const a3 = K.box({ color: P.woodDark, size: [0.16, 1.4, 0.15], family: 'wood' });
    K.tilt(a3, 0, 0, 0.9);
    arcs.add(K.put(a3, -0.6, -0.6, 0));
    K.tilt(arcs, Math.PI / 2, 0.2, 0); // 平躺
    g.add(K.put(arcs, 1.8, 0.12, 2.0));
    // A 形立架：双梁自纵梁斜上聚顶（向心收拢+后仰），顶横档 + 后撑
    for (const s of [-1, 1]) {
      const beam = K.box({ color: P.wood, size: [0.42, 5.1, 0.36], family: 'wood' });
      K.tilt(beam, -s * 0.42, 0, 0.2);
      g.add(K.put(beam, -1.4, 3.19, s * 0.36));
    }
    g.add(K.put(K.box({ color: shade(P.wood, -0.06), size: [0.45, 0.35, 1.6], family: 'wood' }), -1.6, 5.3, 0));
    const brace = K.box({ color: P.woodDark, size: [0.32, 4.4, 0.28], family: 'wood' });
    K.tilt(brace, 0, 0, -0.21); // 自后纵梁斜撑到顶
    g.add(K.put(brace, -2.15, 3.06, 0));
    // 投掷残臂：自前枢（铁销穿矩）后仰，顶端劈裂；臂梢断段弃于架前
    const arm = K.box({ color: shade(P.wood, 0.04), size: [0.5, 6.3, 0.45], family: 'wood' });
    K.chip(arm, { corner: [-1, 1, 1], amount: 0.35 });
    K.tilt(arm, 0.06, 0, armLean);
    g.add(K.put(arm, -0.98, 3.75, 0));
    const pin = K.cyl({ color: P.woodDark, r: 0.13, h: 1.3, seg: 5, family: 'wood' });
    K.tilt(pin, Math.PI / 2, 0, 0);
    g.add(K.put(pin, 1.0, 1.3, 0));
    const frag = K.box({ color: shade(P.wood, -0.03), size: [1.9, 0.4, 0.36], family: 'wood' });
    K.chip(frag, { corner: [1, 1, 1], amount: 0.2 });
    K.tilt(frag, 0.04, 0.55, 0.02);
    g.add(K.put(frag, 3.1, 0.2, 1.3));
    // 垂吊兜：两绳自臂梢劈口垂下（近竖直、兜底微外张），兜袋布囊微歪
    if (sling) {
      const tipX = 1.0 - Math.sin(armLean) * 6.3;
      const tipY = 1.3 + Math.cos(armLean) * 6.3 - 0.25;
      const pouch = K.box({ color: P.sack, size: [0.95, 0.5, 0.75], family: 'cloth' });
      K.tilt(pouch, 0.15, 0.2, 0.08);
      g.add(K.put(pouch, tipX + 0.35, tipY - 1.9, 0));
      for (const s of [-1, 1]) {
        const ax = tipX - 0.2, ay = tipY, az = s * 0.28;
        const bx = tipX + 0.55, by = tipY - 1.65, bz = s * 0.32;
        const dx = bx - ax, dy = by - ay, dz = bz - az;
        const rope = K.cyl({ color: P.rope, r: 0.05, h: Math.hypot(dx, dy, dz) + 0.05, seg: 4, family: 'cloth' });
        g.add(K.put(aimCyl(rope, dx, dy, dz), (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2));
      }
    }
    // 绞盘：后梁间横辊 + 缠绳一段 + 卡爪
    const roller = K.cyl({ color: shade(P.wood, 0.06), r: 0.2, h: 2.9, seg: 6, family: 'wood' });
    K.tilt(roller, Math.PI / 2, 0, 0);
    g.add(K.put(roller, -2.3, 1.35, 0));
    const wrap = K.cyl({ color: P.rope, r: 0.24, h: 1.0, seg: 5, family: 'cloth' });
    K.tilt(wrap, Math.PI / 2, 0, 0);
    g.add(K.put(wrap, -2.3, 1.35, 0.35));
    const pawl = K.box({ color: P.woodDark, size: [0.28, 0.7, 0.24], family: 'wood' });
    K.tilt(pawl, 0, 0, 0.3);
    g.add(K.put(pawl, -2.15, 0.95, 1.62));
    return g;
  },
};
