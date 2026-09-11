// 召唤法阵（CATALOG2 编号 99）：「暗刻双环+符点+角标」——floorDecal 大贴印（stone+unlit 双族）。
// 对比度走 ritualCircle「浅刻=亮刻」范式（批3 红线）：深色地面上刻痕一律亮于地面——外环亮
// 一档、内环更亮、符点最亮（方石/尖石交替）；四斜角契形角标（压平 prism 尖朝环心）指向
// 环心；中央 unlit 暗盘+暗芯锥读作召唤深孔（「暗刻」之暗落在此处）。原点=环心（y=0 落地），
// 总高 ≤0.5。变体走 build(opts)：环径 ringR/符点数 runes。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'circleSummon',
  place: 'floorDecal',
  tags: ['arcane'],
  footprint: { x: 10, z: 10 },
  behaviors: [],
  build({ ringR = 4.3, runes = 6, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('circleSummon');
    // 外环：14 段亮刻石段（亮于地面一档，微错位出手工凿感），弧段切向排布
    const OUTER = 14;
    for (let i = 0; i < OUTER; i++) {
      const a = (i / OUTER) * Math.PI * 2;
      const seg = K.box({ color: shade(P.stone, 0.2), size: [2.0, 0.12, 0.5] });
      K.tilt(seg, 0, Math.PI / 2 - a + (r() - 0.5) * 0.03, (r() - 0.5) * 0.02);
      g.add(K.put(seg, Math.cos(a) * ringR, 0.05, Math.sin(a) * ringR));
    }
    // 内环：10 段更亮（刻槽更浅更亮），与外环错缝
    const INNER = 10;
    const innerR = ringR * 0.58;
    for (let i = 0; i < INNER; i++) {
      const a = (i / INNER) * Math.PI * 2 + 0.31;
      const seg = K.box({ color: shade(P.stone, 0.34), size: [1.6, 0.12, 0.38] });
      K.tilt(seg, 0, Math.PI / 2 - a + (r() - 0.5) * 0.03, (r() - 0.5) * 0.02);
      g.add(K.put(seg, Math.cos(a) * innerR, 0.05, Math.sin(a) * innerR));
    }
    // 符点：环间小立石（最亮档，平面朝环心），方石/尖石交替
    const rn = Math.max(3, Math.min(8, runes));
    const runeR = ringR * 0.79;
    for (let i = 0; i < rn; i++) {
      const a = (i / rn) * Math.PI * 2 + Math.PI / (rn * 2);
      const rune = i % 2
        ? K.prism({ color: shade(P.stone, 0.5), size: [0.32, 0.42, 0.2] })
        : K.box({ color: shade(P.stone, 0.44), size: [0.26, 0.3, 0.2] });
      K.tilt(rune, 0, Math.PI / 2 - a, 0);
      g.add(K.put(rune, Math.cos(a) * runeR, 0.16, Math.sin(a) * runeR));
    }
    // 角标：四斜角契形尖标（压平 prism，尖朝环心；holder 转 y 定向）
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k / 4) * Math.PI * 2;
      const holder = new THREE.Group();
      const wedge = K.prism({ color: shade(P.stone, 0.4), size: [0.62, 0.55, 0.14] });
      K.tilt(wedge, -Math.PI / 2, 0, 0);            // 契面平躺、尖朝 -z
      holder.add(wedge);
      K.tilt(holder, 0, Math.PI / 2 - a, 0);        // 尖转向环心
      g.add(K.put(holder, Math.cos(a) * ringR * 1.13, 0.06, Math.sin(a) * ringR * 1.13));
    }
    // 中央召唤孔：unlit 暗盘 + 暗芯锥（法阵之「暗」）
    g.add(K.put(K.cyl({ color: P.night, r: 0.58, h: 0.1, seg: 8, family: 'unlit' }), 0, 0.05, 0));
    g.add(K.put(K.cone({ color: shade(P.night, 0.22), r: 0.2, h: 0.26, seg: 6, family: 'unlit' }), 0, 0.2, 0));
    return g;
  },
};
