// 铁匠工具架（CATALOG2 编号 47）：「立架挂锤钳锉」——prop 类（wood 立架 + metal 工具 双族）。
// 原点=底面中心（y=0 落地），x=宽 z=深；双立柱 + 上横轨（挂工具）+ 下层搁板，全高约 4.3。
// 锤钳锉=剪影级小 box/cyl 组合，自横轨前伸的木挂钉垂挂（挂点=组原点，整体可微歪）。
// 变体走 build(opts)：锤数 hammers / 钳数 tongs / 锉数 files（0~2，等距摊到挂位）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

// 手锤（剪影级）：铁锤头横卧 + 木柄下垂，原点=挂点（头勾在挂钉上）
function buildHammer() {
  return K.grp(
    K.put(K.box({ color: shade(P.iron, 0.08), size: [0.62, 0.3, 0.3], family: 'metal' }), 0, -0.15, 0),
    K.put(K.cyl({ color: P.wood, r: 0.07, h: 1.05, seg: 5 }), 0, -0.825, 0),
  );
}

// 铁钳（剪影级）：两长臂上端并拢挂在铆钉处、下端张开成夹口（rz 对称外撇）
function buildTongs() {
  const g = K.grp(
    K.put(K.box({ color: P.iron, size: [0.18, 0.16, 0.1], family: 'metal' }), 0, -0.08, 0),
  );
  for (const s of [-1, 1]) {
    const arm = K.put(K.box({
      color: shade(P.iron, -0.05), size: [0.1, 1.55, 0.08], family: 'metal',
    }), s * 0.1, -0.72, 0);
    K.tilt(arm, 0, 0, s * 0.15); // 臂顶并拢、臂底外张
    g.add(arm);
  }
  return g;
}

// 锉刀（剪影级）：提亮钢锉身 + 上端木手柄，原点=挂点
function buildFile() {
  return K.grp(
    K.put(K.cyl({ color: P.woodDark, r: 0.075, h: 0.4, seg: 5 }), 0, -0.2, 0),
    K.put(K.box({ color: shade(P.iron, 0.22), size: [0.13, 1.3, 0.07], family: 'metal' }), 0, -1.05, 0),
  );
}

export default {
  id: 'toolRackSmith',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'metal', 'smith'],
  footprint: { x: 4.2, z: 2.2 },
  behaviors: [],
  build({ hammers = 1, tongs = 1, files = 1, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('toolRackSmith');
    // 立架：双立柱 + 上横轨（挂工具）+ 中横档 + 下层搁板
    for (const s of [-1, 1]) {
      g.add(K.put(K.box({ color: P.woodDark, size: [0.32, 4.3, 0.32] }), s * 1.62, 2.15, 0));
    }
    g.add(K.put(K.box({ color: P.wood, size: [3.7, 0.3, 0.26] }), 0, 3.68, 0));
    g.add(K.put(K.box({ color: P.woodDark, size: [3.35, 0.22, 0.22] }), 0, 2.0, 0));
    g.add(K.put(K.box({ color: P.wood, size: [3.1, 0.16, 0.8] }), 0, 1.3, 0.1));
    // 柱脚外伸垫脚（前伸后蹬，立架站稳）
    for (const s of [-1, 1]) {
      g.add(K.put(K.box({ color: P.woodDark, size: [0.95, 0.24, 1.45] }), s * 1.55, 0.12, 0.15));
    }
    // 工具队列：锤钳锉按需拼装，等距摊到横轨挂位
    const builders = [];
    for (let i = 0; i < Math.max(0, Math.min(2, hammers)); i++) builders.push(buildHammer);
    for (let i = 0; i < Math.max(0, Math.min(2, tongs)); i++) builders.push(buildTongs);
    for (let i = 0; i < Math.max(0, Math.min(2, files)); i++) builders.push(buildFile);
    builders.forEach((make, i) => {
      const x = builders.length === 1 ? 0 : -1.15 + (i * 2.3) / (builders.length - 1);
      // 挂钉：横轨下前伸的短木销（rx 90° 转向 +z）
      const peg = K.cyl({ color: P.wood, r: 0.05, h: 0.42, seg: 5 });
      K.tilt(peg, Math.PI / 2, 0, 0);
      g.add(K.put(peg, x, 3.45, 0.24));
      const tool = make();
      K.tilt(tool, (r() - 0.5) * 0.06, 0, (r() - 0.5) * 0.08); // 挂垂微歪
      g.add(K.put(tool, x, 3.45, 0.34));
    });
    return g;
  },
};
