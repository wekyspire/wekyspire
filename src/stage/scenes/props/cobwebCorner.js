// 墙角蛛网（阶段三·维护衰减装饰）：「顶角张开的扇形网，断丝挂尘」——wallDecor 高带
// （unlit 单族： pale 丝线在暗室里泛微光，月光下先亮起来）。原点=网心锚点（墙角顶
// 挂点，z=0 贴墙面，+z 朝室内，网扇向局部 -x/-y 张开——挂角时由 ry 转向）。
// 结构：5 根辐射丝 + 3 道同心弧（中段下垂的微弧线段拼）+ 尘点两三。变体走 build(opts)：半径 r。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'cobwebCorner',
  place: 'wallDecor',
  band: 'high',
  tags: ['cloth'],
  behaviors: [],
  build({ rad = 4.2, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('cobwebCorner');
    const strand = (len, ang, sag = 0) => {
      // 单根丝：细长 box，从锚点沿 ang（局部，0=-x 水平 左张，-PI/2=-y 下垂）伸出
      const s = K.box({ color: shade(P.bone, 0.12), size: [len, 0.07, 0.07], family: 'unlit' });
      const dx = Math.cos(ang); const dy = Math.sin(ang);
      s.rotation.z = ang;
      return K.put(s, (dx * len) / 2, (dy * len) / 2, 0.12 + sag);
    };
    // 辐射丝 5 根：从垂直到水平扫 90°（贴两面墙的顶角）
    const RAD = 5;
    for (let i = 0; i < RAD; i++) {
      const a = -Math.PI / 2 + (i / (RAD - 1)) * (Math.PI / 2);
      g.add(strand(rad * (0.92 + r() * 0.12), a));
    }
    // 同心弧 3 道：沿辐射丝采样折线（中段下垂 = 段间错层 z 微浮）
    for (let ring = 1; ring <= 3; ring++) {
      const rr = (rad * ring) / 3.2;
      const SEG = 4 + ring;
      for (let i = 0; i < SEG; i++) {
        if (r() < 0.18) continue; // 断丝
        const a0 = -Math.PI / 2 + (i / SEG) * (Math.PI / 2);
        const a1 = -Math.PI / 2 + ((i + 0.85) / SEG) * (Math.PI / 2);
        const x0 = Math.cos(a0) * rr; const y0 = Math.sin(a0) * rr;
        const x1 = Math.cos(a1) * rr; const y1 = Math.sin(a1) * rr;
        const len = Math.hypot(x1 - x0, y1 - y0);
        const seg = K.box({ color: shade(P.bone, 0.06), size: [len, 0.06, 0.06], family: 'unlit' });
        seg.rotation.z = Math.atan2(y1 - y0, x1 - x0);
        g.add(K.put(seg, (x0 + x1) / 2, (y0 + y1) / 2, 0.1 + ring * 0.02));
      }
    }
    // 尘点（落网碎屑）：网面随机两三粒
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + r() * (Math.PI / 2);
      const rr = rad * (0.3 + r() * 0.6);
      g.add(K.put(K.sphereLo({
        color: shade(P.bone, -0.1), r: 0.09 + r() * 0.06, seg: 0, family: 'unlit',
      }), Math.cos(a) * rr, Math.sin(a) * rr, 0.16));
    }
    return g;
  },
};
