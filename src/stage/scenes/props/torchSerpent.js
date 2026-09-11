// 蛇形火把座（CATALOG #72）：「扭曲铁艺单托，托焰」——wallDecor（metal+unlit 双族）。
// 原点=墙面挂点（z=0 贴墙，+z 朝室内，同 wallTorch 约定）；band=mid；全高约 5。
// 蛇形铁艺=分段 cyl 折线扭曲：蛇身左右/进深交替摆动攀升，座侧一小卷钩收尾（铁艺扭花）。
// 布光职责：tags 声明 lightSource/fire 即"这里有火"——不私设 PointLight（CATALOG §6），
// 托焰用 unlit 冷白双锥（同 wallTorch 语言）。变体走 build(opts)：蛇弯数/焰高/燃灭。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 折线铁条：连接两折点的 cyl（轴向对齐连线、中点定位）——蛇身逐段搭建的零件
function strut(p0, p1, rad, color) {
  const a = new THREE.Vector3(p0[0], p0[1], p0[2]);
  const b = new THREE.Vector3(p1[0], p1[1], p1[2]);
  const d = b.clone().sub(a);
  const m = K.cyl({ color, r: rad, h: d.length(), seg: 5, family: 'metal' });
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  m.position.copy(a).addScaledVector(d, 0.5);
  return m;
}

export default {
  id: 'torchSerpent',
  place: 'wallDecor',
  band: 'mid',
  tags: ['metal', 'lightSource', 'fire'],
  behaviors: [],
  build({ coils = 3, flameH = 1.15, lit = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('torchSerpent');
    // 壁座板 + 两枚铆钉（同 wallTorch 座板语言：压暗底板 + 提亮钉头）
    g.add(K.put(K.box({ color: shade(P.iron, -0.12), size: [0.9, 1.2, 0.2], family: 'metal' }), 0, 1.5, 0.1));
    for (const y of [1.15, 1.85]) {
      g.add(K.put(K.tilt(K.cyl({ color: shade(P.iron, 0.1), r: 0.07, h: 0.12, seg: 5, family: 'metal' }), Math.PI / 2), 0, y, 0.24));
    }
    // 蛇身折线：自座板中腰扭出，横摆/进深交替（末点回中），攀升至托碗下
    const baseY = 0.95, topY = 3.7, steps = coils + 1;
    const pts = [[0, baseY, 0.22]];
    for (let i = 1; i <= steps; i++) {
      if (i === steps) { pts.push([0, topY, 0.46]); break; }
      pts.push([
        (i % 2 ? 1 : -1) * (0.26 + r() * 0.07),
        baseY + (topY - baseY) * (i / steps),
        (i % 2 ? 0.62 : 0.36) + r() * 0.05,
      ]);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      g.add(strut(pts[i], pts[i + 1], i === 0 ? 0.13 : 0.11, P.iron));
    }
    // 座侧小卷钩（铁艺收尾扭花）
    g.add(strut([0, 0.95, 0.22], [0.34, 0.68, 0.3], 0.08, shade(P.iron, -0.08)));
    g.add(strut([0.34, 0.68, 0.3], [0.54, 0.92, 0.26], 0.07, shade(P.iron, -0.08)));
    // 单托碗 + 托焰（外锥压暗 + 内芯，unlit 冷白幽火防过曝）
    g.add(K.put(K.cyl({ color: shade(P.iron, 0.08), r: 0.3, rTop: 0.5, h: 0.42, seg: 6, family: 'metal' }), 0, topY + 0.21, 0.46));
    if (lit) {
      const fy = topY + 0.42;
      g.add(K.put(K.cone({ color: shade(P.flameCore, -0.34), r: 0.42, h: flameH, seg: 6, family: 'unlit' }), 0, fy + flameH * 0.5, 0.46));
      g.add(K.put(K.cone({ color: shade(P.flameCore, -0.12), r: 0.26, h: flameH * 0.62, seg: 5, family: 'unlit' }), 0, fy + flameH * 0.31, 0.46));
    }
    return g;
  },
};
