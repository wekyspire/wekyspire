// 法环贴地（CATALOG #58）：「浅刻法阵圆环，符文点缀」——floorDecal 大贴印（stone 刻环 + unlit 符文双族）。
// 原点=环心（y=0 落地）；内外两圈石段环排读作浅刻圆环，环间立小符文石（少数 unlit 压暗冷白
// 微亮，flameCore 点缀克制——无 lightSource 职责不加火），中央小祭点。总高 ≤0.5。
// 变体走 build(opts)：环径/符文数。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'ritualCircle',
  place: 'floorDecal',
  tags: ['ritual', 'decal'],
  footprint: { x: 10, z: 10 },
  behaviors: [],
  build({ ringR = 4.6, runes = 6, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('ritualCircle');
    // 外环：16 段浅刻石段（压暗刻槽色），微错位出手工凿感
    const OUTER = 16;
    for (let i = 0; i < OUTER; i++) {
      const a = (i / OUTER) * Math.PI * 2;
      const seg = K.box({ color: shade(P.stone, 0.18), size: [2.05, 0.12, 0.55] });
      K.tilt(seg, 0, a + Math.PI / 2 + (r() - 0.5) * 0.03, (r() - 0.5) * 0.02);
      g.add(K.put(seg, Math.cos(a) * ringR, 0.05, Math.sin(a) * ringR));
    }
    // 内环：12 段略浅，与外环错缝
    const INNER = 12;
    const innerR = ringR * 0.66;
    for (let i = 0; i < INNER; i++) {
      const a = (i / INNER) * Math.PI * 2 + 0.26;
      const seg = K.box({ color: shade(P.stone, 0.32), size: [1.8, 0.12, 0.42] });
      K.tilt(seg, 0, a + Math.PI / 2 + (r() - 0.5) * 0.03, (r() - 0.5) * 0.02);
      g.add(K.put(seg, Math.cos(a) * innerR, 0.05, Math.sin(a) * innerR));
    }
    // 符文石：环间小立石（方石/尖石交替），多数石色，约三分之一 unlit 微亮
    const runeR = ringR * 0.83;
    for (let i = 0; i < runes; i++) {
      const a = (i / runes) * Math.PI * 2 + Math.PI / (runes * 2);
      const lit = i % 3 === 0;
      const color = lit ? shade(P.flameCore, -0.16) : shade(P.stone, 0.4);
      const family = lit ? 'unlit' : 'stone';
      const rune = i % 2
        ? K.prism({ color, size: [0.34, 0.4, 0.22], family })
        : K.box({ color, size: [0.3, 0.28, 0.22], family });
      K.tilt(rune, 0, a + Math.PI / 2, 0);       // 平面朝环心
      g.add(K.put(rune, Math.cos(a) * runeR, 0.14, Math.sin(a) * runeR));
    }
    // 中央祭点：压暗圆盘 + 一点 unlit 微亮芯
    g.add(K.put(K.cyl({ color: shade(P.stone, -0.3), r: 0.6, h: 0.1, seg: 8 }), 0, 0.05, 0));
    g.add(K.put(K.cyl({ color: shade(P.flameCore, -0.42), r: 0.15, h: 0.14, seg: 6, family: 'unlit' }), 0, 0.07, 0));
    return g;
  },
};
