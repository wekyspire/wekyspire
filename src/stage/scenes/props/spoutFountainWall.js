// 壁泉口（CATALOG2 编号 114）：「兽首吐水口+石盆（干涸）」——wallStructure（stone+unlit 双族）。
// 原点=墙脚挂点（z=0 贴墙面、+z 朝室内，自地面向上）；占 1 墙段，全高约 6.4、盆径约 3.2。
// 兽首=压扁球颅 + 方吻前伸 + 眉突 + 双耳尖锥（mountedHead 迷你语汇），口部 unlit 夜色
// 吐水洞朝前 + 出唇石；石盆=靠墙半没的 lathe 盆（外翻沿→内壁折回，fountainDry 迷你），
// 盆底压暗湿渍两圈 + 吻下→盆内一道暗色水渍读「干涸」；苔斑压扁球爬盆沿/墙脚（nature）。
// 变体走 build(opts)：moss 苔斑数（0~4）/ears 兽耳有无/stain 水渍长（0.8~1.4）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'spoutFountainWall',
  place: 'wallStructure',
  bayWidth: 1,
  tags: ['stone', 'nature'],
  behaviors: [],
  build({ moss = 3, ears = true, stain = 1.1, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('spoutFountainWall');
    // 基座 + 墙面板 + 顶压条
    g.add(K.put(K.box({ color: shade(P.stone, -0.12), size: [3.4, 0.7, 1.05] }), 0, 0.35, 0.525));
    const panel = K.box({ color: P.stone, size: [3.05, 5.3, 0.6] });
    K.jitter(panel, r, { rot: 0.006 });
    g.add(K.put(panel, 0, 3.35, 0.3));
    g.add(K.put(K.box({ color: shade(P.stone, 0.06), size: [3.25, 0.35, 0.75] }), 0, 6.175, 0.375));
    // 兽首：球颅 + 眉突 + 方吻 + 夜色吐水口 + 出唇 + 眼洞 + 耳尖锥
    const cy = 4.55;
    const skull = K.sphereLo({ color: shade(P.stone, 0.12), r: 0.6, seg: 1, jitter: 0.06, rng: r });
    K.scaleXYZ(skull, 1, 0.95, 1.05);
    g.add(K.put(skull, 0, cy, 0.72));
    g.add(K.put(K.box({ color: shade(P.stone, 0.04), size: [1.05, 0.24, 0.4] }), 0, cy + 0.27, 1.08));
    g.add(K.put(K.box({ color: shade(P.stone, 0.08), size: [0.72, 0.52, 0.62] }), 0, cy - 0.23, 1.06));
    g.add(K.put(K.box({ color: P.night, size: [0.4, 0.2, 0.1], family: 'unlit' }), 0, cy - 0.35, 1.4));
    g.add(K.put(K.box({ color: shade(P.stone, -0.1), size: [0.5, 0.16, 0.42] }), 0, cy - 0.49, 1.24));
    for (const s of [-1, 1]) {
      g.add(K.put(K.box({ color: P.night, size: [0.18, 0.16, 0.08], family: 'unlit' }), s * 0.34, cy + 0.13, 1.3));
    }
    if (ears) {
      for (const s of [-1, 1]) {
        const ear = K.cone({ color: shade(P.stone, -0.06), r: 0.15, h: 0.45, seg: 5 });
        K.aim(ear, s * 0.55, 0.8, -0.05);
        g.add(K.put(ear, s * 0.5, cy + 0.53, 0.55));
      }
    }
    // 石盆：靠墙半没的柱脚 + lathe 盆体（外翻沿→内壁折回）
    g.add(K.put(K.cyl({ color: shade(P.stone, -0.08), r: 0.9, rTop: 0.78, h: 0.7, seg: 8 }), 0, 1.05, 0));
    g.add(K.put(K.lathe({
      color: P.stone, seg: 9,
      profile: [
        [0, 0.6], [1.0, 0.64], [1.38, 0.78], [1.52, 1.1], [1.6, 1.3],
        [1.34, 1.34], [1.05, 1.02], [0.55, 0.9], [0, 0.88],
      ],
    }), 0, 1.4, 0));
    // 干涸：盆底残湿两圈（内圈更深）+ 吻下沿→盆内暗色水渍 + 墙面垂渍
    g.add(K.put(K.cyl({ color: shade(P.stone, -0.28), r: 1.0, h: 0.05, seg: 9 }), 0, 2.33, 0));
    g.add(K.put(K.cyl({ color: shade(P.stone, -0.42), r: 0.55, h: 0.05, seg: 8 }), 0, 2.31, 0));
    const drip = K.box({ color: shade(P.stone, -0.34), size: [0.34, 0.85, 0.1] });
    K.tilt(drip, -0.08, 0, 0);
    g.add(K.put(drip, 0, 2.5, 1.15));
    const sl = Math.min(1.4, Math.max(0.8, stain));
    g.add(K.put(K.box({ color: shade(P.stone, -0.3), size: [0.3, sl, 0.07] }), 0, 3.6, 0.64));
    // 苔斑：盆沿顶面 + 墙脚，压扁球深浅两层
    const nm = Math.min(4, Math.max(0, Math.round(moss)));
    const tones = [P.mossDark, P.moss, shade(P.moss, 0.16)];
    const spots = [
      [-0.95, 2.78, 1.35], [0.85, 2.76, 1.4], [-1.1, 0.78, 0.64], [1.05, 0.8, 0.66],
    ];
    for (let i = 0; i < nm; i++) {
      const blob = K.sphereLo({ color: tones[i % 3], r: 1, seg: 0, jitter: 0.2, rng: r });
      K.scaleXYZ(blob, 0.42, 0.12, 0.3);
      K.tilt(blob, 0, r() * Math.PI, (r() - 0.5) * 0.2);
      g.add(K.put(blob, ...spots[i]));
    }
    return g;
  },
};
