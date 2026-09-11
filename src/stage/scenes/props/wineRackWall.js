// 壁挂酒架（CATALOG2 编号 107）：「格内卧瓶+漏滴」——wallDecor 低带挂件（wood+glass 双族）。
// 原点=墙面挂点（z=0 贴墙，+z 朝室内；band=low 主体在正 y 近原点，板底近 y=0，同 hooksRope 口径）：
// 背板+双侧框+底横档，三层搁板各配前挡条与中隔竖条分出格位；格内卧瓶=横放 lathe
// （同 bottleRack 倒瓶写法，rz 90° 轴向 x、瓶口朝外），瓶色 P.wine 深浅轮换；
// 最上层一瓶渗漏——瓶口垂滴锥+半空滴珠+下层搁板酒渍（漏滴）。整体 ~4.1 宽 × ~3.5 高。
// 变体走 build(opts)：瓶数 bottles（2~6）/漏滴有无 drip。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 酒瓶轮廓（lathe profile：底→圆肚→收肩→长颈→瓶口），轴向长约 1.5、肚径 0.52
const BOTTLE = [
  [0.04, 0], [0.2, 0.04], [0.26, 0.3], [0.26, 0.62],
  [0.13, 0.9], [0.11, 1.25], [0.15, 1.3],
];

// 卧瓶：横放 lathe（rz 转轴贴 x 向、微垂头），dir=瓶口朝向（-1 左 / +1 右）
function lyingBottle(r, tone, dir) {
  const b = K.lathe({ color: tone, profile: BOTTLE, seg: 7, family: 'glass' });
  K.scaleXYZ(b, 1, 1.15, 1);
  K.tilt(b, 0, 0, dir * (Math.PI / 2 - 0.04));
  K.jitter(b, r, { rot: 0.02 });
  return b;
}

export default {
  id: 'wineRackWall',
  place: 'wallDecor',
  band: 'low',
  tags: ['wood', 'kitchen'],
  behaviors: [],
  build({ bottles = 4, drip = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('wineRackWall');
    // 背板 + 双侧框 + 底横档
    g.add(K.put(K.box({ color: P.wood, size: [4.1, 3.5, 0.14], family: 'wood' }), 0, 2.0, 0.07));
    for (const sx of [-1, 1]) {
      g.add(K.put(K.box({ color: shade(P.woodDark, 0.05), size: [0.26, 3.5, 0.9], family: 'wood' }), sx * 2.0, 2.0, 0.48));
    }
    g.add(K.put(K.box({ color: shade(P.woodDark, 0.02), size: [4.1, 0.26, 0.9], family: 'wood' }), 0, 0.3, 0.5));
    // 三层格位：搁板 + 前挡条 + 中隔竖条（每层两格）
    const rows = [0.75, 1.75, 2.75];
    for (const y of rows) {
      g.add(K.put(K.box({ color: shade(P.wood, -0.06), size: [3.8, 0.2, 0.95], family: 'wood' }), 0, y, 0.5));
      g.add(K.put(K.box({ color: P.woodDark, size: [3.8, 0.3, 0.16], family: 'wood' }), 0, y + 0.22, 0.95));
      g.add(K.put(K.box({ color: shade(P.woodDark, 0.02), size: [0.16, 0.68, 0.8], family: 'wood' }), 0, y + 0.38, 0.46));
    }
    // 卧瓶：自下层往上、每层两格填放（瓶口朝外左右交替），瓶肚半径 ~0.26 垫在搁板上
    const tones = [P.wine, shade(P.wine, 0.08), shade(P.wine, -0.1)];
    const nb = Math.min(Math.max(bottles, 2), 6);
    let leak = null;                              // 记录最后一只瓶（最上层）作漏滴源
    for (let i = 0; i < nb; i++) {
      const rowY = rows[Math.min(Math.floor(i / 2), 2)];
      const slot = i % 2;
      const x = slot ? 0.95 : -0.95;
      const dir = slot ? 1 : -1;                  // 瓶口朝外（左格朝左、右格朝右）
      const b = lyingBottle(r, tones[i % 3], dir);
      g.add(K.put(b, x + (r() - 0.5) * 0.1, rowY + 0.37, 0.45));
      if (i === nb - 1) leak = { mouthX: x + dir * 0.75, cy: rowY + 0.37, rowY };
    }
    // 漏滴：瓶口垂滴锥（尖朝下）+ 半空滴珠 + 下方落点酒渍
    if (drip && leak) {
      const stainY = leak.rowY > 1 ? leak.rowY - 0.9 : 0.45;
      const drop = K.cone({ color: shade(P.wine, 0.12), r: 0.09, h: 0.3, seg: 5, family: 'glass' });
      K.tilt(drop, 0, 0, Math.PI);
      g.add(K.put(drop, leak.mouthX, leak.cy - 0.32, 0.5));
      g.add(K.put(K.sphereLo({ color: shade(P.wine, 0.06), r: 0.09, seg: 0, family: 'glass' }), leak.mouthX, stainY + 0.28, 0.5));
      g.add(K.put(K.box({ color: shade(P.wine, -0.24), size: [0.55, 0.06, 0.4], family: 'glass' }), leak.mouthX, stainY, 0.55));
    }
    return g;
  },
};
