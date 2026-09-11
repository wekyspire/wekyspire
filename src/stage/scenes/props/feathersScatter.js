// 散羽（CATALOG2 编号 97）：「几根羽毛+绒点」——floorDecal 撒印类（纯 stone 单族贴地薄片）。
// 原点=羽群中心投影（y=0 落地）；单羽=裸羽轴细柱+压扁羽片+收窄羽尖沿局部 +Y 排布（局部
// 原点居中），K.aim 把羽长轴对向外向水平方位（微翘读作风落地后斜躺，躺倒件禁 tilt 叠轴）；
// 绒点=羽间压扁小球。冷银/骨白羽色在深色地面上高对比。总高 ≤0.4。
// 变体走 build(opts)：羽数 feathers/绒点数 downs/摊开度 spread。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 单根羽毛（局部原点=羽身中点，长轴 +Y）：裸羽轴半截 + 压扁羽片 + 收窄羽尖
function feather(tone) {
  const f = new THREE.Group();
  f.add(K.put(K.cyl({ color: shade(tone, -0.26), r: 0.03, h: 0.55, seg: 5 }), 0, -0.4, 0));
  const vane = K.box({ color: tone, size: [0.3, 0.74, 0.05] });
  K.tilt(vane, 0, 0, 0.05);
  f.add(K.put(vane, 0, 0.08, 0));
  const tip = K.box({ color: shade(tone, -0.08), size: [0.15, 0.3, 0.045] });
  K.tilt(tip, 0, 0, -0.07);
  f.add(K.put(tip, 0.03, 0.55, 0));
  return f;
}

export default {
  id: 'feathersScatter',
  place: 'floorDecal',
  tags: ['nature'],
  footprint: { x: 3, z: 2 },
  behaviors: [],
  build({ feathers = 6, downs = 5, spread = 1, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('feathersScatter');
    const tones = [P.silver, shade(P.silver, 0.2), P.bone, shade(P.wax, -0.05)];
    // 羽毛：aim 对向外向平躺（羽尖朝外微翘），头密尾疏
    const n = Math.max(2, Math.min(9, feathers));
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2;
      const rad = (0.2 + Math.pow(r(), 0.85) * 0.85) * spread;
      const f = feather(tones[i % 4]);
      K.aim(f, Math.cos(a), 0.14 + r() * 0.14, Math.sin(a));
      K.tilt(f, 0, 0, (r() - 0.5) * 0.24);
      g.add(K.put(f, Math.cos(a) * rad, 0.05, Math.sin(a) * rad * 0.62));
    }
    // 绒点：羽间压扁小球（羽绒感，冷白点睛）
    const m = Math.max(0, Math.min(9, downs));
    for (let i = 0; i < m; i++) {
      const a = r() * Math.PI * 2;
      const rad = (0.35 + r() * 0.95) * spread;
      const down = K.sphereLo({
        color: i % 2 ? P.wax : shade(P.silver, 0.28),
        r: 0.07 + r() * 0.05, seg: 0, jitter: 0.22, rng: r,
      });
      K.scaleXYZ(down, 1, 0.55, 1);
      g.add(K.put(down, Math.cos(a) * rad, 0.05, Math.sin(a) * rad * 0.62));
    }
    return g;
  },
};
