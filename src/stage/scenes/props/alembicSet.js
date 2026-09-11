// 蒸馏器组（CATALOG2 编号 115）：「曲颈瓶+受瓶+炉芯微光」——奥术小件 prop（metal+glass+unlit 三族）。
// 原点=底面中心（y=0 落地），全宽约 3.1、全高约 3.3（S 档）；mount 双宿主 ['floor','smallWallTop']。
// 铜器=P.copper：铜托盘上左置束腰铜炉，炉口托圈承曲颈玻璃瓶（腹内药液），曲颈双段玻璃管
// （K.aim 对向）自瓶口折上再斜插右置受瓶口（馏液 P.potionGreen/Blue 对色）；玻璃器=glass 族。
// 布光职责：tags 声明 lightSource 即「这里有光」——不私设 PointLight，炉芯微光用
// unlit 压暗焰点（冷白压暗锥+烬心，同 brazierFire 语言）。变体走 build(opts)：液色对调
// hue（green/blue）/ 炉芯亮灭 lit / 曲颈粗细 neckR。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 铜炉轮廓（束腰→鼓腹→炉口收沿），高约 1.15
const FURNACE = [
  [0.3, 0], [0.52, 0.08], [0.44, 0.28], [0.56, 0.62], [0.6, 0.9], [0.52, 1.06], [0.46, 1.15],
];
// 曲颈瓶轮廓（圆腹→收肩→短颈外翻口），高约 1.5
const RETORT = [
  [0.05, 0], [0.42, 0.05], [0.62, 0.32], [0.58, 0.62], [0.4, 0.88],
  [0.18, 1.04], [0.15, 1.26], [0.22, 1.36], [0.25, 1.5],
];
// 曲颈瓶内药液（贴腹内壁的浅层）
const RETORT_FLUID = [
  [0.04, 0], [0.5, 0.06], [0.54, 0.3], [0.48, 0.5], [0.28, 0.62], [0.08, 0.66],
];
// 受瓶轮廓（矮圆腹→细颈翻口），高约 1.2
const RECEIVER = [
  [0.04, 0], [0.34, 0.05], [0.48, 0.3], [0.44, 0.52], [0.22, 0.7], [0.14, 0.94], [0.19, 1.04], [0.22, 1.2],
];
// 受瓶内馏液
const RECEIVER_FLUID = [
  [0.03, 0], [0.36, 0.06], [0.4, 0.22], [0.3, 0.36], [0.1, 0.42],
];

// 两点间斜管：定长 cyl + aim 对向 + 置中点（曲颈玻璃导管）
function tube(x0, y0, x1, y1, r, color) {
  const t = K.cyl({ color, r, h: Math.hypot(x1 - x0, y1 - y0), seg: 5, family: 'glass' });
  K.aim(t, x1 - x0, y1 - y0, 0);
  t.position.set((x0 + x1) / 2, (y0 + y1) / 2, 0);
  return t;
}

export default {
  id: 'alembicSet',
  place: 'prop',
  mount: ['floor', 'smallWallTop'],
  tags: ['glass', 'metal', 'lightSource', 'arcane'],
  footprint: { x: 3.3, z: 2.2 },
  behaviors: [],
  build({ hue = 'green', lit = true, neckR = 0.09, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('alembicSet');
    const brass = P.copper;
    const glassTint = shade(P.glowCyan, -0.3);                    // 玻璃器皿青灰透明感
    const upHue = hue === 'blue' ? P.potionBlue : P.potionGreen;  // 曲颈瓶内药液
    const lowHue = hue === 'blue' ? P.potionGreen : P.potionBlue; // 受瓶内馏液
    // 铜托盘：整组底盘（读作成套铜器）
    g.add(K.plate({ color: shade(brass, -0.12), w: 3.1, d: 2.1, th: 0.14, family: 'metal' }));
    // 铜炉（左置）：束腰鼓腹 + 炉口沿箍 + 承瓶托圈
    const fx = -0.98;
    const furnace = K.lathe({ color: brass, profile: FURNACE, seg: 8, family: 'metal' });
    K.tilt(furnace, 0, 0, (r() - 0.5) * 0.03);
    g.add(K.put(furnace, fx, 0.14, 0));
    g.add(K.put(K.cyl({ color: shade(brass, 0.1), r: 0.5, rTop: 0.44, h: 0.1, seg: 8, family: 'metal' }), fx, 1.3, 0));
    g.add(K.put(K.cyl({ color: shade(brass, -0.05), r: 0.3, rTop: 0.34, h: 0.16, seg: 7, family: 'metal' }), fx, 1.4, 0));
    // 炉芯微光：unlit 压暗焰点（lightSource 只进 tags，不设点光）
    if (lit) {
      const dim = shade(P.flameCore, -0.38);
      g.add(K.put(K.cone({ color: dim, r: 0.16, h: 0.3, seg: 5, family: 'unlit' }), fx, 1.34, 0));
      g.add(K.put(K.sphereLo({ color: shade(dim, -0.1), r: 0.1, seg: 0, family: 'unlit' }), fx, 1.3, 0));
    }
    // 曲颈瓶：坐炉口托圈上，腹内药液贴壁
    const retort = K.lathe({ color: glassTint, profile: RETORT, seg: 8, family: 'glass' });
    K.tilt(retort, 0, 0, (r() - 0.5) * 0.02);
    g.add(K.put(retort, fx, 1.46, 0));
    g.add(K.put(K.lathe({ color: shade(upHue, -0.04), profile: RETORT_FLUID, seg: 8, family: 'glass' }), fx, 1.56, 0));
    // 曲颈双段玻璃管：自瓶口折上至 apex，再斜落受瓶口上沿（蒸馏下行）
    const nr = Math.min(Math.max(neckR, 0.06), 0.13);
    g.add(tube(fx + 0.12, 2.86, -0.32, 3.16, nr, glassTint));
    g.add(tube(-0.32, 3.16, 0.92, 1.66, nr * 0.9, glassTint));
    // 受瓶（右置）：铜环矮座承瓶，腹内馏液
    const rx = 0.92;
    g.add(K.put(K.cyl({ color: shade(brass, -0.08), r: 0.42, rTop: 0.36, h: 0.18, seg: 7, family: 'metal' }), rx, 0.23, 0));
    const recv = K.lathe({ color: glassTint, profile: RECEIVER, seg: 8, family: 'glass' });
    K.tilt(recv, 0, 0, (r() - 0.5) * 0.02);
    g.add(K.put(recv, rx, 0.3, 0));
    g.add(K.put(K.lathe({ color: shade(lowHue, 0.06), profile: RECEIVER_FLUID, seg: 7, family: 'glass' }), rx, 0.34, 0));
    return g;
  },
};
