// 吊盆栽（CATALOG2 编号 89）：「垂盆+垂藤蔓几缕」——prop / mount:'ceiling' 纯顶挂件
// （stone 陶盆 + cloth 吊绳 + wood 叶藤 三族）。原点=天花板锚点（口径同 chandelierChain）：
// 锚座顶面即 y=0，三股吊绳自锚点垂挂向下，陶盆吊在绳末，盆口叶簇 + 数缕垂藤，
// 全垂长约 6（bbox.max.y≈0、身体在负 y）。变体走 build(opts)：绳长/藤数/藤长/叶簇密度。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 斜撑杆：自 a 指向 b 的细圆柱（aim 对向，中点落位；rTop 收梢读作植物茎藤）
function strut({ color, r, rTop, family }, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  const m = K.cyl({ color, r, rTop: rTop ?? r * 0.85, h: len, seg: 5, family });
  K.aim(m, dx, dy, dz);
  return K.put(m, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
}

export default {
  id: 'plantHanging',
  place: 'prop',
  mount: 'ceiling',
  tags: ['pottery', 'herb', 'nature'],
  footprint: { x: 3.2, z: 3.2 }, // 纯顶挂件也声明（宁大勿小，防垂藤扫进人堆）
  behaviors: [],
  build({ cordLen = 3.3, vines = 3, vineLen = 2.2, lush = 4, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('plantHanging');
    const rimY = -0.4 - cordLen; // 盆口沿高度（锚座 0.4 + 吊绳）
    // 天花板锚座：木盘钩（顶面贴原点 y=0）
    g.add(K.put(K.cyl({ color: shade(P.woodDark, -0.08), r: 0.38, rTop: 0.28, h: 0.4, seg: 6, family: 'wood' }), 0, -0.2, 0));
    // 吊绳：三股绳自锚座底散开、向盆口沿收拢（P.rope 绳色，cloth 族）
    for (let i = 0; i < 3; i++) {
      const a = i * (Math.PI * 2 / 3) + 0.5;
      g.add(strut(
        { color: shade(P.rope, -0.04 * (i % 2)), r: 0.045, rTop: 0.04, family: 'cloth' },
        [Math.cos(a) * 0.14, -0.38, Math.sin(a) * 0.14],
        [Math.cos(a) * 0.6, rimY, Math.sin(a) * 0.6],
      ));
    }
    // 垂盆：吊挂式陶盆（束底→鼓腹→外撇盆口），盆口沿=rimY
    g.add(K.put(K.lathe({
      color: P.clay, seg: 7,
      profile: [[0.04, 0], [0.3, 0.04], [0.42, 0.3], [0.5, 0.6], [0.58, 0.85], [0.64, 0.95]],
    }), 0, rimY - 0.95, 0));
    g.add(K.put(K.cyl({ color: P.clayDark, r: 0.66, rTop: 0.6, h: 0.12, seg: 7 }), 0, rimY - 0.06, 0));
    // 干土面：盆口内凹的暗色土盘
    g.add(K.put(K.cyl({ color: shade(P.woodDark, -0.18), r: 0.56, h: 0.07, seg: 7, family: 'wood' }), 0, rimY - 0.16, 0));
    // 叶簇：盆口鼓出的低模叶球数团（深浅交替）
    const fn = Math.max(3, Math.min(6, lush));
    for (let i = 0; i < fn; i++) {
      const a = i * (Math.PI * 2 / fn) + r() * 0.6;
      const rad = i === 0 ? 0 : 0.16 + r() * 0.2;
      const blob = K.sphereLo({
        color: i % 2 ? shade(P.herb, -0.12) : (i % 3 ? P.herb : shade(P.herb, 0.1)),
        r: (i === 0 ? 0.4 : 0.24 + r() * 0.1), seg: 0, jitter: 0.25, rng: r, family: 'wood',
      });
      g.add(K.put(blob, Math.cos(a) * rad, rimY + 0.06 + r() * 0.18, Math.sin(a) * rad));
    }
    // 垂藤：自盆沿斜垂而下的细藤几缕，藤上散生小叶球（垂到约 -6）
    const vn = Math.max(2, Math.min(5, vines));
    for (let i = 0; i < vn; i++) {
      const a = i * (Math.PI * 2 / vn) + 0.9 + r() * 0.5;
      const start = [Math.cos(a) * 0.55, rimY - 0.06, Math.sin(a) * 0.55];
      const len = vineLen * (0.8 + r() * 0.4);
      const end = [Math.cos(a) * (0.95 + r() * 0.35), rimY - len, Math.sin(a) * (0.95 + r() * 0.35)];
      g.add(strut({ color: shade(P.herb, -0.2), r: 0.032, rTop: 0.014, family: 'wood' }, start, end));
      for (const t of [0.45, 0.75, 1.0]) { // 藤上小叶球（末球略越出藤梢）
        const leaf = K.sphereLo({
          color: t === 1 ? P.herb : shade(P.herb, -0.08), r: 0.07 + r() * 0.03, seg: 0, jitter: 0.2, rng: r, family: 'wood',
        });
        g.add(K.put(leaf, start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t, start[2] + (end[2] - start[2]) * t));
      }
    }
    return g;
  },
};
