// 挂斗篷（CATALOG2 编号 105）：「钩+斗篷垂褶+搭巾」——wallDecor 中带挂件（wood+metal+cloth 三族）。
// 原点=墙面挂点（z=0 贴墙，+z 朝室内；band=mid 主体在正 y 近原点，同 hooksRope 口径）：
// 木壁板装 J 形铁钩（横臂+下弯钩尖），斗篷自钩尖垂挂——肩领横幅过钩、领口小鼓+金扣，
// 竖褶片多片错位叠（同 bannerLong 垂褶语言）垂落 ~6、底缘参差；旁侧木销搭一条对折小巾。
// 变体走 build(opts)：褶数 folds（3~5）/斗篷色 hue /搭巾有无 towel。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 斗篷：肩领过钩（横幅+领口鼓+金扣）+ 竖褶片错位叠（深浅交替、底缘参差）；原点=钩尖挂点
function makeCloak(r, base, folds) {
  const c = new THREE.Group();
  const w = 2.0, len = 5.6;
  const yoke = K.box({ color: shade(base, 0.08), size: [w, 0.5, 0.34], family: 'cloth' });
  K.tilt(yoke, 0, 0, 0.03 + (r() - 0.5) * 0.04);
  c.add(K.put(yoke, 0, -0.25, 0));
  c.add(K.put(K.box({ color: shade(base, -0.12), size: [0.6, 0.34, 0.4], family: 'cloth' }), 0.1, -0.12, 0.05));
  c.add(K.put(K.box({ color: P.gold, size: [0.26, 0.26, 0.14], family: 'cloth' }), 0.1, -0.3, 0.22));
  const nf = Math.min(Math.max(folds, 3), 5);
  const tones = [shade(base, 0.05), base, shade(base, -0.12)];
  for (let i = 0; i < nf; i++) {
    const fw = w / nf - 0.06;
    const x = -w / 2 + (w / nf) * i + fw / 2 + 0.03;
    const fl = len - 0.7 + r() * 1.1;          // 底缘参差=垂褶感
    const piece = K.box({ color: tones[i % 3], size: [fw, fl, 0.12], family: 'cloth' });
    K.tilt(piece, 0, 0, (r() - 0.5) * 0.06);
    c.add(K.put(piece, x, -0.4 - fl / 2, (i % 2) * 0.09 - 0.02));
  }
  return c;
}

export default {
  id: 'cloakHook',
  place: 'wallDecor',
  band: 'mid',
  tags: ['cloth', 'quarters'],
  behaviors: [],
  build({ folds = 4, hue = 'red', towel = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('cloakHook');
    const base = hue === 'blue' ? P.bannerBlue : P.bannerRed;
    // 木壁板（板面贴墙，挂具居板）
    g.add(K.put(K.box({ color: P.wood, size: [2.9, 1.1, 0.18], family: 'wood' }), 0, 1.85, 0.09));
    // J 形铁钩：横臂自板前伸 + 下弯钩尖（斗篷挂点）
    const arm = K.cyl({ color: P.iron, r: 0.11, h: 0.95, seg: 5, family: 'metal' });
    K.tilt(arm, Math.PI / 2, 0, 0);
    g.add(K.put(arm, -0.5, 1.95, 0.18 + 0.475));
    g.add(K.put(K.cyl({ color: shade(P.iron, 0.06), r: 0.1, h: 0.55, seg: 5, family: 'metal' }), -0.5, 1.7, 1.02));
    // 斗篷自钩尖垂挂（整体微歪）
    const cloak = makeCloak(r, base, folds);
    K.tilt(cloak, 0, 0, (r() - 0.5) * 0.04);
    g.add(K.put(cloak, -0.5, 1.62, 0.95));
    // 旁侧木销 + 对折搭巾（两片前后错开=搭过销的读法）
    if (towel) {
      const peg = K.cyl({ color: P.woodDark, r: 0.07, h: 0.5, seg: 5, family: 'wood' });
      K.tilt(peg, Math.PI / 2, 0, 0);
      g.add(K.put(peg, 1.0, 1.9, 0.3));
      const front = K.box({ color: P.sack, size: [0.95, 1.5, 0.09], family: 'cloth' });
      K.tilt(front, 0, 0, 0.05);
      g.add(K.put(front, 1.0, 1.15, 0.42));
      const back = K.box({ color: shade(P.sack, -0.1), size: [0.85, 1.2, 0.09], family: 'cloth' });
      K.tilt(back, 0, 0, -0.04);
      g.add(K.put(back, 1.0, 1.2, 0.18));
    }
    return g;
  },
};
