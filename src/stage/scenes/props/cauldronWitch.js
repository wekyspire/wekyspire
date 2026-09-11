// 女巫大釜（CATALOG2 编号 68）：「黑铁大锅+搭搅拌桨」——prop/floor（metal+wood+unlit 三族）。
// 原点=釜底投影中心（y=0 落地）：三足外撇承起球腹黑釜（口径约 3.5、连足高约 3，M 档），
// 釜口夜色内腔浮 unlit 绿汤面+冒泡（arcane 微光），搅拌桨=木柄+桨板斜搭锅沿、桨板没入汤中
// （斜搭姿态走 K.aim 对向）。釜脚四周横陈熄火余柴（柴语言同 fireplaceBig，无焰）。
// 变体走 build(opts)：余柴数 logs / 浮泡数 bubbles / 汤色 brew（green|dark）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 釜身轮廓（lathe 自下而上）：球腹黑釜，口沿外撇，局部高约 1.92
const POT = [
  [0.5, 0], [1.32, 0.1], [1.68, 0.5], [1.75, 1.0],
  [1.6, 1.45], [1.28, 1.72], [1.32, 1.82], [1.42, 1.92],
];

export default {
  id: 'cauldronWitch',
  place: 'prop',
  mount: 'floor',
  tags: ['metal', 'arcane', 'kitchen'],
  footprint: { x: 4.4, z: 4.4 },
  behaviors: [],
  build({ logs = 3, bubbles = 2, brew = 'green', rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('cauldronWitch');
    const lift = 1.0;                     // 釜身由三足承起离地
    // 三足：120° 环布、自釜底外撇落地（足端粗、根端细，同 brazierFire 足语言）
    for (let i = 0; i < 3; i++) {
      const a = i * (Math.PI * 2 / 3) + 0.5;
      const rootR = 0.55, footR = 1.5;
      const leg = K.cyl({
        color: shade(P.iron, -0.08), r: 0.17, rTop: 0.12,
        h: Math.hypot(footR - rootR, lift), seg: 5, family: 'metal',
      });
      K.tilt(leg, 0, -a, -Math.atan2(footR - rootR, lift));
      const midR = (rootR + footR) / 2;
      g.add(K.put(leg, Math.cos(a) * midR, lift / 2, Math.sin(a) * midR));
    }
    // 釜身 + 沿口唇圈 + 腹部浇铸凸箍（烟色深浅读出铸铁厚胎）
    g.add(K.put(K.lathe({ color: P.iron, profile: POT, seg: 8, family: 'metal' }), 0, lift, 0));
    g.add(K.put(K.cyl({ color: shade(P.iron, 0.08), r: 1.5, h: 0.14, seg: 8, family: 'metal' }), 0, lift + 1.86, 0));
    g.add(K.put(K.cyl({ color: shade(P.iron, -0.14), r: 1.79, h: 0.2, seg: 8, family: 'metal' }), 0, lift + 1.02, 0));
    // 釜口内腔（unlit 夜色读深）+ 绿汤面（unlit 发色感纯色，半径收一档留出腔壁）
    g.add(K.put(K.cyl({ color: P.night, r: 1.3, h: 0.06, seg: 8, family: 'unlit' }), 0, lift + 1.78, 0));
    g.add(K.put(K.cyl({
      color: brew === 'dark' ? shade(P.potionGreen, -0.3) : shade(P.potionGreen, -0.04),
      r: 1.05, h: 0.07, seg: 8, family: 'unlit',
    }), 0, lift + 1.84, 0));
    // 浮泡：汤面两点冒泡（提亮的汤色小珠）
    const nb = Math.min(Math.max(bubbles, 0), 4);
    for (let i = 0; i < nb; i++) {
      const aa = r() * Math.PI * 2, rad = 0.25 + r() * 0.45;
      g.add(K.put(
        K.sphereLo({ color: shade(P.potionGreen, 0.3), r: 0.09 + r() * 0.05, seg: 0, jitter: 0.2, rng: r, family: 'unlit' }),
        Math.cos(aa) * rad, lift + 1.9, Math.sin(aa) * rad));
    }
    // 熄火余柴：焦色圆木横陈釜脚四周（躺倒件走 K.aim 水平对向；无 lightSource 即无焰）
    const nl = Math.min(Math.max(logs, 0), 5);
    for (let i = 0; i < nl; i++) {
      const a = (i / nl) * Math.PI * 2 + 1.1 + (r() - 0.5) * 0.2;
      const log = K.cyl({
        color: i % 2 ? shade(P.woodDark, 0.06) : P.woodDark,
        r: 0.19 + (i % 2) * 0.04, h: 1.7, seg: 5, family: 'wood',
      });
      K.aim(log, -Math.sin(a), 0, Math.cos(a));
      g.add(K.put(log, Math.cos(a) * 1.05, 0.2, Math.sin(a) * 1.05));
    }
    // 搅拌桨：木柄+桨板（+Y 自桨板底指向柄梢），斜搭锅沿——桨板没入汤面、柄身压过口沿、
    // 柄梢翘出锅外上方（沿口接触点解算见姿态常量，微嵌入即「搭」感）
    const paddle = K.grp(
      K.put(K.cyl({ color: P.wood, r: 0.11, h: 2.6, seg: 5, family: 'wood' }), 0, 1.7, 0),
      K.put(K.box({ color: shade(P.wood, 0.08), size: [0.44, 1.3, 0.16], family: 'wood' }), 0, 0.65, 0),
    );
    K.aim(paddle, 2.05, 1.5, 0.65);
    g.add(K.put(paddle, 0.15, 2.0, -0.05));
    return g;
  },
};
