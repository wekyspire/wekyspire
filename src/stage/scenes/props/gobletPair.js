// 高脚杯对（CATALOG2 编号 73）：「一对细脚杯+翻倒一只」——起居餐饮小件 prop（metal 银杯 + unlit 杯口暗面 双族）。
// 原点=底面中心（y=0 落地）；细脚杯=lathe 一体旋出（宽座盘→收细脚→脚杆→开敞杯身），高约 1.05（S 档小件）；
// 两只立置微歪，另一只翻倒横卧——躺倒件用 K.aim 轴角对向（别用 tilt 叠 rx+ry）。
// 变体走 build(opts)：立杯数 cups（1~3）/翻倒有无 tipped。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 杯身轮廓（lathe profile 自下而上）：座盘→收细脚→细脚杆→底结展开→杯身外扩微收口，高约 1.05
const GOBLET = [
  [0.02, 0], [0.3, 0], [0.33, 0.06],
  [0.11, 0.13], [0.055, 0.22], [0.05, 0.56],
  [0.075, 0.63], [0.15, 0.71],
  [0.29, 0.88], [0.33, 1.02], [0.31, 1.05],
];

// 单只高脚杯（局部 y=0 落地）：杯身 + 杯口暗盘（unlit 夜色读作空腔，vaseClay 瓮口手法）
function goblet(tone) {
  const c = new THREE.Group();
  c.add(K.lathe({
    color: [P.silver, shade(P.silver, 0.1), shade(P.silver, -0.12)][tone],
    seg: 7, profile: GOBLET, family: 'metal',
  }));
  c.add(K.put(K.cyl({ color: P.night, r: 0.27, h: 0.05, seg: 7, family: 'unlit' }), 0, 0.97, 0));
  return c;
}

export default {
  id: 'gobletPair',
  place: 'prop',
  mount: 'floor',
  tags: ['metal', 'quarters'],
  footprint: { x: 2.3, z: 1.8 },
  behaviors: [],
  build({ cups = 2, tipped = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('gobletPair');
    // 立杯：松散排开，微歪微挪（rng 确定性变体）
    const xs = [-0.7, 0.2, 1.0];
    const n = Math.min(Math.max(cups, 1), 3);
    for (let i = 0; i < n; i++) {
      const c = goblet(i % 3);
      K.tilt(c, (r() - 0.5) * 0.12, r() * Math.PI * 2, (r() - 0.5) * 0.12);
      g.add(K.put(c, xs[i] + (r() - 0.5) * 0.2, 0, (i - 0.5) * 0.45 + (r() - 0.5) * 0.15));
    }
    // 翻倒一只：K.aim 把 +Y 轴指向斜前方躺平（轴高≈杯口半径，读作搁在地上）
    if (tipped) {
      const c = goblet(n % 3);
      K.aim(c, 1, 0.1, 0.5);
      g.add(K.put(c, 0.35, 0.28, -0.85));
    }
    return g;
  },
};
