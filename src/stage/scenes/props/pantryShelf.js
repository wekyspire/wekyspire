// 食架（CATALOG2 编号 70）：「分层摆面包奶酪罐」——prop/floor（wood+stone 陶罐 双族）。
// 原点=底面中心（y=0 落地），x=宽 z=深；三层搁板格架（框架语言同 potionShelf），全高约 6（M 档）。
// 底层圆面包+长棍（P.bread），中层奶酪轮+楔块+羊皮纸捆（P.cheese/P.parchment），顶层陶罐+药草束
// （P.herb）。变体走 build(opts)：面包数 breads / 罐数 jars。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 陶罐轮廓（lathe 基准，供缩放复用）：腹径约 0.9、高约 1.22
const JAR = [
  [0.04, 0], [0.34, 0.04], [0.45, 0.3], [0.44, 0.62],
  [0.32, 0.9], [0.26, 1.0], [0.3, 1.12], [0.33, 1.22],
];

// 三层搁板面高（自下而上：面包层/奶酪层/罐层）
const SHELF_Y = [1.75, 3.45, 5.15];

// 摆一只陶罐（罐身+口沿唇圈，scale 控大小），返回未落位（调用方 put）
function jarAt(color, s) {
  return K.grp(
    K.lathe({ color, seg: 7, profile: JAR.map(([rr, y]) => [rr * s, y * s]) }),
    K.put(K.cyl({ color: P.clayDark, r: 0.34 * s, h: 0.07, seg: 7 }), 0, 1.18 * s, 0),
  );
}

export default {
  id: 'pantryShelf',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'kitchen'],
  footprint: { x: 4.8, z: 1.9 },
  behaviors: [],
  build({ breads = 3, jars = 2, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('pantryShelf');
    // 框架：底座板+两侧夹板+三层搁板（微歪的手工木感）
    g.add(K.put(K.box({ color: P.woodDark, size: [4.4, 0.28, 1.7], family: 'wood' }), 0, 0.14, 0));
    for (const s of [-1, 1]) {
      g.add(K.put(K.box({ color: shade(P.woodDark, 0.04), size: [0.28, 5.5, 1.55], family: 'wood' }), s * 2.06, 3.0, 0));
    }
    SHELF_Y.forEach((y) => {
      const sh = K.box({ color: P.wood, size: [3.85, 0.22, 1.4], family: 'wood' });
      K.tilt(sh, 0, 0, (r() - 0.5) * 0.012);
      g.add(K.put(sh, 0, y, 0));
    });
    // 底层面包层：圆面包一两只 + 长棍（P.bread 麦色深浅交替，r 0.42~0.48 低模球压扁）
    const BREAD_X = [-1.35, -0.45, 0.45, 1.35];
    const nb = Math.min(Math.max(breads, 1), 4);
    for (let i = 0; i < nb; i++) {
      if (i === 2) {                      // 第三只起换长棍面包
        const loaf = K.sphereLo({ color: shade(P.bread, -0.06), r: 0.42, seg: 1, jitter: 0.12, rng: r });
        K.scaleXYZ(loaf, 1.75, 0.62, 0.8);
        K.tilt(loaf, 0, r() * Math.PI, 0);
        g.add(K.put(loaf, BREAD_X[i], SHELF_Y[0] + 0.28, 0));
      } else {
        const loaf = K.sphereLo({ color: i % 2 ? shade(P.bread, 0.08) : P.bread, r: 0.48, seg: 1, jitter: 0.14, rng: r });
        K.scaleXYZ(loaf, 1, 0.66, 0.95);
        g.add(K.put(loaf, BREAD_X[i], SHELF_Y[0] + 0.33, (r() - 0.5) * 0.3));
      }
    }
    // 中层奶酪层：奶酪轮（顶面切色浅一档）+ 楔形切块（prism）+ 羊皮纸捆（捆绳一道）
    g.add(K.put(K.cyl({ color: P.cheese, r: 0.68, h: 0.5, seg: 8, family: 'wood' }), -1.3, SHELF_Y[1] + 0.36, 0.1));
    g.add(K.put(K.cyl({ color: shade(P.cheese, 0.12), r: 0.56, h: 0.06, seg: 8, family: 'wood' }), -1.3, SHELF_Y[1] + 0.64, 0.1));
    const wedge = K.prism({ color: shade(P.cheese, 0.04), size: [0.8, 0.55, 0.42], family: 'wood' });
    K.tilt(wedge, 0, 0.4, -0.05);
    g.add(K.put(wedge, -0.32, SHELF_Y[1] + 0.4, 0.05));
    const bundle = K.box({ color: P.parchment, size: [0.8, 0.42, 0.6], family: 'wood' });
    K.tilt(bundle, 0, 0.25, 0.04);
    g.add(K.put(bundle, 0.52, SHELF_Y[1] + 0.33, 0));
    g.add(K.put(K.box({ color: shade(P.rope, -0.05), size: [0.84, 0.1, 0.16], family: 'wood' }), 0.52, SHELF_Y[1] + 0.38, 0));
    // 罐：第一只坐中层右端，其余上顶层（P.clay 陶胎，微歪的窑烧感）
    const nj = Math.min(Math.max(jars, 0), 3);
    const TOP_JAR_X = [-1.3, -0.45];
    for (let i = 0; i < nj; i++) {
      const s = i === 0 ? 0.85 : 1;
      const jar = jarAt(i % 2 ? shade(P.clay, 0.07) : P.clay, s);
      K.tilt(jar, (r() - 0.5) * 0.05, 0, (r() - 0.5) * 0.05);
      g.add(K.put(jar, i === 0 ? 1.42 : TOP_JAR_X[i - 1], SHELF_Y[i === 0 ? 1 : 2] + 0.11, (r() - 0.5) * 0.3));
    }
    // 顶层药草束：三五茎平放（P.herb 深浅），捆绳缠腰一道（躺倒件走 K.aim）
    const stems = [];
    for (let i = 0; i < 3; i++) {
      const stem = K.cyl({ color: i % 2 ? P.herb : shade(P.herb, -0.16), r: 0.055, h: 0.9 + (i % 2) * 0.12, seg: 4, family: 'wood' });
      K.aim(stem, 1, 0.1, (i - 1) * 0.08);
      stems.push(stem);
      g.add(K.put(stem, 0.55 + (r() - 0.5) * 0.1, SHELF_Y[2] + 0.32 + i * 0.09, 0.05 + (r() - 0.5) * 0.12));
    }
    g.add(K.put(K.box({ color: shade(P.rope, -0.1), size: [0.12, 0.3, 0.22], family: 'wood' }), 0.62, SHELF_Y[2] + 0.42, 0.05));
    return g;
  },
};
