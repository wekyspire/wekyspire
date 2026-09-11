// 门口垂帘（CATALOG2 编号 104）：「分幅布帘+束带」——wallDecor 高带垂挂件（cloth+wood 双族）。
// 原点=墙面高位挂点投影（z=0 贴墙，+z 朝室内，y=0 即挂点）：横杆悬于门洞上方，布帘分幅
// 自杆垂挂（每幅=多条竖褶片错位叠出垂褶、底缘参差，同 bannerLong 布旗语言），中段金束带
// 收拢（横带+前结扣，幅宽收细读出系扎），总垂长 ~10。变体走 build(opts)：幅数 panels（1~3）/
// 每幅褶数 folds（2~4）/帘色 hue /帘长 len。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 单幅布帘：竖褶片错位叠（深浅交替=褶皱明暗、底缘参差）；原点=幅顶挂点，褶片向下垂
function makePanel(r, base, w, len, folds) {
  const p = new THREE.Group();
  const nf = Math.min(Math.max(folds, 2), 4);
  const tones = [shade(base, 0.06), base, shade(base, -0.1)];
  for (let i = 0; i < nf; i++) {
    const fw = w / nf - 0.1;
    const x = -w / 2 + (w / nf) * i + fw / 2 + 0.05;
    const fl = len - 0.5 + r() * 0.9;           // 底缘参差
    const piece = K.box({ color: tones[i % 3], size: [fw, fl, 0.11], family: 'cloth' });
    K.tilt(piece, 0, 0, (r() - 0.5) * 0.05);
    p.add(K.put(piece, x, -fl / 2, 0.14 + (i % 2) * 0.09));
  }
  return p;
}

// 束带：中段收拢的横带 + 前结扣（幅宽收细，读作系扎）；原点=带心
function makeBand(r, w) {
  const b = new THREE.Group();
  const tie = K.box({ color: shade(P.gold, -0.08), size: [w * 0.62, 0.44, 0.42], family: 'cloth' });
  K.tilt(tie, 0, 0, 0.04 + (r() - 0.5) * 0.05);
  b.add(tie);
  b.add(K.put(K.box({ color: shade(P.gold, -0.2), size: [0.5, 0.5, 0.5], family: 'cloth' }), -w * 0.16, 0, 0.3));
  return b;
}

export default {
  id: 'curtainDraped',
  place: 'wallDecor',
  band: 'high',
  tags: ['cloth', 'quarters'],
  behaviors: [],
  build({ panels = 2, folds = 3, hue = 'blue', len = 9.4, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('curtainDraped');
    const base = hue === 'blue' ? P.bannerBlue : P.bannerRed;
    const n = Math.min(Math.max(panels, 1), 3);
    const w = 4.4;
    const span = n * w + (n - 1) * 0.25;
    // 横杆 + 双端杆头（挂点即杆位）
    const rod = K.cyl({ color: P.woodDark, r: 0.2, h: span + 1.2, seg: 5, family: 'wood' });
    K.tilt(rod, 0, 0, Math.PI / 2);
    g.add(K.put(rod, 0, 0.06, 0.24));
    for (const sx of [-1, 1]) {
      g.add(K.put(K.box({ color: shade(P.woodDark, 0.07), size: [0.4, 0.58, 0.4], family: 'wood' }), sx * (span / 2 + 0.42), 0.06, 0.24));
    }
    // 分幅布帘 + 每幅束带（束带落在中段收拢位）
    for (let i = 0; i < n; i++) {
      const x = (i - (n - 1) / 2) * (w + 0.25);
      g.add(K.put(makePanel(r, base, w, len, folds), x, -0.1, 0));
      g.add(K.put(makeBand(r, w), x, -0.1 - len * 0.44, 0.16));
    }
    return g;
  },
};
