// 石笋（CATALOG2 编号 87）：「锥状积岩+底裙」——smallWall 宿主类（纯 stone 单族）。
// 底裙=两团压扁低模岩围脚（裙坡一点苔斑，nature 语汇）；笋身=四段收分的积岩环带
// （深浅交替、逐段微歪错位读作逐层凝积）+ 尖顶；可选侧笋一两根。
// 原点=底面中心（y=0 落地）；全高约 3（S 档），尖顶不承物——不声明 topY。
// 变体走 build(opts)：笋身高/侧笋数/苔斑有无。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'stalagmite',
  place: 'smallWall',
  tags: ['stone', 'nature'],
  footprint: { x: 3.4, z: 3.4 },
  behaviors: [],
  build({ height = 3, spikes = 1, mossy = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('stalagmite');
    const k = height / 3.1; // 全高缩放因子（默认 3.1）
    // 底裙：主裙 + 侧团（压扁低模球，读作洞底积岩围脚）
    const skirt = K.sphereLo({ color: P.rock, r: 1.05, seg: 0, jitter: 0.2, rng: r });
    K.scaleXYZ(skirt, 1.35, 0.34, 1.3);
    g.add(K.put(skirt, 0, 0.36 * k, 0));
    const mound = K.sphereLo({ color: shade(P.rock, 0.08), r: 0.62, seg: 0, jitter: 0.25, rng: r });
    K.scaleXYZ(mound, 1.2, 0.4, 1.15);
    g.add(K.put(mound, 0.62, 0.26 * k, 0.35));
    // 笋身：四段收分环带（深浅交替）逐段微歪错位 + 尖顶，读作逐层凝积拔高
    const bands = [
      { rb: 0.58, rt: 0.48, h: 0.95, y: 0.55 },
      { rb: 0.42, rt: 0.32, h: 0.85, y: 1.35 },
      { rb: 0.26, rt: 0.17, h: 0.65, y: 2.05 },
    ];
    bands.forEach((b, i) => {
      const seg = K.cyl({ color: i % 2 ? shade(P.rock, -0.07) : shade(P.rock, 0.05), r: b.rb, rTop: b.rt, h: b.h * k, seg: 6 });
      K.jitter(seg, r, { pos: 0.03, rot: 0.025 });
      g.add(K.put(seg, (r() - 0.5) * 0.05, (b.y + b.h / 2) * k, (r() - 0.5) * 0.05));
    });
    const tip = K.cone({ color: shade(P.rock, 0.12), r: 0.15, h: 0.5 * k, seg: 6 });
    K.jitter(tip, r, { rot: 0.03 });
    g.add(K.put(tip, (r() - 0.5) * 0.04, 2.85 * k, (r() - 0.5) * 0.04));
    // 侧笋：自裙坡斜出的小笋一两根（同款环带语言，短小）
    const sn = Math.max(0, Math.min(2, spikes));
    for (let i = 0; i < sn; i++) {
      const a = 1.1 + i * 2.4 + r() * 0.5;
      const spike = K.cone({ color: shade(P.rock, -0.03), r: 0.2, rTop: 0.06, h: (0.75 + r() * 0.25) * k, seg: 6 });
      K.aim(spike, Math.cos(a) * 0.4, 1, Math.sin(a) * 0.4);
      g.add(K.put(spike, Math.cos(a) * 0.95, 0.45 * k, Math.sin(a) * 0.95));
    }
    // 苔斑：裙坡两小片压扁苔球（nature 侵蚀感）
    if (mossy) {
      const moss1 = K.sphereLo({ color: P.moss, r: 0.34, seg: 0, jitter: 0.25, rng: r });
      K.scaleXYZ(moss1, 1.35, 0.3, 1.1);
      g.add(K.put(moss1, -0.55, 0.2 * k, 0.5));
      const moss2 = K.sphereLo({ color: P.mossDark, r: 0.2, seg: 0, jitter: 0.3, rng: r });
      K.scaleXYZ(moss2, 1.3, 0.28, 1.0);
      g.add(K.put(moss2, 0.15, 0.14 * k, 0.85));
    }
    return g;
  },
};
