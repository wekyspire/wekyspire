// 壁挂工具板（CATALOG2 编号 108）：「钉挂钳锤+线锯」——wallDecor 低带挂件（wood+metal 双族）。
// 原点=墙面挂点（z=0 贴墙，+z 朝室内；band=low 主体在正 y 近原点，板底近 y=0，同 hooksRope 口径）：
// 整幅木板+上下压边条，木销前伸钉挂工具——钳/锤剪影沿用 toolRackSmith 写法，线锯=上木握手梁
// +金属 C 框两臂+口部细锯条（垂挂长件优先上排）。板 ~5.2 宽 × ~3.4 高。
// 变体走 build(opts)：锤数 hammers /钳数 tongs /线锯数 saws（各 0~2）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 手锤（剪影级，同 toolRackSmith）：铁锤头横卧 + 木柄下垂，原点=挂点
function buildHammer() {
  return K.grp(
    K.put(K.box({ color: shade(P.iron, 0.08), size: [0.62, 0.3, 0.3], family: 'metal' }), 0, -0.15, 0),
    K.put(K.cyl({ color: P.wood, r: 0.07, h: 1.05, seg: 5, family: 'wood' }), 0, -0.825, 0),
  );
}

// 铁钳（剪影级，同 toolRackSmith）：铆头 + 两臂顶并拢挂点、臂底外张成夹口
function buildTongs() {
  const t = K.grp(
    K.put(K.box({ color: P.iron, size: [0.18, 0.16, 0.1], family: 'metal' }), 0, -0.08, 0),
  );
  for (const s of [-1, 1]) {
    const arm = K.put(K.box({ color: shade(P.iron, -0.05), size: [0.1, 1.55, 0.08], family: 'metal' }), s * 0.1, -0.72, 0);
    K.tilt(arm, 0, 0, s * 0.15);
    t.add(arm);
  }
  return t;
}

// 线锯（剪影级）：上木握手梁 + 金属框两臂 + 口部细锯条（提亮钢色），原点=挂点
function buildSaw() {
  return K.grp(
    K.put(K.box({ color: P.woodDark, size: [0.7, 0.24, 0.16], family: 'wood' }), 0, -0.12, 0.1),
    K.put(K.box({ color: P.iron, size: [0.1, 1.35, 0.09], family: 'metal' }), -0.33, -0.85, 0),
    K.put(K.box({ color: P.iron, size: [0.1, 1.35, 0.09], family: 'metal' }), 0.33, -0.85, 0),
    K.put(K.box({ color: shade(P.iron, 0.2), size: [0.56, 0.06, 0.04], family: 'metal' }), 0, -1.48, 0.04),
  );
}

// 挂位表：上排居中留给长件线锯，其余上下交错摊开（x,y 即钉位）
const SLOTS = [
  [0, 2.8], [-1.7, 1.8], [1.7, 1.8],
  [-1.7, 2.8], [1.7, 2.8], [0, 1.8],
];

export default {
  id: 'toolWallBoard',
  place: 'wallDecor',
  band: 'low',
  tags: ['wood', 'metal', 'smith'],
  behaviors: [],
  build({ hammers = 1, tongs = 1, saws = 1, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('toolWallBoard');
    // 挂板：整幅木板 + 上下压边条
    g.add(K.put(K.box({ color: P.wood, size: [5.2, 3.4, 0.16], family: 'wood' }), 0, 2.05, 0.08));
    for (const y of [3.65, 0.45]) {
      g.add(K.put(K.box({ color: shade(P.woodDark, 0.06), size: [5.2, 0.3, 0.24], family: 'wood' }), 0, y, 0.12));
    }
    // 工具队列：线锯优先占上排（垂挂长件），再锤再钳，按挂位表摊开
    const builders = [];
    for (let i = 0; i < Math.max(0, Math.min(2, saws)); i++) builders.push(buildSaw);
    for (let i = 0; i < Math.max(0, Math.min(2, hammers)); i++) builders.push(buildHammer);
    for (let i = 0; i < Math.max(0, Math.min(2, tongs)); i++) builders.push(buildTongs);
    builders.slice(0, SLOTS.length).forEach((make, i) => {
      const [x, y] = SLOTS[i];
      const peg = K.cyl({ color: P.woodDark, r: 0.06, h: 0.42, seg: 5, family: 'wood' });
      K.tilt(peg, Math.PI / 2, 0, 0);
      g.add(K.put(peg, x, y, 0.3));
      const tool = make();
      K.tilt(tool, (r() - 0.5) * 0.06, 0, (r() - 0.5) * 0.08);  // 挂垂微歪
      g.add(K.put(tool, x, y, 0.42));
    });
    return g;
  },
};
