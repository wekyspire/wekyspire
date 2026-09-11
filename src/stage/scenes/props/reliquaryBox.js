// 圣物匣（CATALOG2 编号 32）：「小匣+拱盖+锁片」——容器类 prop/floor（wood 匣体 + metal 箍带锁片 + unlit 锁孔 三族）。
// 原点=底面中心（y=0 落地）；拱盖=横卧圆柱半露匣口（闭合态，同宝箱拱盖语汇），
// 锁片/盖钮走 P.gold 冷金读作圣器鎏金件。变体走 build(opts)：弧箍数 straps/盖钮 knob 有无。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'reliquaryBox',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'metal', 'chapel'],
  footprint: { x: 1.5, z: 1.1 },
  behaviors: [],
  build({ straps = 2, knob = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('reliquaryBox');
    const w = 1.15, hB = 0.52, d = 0.82, R = 0.42;
    // 四矮脚 + 匣身
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      g.add(K.put(K.box({ color: P.woodDark, size: [0.18, 0.1, 0.16], family: 'wood' }), sx * (w / 2 - 0.18), 0.05, sz * (d / 2 - 0.16)));
    }
    const body = K.box({ color: P.wood, size: [w, hB, d], family: 'wood' });
    K.jitter(body, r, { rot: 0.012 });
    g.add(K.put(body, 0, 0.1 + hB / 2, 0));
    const top = 0.1 + hB;
    // 拱盖：横卧圆柱半露匣口（闭合拱盖）
    const dome = K.cyl({ color: shade(P.wood, 0.05), r: R, h: w + 0.06, seg: 8, family: 'wood' });
    K.tilt(dome, 0, 0, Math.PI / 2);
    g.add(K.put(dome, 0, top, 0));
    // 弧面箍带：横环骑在拱面上（与拱盖同轴的短粗环）
    const ns = Math.min(Math.max(straps, 0), 2);
    for (let i = 0; i < ns; i++) {
      const band = K.cyl({ color: shade(P.iron, -0.04), r: R + 0.03, h: 0.12, seg: 8, family: 'metal' });
      K.tilt(band, 0, 0, Math.PI / 2);
      g.add(K.put(band, (i === 0 ? -1 : 1) * (w / 2 - 0.28), top, 0));
    }
    // 锁片：跨盖缝的鎏金片 + 锁孔（unlit 读作透空）
    g.add(K.put(K.box({
      color: shade(P.gold, -0.05), size: [0.46, 0.36, 0.07], family: 'metal',
    }), 0, top - 0.12, d / 2 + 0.02));
    g.add(K.put(K.box({
      color: P.night, size: [0.09, 0.15, 0.04], family: 'unlit',
    }), 0, top - 0.1, d / 2 + 0.06));
    // 盖钮：拱顶小鎏金钮
    if (knob) {
      g.add(K.put(K.cyl({
        color: P.gold, r: 0.09, rTop: 0.12, h: 0.12, seg: 6, family: 'metal',
      }), 0, top + R + 0.05, 0));
    }
    return g;
  },
};
