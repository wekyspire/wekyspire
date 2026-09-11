// 梁上鸟巢（CATALOG2 编号 91）：「小巢+探出枯枝」——prop / mount:'ceiling' 纯顶挂件
// （wood 巢材 + cloth 吊绳 两族）。原点=天花板锚点（口径同 chandelierChain/plantHanging）：
// 锚座顶面即 y=0，双股短绳自锚点垂挂向下，碗状小巢吊在绳末——巢=筐底放射枯枝 +
// 两圈切向围环的巢壁（ropeCoil 的绳股语汇移植成枯枝），巢沿数根长枯枝斜探而出
// （aim 对向任意朝向，末端收梢），全垂长约 2.1（bbox.max.y≈0、身体在负 y）。
// 变体走 build(opts)：绳长/探出枝数/巢径。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

const TWIG_R = 0.045;

// 一圈巢壁：n 段细枯枝切向围环（段色深浅交替、微错位错高，读作杂乱枝条堆叠的巢）
function twigLoop(g, R, y, n, r) {
  for (let i = 0; i < n; i++) {
    const chord = 2 * R * Math.sin(Math.PI / n);
    const piv = new THREE.Group();
    piv.rotation.y = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.28;
    const seg = K.cyl({
      color: [P.wood, shade(P.woodDark, 0.08), P.woodDark][i % 3],
      r: TWIG_R, h: chord + 0.09, seg: 4, family: 'wood',
    });
    K.tilt(seg, (r() - 0.5) * 0.16, 0, Math.PI / 2 + (r() - 0.5) * 0.14);
    piv.add(K.put(seg, R, y + (r() - 0.5) * 0.06, 0));
    g.add(piv);
  }
}

export default {
  id: 'nestRafters',
  place: 'prop',
  mount: 'ceiling',
  tags: ['wood', 'nature'],
  footprint: { x: 2.6, z: 2.6 }, // 纯顶挂件也声明（宁大勿小，防探出枝扫进人堆）
  behaviors: [],
  build({ hang = 1.6, twigs = 5, nestR = 0.72, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('nestRafters');
    const nestY = -0.36 - hang; // 巢心高度（锚座 0.36 + 吊绳）
    // 天花板锚座：木盘钩（顶面贴原点 y=0）
    g.add(K.put(
      K.cyl({ color: shade(P.woodDark, -0.08), r: 0.3, rTop: 0.2, h: 0.36, seg: 6, family: 'wood' }),
      0, -0.18, 0));
    // 吊绳：双股短绳自锚座底微微张开垂到巢沿（P.rope，cloth 族）
    for (let i = 0; i < 2; i++) {
      const a = i * Math.PI + 0.4;
      const cord = K.cyl({ color: shade(P.rope, -0.04 * i), r: 0.035, h: hang - 0.06, seg: 4, family: 'cloth' });
      K.tilt(cord, 0, 0, (r() - 0.5) * 0.05);
      g.add(K.put(cord, Math.cos(a) * 0.1, -0.33 - (hang - 0.06) / 2, Math.sin(a) * 0.1));
    }
    // 巢体：子组整体微斜（旧巢歪挂感），自绳末垂挂
    const nest = new THREE.Group();
    K.tilt(nest, 0.07, 0.2, 0.11);
    g.add(K.put(nest, 0, nestY, 0));
    // 筐底放射枝：细枝自巢心向外平铺、外端微垂（编篮底的弧）
    for (let i = 0; i < 5; i++) {
      const piv = new THREE.Group();
      piv.rotation.y = (i / 5) * Math.PI * 2 + 0.3;
      const tw = K.cyl({ color: P.woodDark, r: TWIG_R * 0.8, h: nestR * 1.55, seg: 4, family: 'wood' });
      K.tilt(tw, 0, 0, Math.PI / 2 - 0.14);
      piv.add(K.put(tw, nestR * 0.42, -0.15, 0));
      nest.add(piv);
    }
    // 巢壁两圈：下圈略收（碗肚）、上圈巢口
    twigLoop(nest, nestR * 0.82, -0.1, 9, r);
    twigLoop(nest, nestR, 0.03, 10, r);
    // 探出枯枝：自巢沿斜上探出的长枝（末端收梢读作枯枝）
    const tn = Math.min(Math.max(twigs, 3), 7);
    for (let i = 0; i < tn; i++) {
      const a = (i / tn) * Math.PI * 2 + 0.5;
      const len = 0.7 + r() * 0.4;
      const out = K.cyl({
        color: shade(P.woodDark, 0.12), r: 0.042, rTop: 0.014, h: len, seg: 4, family: 'wood',
      });
      K.aim(out, Math.cos(a) * 0.75, 0.8 + r() * 0.3, Math.sin(a) * 0.75);
      nest.add(K.put(out, Math.cos(a) * nestR * 0.8, 0.07, Math.sin(a) * nestR * 0.8));
    }
    return g;
  },
};
