// 大挂毯（CATALOG2 编号 103）：「织画人物+垂穗+厚框杆」——wallDecor 高带垂挂件（cloth+wood 双族）。
// 原点=墙面高位挂点投影（z=0 贴墙，+z 朝室内，y=0 即挂点）：厚框杆=粗木横杆+双端柱头，
// ~8 幅宽的织毯自杆垂挂向下（bbox 主体在负 y，band=high 垂挂语义同 bannerLong），总垂长 ~12。
// 织画=毯上色块剪影（压暗画境后景 + 苍袍圣者立像 + 金环，shade 拉层次）；毯缘织带压暗一圈
// 出厚框感，杆下压一道金线，底缘垂穗一排。变体走 build(opts)：毯色 hue / 像数 figures（1~2）/
// 穗数 tassels（3~5）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 织画圣者立像（色块剪影）：苍袍大块 + 微亮头 + 金环（薄片侧对室内）+ 侧杖；原点=像足中心
function makeFigure(r, scale) {
  const f = K.grp(
    K.put(K.box({ color: shade(P.parchment, -0.06), size: [1.5 * scale, 4.4 * scale, 0.12], family: 'cloth' }), 0, 0, 0),
  );
  const head = K.sphereLo({ color: shade(P.parchment, 0.07), r: 0.52 * scale, seg: 0, jitter: 0.12, rng: r, family: 'cloth' });
  K.scaleXYZ(head, 0.85, 1.0, 0.5);
  f.add(K.put(head, 0, 2.75 * scale, 0.06));
  const halo = K.cyl({ color: P.gold, r: 0.78 * scale, h: 0.06, seg: 7, family: 'cloth' });
  K.tilt(halo, Math.PI / 2, 0, 0);            // 薄片翻起正对室内
  f.add(K.put(halo, 0, 3.05 * scale, -0.1));
  f.add(K.put(K.box({ color: shade(P.gold, -0.3), size: [0.2, 4.6 * scale, 0.1], family: 'cloth' }), 1.05 * scale, 0.3 * scale, 0.1));
  return f;
}

// 单只垂穗（自毯底缘垂坠）：绳段 + 双箍结 + 收尖穗尾，带微摆；原点=穗顶挂点
function makeTassel(r, len) {
  const t = new THREE.Group();
  const sway = (r() - 0.5) * 0.16;
  const strand = K.cyl({ color: P.gold, r: 0.08, h: len * 0.32, seg: 5, family: 'cloth' });
  K.tilt(strand, 0, 0, sway);
  t.add(K.put(strand, 0, -len * 0.16, 0));
  const knot = K.cyl({ color: shade(P.gold, -0.14), r: 0.2, rTop: 0.15, h: 0.34, seg: 5, family: 'cloth' });
  K.tilt(knot, 0, 0, sway * 1.5);
  t.add(K.put(knot, sway * 0.5, -len * 0.32 - 0.17, 0));
  const fringe = K.cyl({ color: shade(P.gold, -0.05), r: 0.26, rTop: 0.1, h: len * 0.62, seg: 5, family: 'cloth' });
  K.tilt(fringe, 0, 0, sway * 2);
  t.add(K.put(fringe, sway * 0.9, -len * 0.32 - 0.34 - len * 0.31, 0));
  return t;
}

export default {
  id: 'tapestryGrand',
  place: 'wallDecor',
  band: 'high',
  tags: ['cloth', 'chapel'],
  behaviors: [],
  build({ hue = 'blue', figures = 1, tassels = 3, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('tapestryGrand');
    const base = hue === 'blue' ? P.bannerBlue : P.bannerRed;
    const w = 8, bh = 10.2;
    // 厚框杆：粗横杆横陈挂点 + 双端柱头
    const rod = K.cyl({ color: P.woodDark, r: 0.24, h: w + 1.5, seg: 6, family: 'wood' });
    K.tilt(rod, 0, 0, Math.PI / 2);
    g.add(K.put(rod, 0, 0.1, 0.26));
    for (const sx of [-1, 1]) {
      g.add(K.put(K.box({ color: shade(P.woodDark, 0.08), size: [0.46, 0.66, 0.46], family: 'wood' }), sx * (w / 2 + 0.62), 0.1, 0.26));
    }
    // 毯身：自杆垂挂（微倾出布感）
    const body = K.box({ color: base, size: [w, bh, 0.14], family: 'cloth' });
    K.tilt(body, 0.015, 0, (r() - 0.5) * 0.03);
    g.add(K.put(body, 0, -0.12 - bh / 2, 0.28));
    // 织带厚框：毯缘一圈压暗宽带（读作织出的框缘）
    const bw = 0.72, deep = shade(base, -0.22);
    g.add(K.put(K.box({ color: deep, size: [w - 0.3, bw, 0.16], family: 'cloth' }), 0, -0.7, 0.32));
    g.add(K.put(K.box({ color: deep, size: [w - 0.3, bw, 0.16], family: 'cloth' }), 0, -0.12 - bh + 0.62, 0.32));
    for (const sx of [-1, 1]) {
      g.add(K.put(K.box({ color: deep, size: [bw, bh - 1.6, 0.16], family: 'cloth' }), sx * (w / 2 - 0.55), -0.12 - bh / 2, 0.32));
    }
    // 杆下金线压条（勾出毯头收口）
    g.add(K.put(K.box({ color: P.gold, size: [w - 0.9, 0.3, 0.17], family: 'cloth' }), 0, -1.35, 0.33));
    // 画境后景：框内整幅压暗（画中夜色底）
    g.add(K.put(K.box({ color: shade(base, -0.34), size: [w - 2.1, bh - 2.7, 0.1], family: 'cloth' }), 0, -0.12 - bh / 2 + 0.2, 0.36));
    // 织画人物：居中大像 + 侧下小像（小像低置读作跪拜信众）
    const cy = -0.12 - bh / 2 + 0.3;
    g.add(K.put(makeFigure(r, 1), -0.7, cy - 0.6, 0.42));
    if (Math.min(Math.max(figures, 1), 2) === 2) {
      g.add(K.put(makeFigure(r, 0.55), 2.1, cy - 1.9, 0.4));
    }
    // 底缘垂穗一排
    const nt = Math.min(Math.max(tassels, 3), 5);
    for (let i = 0; i < nt; i++) {
      const x = -w / 2 + 0.85 + ((w - 1.7) * i) / (nt - 1);
      g.add(K.put(makeTassel(r, 1.5 + r() * 0.3), x, -0.12 - bh + 0.95, 0.34));
    }
    return g;
  },
};
