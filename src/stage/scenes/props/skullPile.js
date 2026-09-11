// 骷髅头堆（CATALOG #56）：「三五个叠放，眼窝深洞」——floorDecal 撒印类（骨色 stone + 眼窝 unlit 双族矮堆）。
// 原点=堆心投影（y=0 落地）；颅骨=压扁低模球，眼窝=unlit 夜色贴片嵌进颅面（vaseClay 瓮口暗盘
// 手法读作深洞），下颌=压暗方盒；底层三头环坐、顶上叠一两只，总高 ≤1.5。
// 变体走 build(opts)：头数/摊开度/散落碎骨数。

import * as THREE from 'three';
import { P, K } from '../kit/index.js';

// 单个骷髅头（局部原点=颅心）：返回 Group 便于整体摆位转向
function skull(r) {
  const s = new THREE.Group();
  const cr = K.sphereLo({ color: P.bone, r: 0.52, seg: 1, jitter: 0.07, rng: r });
  K.scaleXYZ(cr, 0.94, 0.82, 1.08);               // 压扁 + 前后略长
  s.add(cr);
  for (const ex of [-0.19, 0.19]) {               // 眼窝：夜色小贴片嵌进颅面（深洞）
    const eye = K.cyl({ color: P.night, r: 0.115, h: 0.14, seg: 6, family: 'unlit' });
    K.tilt(eye, Math.PI / 2, 0, 0);               // 轴 y→z 朝前
    s.add(K.put(eye, ex, 0.07, 0.47));
  }
  // 下颌：骨色压暗方盒，略前伸
  s.add(K.put(K.box({ color: P.boneDark, size: [0.34, 0.15, 0.28] }), 0, -0.33, 0.22));
  return s;
}

export default {
  id: 'skullPile',
  place: 'floorDecal',
  tags: ['bone'],
  footprint: { x: 3, z: 3 },
  behaviors: [],
  build({ skulls = 5, spread = 1, bits = 3, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('skullPile');
    const base = Math.min(3, skulls);
    for (let i = 0; i < base; i++) {              // 底层：环坐三头，脸朝外
      const a = (i / base) * Math.PI * 2 + 0.6;
      const s = skull(r);
      K.tilt(s, (r() - 0.5) * 0.25, a + (r() - 0.5) * 1.2, (r() - 0.5) * 0.25);
      g.add(K.put(s, Math.cos(a) * 0.62 * spread, 0.43, Math.sin(a) * 0.55 * spread));
    }
    for (let i = 0; i < skulls - base; i++) {     // 顶层：叠一两只，嵌进底层头间
      const a = r() * Math.PI * 2;
      const s = skull(r);
      K.tilt(s, (r() - 0.5) * 0.35, a, (r() - 0.5) * 0.35);
      g.add(K.put(s, (r() - 0.5) * 0.5 * spread, 1.0, (r() - 0.5) * 0.4 * spread));
    }
    for (let i = 0; i < bits; i++) {              // 散落碎骨/齿渣：小圆柱贴地
      const a = r() * Math.PI * 2;
      const bit = K.cyl({
        color: i % 2 ? P.boneDark : P.bone, r: 0.05 + r() * 0.02, h: 0.3 + r() * 0.2, seg: 4,
      });
      K.tilt(bit, (r() - 0.5) * 0.15, r() * Math.PI * 2, Math.PI / 2 + (r() - 0.5) * 0.4);
      g.add(K.put(bit, Math.cos(a) * (1.0 + r() * 0.25) * spread, 0.05, Math.sin(a) * 0.85 * spread));
    }
    return g;
  },
};
