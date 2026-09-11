// 高背椅（CATALOG #28）：「雕花木椅，椅背高耸」——家具类 prop（纯 wood 单族）。
// 原点=底面中心（y=0 落地），x=宽 z=深；座高约 2.4，后腿通顶成背柱（总高约 7.4），
// 雕花=背板菱花钉 + 柱顶尖饰。变体走 build(opts)：背高 / 是否带雕花。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'chairHighback',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'furniture'],
  footprint: { x: 2.4, z: 2.1 },
  behaviors: [],
  build({ backH = 7.2, carved = true, rng } = {}) {
    const g = new THREE.Group();
    // 座面 + 前腿（后腿即背柱，见下）
    g.add(K.put(K.box({ color: P.wood, size: [2.1, 0.28, 1.9], family: 'wood' }), 0, 2.28, 0));
    for (const sx of [-1, 1]) {
      const leg = K.box({ color: P.woodDark, size: [0.3, 2.28, 0.3], family: 'wood' });
      if (rng) K.jitter(leg, rng, { rot: 0.012 });
      g.add(K.put(leg, sx * 0.72, 1.14, 0.62));
    }
    // 高背：后腿通顶成背柱 + 顶冠板 + 柱顶尖饰（高耸收束）
    for (const sx of [-1, 1]) {
      const stile = K.box({ color: P.woodDark, size: [0.34, backH, 0.36], family: 'wood' });
      if (rng) K.jitter(stile, rng, { rot: 0.008 });
      g.add(K.put(stile, sx * 0.72, backH / 2, -0.62));
      g.add(K.put(K.cone({ color: shade(P.woodDark, 0.12), r: 0.12, h: 0.26, seg: 5, family: 'wood' }), sx * 0.72, backH + 0.13, -0.62));
    }
    g.add(K.put(K.box({ color: shade(P.woodDark, 0.08), size: [1.86, 0.45, 0.36], family: 'wood' }), 0, backH - 0.22, -0.62));
    // 背板竖棂三根（自座面直上顶冠）
    const slatH = backH - 2.92;
    for (const x of [-0.42, 0, 0.42]) {
      g.add(K.put(K.box({ color: P.wood, size: [0.22, slatH, 0.13], family: 'wood' }), x, 2.42 + slatH / 2, -0.62));
    }
    // 雕花：棂上一列菱花钉 + 中央菱花章（45° 方块斜贴读作雕花）
    if (carved) {
      for (const x of [-0.42, 0, 0.42]) {
        const stud = K.box({ color: shade(P.woodDark, 0.14), size: [0.26, 0.26, 0.1], family: 'wood' });
        K.tilt(stud, 0, 0, Math.PI / 4);
        g.add(K.put(stud, x, backH - 1.5, -0.53));
      }
      const sigil = K.box({ color: shade(P.woodDark, 0.14), size: [0.34, 0.34, 0.1], family: 'wood' });
      K.tilt(sigil, 0, 0, Math.PI / 4);
      g.add(K.put(sigil, 0, 4.6, -0.53));
    }
    // 扶手：前撑柱 + 横扶杆（背柱到前腿上方）
    for (const sx of [-1, 1]) {
      g.add(K.put(K.box({ color: P.wood, size: [0.15, 1.16, 0.15], family: 'wood' }), sx * 0.72, 2.9, 0.6));
      g.add(K.put(K.box({ color: shade(P.wood, -0.04), size: [0.18, 0.14, 1.4], family: 'wood' }), sx * 0.72, 3.52, -0.02));
    }
    return g;
  },
};
