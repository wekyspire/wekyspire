// 砾石斑（CATALOG #50）：「细碎石片滩，边缘融地」——撒印类 floorDecal。
// 原点=斑心投影；细小石片椭圆撒布（中心密而微凸，向外渐稀渐扁），外缘石片压暗趋地面色
// 与地相融（融地），斑心两粒锚石立剪影。rng 驱动确定性变体。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'gravelPatch',
  place: 'floorDecal',
  tags: ['rubble'],
  footprint: { x: 5, z: 5 },
  behaviors: [],
  build({ chips = 20, spread = 1.0, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('gravelPatch');
    const tones = [shade(P.rock, 0.1), P.rock, shade(P.slab, 0.06)];
    const edgeTone = shade(P.floor, -0.05);            // 外缘融地色（趋地面）
    // 细碎石片：q=离心率（0 心 → 1 缘），中心略大微凸、边缘更扁更暗
    for (let i = 0; i < chips; i++) {
      const q = Math.pow(r(), 0.7);                     // 中心密
      const a = r() * Math.PI * 2;
      const size = 0.17 + r() * 0.08 + (1 - q) * 0.05;
      const flat = 0.5 - q * 0.3;
      const chip = K.sphereLo({
        color: q > 0.72 ? edgeTone : tones[i % 3],
        r: size, seg: 0, jitter: 0.2, rng: r,
      });
      K.scaleXYZ(chip, 1, flat, 1);
      g.add(K.put(chip, Math.cos(a) * q * 2.1 * spread, size * flat * 0.6, Math.sin(a) * q * 1.7 * spread));
    }
    // 斑心锚石两粒（碎滩剪影锚点）
    for (let i = 0; i < 2; i++) {
      const anchor = K.sphereLo({ color: tones[(i + 1) % 3], r: 0.3 + r() * 0.05, seg: 0, jitter: 0.22, rng: r });
      K.scaleXYZ(anchor, 1.1, 0.5, 0.9);
      K.tilt(anchor, 0, r() * Math.PI, 0);
      g.add(K.put(anchor, (r() - 0.5) * 0.8, 0.16, (r() - 0.5) * 0.6));
    }
    return g;
  },
};
