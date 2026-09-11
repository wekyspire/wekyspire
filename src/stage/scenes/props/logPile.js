// 柴堆（CATALOG2 编号 88）：「码放圆木垛+树皮茬」——prop/floor（wood 单族）。
// 码放语言同 crateStack：三层金字塔圆木垛（默认 7/6/5 根，上层落下层沟谷），
// 圆木=侧放六棱短柱（树皮深浅交替、微收梢）+ 外露端浅色砍切面 + 断枝残茬；
// 根根微错位读作手码。原点=底面中心（y=0 落地）；约 4×2、垛高 1.5（M 档）。
// 变体走 build(opts)：底行根数/层数/切面密度/残茬数。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

const LOG_R = 0.28;

// 单根圆木：局部轴沿 y，组外整体躺倒向 z；含可选两端砍切面与断枝茬
function log(len, capL, capR, stub, dk) {
  const lg = new THREE.Group();
  lg.add(K.cyl({ color: shade(P.wood, dk), r: LOG_R, rTop: LOG_R * 0.94, h: len, seg: 6, family: 'wood' }));
  if (capL) lg.add(K.put(K.cyl({ color: shade(P.wood, 0.28), r: LOG_R * 0.8, h: 0.07, seg: 6, family: 'wood' }), 0, -len / 2 + 0.02, 0));
  if (capR) lg.add(K.put(K.cyl({ color: shade(P.wood, 0.24), r: LOG_R * 0.86, h: 0.07, seg: 6, family: 'wood' }), 0, len / 2 - 0.02, 0));
  if (stub) { // 树皮茬：粗端旁斜出的断枝残茬（深色短锥）
    const st = K.cyl({ color: P.woodDark, r: 0.09, rTop: 0.05, h: 0.34, seg: 5, family: 'wood' });
    K.tilt(st, 0.5, 0, 0.35);
    lg.add(K.put(st, 0.12, len / 2 - 0.05, 0.1));
  }
  return lg;
}

export default {
  id: 'logPile',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'kitchen'],
  footprint: { x: 4.3, z: 2.4 },
  behaviors: [],
  build({ baseRows = 7, layers = 3, capRate = 0.8, stubs = 3, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('logPile');
    const base = Math.max(4, Math.min(8, baseRows));
    const ln = Math.max(2, Math.min(3, layers));
    const step = LOG_R * 2 + 0.015; // 相邻圆木贴靠步距
    let stubLeft = Math.max(0, Math.min(5, stubs));
    for (let L = 0; L < ln; L++) {
      const count = base - L; // 金字塔：每层少一根
      const y = LOG_R + L * LOG_R * 1.732; // 沟谷堆叠抬升（√3·r）
      for (let i = 0; i < count; i++) {
        const x = (i - (count - 1) / 2) * step;
        const outer = Math.abs(x) > step * 1.5; // 切面/残茬只落外露列
        const wantStub = outer && stubLeft > 0 && r() < 0.4;
        if (wantStub) stubLeft--;
        const lg = log(
          2.0 + (r() - 0.5) * 0.3, // 木段长短略差
          outer && r() < capRate * 0.5, // 里端切面少给（多被遮挡）
          outer && r() < capRate, // 外端（观众侧）切面多给
          wantStub,
          (i % 2 ? -0.07 : 0.04) + L * 0.02,
        );
        K.tilt(lg, Math.PI / 2, 0, 0); // 轴躺向 z
        K.put(lg, x, y, (r() - 0.5) * 0.06);
        K.jitter(lg, r, { pos: 0.02, rot: 0.02 }); // 手码微错位（落位后抖）
        g.add(lg);
      }
    }
    return g;
  },
};
