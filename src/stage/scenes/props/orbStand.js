// 水晶球座（CATALOG2 编号 63）：「托座+幽光球」——奥术占卜小件 prop（stone+glass+unlit 三族）。
// 原点=底面中心（y=0 落地），全高约 3（S 档柱顶件）；mount 双宿主 ['floor','smallWallTop']。
// 托座=柱础束腰轮廓（lathe：盘座→细腰→束颈）+ 颈上承球窝；球窝周沿三/四支爪钩斜上兜住
// 球腰（aim 定向）。幽光球=双层：玻璃族半透明青球壳 + 内芯 unlit 幽光球（glowCyan，晶簇/
// 微光蘑菇专用 token）——壳读体积、芯读光源。布光职责：tags 声明 lightSource 即"这里有光"
// ——不私设 PointLight（CATALOG §6）。变体走 build(opts)：球径 orbR / 爪数 claws / 球芯燃否 lit。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'orbStand',
  place: 'prop',
  mount: ['floor', 'smallWallTop'],
  tags: ['stone', 'lightSource', 'arcane'],
  footprint: { x: 2.0, z: 2.0 },
  behaviors: [],
  build({ orbR = 0.85, claws = 3, lit = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('orbStand');
    const rad = Math.min(Math.max(orbR, 0.65), 1.05);
    // 托座：束腰柱础（盘座→细腰→束颈，lathe 自闭底）+ 颈口承球窝圈
    g.add(K.put(K.lathe({
      color: shade(P.stone, -0.1),
      profile: [[0.02, 0], [0.66, 0.06], [0.7, 0.18], [0.38, 0.34], [0.26, 0.52], [0.42, 0.64], [0.52, 0.7]],
      seg: 7,
    }), 0, 0, 0));
    g.add(K.put(K.cyl({ color: shade(P.stone, 0.06), r: 0.6, rTop: 0.5, h: 0.16, seg: 7 }), 0, 0.78, 0));
    // 束颈柱：自承窝顶托起球体（球底沉入窝口读作嵌座）
    g.add(K.put(K.cyl({ color: P.stone, r: 0.24, rTop: 0.32, h: 0.92, seg: 6 }), 0, 1.32, 0));
    const orbY = 2.28; // 球心：颈顶沉球 + 爪兜，顶面约 2.28+rad（约 3）
    // 爪钩：自承窝沿斜上兜住球腰（aim 定向，读作金属爪托的石雕化钩指）
    const nc = Math.min(Math.max(claws, 3), 4);
    for (let i = 0; i < nc; i++) {
      const a = i * (Math.PI * 2 / nc) + 0.6;
      const polar = 0.96; // 自球心张开角（弧度，贴球面 55°）
      const tip = new THREE.Vector3(
        Math.cos(a) * rad * Math.sin(polar), orbY + rad * Math.cos(polar), Math.sin(a) * rad * Math.sin(polar));
      const root = new THREE.Vector3(Math.cos(a) * 0.58, 0.84, Math.sin(a) * 0.58);
      const d = tip.clone().sub(root);
      const claw = K.cyl({ color: shade(P.stone, 0.08), r: 0.09, rTop: 0.06, h: d.length(), seg: 5 });
      K.aim(claw, d.x, d.y, d.z);
      claw.position.copy(root).addScaledVector(d, 0.5);
      g.add(claw);
    }
    // 幽光球：玻璃壳（半透明读体积）+ unlit 内芯（读光源；熄时芯压暗成哑球）
    const shell = K.sphereLo({ color: shade(P.glowCyan, -0.12), r: rad, seg: 1, family: 'glass' });
    K.tilt(shell, 0, r() * 0.4, 0);
    g.add(K.put(shell, 0, orbY, 0));
    g.add(K.put(K.sphereLo({
      color: lit ? shade(P.glowCyan, 0.26) : shade(P.glowCyan, -0.5),
      r: rad * 0.5, seg: 0, family: 'unlit',
    }), 0, orbY, 0));
    return g;
  },
};
