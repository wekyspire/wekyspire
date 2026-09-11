// 矛束（CATALOG2 编号 50）：「五六杆斜靠+绳捆」——军事类 prop/floor（矛杆 wood + 矛头 metal + 皮绳箍 cloth 三族）。
// 原点=底面中心；整束后仰斜靠（读作倚墙）：矛杆聚成小簇、各杆微错角外撇，杆高参差；
// 束身两三道皮绳紧箍（束紧感=箍圈收口 rTop 略小）；矛头=柳叶形扁锥（cone 压扁）+ 铁颚箍。
// 变体走 build(opts)：矛数（4~7）/绳箍道数（1~3）/后仰角。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 单杆长矛（剪影级，原点=杆底、轴 +y，全长约 7）：木杆 → 铁颚箍 → 压扁柳叶矛尖
function buildSpear(len) {
  const tip = K.cone({ color: shade(P.iron, 0.28), r: 0.2, h: 0.9, seg: 4, family: 'metal' });
  K.scaleXYZ(tip, 1, 1, 0.45);
  return K.grp(
    K.put(K.cyl({ color: P.wood, r: 0.09, h: len, seg: 5, family: 'wood' }), 0, len / 2, 0),
    K.put(K.cyl({ color: shade(P.iron, -0.1), r: 0.13, h: 0.26, seg: 5, family: 'metal' }), 0, len + 0.08, 0),
    K.put(tip, 0, len + 0.71, 0),
  );
}

export default {
  id: 'spearBundle',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'metal', 'barrack'],
  footprint: { x: 2.2, z: 3.4 },
  behaviors: [],
  build({ spears = 6, wraps = 2, lean = 0.36, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('spearBundle');
    const bundle = new THREE.Group();
    const n = Math.min(Math.max(spears, 4), 7);
    // 矛杆小簇：环形布位 + 各杆向外微撇（读作随手斜靠的一捆），杆高参差
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.4;
      const rr = 0.28 + (i % 2) * 0.1;
      const sp = buildSpear(5.7 + r() * 0.5);
      K.tilt(sp,
        Math.sin(a) * 0.035 + (r() - 0.5) * 0.02, 0,
        -Math.cos(a) * 0.035 + (r() - 0.5) * 0.02);
      bundle.add(K.put(sp, Math.cos(a) * rr, 0, Math.sin(a) * rr));
    }
    // 皮绳紧箍：束身一至三道收口箍（rTop 收小读作勒紧），深浅交替绳股感
    const nw = Math.min(Math.max(wraps, 1), 3);
    const ys = [2.85, 3.3, 3.7];
    for (let i = 0; i < nw; i++) {
      const wrap = K.cyl({
        color: shade(P.rope, i % 2 ? -0.06 : 0),
        r: 0.56, rTop: 0.5, h: 0.22, seg: 6, family: 'cloth',
      });
      K.jitter(wrap, r, { rot: 0.015 });
      bundle.add(K.put(wrap, 0, ys[3 - nw + i], 0));
    }
    // 整束后仰：绕 x 轴倒向 -z（顶端斜靠、杆底翘起少许由垫高吸收）
    K.tilt(bundle, -Math.min(Math.max(lean, 0.2), 0.5), 0, 0);
    g.add(K.put(bundle, 0, 0.16, 0.45));
    return g;
  },
};
