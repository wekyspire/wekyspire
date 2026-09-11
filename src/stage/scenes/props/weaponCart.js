// 武器车（CATALOG2 编号 48）：「两轮车斗+斜倚矛束」——prop 类（wood 车体 + metal 轮轴矛头 双族）。
// 原点=底面中心（y=0 落地），x=长（车辕在后 -x、头板在前 +x）；全长约 7.5、全高约 4（L 档）。
// 车轮=cyl 压扁的木轮盘 + 铁辐条 box 贯穿轮面（三向交叉读作六辐）+ 铁轮毂；矛=木杆+
// 提亮锥矛头+喉箍，倚头板斜出（tilt 绕组原点=矛根）。变体走 build(opts)：矛数 spears。
// 布光：无光源件（纯载具），不涉 PointLight。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 长矛（剪影级）：木杆 + 铁喉箍 + 提亮压扁锥矛头，原点=矛根（y=0），全长约 3.2
function buildSpear() {
  return K.grp(
    K.put(K.cyl({ color: P.woodDark, r: 0.05, h: 2.75, seg: 5 }), 0, 1.375, 0),
    K.put(K.cyl({ color: P.iron, r: 0.07, h: 0.1, seg: 5, family: 'metal' }), 0, 2.78, 0),
    K.put(K.scaleXYZ(K.cone({ color: shade(P.iron, 0.25), r: 0.09, h: 0.45, seg: 4, family: 'metal' }), 1, 1, 0.4), 0, 3.05, 0),
  );
}

// 车轮：压扁木轮盘 + 三向铁辐条（贯穿轮面双侧凸出）+ 凸出轮毂，原点=轮心。
// 轮面=滚动面（x-y 平面，轴向 z 与轮轴同向）：cyl 默认 y 轴 → rx 90° 转轴向 z。
function buildWheel() {
  const g = K.grp(
    (() => { const disc = K.cyl({ color: P.woodDark, r: 0.85, h: 0.18, seg: 9 }); K.tilt(disc, Math.PI / 2, 0, 0); return disc; })(),
    (() => { const hub = K.cyl({ color: P.iron, r: 0.17, h: 0.46, seg: 6, family: 'metal' }); K.tilt(hub, Math.PI / 2, 0, 0); return hub; })(),
  );
  for (let i = 0; i < 3; i++) {
    const spoke = K.box({ color: P.iron, size: [0.13, 1.56, 0.34], family: 'metal' });
    K.tilt(spoke, 0, 0, i * Math.PI / 3); // 辐条在滚动面（x-y 平面）内三向交叉
    g.add(spoke);
  }
  return g;
}

export default {
  id: 'weaponCart',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'metal', 'barrack'],
  footprint: { x: 8, z: 3.6 },
  behaviors: [],
  build({ spears = 5, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('weaponCart');
    // 车斗：底板 + 两侧低栏 + 前端高头板（矛束倚头板斜出）
    g.add(K.put(K.box({ color: P.wood, size: [4.0, 0.34, 2.4] }), 0.6, 1.06, 0));
    for (const s of [-1, 1]) {
      g.add(K.put(K.box({ color: P.woodDark, size: [4.0, 0.46, 0.1] }), 0.6, 1.46, s * 1.25));
    }
    g.add(K.put(K.box({ color: P.woodDark, size: [0.14, 1.35, 2.4] }), 2.66, 1.9, 0));
    // 车底滑木：纵贯底板下的两根托木
    for (const s of [-1, 1]) {
      g.add(K.put(K.box({ color: P.woodDark, size: [4.2, 0.2, 0.26] }), 0.4, 0.79, s * 0.82));
    }
    // 轮轴 + 双轮：轴贯穿两侧轮毂，轮盘压扁贴轴端
    const axle = K.cyl({ color: P.iron, r: 0.1, h: 3.4, seg: 6, family: 'metal' });
    K.tilt(axle, Math.PI / 2, 0, 0); // y 轴 → z 轴
    g.add(K.put(axle, -0.3, 0.85, 0));
    for (const s of [-1, 1]) {
      g.add(K.put(buildWheel(), -0.3, 0.85, s * 1.55));
    }
    // 车辕：后伸双木杆 + 单侧驻车支腿（停车态，辕端离地一拳）
    for (const s of [-1, 1]) {
      g.add(K.put(K.box({ color: P.wood, size: [2.6, 0.2, 0.2] }), -2.3, 0.95, s * 0.6));
    }
    g.add(K.put(K.box({ color: P.woodDark, size: [0.16, 0.85, 0.16] }), -2.85, 0.425, 0.6));
    // 矛束：矛根抵斗底、杆倚头板、尖斜出上挑（扇形铺开、高低错落）
    const n = Math.max(0, Math.min(7, spears));
    for (let i = 0; i < n; i++) {
      const s = buildSpear();
      const lean = 0.86 + r() * 0.1; // 自竖直的倾角（倚头板斜度）
      K.tilt(s, 0, (r() - 0.5) * 0.24, -lean);
      const bx = 0.7 + i * 0.18 + r() * 0.06;
      const bz = n === 1 ? 0 : -0.75 + (i * 1.5) / (n - 1) + (r() - 0.5) * 0.1;
      g.add(K.put(s, bx, 1.23, bz));
    }
    return g;
  },
};
