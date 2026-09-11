// 绳卷（CATALOG2 编号 34）：「盘绳三匝+垂头一段」——容器类 prop/floor（cloth 单族，P.rope 深浅交替读作绳股）。
// 原点=底面中心（y=0 落地）；匝=小圆柱链段切向围环（同 hooksRope 绳语汇），匝径同心渐扩、
// 微错高微错位读作手盘；垂头=外匝斜向引出的贴地两段 + 末端收口缠箍。
// 变体走 build(opts)：匝数 coils（2~4）/垂头 tail 有无。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

const ROPE_R = 0.115;

// 一匝盘绳：n 段小圆柱绕半径 R 切向围环（段轴先转横，随枢轴绕 y 布开；段深浅交替）
function coilLoop(g, R, y, n, r) {
  for (let i = 0; i < n; i++) {
    const chord = 2 * R * Math.sin(Math.PI / n);
    const piv = new THREE.Group();
    piv.rotation.y = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.12;
    const seg = K.cyl({
      color: i % 2 ? shade(P.rope, -0.07) : P.rope,
      r: ROPE_R, h: chord + 0.09, seg: 5, family: 'cloth',
    });
    K.tilt(seg, 0, 0, Math.PI / 2);
    K.jitter(seg, r, { rot: 0.04 });
    piv.add(K.put(seg, R + (r() - 0.5) * 0.06, y + (r() - 0.5) * 0.02, 0));
    g.add(piv);
  }
}

export default {
  id: 'ropeCoil',
  place: 'prop',
  mount: 'floor',
  tags: ['rope', 'generic'],
  footprint: { x: 2.8, z: 2.8 },
  behaviors: [],
  build({ coils = 3, tail = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('ropeCoil');
    const ns = Math.min(Math.max(coils, 2), 4);
    const SEG_N = [6, 8, 10, 12];                    // 匝径越大段越多
    let outer = 0;
    for (let i = 0; i < ns; i++) {
      const R = 0.48 + i * 0.24;                    // 相邻匝贴靠（步距=2×绳径）
      outer = R;
      coilLoop(g, R, ROPE_R + i * 0.012, SEG_N[i], r);
    }
    // 垂头：外匝斜向引出贴地两段（段轴随引出向转向）+ 末端收口缠箍（粗一档压暗）
    if (tail) {
      const a0 = 0.75 + (r() - 0.5) * 0.3;
      const dx = Math.cos(a0), dz = Math.sin(a0);
      const spots = [outer + 0.26, outer + 0.72, outer + 1.02];
      for (let i = 0; i < spots.length; i++) {
        const last = i === spots.length - 1;
        const seg = K.cyl({
          color: last ? shade(P.rope, -0.14) : (i % 2 ? shade(P.rope, -0.07) : P.rope),
          r: last ? ROPE_R + 0.035 : ROPE_R,
          h: last ? 0.2 : 0.52, seg: 5, family: 'cloth',
        });
        K.tilt(seg, 0, -a0 + i * 0.08, Math.PI / 2);
        g.add(K.put(seg, dx * spots[i], ROPE_R, dz * spots[i]));
      }
    }
    return g;
  },
};
