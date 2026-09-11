// 麻袋堆（CATALOG #45）：「三五软袋相叠，袋口扎绳」——prop 类（cloth 单族，DoubleSide 软轮廓）。
// 原点=底面中心（y=0 落地）；单袋=低模球压扁（jitter 出软鼓轮廓，约 3×1.6×2.2），
// 袋口束颈 + P.rope 绳箍。变体走 build(opts)：袋数（3~5）；rng 驱动确定性变体。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 单只麻袋：压扁球袋身 + 束颈 + 绳箍，返回局部 y=0 落地的 Group（袋口朝 +x）
function makeSack(r, tone = 0) {
  const s = new THREE.Group();
  const body = K.sphereLo({
    color: [P.sack, shade(P.sack, 0.06), shade(P.sack, -0.09)][tone],
    r: 1, seg: 1, jitter: 0.14, rng: r, family: 'cloth',
  });
  K.scaleXYZ(body, 1.5, 0.8, 1.1);
  K.tilt(body, 0, 0, 0.03);
  s.add(K.put(body, 0, 0.76, 0));
  // 袋口：肩上收拢的束颈 + 绳箍扎口
  const neck = K.cyl({ color: shade(P.sack, -0.04), r: 0.24, rTop: 0.13, h: 0.5, seg: 5, family: 'cloth' });
  K.tilt(neck, 0, 0, -0.15);
  s.add(K.put(neck, 1.05, 1.56, 0));
  s.add(K.put(K.cyl({ color: P.rope, r: 0.28, h: 0.16, seg: 5, family: 'cloth' }), 1.0, 1.36, 0));
  return s;
}

export default {
  id: 'sacksGrain',
  place: 'prop',
  mount: 'floor',
  tags: ['cloth', 'container'],
  footprint: { x: 4, z: 4 },
  behaviors: [],
  build({ sacks = 4, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('sacksGrain');
    // 堆位：底层两袋并排 → 顶层压缝 → 余袋倚靠/再并（三五袋相叠的软堆剪影）
    const spots = [
      { x: -0.55, z: 0.2, ry: 0.42 },
      { x: 0.6, z: -0.5, ry: -0.65 },
      { x: 0.02, y: 1.48, z: 0.1, ry: 1.3, rz: 0.05 },
      { x: -0.1, y: 0.62, z: 1.35, ry: -0.25, rz: 0.3 },  // 倚靠袋
      { x: 1.5, z: 0.95, ry: 2.0, rz: -0.04 },
    ];
    const n = Math.min(Math.max(sacks, 3), 5);
    for (let i = 0; i < n; i++) {
      const sp = spots[i];
      const sk = makeSack(r, i % 3);
      K.tilt(sk, 0, sp.ry + (r() - 0.5) * 0.2, sp.rz ?? 0);
      g.add(K.put(sk, sp.x + (r() - 0.5) * 0.12, sp.y ?? 0, sp.z + (r() - 0.5) * 0.12));
    }
    return g;
  },
};
