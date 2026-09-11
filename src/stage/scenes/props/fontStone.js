// 洗礼盆（CATALOG2 编号 60）：「立柱盆+静水片」——圣所家具 prop（stone+glass 双族）。
// 原点=底面中心（y=0 落地），x=z=径向：两级阶座 + 七棱收分立柱（中箍一道）+ 敞口盆
// （收张盆体 + 外翻盆沿，沿口 chip 读作磕缺）；静水=玻璃族 P.water 薄片（puddleWater
// 同语汇：低粗糙半透明自带微反光），满盛时水面微低于沿口。变体走 build(opts)：
// 水位 level / 有水 fill / 沿口磕缺 chipped。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'fontStone',
  place: 'prop',
  mount: 'floor',
  tags: ['stone', 'chapel'],
  footprint: { x: 3.4, z: 3.4 },
  behaviors: [],
  build({ level = 0.06, fill = true, chipped = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('fontStone');
    // 两级阶座 + 七棱收分立柱 + 中箍
    g.add(K.put(K.box({ color: shade(P.stone, -0.1), size: [2.5, 0.4, 2.5], family: 'stone' }), 0, 0.2, 0));
    g.add(K.put(K.box({ color: P.stone, size: [2.05, 0.35, 2.05], family: 'stone' }), 0, 0.575, 0));
    const shaft = K.cyl({ color: shade(P.stone, 0.02), r: 0.6, rTop: 0.48, h: 1.9, seg: 7, family: 'stone' });
    K.tilt(shaft, 0, r() * 0.1, 0); // 七棱朝向微偏（手工感）
    if (rng) K.jitter(shaft, r, { rot: 0.008 });
    g.add(K.put(shaft, 0, 1.7, 0));
    g.add(K.put(K.cyl({ color: shade(P.stone, -0.06), r: 0.66, h: 0.18, seg: 7, family: 'stone' }), 0, 1.68, 0));
    // 敞口盆：收张盆体（底窄口阔）+ 外翻盆沿（磕缺一角）
    const cup = K.cyl({ color: P.stone, r: 0.8, rTop: 1.5, h: 1.05, seg: 8, family: 'stone' });
    K.tilt(cup, 0, shaft.rotation.y * 0.5, 0);
    g.add(K.put(cup, 0, 3.175, 0));
    const rim = K.cyl({ color: shade(P.stone, 0.08), r: 1.62, rTop: 1.55, h: 0.24, seg: 8, family: 'stone' });
    if (chipped) K.chip(rim, { corner: [1, 1, 1], amount: 0.22 }); // 沿口磕缺
    g.add(K.put(rim, 0, 3.82, 0));
    // 静水片：盆内满盛（微低于沿口）；干涸变体换压暗湿底薄片
    if (fill) {
      const water = K.cyl({
        color: shade(P.water, 0.16), r: 1.38, h: 0.1, seg: 8, family: 'glass',
      });
      K.tilt(water, 0, r() * 0.4, 0);
      g.add(K.put(water, 0, 3.74 + level, 0));
    } else {
      g.add(K.put(K.cyl({
        color: shade(P.water, -0.42), r: 1.3, h: 0.06, seg: 8, family: 'glass',
      }), 0, 3.73, 0));
    }
    return g;
  },
};
