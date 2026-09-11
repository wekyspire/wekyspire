// 地裂（CATALOG #53）：「分叉裂纹贴地，主缝宽」——撒印类 floorDecal（贴地薄片）。
// 原点=主缝中点投影；主缝 3 段宽片沿 x 微折前行（越行越窄），节点处伸出窄支缝
// （方向折角随机、长度渐短），首支再带一二级小叉，缝色 P.night 深槽感，全部贴地。
// 变体：支缝数/缝长。rng 驱动确定性变体。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'cracksFloor',
  place: 'floorDecal',
  tags: ['decal'],
  footprint: { x: 6, z: 4 },
  behaviors: [],
  build({ branches = 4, length = 1.0, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('cracksFloor');
    // 主缝路点（x 均布、z 微折）→ 段片：长=段距+半宽搭接，宽逐段收窄
    const pts = [[-2.2, 0]];
    for (let i = 1; i <= 3; i++) pts.push([-2.2 + i * 1.4 * length, (r() - 0.5) * 0.7]);
    const segW = [0.5, 0.44, 0.36];
    for (let i = 0; i < 3; i++) {
      const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
      const dx = x1 - x0, dz = z1 - z0;
      const seg = K.plate({
        color: P.night, w: Math.hypot(dx, dz) + segW[i] * 0.5, d: segW[i], th: 0.12,
      });
      K.tilt(seg, 0, -Math.atan2(dz, dx), 0);
      g.add(K.put(seg, (x0 + x1) / 2, 0.06, (z0 + z1) / 2));
    }
    // 支缝：主缝节点处分叉（± 折角），首支带二级小叉；微抬 y 防接缝 z-fight
    const branchTone = shade(P.night, 0.12);
    for (let i = 0; i < branches; i++) {
      const j = Math.min(3, 1 + (i % 3));               // 分叉节点（第 1~3 路点）
      const [nx, nz] = pts[j];
      const p0 = pts[j - 1], p1 = pts[Math.min(3, j + 1)];
      const mdx = p1[0] - p0[0], mdz = p1[1] - p0[1];
      const ma = Math.atan2(mdz, mdx);
      const fork = (0.5 + r() * 0.4) * (r() < 0.5 ? 1 : -1);
      const a = ma + fork;
      const bl = 0.8 + r() * 0.45;
      const bw = 0.24 - i * 0.02;
      const arm = K.plate({ color: branchTone, w: bl, d: bw, th: 0.1 });
      K.tilt(arm, 0, -a, 0);
      const tipX = nx + Math.cos(a) * bl, tipZ = nz + Math.sin(a) * bl;
      g.add(K.put(arm, nx + Math.cos(a) * bl * 0.5, 0.14, nz + Math.sin(a) * bl * 0.5));
      if (i === 0) {
        // 二级小叉：自首支中段再折
        const sa = a + (0.45 + r() * 0.35) * (r() < 0.5 ? 1 : -1);
        const sl = 0.5 + r() * 0.25;
        const sub = K.plate({ color: shade(P.night, 0.2), w: sl, d: 0.14, th: 0.08 });
        K.tilt(sub, 0, -sa, 0);
        const mx = nx + Math.cos(a) * bl * 0.5, mz = nz + Math.sin(a) * bl * 0.5;
        g.add(K.put(sub, mx + Math.cos(sa) * sl * 0.5, 0.2, mz + Math.sin(sa) * sl * 0.5));
      }
      // 支缝末端碎屑（裂尖崩渣）
      if (i % 2 === 0) {
        const speck = K.sphereLo({ color: shade(P.rock, -0.12), r: 0.11 + r() * 0.04, seg: 0, jitter: 0.2, rng: r });
        K.scaleXYZ(speck, 1.2, 0.5, 1);
        g.add(K.put(speck, tipX, 0.09, tipZ));
      }
    }
    return g;
  },
};
