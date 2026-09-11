// 歪挂小画（CATALOG #78）：「两三幅小画歪挂成组」——wallDecor 中带（wood+unlit 双族）。
// 原点=整组底缘中点（z=0 贴墙面，+z 朝室内，y 向上）；每幅局部原点=顶缘中点挂钉点，
// 小角度歪斜（绕挂钉旋的「歪挂」语义）、x 错位 + 挂钉高低差成组。每幅=薄木框 +
// unlit 暗底画片 + 简笔母题色块（苍白小面孔 / 月与山 / 生涩斜杠）。
// 变体走 build(opts)：画幅数 count（2~3）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 单幅小画：局部原点=顶缘中点（挂钉），框体向下悬挂
function smallPainting(r, { w, h, tone, motif }) {
  const p = new THREE.Group();
  const bw = 0.26, fd = 0.34;
  // 薄框四缘（wood 族）
  p.add(K.put(K.box({ color: shade(P.wood, -0.05), size: [w, bw, fd], family: 'wood' }), 0, -bw / 2, fd / 2));
  p.add(K.put(K.box({ color: shade(P.wood, -0.12), size: [w, bw, fd], family: 'wood' }), 0, bw / 2 - h, fd / 2));
  const side = shade(P.woodDark, 0.05);
  p.add(K.put(K.box({ color: side, size: [bw, h - 2 * bw, fd], family: 'wood' }), -(w - bw) / 2, -h / 2, fd / 2));
  p.add(K.put(K.box({ color: side, size: [bw, h - 2 * bw, fd], family: 'wood' }), (w - bw) / 2, -h / 2, fd / 2));
  // 画片：unlit 暗底（边缘藏进框后）
  const cw = w - 2 * bw, ch = h - 2 * bw;
  p.add(K.put(K.box({ color: tone, size: [cw + 0.14, ch + 0.14, 0.07], family: 'unlit' }), 0, -h / 2, 0.19));
  if (motif === 0) {
    // 苍白小面孔 + 肩影（paintingGrand 的微缩呼应）
    p.add(K.put(K.box({ color: shade(P.woodDark, -0.38), size: [cw * 0.8, ch * 0.45, 0.05], family: 'unlit' }), 0, -h * 0.34, 0.28));
    const hd = K.sphereLo({ color: shade(P.bone, -0.46), r: 0.3, seg: 1, jitter: 0.1, rng: r, family: 'unlit' });
    K.scaleXYZ(hd, 0.9, 1, 0.4);
    p.add(K.put(hd, 0, -h * 0.55, 0.2));
  } else if (motif === 1) {
    // 月与山：冷白小圆月 + 夜色山形
    const moon = K.sphereLo({ color: shade(P.wax, -0.52), r: 0.24, seg: 0, family: 'unlit' });
    K.scaleXYZ(moon, 1, 1, 0.45);
    p.add(K.put(moon, cw * 0.22, -h * 0.62, 0.21));
    p.add(K.put(K.prism({ color: shade(P.night, 0.3), size: [cw * 0.9, ch * 0.34, 0.05], family: 'unlit' }), -cw * 0.08, -h * 0.24, 0.28));
  } else {
    // 生涩斜杠涂划两道
    for (let i = 0; i < 2; i++) {
      const st = K.box({ color: shade(P.night, 0.22 + i * 0.12), size: [cw * 0.66, 0.12, 0.05], family: 'unlit' });
      K.tilt(st, 0, 0, (i ? -1 : 1) * (0.35 + r() * 0.3));
      p.add(K.put(st, 0, -h * (0.4 + i * 0.22), 0.28));
    }
  }
  return p;
}

export default {
  id: 'paintingTilted',
  place: 'wallDecor',
  band: 'mid',
  tags: ['wood'],
  behaviors: [],
  build({ count = 3, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('paintingTilted');
    // 成组布局：x 错位 + 挂钉高低差 + 各自小角度歪斜（tilt 绕挂钉点）
    const specs = [
      { x: -2.75, nail: 3.7, w: 2.7, h: 3.3, motif: 0, tone: shade(P.clayDark, -0.3), tilt: 0.1 },
      { x: 0.25, nail: 4.5, w: 3.3, h: 2.7, motif: 1, tone: shade(P.woodDark, -0.26), tilt: -0.08 },
      { x: 3.05, nail: 3.0, w: 2.4, h: 2.9, motif: 2, tone: shade(P.night, 0.06), tilt: 0.15 },
    ];
    const n = Math.max(1, Math.min(specs.length, Math.round(count)));
    for (const s of specs.slice(0, n)) {
      const p = smallPainting(r, s);
      K.tilt(p, 0, 0, s.tilt + (r() - 0.5) * 0.04);
      g.add(K.put(p, s.x, s.nail, 0));
    }
    return g;
  },
};
