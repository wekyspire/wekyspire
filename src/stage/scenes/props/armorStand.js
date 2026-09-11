// 甲胄架（CATALOG #42）：「半身甲+立剑的木架」——prop 类（木架 stone + 铁甲 metal + 甲口 unlit 三族）。
// 原点=底面中心（y=0 落地），x=宽 z=深；十字脚木 + 立杆 + 双臂托撑半身胸甲，架侧立一柄长剑。
// 甲胄/长剑为剪影级 lowpoly（几段 cyl/sphereLo/box 组合，不做雕刻）。
// 变体走 build(opts)：立剑有无/肩甲数。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'armorStand',
  place: 'prop',
  mount: 'floor',
  tags: ['metal'],
  footprint: { x: 3, z: 3 },
  behaviors: [],
  build({ sword = true, pauldrons = 2, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('armorStand');
    // 十字脚木：两根枕木微错角，承中央立杆
    const footA = K.tilt(K.box({ color: P.woodDark, size: [2.7, 0.26, 0.5] }), 0, 0.2, 0);
    g.add(K.put(footA, 0, 0.13, 0));
    const footB = K.tilt(K.box({ color: P.woodDark, size: [0.5, 0.26, 2.7] }), 0, -0.15, 0);
    g.add(K.put(footB, 0, 0.13, 0));
    // 立杆 + 双臂托 + 杆头圆首
    g.add(K.put(K.cyl({ color: P.wood, r: 0.17, rTop: 0.13, h: 4.9, seg: 6 }), 0, 2.71, 0));
    const fork = K.box({ color: P.woodDark, size: [2.05, 0.18, 0.3] });
    K.jitter(fork, r, { rot: 0.008 }); // 托臂微错位的手工感
    g.add(K.put(fork, 0, 2.66, 0));
    g.add(K.put(K.sphereLo({ color: shade(P.wood, 0.15), r: 0.2, seg: 0 }), 0, 5.28, 0));
    // 半身胸甲：桶身收肩 + 领口收边 + 前脊棱 + 领口暗腔（unlit 夜色读作空甲内腔）
    const chest = K.cyl({ color: P.iron, r: 0.66, rTop: 0.56, h: 1.55, seg: 7, family: 'metal' });
    K.jitter(chest, r, { rot: 0.01 }); // 挂甲微歪
    g.add(K.put(chest, 0, 3.525, 0));
    g.add(K.put(K.cyl({ color: shade(P.iron, 0.1), r: 0.58, rTop: 0.46, h: 0.22, seg: 7, family: 'metal' }), 0, 4.41, 0));
    g.add(K.put(K.box({ color: shade(P.iron, 0.22), size: [0.14, 1.3, 0.1], family: 'metal' }), 0, 3.5, 0.64));
    g.add(K.put(K.cyl({ color: P.night, r: 0.3, h: 0.08, seg: 7, family: 'unlit' }), 0, 4.56, 0));
    // 肩甲：两侧压扁圆球、外倾扣肩（pauldrons 可 0/1/2）
    for (let i = 0; i < Math.min(pauldrons, 2); i++) {
      const s = i ? 1 : -1;
      const pd = K.sphereLo({ color: shade(P.iron, 0.14), r: 0.46, seg: 0, family: 'metal' });
      K.scaleXYZ(pd, 1.2, 0.62, 1.05);
      K.tilt(pd, 0, 0, s * 0.18);
      K.jitter(pd, r, { rot: 0.03 });
      g.add(K.put(pd, s * 0.76, 4.35, 0));
    }
    // 立剑：架侧一柄提亮长剑（剑首抵地、剑尖朝天，微向外倚开肩甲）
    if (sword) {
      const sw = K.grp(
        K.put(K.sphereLo({ color: shade(P.iron, -0.12), r: 0.15, seg: 0, family: 'metal' }), 0, 0.15, 0),
        K.put(K.cyl({ color: P.woodDark, r: 0.1, h: 0.67, seg: 5 }), 0, 0.61, 0),
        K.put(K.box({ color: P.iron, size: [0.7, 0.15, 0.2], family: 'metal' }), 0, 1.02, 0),
        K.put(K.box({ color: shade(P.iron, 0.3), size: [0.17, 2.9, 0.07], family: 'metal' }), 0, 2.5, 0),
        K.put(K.scaleXYZ(K.cone({ color: shade(P.iron, 0.3), r: 0.085, h: 0.4, seg: 4, family: 'metal' }), 1, 1, 0.4), 0, 4.15, 0),
      );
      K.tilt(sw, 0, -0.15, 0.04);
      g.add(K.put(sw, -1.3, 0, 0.5));
    }
    return g;
  },
};
