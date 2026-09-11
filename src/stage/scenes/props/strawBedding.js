// 草垫铺（CATALOG #60）：「干草铺地，压痕散乱」——撒印类 floorDecal。
// 原点=垫心投影；两层薄草底微错位微转（踩压的垫层）+ 散乱草蓬（压扁 jitter 球，
// 个别更扁更暗=压痕）+ 数根散草甩在垫边，草色 P.straw 深浅微差，总高 ≤0.5。
// 变体：草蓬数/铺开规模。rng 驱动确定性变体。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'strawBedding',
  place: 'floorDecal',
  tags: ['decal'],
  footprint: { x: 6, z: 4 },
  behaviors: [],
  build({ tufts = 7, spread = 1.0, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('strawBedding');
    const tones = [shade(P.straw, 0.06), P.straw, shade(P.straw, -0.07)];
    // 草底：两片薄垫错位斜压（压平的垫层 + 踩压痕）
    const mat1 = K.plate({ color: shade(P.straw, 0.02), w: 5.0 * spread, d: 3.0 * spread, th: 0.07, family: 'cloth' });
    g.add(K.put(mat1, 0, 0.035, 0));
    const mat2 = K.plate({ color: shade(P.straw, 0.06), w: 3.9 * spread, d: 2.5 * spread, th: 0.07, family: 'cloth' });
    g.add(K.put(K.tilt(mat2, 0, 0.35, 0), 0.45, 0.1, 0.3));
    // 草蓬：压扁 jitter 球散布（每第 4 蓬更扁更暗=压痕）
    for (let i = 0; i < tufts; i++) {
      const pressed = i % 4 === 3;
      const tuft = K.sphereLo({
        color: pressed ? shade(P.straw, -0.1) : tones[i % 3],
        r: 0.8, seg: 1, jitter: 0.18, rng: r, family: 'cloth',
      });
      K.scaleXYZ(tuft, 1.1 + r() * 0.2, pressed ? 0.16 : 0.3, 0.85 + r() * 0.15);
      K.tilt(tuft, 0, r() * Math.PI, 0);
      const a = r() * Math.PI * 2, q = 0.25 + 0.75 * r();
      g.add(K.put(tuft, Math.cos(a) * q * 1.6 * spread, pressed ? 0.16 : 0.24, Math.sin(a) * q * 1.2 * spread));
    }
    // 散草：细草梗甩在垫边
    for (let i = 0; i < 5; i++) {
      const stalk = K.box({ color: tones[i % 3], size: [0.85 + r() * 0.3, 0.06, 0.09], family: 'cloth' });
      g.add(K.put(K.tilt(stalk, (r() - 0.5) * 0.12, r() * Math.PI, (r() - 0.5) * 0.12),
        (r() * 2 - 1) * 2.2 * spread, 0.1, (r() * 2 - 1) * 1.4 * spread));
    }
    return g;
  },
};
