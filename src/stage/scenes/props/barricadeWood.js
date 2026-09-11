// 木拒马（CATALOG2 编号 54）：「交叉尖木+横档」——军事类 prop/floor（尖木/横档 wood + 捆扎丝箍 metal 双族）。
// 原点=底面中心；数副 X 交叉尖木桩（圆柱+锥尖）沿 x 排开（长 ~8）：桩脚前后撇开、
// 顶端斜指外撑，交叉处以铁丝箍捆扎（束紧接口读铁丝感）；顶部双横档圆木架在 X 口内，
// 低位再加一道锁脚横档；档上斜插一圈防御尖桩（外倾交错、高 ~4.5）。
// 变体走 build(opts)：桩架副数（2~4）/尖桩数（4~8）/桩脚撇角。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'barricadeWood',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'barrack'],
  footprint: { x: 8, z: 3.4 },
  behaviors: [],
  build({ frames = 3, spikes = 6, splay = 0.45, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('barricadeWood');
    const nf = Math.min(Math.max(frames, 2), 4);
    const ns = Math.min(Math.max(spikes, 4), 8);
    const sp = Math.min(Math.max(splay, 0.3), 0.6);
    const spacing = 2.7;
    const len = (nf - 1) * spacing + 2.4; // 横档总长（档端出头少许）
    // X 交叉尖木桩：每副两根对撇（圆柱+锥尖，顶端斜指），交叉点铁丝箍捆扎
    for (let f = 0; f < nf; f++) {
      const fx = (f - (nf - 1) / 2) * spacing;
      for (const s of [-1, 1]) {
        const pole = K.grp(
          K.put(K.cyl({ color: P.wood, r: 0.17, h: 3.0, seg: 5, family: 'wood' }), 0, 1.5, 0),
          K.put(K.cone({
            color: shade(P.wood, 0.12), r: 0.17, h: 0.5, seg: 5, family: 'wood',
          }), 0, 3.25, 0),
        );
        K.tilt(pole, -s * sp, 0, 0);
        g.add(K.put(pole, fx, 0.02, s * 1.15));
      }
      const wire = K.cyl({
        color: shade(P.iron, -0.12), r: 0.26, h: 1.05, seg: 5, family: 'metal',
      });
      K.tilt(wire, 0, 0, Math.PI / 2);
      g.add(K.put(wire, fx, 1.15 / Math.tan(sp), 0));
    }
    // 横档：顶部双档架在 X 口内（托住尖桩），低位一道锁脚档
    for (const [y, z] of [[3.02, 0.18], [3.02, -0.18], [1.5, 0]]) {
      const rail = K.cyl({ color: P.woodDark, r: 0.19, h: len, seg: 6, family: 'wood' });
      K.tilt(rail, 0, 0, Math.PI / 2);
      g.add(K.put(rail, 0, y, z));
    }
    // 防御尖桩：沿顶档等距斜插，左右外倾交错、微乱
    const halfw = len * 0.42;
    for (let i = 0; i < ns; i++) {
      const x = ns === 1 ? 0 : -halfw + (i * (halfw * 2)) / (ns - 1);
      const stake = K.grp(
        K.put(K.cyl({
          color: shade(P.wood, 0.08), r: 0.12, h: 0.9, seg: 5, family: 'wood',
        }), 0, 0.45, 0),
        K.put(K.cone({
          color: shade(P.wood, 0.2), r: 0.12, h: 0.5, seg: 5, family: 'wood',
        }), 0, 1.15, 0),
      );
      K.tilt(stake, 0, (r() - 0.5) * 0.3, (i % 2 ? 1 : -1) * (0.13 + r() * 0.1));
      g.add(K.put(stake, x, 3.02, (i % 2 ? 1 : -1) * 0.18));
    }
    return g;
  },
};
