// 地刺排（CATALOG2 编号 55）：「斜埋尖桩一排」——监牢军事类 prop（纯 wood 单族）。
// 原点=底面中心（y=0 落地），x=长 z=深：半埋枕木一根作栽植基座，尖桩（收尖圆柱）
// 间隔斜插其上一律向 +z 前倾（阵面朝前），另有断桩（短茬+劈裂）与拔弃倒落的散桩。
// 变体走 build(opts)：尖桩数 spikes / 前倾角 lean / 断桩数 broken / 散桩数 fallen。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'spikesGround',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'prison'],
  footprint: { x: 6.4, z: 3.4 },
  behaviors: [],
  build({ spikes = 5, lean = 0.5, broken = 1, fallen = 1, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('spikesGround');
    // 半埋枕木：尖桩的栽植基座（顶面微露地面，整排微偏转）
    const sleeper = K.box({ color: P.woodDark, size: [5.6, 0.5, 0.7], family: 'wood' });
    K.tilt(sleeper, 0, (r() - 0.5) * 0.06, 0);
    g.add(K.put(sleeper, 0, 0.16, 0));
    // 尖桩一排：收尖圆柱（rTop 近零读作削尖），前倾一致、高低左右微差；断桩=短茬劈裂
    const n = Math.max(2, spikes);
    let brokenLeft = Math.max(0, broken);
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * (5.0 / Math.max(1, n - 1));
      const isBroken = brokenLeft > 0 && i % 3 === 1;
      if (isBroken) brokenLeft--;
      const h = isBroken ? 1.1 + r() * 0.3 : 3.4 + r() * 0.6;
      const stake = K.cyl({
        color: isBroken ? shade(P.woodDark, 0.08) : (i % 2 ? P.wood : shade(P.wood, 0.07)),
        r: 0.26 + r() * 0.04, rTop: 0.05, h, seg: 5, family: 'wood',
      });
      if (isBroken) K.chip(stake, { corner: [1, 1, 1], amount: 0.18 }); // 断口劈裂斜茬
      K.tilt(stake, lean + (r() - 0.5) * 0.08, r() * Math.PI * 2, (r() - 0.5) * 0.1);
      g.add(K.put(stake, x, 0.3 + (h / 2) * Math.cos(lean), 0.1 + (h / 2) * Math.sin(lean)));
    }
    // 倒落散桩：拔出后弃置一旁的整桩，平躺微斜（quaternion 对向，基本沿 x 向不越阵）
    for (let i = 0; i < fallen; i++) {
      const f = K.cyl({
        color: shade(P.wood, -0.05), r: 0.24, rTop: 0.05, h: 3.1 + r() * 0.5, seg: 5, family: 'wood',
      });
      const phi = (r() - 0.5) * 0.8;
      f.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(Math.cos(phi), 0.06, -Math.sin(phi)).normalize(),
      );
      g.add(K.put(f, -2.0 + i * 3.9 + (r() - 0.5) * 0.5, 0.24, -0.7 - r() * 0.3));
    }
    return g;
  },
};
