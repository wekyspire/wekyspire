// 征战浮雕板（CATALOG #62）：「骑士征战场面高浮雕，人物层叠」——wallStructure 类（纯 stone 单族）。
// 原点=墙脚挂点（z=0 贴墙面，+z 朝室内，同 pilasterHalf）；占 2 墙段（bayWidth:2），
// 板高 ~14 宽 ~10。人物剪影三层叠压：底层压暗长矛军阵、中层持盾步兵、前层跃马骑士提剑
// （shade 分层拉层次：前层亮、底层暗）。变体走 build(opts)：layers（人物层数 1~3）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'reliefBattle',
  place: 'wallStructure',
  bayWidth: 2,
  tags: ['stone', 'relief'],
  behaviors: [],
  build({ layers = 3, rng } = {}) {
    const g = new THREE.Group();
    // 底座 + 画面板 + 三边框（顶与左右，底由底座收边）
    g.add(K.put(K.box({ color: shade(P.stone, -0.12), size: [10.4, 1.3, 1.15] }), 0, 0.65, 0.575));
    g.add(K.put(K.box({ color: shade(P.stone, -0.06), size: [10, 14, 0.7] }), 0, 8.3, 0.35));
    g.add(K.put(K.box({ color: shade(P.stone, 0.05), size: [0.75, 14, 0.95] }), -4.625, 8.3, 0.475));
    g.add(K.put(K.box({ color: shade(P.stone, 0.05), size: [0.75, 14, 0.95] }), 4.625, 8.3, 0.475));
    g.add(K.put(K.box({ color: shade(P.stone, 0.05), size: [10, 0.75, 0.95] }), 0, 14.925, 0.475));
    // 战场地平线（亮棱，全员的落脚线）
    g.add(K.put(K.box({ color: shade(P.stone, 0.16), size: [8.5, 0.35, 0.75] }), 0, 2.4, 0.5));

    // 底层：远处矛兵军阵（最暗、最薄，衬出纵深）
    if (layers >= 3) {
      for (const [x, s] of [[-4.1, 1], [-1.9, -1], [1.1, 1]]) {
        g.add(K.put(K.box({ color: shade(P.stone, -0.3), size: [0.8, 2.7, 0.3] }), x, 3.75, 0.85));
        g.add(K.put(K.box({ color: shade(P.stone, -0.3), size: [0.45, 0.5, 0.3] }), x, 5.35, 0.85));
        const spear = K.box({ color: shade(P.stone, -0.24), size: [0.13, 5.8, 0.13] });
        K.tilt(spear, 0, 0, 0.07 * s);
        if (rng) K.jitter(spear, rng, { rot: 0.02 });
        g.add(K.put(spear, x + 0.35 * s, 5.3, 0.85));
      }
    }

    // 中层：持盾步兵两名（对向而立，盾前矛斜）
    if (layers >= 2) {
      for (const [x, s] of [[-2.9, 1], [2.3, -1]]) {
        g.add(K.put(K.box({ color: shade(P.stone, -0.12), size: [1.05, 3.3, 0.45] }), x, 4.05, 1.1));
        g.add(K.put(K.box({ color: shade(P.stone, -0.1), size: [0.55, 0.6, 0.45] }), x, 6.0, 1.1));
        const shield = K.cyl({ color: shade(P.stone, -0.04), r: 0.85, h: 0.22, seg: 7 });
        g.add(K.put(K.tilt(shield, Math.PI / 2), x + 0.8 * s, 4.4, 1.35));
        const spear = K.box({ color: shade(P.stone, -0.2), size: [0.15, 6.4, 0.15] });
        K.tilt(spear, 0, 0, -0.18 * s);
        g.add(K.put(spear, x - 0.45 * s, 5.6, 1.15));
      }
    }

    // 前层（最亮、最厚）：跃马骑士，提剑过顶
    const hi = shade(P.stone, 0.1);
    g.add(K.put(K.box({ color: hi, size: [3.1, 1.5, 1.15] }), 0.9, 3.55, 1.35)); // 马身
    for (const dx of [-1.15, 1.15]) {
      for (const dz of [-0.35, 0.35]) {
        g.add(K.put(K.box({ color: shade(hi, -0.06), size: [0.38, 1.0, 0.38] }), 0.9 + dx, 2.9, 1.35 + dz));
      }
    }
    const neck = K.box({ color: hi, size: [0.55, 1.5, 0.65] });
    K.tilt(neck, 0, 0, -0.5);
    g.add(K.put(neck, 2.2, 4.8, 1.35));
    g.add(K.put(K.box({ color: hi, size: [0.95, 0.5, 0.55] }), 2.95, 5.3, 1.35)); // 马首
    g.add(K.put(K.box({ color: shade(hi, 0.05), size: [0.95, 1.7, 0.75] }), 0.9, 5.15, 1.35)); // 骑士躯干
    g.add(K.put(K.box({ color: shade(hi, 0.08), size: [0.5, 0.55, 0.5] }), 0.9, 6.28, 1.35)); // 骑士首
    const sword = K.box({ color: shade(hi, 0.12), size: [0.18, 2.8, 0.18] });
    K.tilt(sword, 0, 0, 0.55);
    if (rng) K.jitter(sword, rng, { rot: 0.03 });
    g.add(K.put(sword, 1.85, 6.9, 1.45));
    // 马蹄下倒伏者 + 落地圆盾（暗层，衬前景高差）
    g.add(K.put(K.box({ color: shade(P.stone, -0.22), size: [2.1, 0.55, 0.6] }), -1.7, 2.65, 1.0));
    g.add(K.put(K.box({ color: shade(P.stone, -0.22), size: [0.45, 0.45, 0.5] }), -0.45, 2.6, 1.0));
    const dropShield = K.cyl({ color: shade(P.stone, -0.18), r: 0.7, h: 0.12, seg: 7 });
    g.add(K.put(K.tilt(dropShield, Math.PI / 2), -1.6, 2.55, 1.1));
    return g;
  },
};
