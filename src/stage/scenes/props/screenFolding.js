// 折屏（CATALOG2 #16）：「三扇木框布面微折角」——起居大件 prop（wood+cloth 双族）。
// 等宽屏扇：木框（左右立柱+顶/中/底横枋）+ 大幅布面 + 下段色带一条；扇与扇铰位相连，
// 首尾两扇向前微折成 C 形围合（凹面朝 +z 室内，凸背抵墙），总宽约 9、总高约 7。
// 原点=底面中心（y=0 落地），x=展开宽 z=进深。变体走 build(opts)：扇数（3~4）/折角。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 单扇屏：原点=左铰边（children 偏 x=w/2），框+布面+下段色带，共 7 网格
function makePanel(w, h, tone, trim) {
  const p = new THREE.Group();
  for (const s of [0, 1]) {
    p.add(K.put(K.box({ color: P.woodDark, size: [0.26, h, 0.17], family: 'wood' }), s ? w - 0.13 : 0.13, h / 2, 0));
  }
  for (const [y, t] of [[h - 0.16, 0.3], [h * 0.52, 0.18], [0.18, 0.36]]) {
    p.add(K.put(K.box({ color: shade(P.wood, 0.04), size: [w, t, 0.14], family: 'wood' }), w / 2, y, 0));
  }
  const cloth = K.box({ color: tone, size: [w - 0.5, h - 1.15, 0.07], family: 'cloth' });
  K.tilt(cloth, 0, 0, 0.004);
  p.add(K.put(cloth, w / 2, h / 2 + 0.02, 0));
  p.add(K.put(K.box({ color: trim, size: [w - 0.42, 0.72, 0.08], family: 'cloth' }), w / 2, 0.95, 0.02));
  return p;
}

export default {
  id: 'screenFolding',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'cloth', 'quarters'],
  footprint: { x: 9.6, z: 2.4 },
  behaviors: [],
  build({ panels = 3, fold = 0.3, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('screenFolding');
    const n = Math.min(Math.max(panels, 3), 4);
    const w = 3.0, h = 6.9;
    // 布面配色：青幡为底、暗红为带，各扇深浅交替（红蓝两幡色的居室化组合）
    const tones = [P.bannerBlue, shade(P.bannerBlue, -0.08), shade(P.bannerRed, -0.1), shade(P.bannerBlue, -0.04)];
    const trims = [shade(P.bannerRed, -0.08), shade(P.bannerBlue, -0.05), P.bannerRed, shade(P.bannerRed, -0.12)];
    // 链式立扇：自左向右逐扇搭接，中间扇平、两翼前折（朝向线性渐变=微折角的 C 形围合）
    let hx = 0, hz = 0, zMin = 0, zMax = 0;
    for (let i = 0; i < n; i++) {
      const yaw = -fold * (i - (n - 1) / 2) + (r() - 0.5) * 0.02;
      const panel = makePanel(w, h, tones[i % 4], trims[i % 4]);
      panel.rotation.y = yaw;
      panel.position.set(hx, 0, hz);
      g.add(panel);
      hx += Math.cos(yaw) * w;
      hz += -Math.sin(yaw) * w;
      zMin = Math.min(zMin, hz);
      zMax = Math.max(zMax, hz);
    }
    // 整体平移回底面中心（链式起点在原点，居中 x/z）
    for (const p of g.children) {
      p.position.x -= hx / 2;
      p.position.z -= (zMin + zMax) / 2;
    }
    return g;
  },
};
