// 锁链巨典（CATALOG2 编号 64）：「斜面台+链拴厚书」——奥术书库禁书 prop（wood+metal+cloth 三族）。
// 原点=底面中心（y=0 落地），台高约 4：双层踏座 + 方柱（cyl seg=4 转 45°）+ 后垫 + 前倾
// 斜面板（带挡书唇，斜面语言同 lecternPodium）。板上卧一部厚典：木封皮 + 羊皮纸书芯
// （三缘外露）+ 两枚铁搭扣；台后立链桩（顶眼环），锁链自桩顶绕过书脊封面垂坠到台座
// 前侧锚环——链段=沿折线分段、逐段 aim 对向 + 绕自身轴交替 90°（chandelierChain 链环
// 手法的任意朝向版）。变体走 build(opts)：链环密度 linkLen / 书厚 tomeT / 斜面倾角 slant。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

const UP = new THREE.Vector3(0, 1, 0);

// 单链环：连接两折点的 cyl（轴向对齐连线）+ 绕自身轴的自旋（交替 90°）
function link(p0, p1, rad, color, spin) {
  const a = new THREE.Vector3(p0[0], p0[1], p0[2]);
  const b = new THREE.Vector3(p1[0], p1[1], p1[2]);
  const d = b.clone().sub(a);
  const m = K.cyl({ color, r: rad, h: d.length() + 0.16, seg: 5, family: 'metal' });
  m.quaternion.setFromUnitVectors(UP, d.clone().normalize());
  m.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(UP, spin));
  m.position.copy(a).addScaledVector(d, 0.5);
  return m;
}

export default {
  id: 'tomeChained',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'metal', 'arcane'],
  footprint: { x: 2.9, z: 2.4 },
  behaviors: [],
  build({ linkLen = 0.34, tomeT = 0.6, slant = 0.36, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('tomeChained');
    // 双层踏座 + 方柱（seg=4 转 45° 即方台）+ 后垫
    g.add(K.put(K.box({ color: P.woodDark, size: [2.5, 0.35, 1.85], family: 'wood' }), 0, 0.175, 0));
    g.add(K.put(K.box({ color: shade(P.wood, -0.04), size: [2.15, 0.2, 1.6], family: 'wood' }), 0, 0.45, 0));
    const column = K.cyl({ color: P.wood, r: 0.55, rTop: 0.45, h: 2.7, seg: 4, family: 'wood' });
    K.tilt(column, 0, Math.PI / 4, 0);
    if (rng) K.jitter(column, r, { rot: 0.01 });
    g.add(K.put(column, 0, 1.9, 0));
    g.add(K.put(K.box({ color: shade(P.wood, -0.08), size: [1.05, 0.55, 0.8], family: 'wood' }), 0, 3.45, -0.25));
    // 前倾斜面板 + 挡书唇（正 slant 使 +z 前缘落低）
    const deskY = 3.85;
    const desk = K.box({ color: shade(P.wood, 0.05), size: [2.25, 0.22, 1.7], family: 'wood' });
    K.tilt(desk, slant, 0, 0);
    g.add(K.put(desk, 0, deskY, 0.02));
    const lip = K.box({ color: P.woodDark, size: [2.25, 0.2, 0.16], family: 'wood' });
    K.tilt(lip, slant, 0, 0);
    g.add(K.put(lip, 0, deskY - Math.sin(slant) * 0.8, 0.02 + Math.cos(slant) * 0.8));
    // 厚典：封皮 + 书芯（三缘外露，P.parchment）+ 两枚搭扣
    const th = Math.min(Math.max(tomeT, 0.42), 0.85);
    const cover = K.box({ color: shade(P.woodDark, 0.14), size: [1.9, th, 1.42], family: 'wood' });
    K.tilt(cover, slant, 0, 0);
    g.add(K.put(cover, 0, deskY + 0.13 + th / 2, -0.05));
    const pages = K.box({ color: P.parchment, size: [1.84, th * 0.74, 1.5], family: 'cloth' });
    K.tilt(pages, slant, 0, 0);
    g.add(K.put(pages, 0, deskY + 0.13 + th / 2, 0.01));
    for (const s of [-1, 1]) {
      const clasp = K.box({ color: shade(P.iron, 0.08), size: [0.24, th + 0.16, 0.16], family: 'metal' });
      K.tilt(clasp, slant, 0, 0);
      g.add(K.put(clasp, s * 0.62, deskY + 0.15 + th / 2, 0.66));
    }
    // 链桩（台后侧立柱 + 顶眼环）与台座锚环：锁链两端
    g.add(K.put(K.cyl({ color: shade(P.iron, -0.06), r: 0.09, h: 1.05, seg: 5, family: 'metal' }), -0.82, 4.55, -0.66));
    const eye = K.cyl({ color: P.iron, r: 0.15, h: 0.09, seg: 6, family: 'metal' });
    K.tilt(eye, Math.PI / 2, 0, 0);
    g.add(K.put(eye, -0.82, 5.1, -0.66));
    const anchor = K.cyl({ color: P.iron, r: 0.17, h: 0.1, seg: 6, family: 'metal' });
    K.tilt(anchor, Math.PI / 2, 0, 0);
    g.add(K.put(anchor, 0.95, 0.55, 0.82));
    // 锁链：自桩顶眼环绕过书脊封面，垂坠到台座前侧锚环（沿折线布链环，交替 90° 自旋）
    let spin = 0;
    const chainRun = (p0, p1) => {
      const a = new THREE.Vector3(p0[0], p0[1], p0[2]);
      const b = new THREE.Vector3(p1[0], p1[1], p1[2]);
      const L = a.distanceTo(b);
      const n = Math.max(2, Math.round(L / Math.max(0.22, linkLen)));
      for (let i = 0; i < n; i++) {
        const q0 = a.clone().lerp(b, i / n), q1 = a.clone().lerp(b, (i + 1) / n);
        g.add(link([q0.x, q0.y, q0.z], [q1.x, q1.y, q1.z], 0.07, P.iron, spin++ * Math.PI / 2));
      }
    };
    const bookTop = deskY + 0.16 + th;
    chainRun([-0.82, 5.06, -0.64], [0, bookTop + 0.1, -0.02]); // 桩顶 → 压过书脊
    chainRun([0, bookTop + 0.08, 0], [0.95, 0.6, 0.8]);        // 书脊 → 台座锚环
    return g;
  },
};
