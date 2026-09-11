// 药草盆（CATALOG2 编号 75）：「陶盆+瘦苗几茎」——起居小件 prop（陶盆 stone + 苗株 cloth 双族）。
// 原点=底面中心（y=0 落地）；陶盆=lathe 斜壁花盆（口宽底窄，口径约 1.4），口沿唇圈 clayDark、
// 盆土压暗一档；瘦苗=细脚杆 + 沿茎两片错生小叶（压扁 sphereLo），苗色 P.herb 深浅交替、逐株外倾。
// mount 双宿主 ['floor','smallWallTop']（S 档柱顶件，宿主准入见 CATALOG §1.2）。
// 变体走 build(opts)：苗数 sprouts（2~6）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 盆轮廓（lathe profile 自下而上）：小底→斜壁外扩→口沿外翻，高约 0.85
const POT = [
  [0.02, 0], [0.33, 0], [0.39, 0.06],
  [0.5, 0.38], [0.59, 0.68], [0.67, 0.79], [0.7, 0.85],
];

// 单茎瘦苗（局部 y=0 出土）：细脚杆 + 两片错生小叶（叶长 rng 微变）
function sprout(r, len, tone) {
  const s = new THREE.Group();
  const stem = K.cyl({
    color: shade(P.herb, -0.14), r: 0.035, rTop: 0.02, h: len, seg: 4, family: 'cloth',
  });
  s.add(K.put(stem, 0, len / 2, 0));
  for (const [t, side] of [[0.55, 1], [0.92, -1]]) {
    const leaf = K.sphereLo({ color: tone, r: 0.1, seg: 0, family: 'cloth' });
    K.scaleXYZ(leaf, 1.3 + r() * 0.4, 0.32, 0.8);
    K.tilt(leaf, 0, 0, side * 0.5);
    s.add(K.put(leaf, side * 0.11, len * t, 0));
  }
  return s;
}

export default {
  id: 'potHerb',
  place: 'prop',
  mount: ['floor', 'smallWallTop'],
  tags: ['pottery', 'herb', 'quarters'],
  footprint: { x: 1.8, z: 1.8 },
  behaviors: [],
  build({ sprouts = 4, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('potHerb');
    // 陶盆 + 口沿唇圈 + 盆土（压暗读作湿土）
    const pot = K.lathe({ color: P.clay, seg: 7, profile: POT });
    if (rng) K.jitter(pot, rng, { rot: 0.02 });
    g.add(pot);
    g.add(K.put(K.cyl({ color: P.clayDark, r: 0.72, h: 0.08, seg: 7 }), 0, 0.8, 0));
    g.add(K.put(K.cyl({ color: shade(P.clayDark, -0.42), r: 0.58, h: 0.1, seg: 7 }), 0, 0.76, 0));
    // 瘦苗几茎：环布盆土、逐株外倾各不相同（外倾 = rx/rz 分解到径向），深浅交替
    const tones = [P.herb, shade(P.herb, 0.1), shade(P.herb, -0.08)];
    const n = Math.min(Math.max(sprouts, 2), 6);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.5;
      const s = sprout(r, 0.55 + r() * 0.35, tones[i % 3]);
      K.tilt(s, 0.3 * Math.sin(a), 0, -0.3 * Math.cos(a));
      g.add(K.put(s, Math.cos(a) * 0.3, 0.78, Math.sin(a) * 0.3));
    }
    return g;
  },
};
