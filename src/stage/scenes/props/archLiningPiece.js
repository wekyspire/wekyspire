// 拱门套（CATALOG2 编号 112）：「内凹门套双层线脚」——wallStructure（stone+unlit 双族）。
// 原点=墙脚挂点（z=0 贴墙面、+z 朝室内，自地面向上，同 pilasterHalf）；占 1 墙段，
// 全宽约 5、全高约 12。门洞内凹=unlit P.night 暗腔（暗矩形洞身 + 暗半圆拱顶，压在
// 线脚层前读深洞，alcoveNiche 先例）；线脚=同心环盘逐层收小、逐层前凸、逐层提亮
// （外环压暗），门边条与环带同层对位（双层起步、可三层），起拱垫块 + 拱心石收形。
// 变体走 build(opts)：layers 线脚层数（2~3）/spring 起拱线高（5.8~7.0）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'archLiningPiece',
  place: 'wallStructure',
  bayWidth: 1,
  tags: ['stone', 'generic'],
  behaviors: [],
  build({ layers = 2, spring = 6.4, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('archLiningPiece');
    const L = Math.min(3, Math.max(2, Math.round(layers)));
    const vw = 1.12;                                       // 洞口半宽
    const sy = Math.min(7.0, Math.max(5.8, spring));       // 起拱线
    // 基座 + 墙面板 + 顶冠带（全高收在约 12）
    g.add(K.put(K.box({ color: shade(P.stone, -0.12), size: [5.0, 1.3, 1.25] }), 0, 0.65, 0.625));
    const surround = K.box({ color: shade(P.stone, -0.04), size: [5.0, 9.6, 0.85] });
    K.jitter(surround, r, { rot: 0.006 });
    g.add(K.put(surround, 0, 6.1, 0.425));
    g.add(K.put(K.box({ color: shade(P.stone, 0.06), size: [5.4, 1.0, 1.05] }), 0, 11.4, 0.525));
    // 暗腔：洞身暗矩形（自基座顶到起拱线）——先铺在最底层，线脚压边
    const frontZ = 0.58 + L * 0.14 + 0.04;
    g.add(K.put(K.box({ color: P.night, size: [vw * 2, sy - 1.3, 0.3], family: 'unlit' }), 0, (1.3 + sy) / 2, frontZ));
    // 线脚层：环盘（拱段）+ 门边条（直段）同层对位，逐层收小/前凸/提亮
    for (let i = 0; i < L; i++) {
      const rr = vw + (L - i) * 0.36 + 0.02;
      const zz = 0.58 + i * 0.14;
      const tone = shade(P.stone, 0.09 - (L - 1 - i) * 0.06);
      const ring = K.cyl({ color: tone, r: rr, h: 0.32, seg: 9 });
      K.tilt(ring, Math.PI / 2);
      g.add(K.put(ring, 0, sy, zz));
      for (const s of [-1, 1]) {                           // 门边条：压住暗矩形侧缘
        const jamb = K.box({ color: tone, size: [0.34, sy - 1.3, 0.9] });
        K.jitter(jamb, r, { rot: 0.008 });
        g.add(K.put(jamb, s * (rr - 0.17), (1.3 + sy) / 2, zz - 0.14));
      }
    }
    // 拱顶暗半圆（压各层环盘心，只余线脚环带）+ 起拱垫块 + 拱心石
    const darkArch = K.cyl({ color: P.night, r: vw, h: 0.12, seg: 9, family: 'unlit' });
    K.tilt(darkArch, Math.PI / 2);
    g.add(K.put(darkArch, 0, sy, frontZ + 0.04));
    for (const s of [-1, 1]) {
      g.add(K.put(K.box({ color: shade(P.stone, 0.12), size: [0.5, 0.5, 0.95] }), s * (vw + 0.55), sy + 0.2, 0.55));
    }
    const key = K.box({ color: shade(P.stone, 0.12), size: [0.55, 0.85, 0.35] });
    K.jitter(key, r, { rot: 0.015 });
    g.add(K.put(key, 0, sy + vw + 0.5, frontZ));
    return g;
  },
};
