// 交叉剑挂饰（CATALOG #80）：「双剑交叉钉墙，剑柄一高一低」——wallDecor（metal+stone 缠柄 双族）。
// 原点=墙面挂点（z=0 贴墙，+z 朝室内，同 wallTorch 约定）；band=mid；剑全长约 8。
// 剑体沿用 weaponRack 的剪影级语言（提亮剑刃+铁横格+缠柄+圆首），双剑前后分层贴墙
// 交错，柄端一低一高；交叉点与下柄位各一枚铁钉铆墙（「钉墙」，按实际倾角求交定位）。
// 变体走 build(opts)：剑数（2/3，第三剑近竖垫后）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 剪影级长剑（全长约 8，原点=柄端、轴 +y）：圆首 → 缠柄 → 横格 → 长刃 → 尖
function buildSword() {
  return K.grp(
    K.put(K.sphereLo({ color: shade(P.iron, -0.12), r: 0.24, seg: 0, family: 'metal' }), 0, 0.24, 0),
    K.put(K.cyl({ color: P.woodDark, r: 0.15, h: 1.1, seg: 5 }), 0, 1.03, 0),
    K.put(K.box({ color: P.iron, size: [1.0, 0.2, 0.24], family: 'metal' }), 0, 1.68, 0),
    K.put(K.box({ color: shade(P.iron, 0.3), size: [0.26, 5.3, 0.09], family: 'metal' }), 0, 4.48, 0),
    K.put(K.scaleXYZ(K.cone({ color: shade(P.iron, 0.3), r: 0.13, h: 0.8, seg: 4, family: 'metal' }), 1, 1, 0.35), 0, 7.53, 0),
  );
}

export default {
  id: 'crossedSwords',
  place: 'wallDecor',
  band: 'mid',
  tags: ['metal'],
  behaviors: [],
  build({ swords = 2, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('crossedSwords');
    // 主剑 A：柄低左、刃指右上（z 前层）；主剑 B：柄高右、刃指左上（z 后层）——柄一高一低
    const tA = -(0.55 + r() * 0.06);
    const tB = 0.62 + r() * 0.06;
    const ax = -1.95, ay = 0.75, bx = 2.05, by = 2.0;
    const a = buildSword();
    K.tilt(a, 0, 0, tA);
    g.add(K.put(a, ax, ay, 0.3));
    const b = buildSword();
    K.tilt(b, 0, 0, tB);
    g.add(K.put(b, bx, by, 0.16));
    // 铆钉：两剑轴线求交取交叉点钉一枚 + A 柄位钉一枚（钉头凸出前层剑面）
    const dAx = -Math.sin(tA), dAy = Math.cos(tA);
    const dBx = -Math.sin(tB), dBy = Math.cos(tB);
    const cross2 = (px, py, qx, qy) => px * qy - py * qx;
    const s = cross2(bx - ax, by - ay, dBx, dBy) / cross2(dAx, dAy, dBx, dBy);
    for (const t of [s, 0.9]) {
      g.add(K.put(K.tilt(K.cyl({ color: shade(P.iron, 0.1), r: 0.1, h: 0.16, seg: 6, family: 'metal' }), Math.PI / 2), ax + dAx * t, ay + dAy * t, 0.44));
    }
    // 第三剑（变体）：近竖垫后，缝隙里露出刃脊
    if (swords >= 3) {
      const c = buildSword();
      K.tilt(c, 0, 0, 0.08 + r() * 0.05);
      g.add(K.put(c, 0.15, 0.35, 0.04));
    }
    return g;
  },
};
