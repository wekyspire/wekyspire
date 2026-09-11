// 烛泪残台（CATALOG2 编号 45）：「燃尽烛泪塔+黑芯」——prop 类（stone 蜡 + unlit 焦坑/黑芯/残焰 双族）。
// 原点=底面中心（y=0 落地）；mount 双宿主 ['floor','smallWallTop']（S 档可上桌沿/断柱顶）。
// 布光职责：tags 声明 lightSource/fire——不私设 PointLight（CATALOG §6）；残焰=unlit
// 压暗冷白小锥（同 candleStand 语言，比常焰更暗更小，读作将尽）。变体走 build(opts)：
// 泪环数 tiers / 垂泪舌数 drips / 残焰 ember / 伴烧残头 stub。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'candleBurntOut',
  place: 'prop',
  mount: ['floor', 'smallWallTop'],
  tags: ['wax', 'lightSource', 'fire', 'generic'],
  footprint: { x: 1.8, z: 1.8 },
  behaviors: [],
  build({ tiers = 3, drips = 3, ember = true, stub = true, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('candleBurntOut');
    // 浅托盘：两层收分盘 + 盘面溢满的蜡池（燃尽后蜡漫出盘面），全高约 1.5
    g.add(K.put(K.cyl({ color: shade(P.wax, -0.22), r: 0.8, rTop: 0.72, h: 0.18, seg: 8 }), 0, 0.09, 0));
    g.add(K.put(K.cyl({ color: shade(P.wax, -0.12), r: 0.62, rTop: 0.55, h: 0.1, seg: 7 }), 0, 0.23, 0));
    g.add(K.put(K.cyl({ color: P.wax, r: 0.68, h: 0.06, seg: 7 }), 0, 0.29, 0));
    // 残烛塔：燃剩主烛（上宽下窄=熔蜡外扩感），整体微歪
    const stump = K.cyl({ color: P.wax, r: 0.24, rTop: 0.31, h: 0.95, seg: 7 });
    K.tilt(stump, r() * 0.05, 0, r() * 0.05);
    g.add(K.put(stump, 0, 0.735, 0));
    // 烛泪环：塔身层层垂凝的蜡领（越往下越宽）
    const tn = Math.max(0, Math.min(4, tiers));
    for (let i = 0; i < tn; i++) {
      const ring = K.cyl({
        color: i % 2 ? shade(P.wax, -0.06) : P.wax,
        r: 0.44 - i * 0.05, rTop: 0.38 - i * 0.05, h: 0.15, seg: 7,
      });
      K.tilt(ring, r() * 0.06, r() * 0.4, r() * 0.06);
      g.add(K.put(ring, (r() - 0.5) * 0.06, 0.52 + i * 0.25, (r() - 0.5) * 0.06));
    }
    // 垂泪舌：自盘沿外翻挂下的凝蜡条
    const dn = Math.max(0, Math.min(5, drips));
    for (let i = 0; i < dn; i++) {
      const a = i * (Math.PI * 2 / dn) + r() * 0.8;
      const len = 0.18 + r() * 0.16;
      const tongue = K.cyl({ color: P.wax, r: 0.055, rTop: 0.035, h: len, seg: 5 });
      K.tilt(tongue, 0, -a, -0.45);
      g.add(K.put(tongue, Math.cos(a) * 0.72, 0.3 - len / 2, Math.sin(a) * 0.72));
    }
    // 顶面焦坑 + 黑芯：unlit 暗盘读作烧焦烛面（同 anvilStone 磨坑手法），歪黑芯折向一侧
    g.add(K.put(K.cyl({ color: P.night, r: 0.24, h: 0.06, seg: 7, family: 'unlit' }), 0, 1.22, 0));
    const wick = K.cyl({ color: shade(P.night, 0.25), r: 0.032, h: 0.16, seg: 5, family: 'unlit' });
    K.tilt(wick, 0.14, 0, 0.1);
    g.add(K.put(wick, 0, 1.31, 0));
    if (ember) g.add(K.put(K.cone({ color: shade(P.flameCore, -0.4), r: 0.05, h: 0.16, seg: 5, family: 'unlit' }), 0.01, 1.44, 0.01));
    // 伴烧残头：盘角另一截烧尽的短烛头（同款焦坑+黑芯）
    if (stub) {
      g.add(K.put(K.cyl({ color: shade(P.wax, -0.08), r: 0.15, rTop: 0.19, h: 0.3, seg: 6 }), 0.48, 0.41, -0.2));
      g.add(K.put(K.cyl({ color: P.night, r: 0.12, h: 0.05, seg: 6, family: 'unlit' }), 0.48, 0.57, -0.2));
      g.add(K.put(K.cyl({ color: shade(P.night, 0.25), r: 0.025, h: 0.1, seg: 5, family: 'unlit' }), 0.48, 0.63, -0.2));
    }
    return g;
  },
};
