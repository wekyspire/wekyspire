// 标本罐（CATALOG2 编号 116）：「玻璃罐泡着不明物」——奥术小件 prop（glass+stone+wood 三族）。
// 原点=底面中心（y=0 落地），全高约 1.8（S 档）；mount 双宿主 ['floor','smallWallTop']。
// 玻璃器=glass 族：罐体青灰透明 lathe，内盛药液（P.potionGreen/Blue 择一）泡着骨色不明物
// ——主团 sphereLo jitter 鼓包 + 垂须斜伸 + 小伴块错落（stone 族 P.bone/boneDark 读作泡标本），
// 木盖（wood 族）压口带提珠，药液内两粒小气泡上浮。变体走 build(opts)：液色 hue /
// 泡物块数 blobs（1~3）/ 气泡 bubbles。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 罐体轮廓（鼓腹→收肩→直口微撇），高约 1.44
const JAR = [
  [0.04, 0], [0.5, 0.05], [0.64, 0.28], [0.66, 0.72], [0.58, 1.02],
  [0.44, 1.16], [0.4, 1.32], [0.45, 1.44],
];
// 罐内药液（贴罐内壁的浅层），高约 1.02
const FLUID = [
  [0.03, 0], [0.56, 0.06], [0.6, 0.3], [0.6, 0.78], [0.48, 0.94], [0.2, 1.02],
];

export default {
  id: 'specimenJar',
  place: 'prop',
  mount: ['floor', 'smallWallTop'],
  tags: ['glass', 'arcane'],
  footprint: { x: 1.7, z: 1.7 },
  behaviors: [],
  build({ hue = 'green', blobs = 2, bubbles = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('specimenJar');
    const fluid = hue === 'blue' ? P.potionBlue : P.potionGreen;
    // 罐体 + 药液：玻璃族双层（外壳读体积、内液读浸泡液）
    const jar = K.lathe({ color: shade(P.glowCyan, -0.32), profile: JAR, seg: 8, family: 'glass' });
    K.tilt(jar, 0, 0, (r() - 0.5) * 0.02);
    g.add(K.put(jar, 0, 0, 0));
    g.add(K.put(K.lathe({ color: shade(fluid, -0.05), profile: FLUID, seg: 8, family: 'glass' }), 0, 0.04, 0));
    // 不明物主体：骨色鼓包团（jitter 读作蜷曲泡物）+ 斜垂须
    const blob = K.sphereLo({ color: P.bone, r: 0.3, seg: 1, jitter: 0.3, rng: r, family: 'stone' });
    K.tilt(blob, 0, r() * Math.PI, 0.12);
    g.add(K.put(blob, -0.1, 0.6, 0.06));
    const tendril = K.cyl({ color: P.boneDark, r: 0.05, rTop: 0.03, h: 0.5, seg: 5, family: 'stone' });
    K.aim(tendril, 0.8, 1, 0.5);
    g.add(K.put(tendril, 0.08, 0.88, 0.2));
    // 伴块：主团旁错落小团（块数 1~3，深浅轮换）
    const n = Math.min(Math.max(blobs, 1), 3);
    for (let i = 0; i < n - 1; i++) {
      const aa = r() * Math.PI * 2;
      const small = K.sphereLo({
        color: [P.boneDark, shade(P.bone, -0.08)][i % 2],
        r: 0.13 + r() * 0.05, seg: 0, jitter: 0.35, rng: r, family: 'stone',
      });
      K.tilt(small, r() * 0.6, r() * Math.PI, r() * 0.6);
      g.add(K.put(small, Math.cos(aa) * 0.28, 0.42 + r() * 0.16, Math.sin(aa) * 0.28));
    }
    // 上浮小气泡：药液内两粒（玻璃族亮色小珠）
    if (bubbles) {
      for (let i = 0; i < 2; i++) {
        g.add(K.put(K.sphereLo({
          color: shade(fluid, 0.3), r: 0.05 + i * 0.02, seg: 0, family: 'glass',
        }), (r() - 0.5) * 0.5, 0.72 + i * 0.24, (r() - 0.5) * 0.5));
      }
    }
    // 木盖：压口厚沿 + 提珠（读作蜡封木盖）
    g.add(K.put(K.cyl({ color: P.woodDark, r: 0.5, rTop: 0.46, h: 0.16, seg: 8, family: 'wood' }), 0, 1.5, 0));
    g.add(K.put(K.sphereLo({ color: shade(P.woodDark, 0.14), r: 0.15, seg: 0, family: 'wood' }), 0, 1.66, 0));
    return g;
  },
};
