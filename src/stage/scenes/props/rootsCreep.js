// 树根蔓延（CATALOG2 编号 93）：「贴地根须分叉+顶起石片」——撒印类 floorDecal
// （wood 根须 + stone 石片/苔 两族）。原点=根带中心投影；数条主根自带缘伸入、
// 两段主干后分叉续伸（扁平段微起伏贴地，粗细分级变细），分叉点顶起翘石片
// （tilt 抬角 + chip 缺角，读作被根顶起），须根细条散在节间，两小簇苔斑点缀。
// 根用 shade(P.wood, 0.18) 提亮档压深色地面读出剪影（mossPatchFloor 对比度范式），
// 总高 ≤0.5。变体走 build(opts)：主根数/石片数/须根数。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'rootsCreep',
  place: 'floorDecal',
  tags: ['nature'],
  footprint: { x: 6, z: 4 },
  behaviors: [],
  build({ roots = 3, slabs = 3, hairs = 6, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('rootsCreep');
    const tones = [shade(P.wood, 0.18), P.wood, shade(P.woodDark, 0.1)];
    const joints = []; // 分叉/末梢点（石片与须根的落位候选）
    const XM = 2.6, ZM = 1.8; // 根带红线：段末越界即回拉弯折（宁弯勿出 footprint）
    // 画一段根：自 (x,z) 沿角 a 的扁平段，走向微摆、微起伏贴地；段末夹回根带内，
    // 再按实际位移反算段长与段角（弯而不出界）；返回段末位置与新角
    function seg(x, z, a, w) {
      const len = 0.9 + r() * 0.55;
      const ca = a + (r() - 0.5) * 0.5;
      const ex = Math.max(-XM, Math.min(XM, x + Math.cos(ca) * len));
      const ez = Math.max(-ZM, Math.min(ZM, z + Math.sin(ca) * len));
      const dx = ex - x, dz = ez - z;
      const actual = Math.hypot(dx, dz);
      if (actual < 0.25) return [x, z, ca]; // 已抵边：不画退化段
      const th = 0.13 + w * 0.1;
      const m = K.box({
        color: tones[Math.floor(r() * 3)], size: [actual + w * 0.6, th, w], family: 'wood',
      });
      K.tilt(m, (r() - 0.5) * 0.1, Math.atan2(dz, dx), (r() - 0.5) * 0.1);
      g.add(K.put(m, x + dx / 2, th / 2 + 0.02 + r() * 0.03, z + dz / 2));
      return [ex, ez, Math.atan2(dz, dx)];
    }
    // 一条主根：两段主干 → 末端分两叉各续一到两段（粗细分级变细）
    function root(x, z, a, w) {
      let [cx, cz, ca] = seg(x, z, a, w);
      [cx, cz, ca] = seg(cx, cz, ca, w * 0.9);
      joints.push([cx, cz]);
      for (const s of [-1, 1]) {
        const f = s * (0.5 + r() * 0.35);
        let [bx, bz, ba] = seg(cx, cz, ca + f, w * 0.62);
        if (r() < 0.7) [bx, bz, ba] = seg(bx, bz, ba, w * 0.45);
        joints.push([bx, bz]);
      }
    }
    const rn = Math.min(Math.max(roots, 2), 4);
    for (let i = 0; i < rn; i++) {
      const z0 = -1.3 + (2.6 * i) / Math.max(1, rn - 1) + (r() - 0.5) * 0.3;
      root(-2.5 + (r() - 0.5) * 0.3, z0, (r() - 0.5) * 0.6, 0.55 + r() * 0.12);
    }
    // 顶起石片：落在分叉点上的翘石（tilt 抬角 + chip 缺角，读作被根顶起）
    const sn = Math.min(Math.max(slabs, 2), 4);
    for (let i = 0; i < sn && joints.length; i++) {
      const [jx, jz] = joints[Math.floor(r() * joints.length)];
      const slab = K.plate({
        color: [shade(P.slab, 0.1), P.slab, shade(P.stone, 0.08)][i % 3],
        w: 0.95 + r() * 0.3, d: 0.8 + r() * 0.25, th: 0.2,
      });
      K.chip(slab, { corner: [r() < 0.5 ? 1 : -1, 1, r() < 0.5 ? 1 : -1], amount: 0.16 });
      K.tilt(slab, (r() - 0.5) * 0.5, r() * Math.PI, (r() - 0.5) * 0.5);
      g.add(K.put(slab, jx, 0.19 + r() * 0.05, jz));
    }
    // 须根：节间散的细短根条
    const hn = Math.min(Math.max(hairs, 4), 8);
    for (let i = 0; i < hn && joints.length; i++) {
      const [jx, jz] = joints[Math.floor(r() * joints.length)];
      const hair = K.box({ color: tones[i % 3], size: [0.4 + r() * 0.2, 0.08, 0.07], family: 'wood' });
      K.tilt(hair, 0, r() * Math.PI * 2, (r() - 0.5) * 0.2);
      g.add(K.put(hair, jx + (r() - 0.5) * 0.9, 0.06, jz + (r() - 0.5) * 0.9));
    }
    // 苔斑两小簇：根节上的自然侵蚀点缀
    for (let i = 0; i < 2 && joints.length; i++) {
      const [jx, jz] = joints[Math.floor(r() * joints.length)];
      const moss = K.sphereLo({ color: i ? P.mossDark : P.moss, r: 0.34, seg: 1, jitter: 0.18, rng: r });
      K.scaleXYZ(moss, 1.2, 0.16, 1);
      g.add(K.put(moss, jx + (r() - 0.5) * 0.5, 0.08, jz + (r() - 0.5) * 0.5));
    }
    return g;
  },
};
