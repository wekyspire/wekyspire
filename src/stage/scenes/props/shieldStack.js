// 盾堆（CATALOG2 编号 49）：「三面盾靠墙互叠」——军事类 prop/floor（盾体 metal + 皮条 cloth 双族）。
// 原点=底面中心（y=0 落地）；盾面语言与挂盾（编号 79）同源：暗缘环（chip 缺角）+ 盾面 +
// 中央伞钉 + 缘钉，凹痕=盾面压扁 sphereLo 暗斑半嵌；数面圆盾（径约 4.1）前后互叠、
// 两翼外摆、整堆后仰读作「靠墙堆放」，外盾下缘垂残断皮条。变体走 build(opts)：
// 盾数（2~4）/每盾凹痕数（1~2）/皮条数（1~3）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 单面立盾（径约 4.1，面朝 +z，原点=盾心）：三层同心短圆柱 + chip 缺角 + 压扁暗斑手法
function buildShield(r, dents) {
  const s = new THREE.Group();
  const rim = K.cyl({ color: shade(P.iron, -0.2), r: 2.05, h: 0.3, seg: 9, family: 'metal' });
  K.chip(rim, { corner: [1, 1, 1], amount: 0.3 }); // 盾缘缺角
  K.tilt(rim, Math.PI / 2);
  s.add(K.put(rim, 0, 0, 0));
  const face = K.cyl({ color: shade(P.iron, 0.05), r: 1.78, h: 0.3, seg: 9, family: 'metal' });
  K.tilt(face, Math.PI / 2);
  s.add(K.put(face, 0, 0, -0.02));
  const boss = K.cyl({ color: shade(P.iron, 0.16), r: 0.52, rTop: 0.38, h: 0.3, seg: 8, family: 'metal' });
  K.tilt(boss, Math.PI / 2);
  s.add(K.put(boss, 0, 0, 0.14));
  // 缘钉：提亮小珠钉在缘环带上
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + 0.4;
    s.add(K.put(K.sphereLo({
      color: shade(P.iron, 0.12), r: 0.1, seg: 0, family: 'metal',
    }), Math.cos(a) * 1.92, Math.sin(a) * 1.92, 0.16));
  }
  // 凹痕暗斑：压扁 sphereLo 半嵌盾面（避开中央伞钉，深浅两档）
  for (let i = 0; i < dents; i++) {
    const a = 0.7 + i * 2.1 + r() * 0.5;
    const rad = 0.85 + r() * 0.62;
    const dent = K.sphereLo({
      color: shade(P.iron, -0.3 - (i % 2) * 0.12), r: 0.3 + r() * 0.16,
      seg: 0, jitter: 0.2, rng: r, family: 'metal',
    });
    K.scaleXYZ(dent, 1, 1, 0.4);
    K.tilt(dent, 0, r() * Math.PI, 0);
    s.add(K.put(dent, Math.cos(a) * rad, Math.sin(a) * rad, 0.1));
  }
  return s;
}

export default {
  id: 'shieldStack',
  place: 'prop',
  mount: 'floor',
  tags: ['metal', 'barrack'],
  footprint: { x: 7.6, z: 3.2 },
  behaviors: [],
  build({ shields = 3, dents = 2, straps = 2, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('shieldStack');
    const n = Math.min(Math.max(shields, 2), 4);
    const per = Math.min(Math.max(dents, 1), 2);
    const pitch = n >= 4 ? 1.55 : 1.7;
    for (let i = 0; i < n; i++) {
      const side = Math.sign(i - (n - 1) / 2) || 0; // -1 左 / 0 中 / +1 右
      // 奇数堆：中盾在后、两翼在前互叠；偶数堆：一后一前交替搭
      const front = n % 2 === 1 ? side !== 0 : i % 2 === 1;
      const sh = buildShield(r, per);
      K.tilt(sh,
        front ? -0.06 - r() * 0.03 : -0.15 - r() * 0.04, // 后仰（后盾更仰，读作靠墙）
        front ? side * (0.22 + r() * 0.05) : (r() - 0.5) * 0.06, // 两翼外摆再回扣
        front ? -side * 0.05 : (r() - 0.5) * 0.05);
      g.add(K.put(sh, (i - (n - 1) / 2) * pitch, 2.2, front ? 0.12 : -0.42));
    }
    // 皮条残断：自最外盾下缘垂下，长短歪斜不齐（同挂盾手法）
    const st = Math.min(Math.max(straps, 1), 3);
    const sx = ((n - 1) / 2) * pitch + 0.9;
    for (let i = 0; i < st; i++) {
      const [x, z, top] = i === 0 ? [-sx, 0.4, 0.92] : i === 1 ? [sx, 0.4, 0.92] : [0.1, 0.16, 0.78];
      const len = 0.6 + r() * 0.25;
      const strap = K.box({ color: P.rope, size: [0.4, len, 0.09], family: 'cloth' });
      K.tilt(strap, 0, 0, Math.sign(x || 1) * (0.06 + r() * 0.16));
      g.add(K.put(strap, x, top - len / 2, z));
    }
    return g;
  },
};
