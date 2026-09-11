// 宝箱（CATALOG #43）：「铁箍木箱半开，金币溢缘」——prop 类（wood 箱体 + metal 铁箍金币 + unlit 箱腔 三族）。
// 原点=底面中心（y=0 落地）；盖=横卧圆拱绕箱背顶缘铰链掀起（open=掀角弧度，0 即闭合）。
// 变体走 build(opts)：掀角/堆内金币数/洒落金币数。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 金币（薄圆柱，metal 族走 P.gold 冷金；倾斜随机由 r 驱动）
function coin(r) {
  const c = K.cyl({ color: P.gold, r: 0.15, h: 0.07, seg: 6, family: 'metal' });
  K.tilt(c, r() * 0.5, r() * Math.PI, r() * 0.5);
  return c;
}

export default {
  id: 'chestTreasure',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'container'],
  footprint: { x: 2.8, z: 3.0 },
  behaviors: [],
  build({ open = 1.22, coins = 3, spill = 3, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('chestTreasure');
    const w = 2.6, hB = 1.5, d = 1.9, R = 0.95;        // 箱宽/箱身/箱深/拱盖半径
    // 垫脚 + 箱身
    for (const s of [-1, 1]) {
      g.add(K.put(K.box({ color: P.woodDark, size: [0.6, 0.22, d * 0.7] }), s * (w / 2 - 0.5), 0.11, 0));
    }
    const body = K.box({ color: P.wood, size: [w, hB, d] });
    K.jitter(body, r, { rot: 0.01 });
    g.add(K.put(body, 0, 0.22 + hB / 2, 0));
    const top = 0.22 + hB;                             // 箱口高度
    // 箱腔：口内暗盘（unlit 夜色读作空箱内壁）
    g.add(K.put(K.box({
      color: P.night, size: [w - 0.5, 0.14, d - 0.5], family: 'unlit',
    }), 0, top + 0.07, 0));
    // 铁箍：前后各两道竖箍
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      g.add(K.put(K.box({
        color: P.iron, size: [0.26, hB, 0.09], family: 'metal',
      }), sx * (w / 2 - 0.55), 0.22 + hB / 2, sz * (d / 2 + 0.03)));
    }
    // 金币堆：压扁金丘 + 堆顶散币 + 溢缘一枚 + 箱前洒落
    const heap = K.sphereLo({ color: shade(P.gold, -0.06), r: 0.72, jitter: 0.12, rng: r, family: 'metal' });
    K.scaleXYZ(heap, 1.15, 0.55, 0.85);
    g.add(K.put(heap, 0, top + 0.16, 0.18));
    for (let i = 0; i < coins; i++) {
      g.add(K.put(coin(r), -0.55 + i * 0.55 + (r() - 0.5) * 0.2, top + 0.5 + r() * 0.1, 0.1 + r() * 0.3));
    }
    g.add(K.put(coin(r), -0.55, top + 0.05, d / 2 - 0.02));   // 溢缘：卡在箱口前缘
    for (let i = 0; i < spill; i++) {
      g.add(K.put(coin(r), -0.7 + i * 0.6 + (r() - 0.5) * 0.3, 0.06, d / 2 + 0.45 + r() * 0.55));
    }
    // 拱盖：横卧圆柱绕背缘铰链掀起（闭合位拱心=箱口中心；掀角 open，前缘上抬）
    const lid = new THREE.Group();
    const dome = K.cyl({ color: P.wood, r: R, h: w + 0.1, seg: 9 });
    K.tilt(dome, 0, 0, Math.PI / 2);                   // 轴线 y→x 横躺
    lid.add(K.put(dome, 0, 0, d / 2));
    for (const s of [-1, 1]) {                         // 拱端铁箍带
      const band = K.cyl({ color: shade(P.iron, -0.05), r: R + 0.03, h: 0.2, seg: 9, family: 'metal' });
      K.tilt(band, 0, 0, Math.PI / 2);
      lid.add(K.put(band, s * (w / 2 - 0.35), 0, d / 2));
    }
    K.tilt(lid, -open, 0, 0);
    g.add(K.put(lid, 0, top, -d / 2));
    return g;
  },
};
