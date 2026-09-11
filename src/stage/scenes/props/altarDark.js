// 暗黑祭坛（CATALOG2 编号 59）：「斜面血槽+骷髅位」——墓窟神秘类 prop（stone+unlit 双族）。
// 原点=底面中心（y=0 落地），x=宽 z=深：两级暗阶座 + 整石坛身 + 后位垫起的前倾斜台，
// 斜面上刻血槽（暗刻凹线=压暗石条夹 P.blood 细条，bloodStain 同语汇），血自槽口沿坛身
// 正面淌下；骷髅位=坛上两处小 bone 剪影（颅骨+unlit 眼窝深洞，skullPile 同手法）。
// 变体走 build(opts)：血槽数 channels / 血色深浅 blood / 骷髅数 skulls / 碎骨 bits。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 单个小骷髅头（剪影级，局部原点=颅心）：压扁低模球 + unlit 眼窝 + 下颌
function skull(r) {
  const s = new THREE.Group();
  const cr = K.sphereLo({ color: P.bone, r: 0.4, seg: 1, jitter: 0.07, rng: r, family: 'stone' });
  K.scaleXYZ(cr, 0.94, 0.82, 1.08);
  s.add(cr);
  for (const ex of [-0.15, 0.15]) {
    const eye = K.cyl({ color: P.night, r: 0.09, h: 0.12, seg: 6, family: 'unlit' });
    K.tilt(eye, Math.PI / 2, 0, 0);
    s.add(K.put(eye, ex, 0.05, 0.36));
  }
  s.add(K.put(K.box({ color: P.boneDark, size: [0.28, 0.12, 0.22], family: 'stone' }), 0, -0.26, 0.17));
  return s;
}

export default {
  id: 'altarDark',
  place: 'prop',
  mount: 'floor',
  tags: ['stone', 'crypt'],
  footprint: { x: 4.6, z: 3.2 },
  behaviors: [],
  build({ channels = 1, blood = 0.3, skulls = 2, bits = 2, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('altarDark');
    // 两级暗阶座 + 整石坛身 + 后位垫条（垫起斜台后缘）
    g.add(K.put(K.box({ color: shade(P.stone, -0.2), size: [4.3, 0.4, 2.7], family: 'stone' }), 0, 0.2, 0));
    g.add(K.put(K.box({ color: shade(P.stone, -0.12), size: [3.8, 0.35, 2.35], family: 'stone' }), 0, 0.575, 0));
    const block = K.box({ color: shade(P.stone, -0.08), size: [3.6, 1.75, 2.15], family: 'stone' });
    if (rng) K.jitter(block, r, { rot: 0.008 });
    g.add(K.put(block, 0, 1.625, 0));
    g.add(K.put(K.box({ color: shade(P.stone, -0.14), size: [3.6, 0.6, 0.55], family: 'stone' }), 0, 2.8, -0.75));
    // 前倾斜台：rx 正角使 +z 前缘落低（后缘搭在垫条顶 3.1，前缘悬出坛身）
    const slab = K.box({ color: shade(P.stone, 0.02), size: [3.6, 0.38, 2.3], family: 'stone' });
    K.tilt(slab, 0.24, 0, 0);
    g.add(K.put(slab, 0, 2.67, 0.37));
    // 血槽：中央主槽（暗刻凹线=压暗石条，内嵌 P.blood 细条），同斜角贴在台面上
    const onSlab = (x, w, len) => {
      const groove = K.box({ color: shade(P.stone, -0.5), size: [w, 0.07, len], family: 'stone' });
      K.tilt(groove, 0.24, 0, 0);
      g.add(K.put(groove, x, 2.87, 0.42));
      const strip = K.box({ color: shade(P.blood, blood), size: [w * 0.44, 0.06, len - 0.15], family: 'stone' });
      K.tilt(strip, 0.24, 0, 0);
      g.add(K.put(strip, x, 2.92, 0.43));
    };
    onSlab(0, 0.36, 2.15);
    for (let i = 1; i < Math.min(3, channels); i++) onSlab(i === 1 ? 1.15 : -1.15, 0.24, 1.9);
    // 淌血：主槽口的血沿坛身正面（z+ 面板）垂落一绺
    g.add(K.put(K.box({ color: P.blood, size: [0.14, 0.85, 0.05], family: 'stone' }), 0, 1.78, 1.1));
    // 骷髅位：后垫条顶正位 + 阶座前角侧位（+斜台散位），歪斜各异
    const n = Math.min(3, Math.max(1, skulls));
    const spots = [
      [0, 3.43, -0.75, 0.2],
      [1.45, 1.08, 0.85, 0.55],
      [0.65, 3.12, 0.55, -0.35],
    ];
    for (let i = 0; i < n; i++) {
      const [x, y, z, rz] = spots[i];
      const s = skull(r);
      K.tilt(s, (r() - 0.5) * 0.2, r() * Math.PI * 2, rz + (r() - 0.5) * 0.2);
      g.add(K.put(s, x, y, z));
    }
    // 碎骨：斜台前口与阶座边散落小段
    for (let i = 0; i < bits; i++) {
      const bit = K.cyl({
        color: i % 2 ? P.boneDark : P.bone, r: 0.05, h: 0.3 + r() * 0.2, seg: 4, family: 'stone',
      });
      K.tilt(bit, (r() - 0.5) * 0.15, r() * Math.PI * 2, Math.PI / 2 + (r() - 0.5) * 0.4);
      g.add(K.put(bit, -1.3 + i * 1.9 + (r() - 0.5) * 0.4, 0.06 + i * 0.02, 1.05 - i * 0.35));
    }
    return g;
  },
};
