// 对开残旗（CATALOG2 编号 120）：「对开残旗两幅并排，一幅缺角」——wallDecor 中带挂件
// （cloth+wood 双族）。原点=墙面挂点（z=0 贴墙，+z 朝室内，同 bannerLong 约定）；band=mid：
// 一杆通长横木挂两幅同款窄旗并排垂挂（对开总幅约 6×8），残旗语言同 bannerTorn——
// 底缘窄片错落撕裂垂挂（bannerLong 撕条手法），其中一幅下角缺角（chip 削角+该角撕裂条
// 随之截短），另一幅裂口较少、徽记完好。变体走 build(opts)：旗色 hue（red/blue）/
// 每幅撕裂数 strips（2~4）/ 缺角侧 chipSide（right/left/none）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 单幅残旗：旗身+压暗饰带+菱形徽+底缘撕裂窄片（局部原点=旗身中心）
function makePanel(base, crest, { w = 2.8, bodyH = 5.3, strips = 3, chipped = false, core = true, r } = {}) {
  const p = new THREE.Group();
  const body = K.box({ color: base, size: [w, bodyH, 0.13], family: 'cloth' });
  if (chipped) K.chip(body, { corner: [1, -1, 1], amount: 0.95 }); // 下外角缺角（正面朝室内）
  K.tilt(body, 0.015, 0, (r() - 0.5) * 0.03);
  p.add(K.put(body, 0, 0, 0.22));
  p.add(K.put(K.box({ color: shade(base, -0.22), size: [w, 0.75, 0.15], family: 'cloth' }), 0, bodyH / 2 - 0.38, 0.27));
  // 菱形徽：缺角幅去内芯微歪（残）；完好幅带提亮内芯
  const dia = K.box({ color: crest, size: [1.7, 1.7, 0.16], family: 'cloth' });
  K.tilt(dia, 0, 0, Math.PI / 4 + (chipped ? 0.06 : 0));
  p.add(K.put(dia, 0, 0.35, 0.3));
  if (core) {
    const inner = K.box({ color: shade(base, 0.16), size: [0.75, 0.75, 0.18], family: 'cloth' });
    K.tilt(inner, 0, 0, Math.PI / 4);
    p.add(K.put(inner, 0, 0.35, 0.36));
  }
  // 底缘撕裂：窄片错落长短垂挂；缺角侧末条截短（随缺角走）
  const ns = Math.min(Math.max(strips, 2), 4);
  const tones = [shade(base, 0.07), base, shade(base, -0.1)];
  for (let i = 0; i < ns; i++) {
    const sw = w / ns - 0.12;
    const x = -w / 2 + (w / ns) * i + sw / 2 + 0.06;
    let sl = 1.5 + r() * 1.4;
    if (chipped && i === ns - 1) sl *= 0.35;
    const piece = K.box({ color: tones[i % 3], size: [sw, sl, 0.1], family: 'cloth' });
    K.tilt(piece, 0, 0, (r() - 0.5) * 0.09);
    p.add(K.put(piece, x + (r() - 0.5) * 0.1, -bodyH / 2 - sl / 2 + 0.32, 0.26 + (r() - 0.5) * 0.06));
  }
  return p;
}

export default {
  id: 'bannerHalfTorn',
  place: 'wallDecor',
  band: 'mid',
  tags: ['cloth', 'barrack'],
  behaviors: [],
  build({ hue = 'red', strips = 3, chipSide = 'right', rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('bannerHalfTorn');
    const base = hue === 'blue' ? P.bannerBlue : P.bannerRed;
    const crest = hue === 'blue' ? shade(P.bannerRed, 0.05) : shade(P.bannerBlue, 0.05);
    // 通长挂杆：横置圆柱+两端方头托座
    const rod = K.cyl({ color: P.woodDark, r: 0.15, h: 6.2, seg: 5, family: 'wood' });
    K.tilt(rod, 0, 0, Math.PI / 2);
    g.add(K.put(rod, 0, 0.1, 0.18));
    for (const sx of [-1, 1]) {
      g.add(K.put(K.box({ color: shade(P.woodDark, 0.07), size: [0.3, 0.4, 0.26], family: 'wood' }), sx * 3.16, 0.02, 0.16));
    }
    // 两幅并排：完好幅（满徽+双穗芯）与缺角幅（去芯+削角+末条短）左右按 chipSide 分置
    const chippedRight = chipSide !== 'left';
    const showChip = chipSide !== 'none';
    const intact = makePanel(base, crest, { strips, core: true, r });
    const torn = makePanel(base, crest, { strips, core: false, chipped: showChip, r });
    K.put(intact, chippedRight ? -1.55 : 1.55, -2.25, 0);
    K.put(torn, chippedRight ? 1.55 : -1.55, -2.3, 0.02);
    if (!chippedRight) K.mirror(torn, 'x'); // 缺角翻到外侧
    g.add(intact, torn);
    return g;
  },
};
