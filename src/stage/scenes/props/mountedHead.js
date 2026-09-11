// 猎头挂饰（CATALOG #81）：「兽首/魔物颅骨，眼窝嵌石」——wallDecor 高带（wood+stone+unlit 三族）。
// 原点=木盾底缘中点（z=0 贴墙面，+z 朝室内，y 向上）；band=high。颅骨=压扁低模球 +
// 方吻/眉骨/下颌组合（骨色 stone 族，后半埋进挂板），眼窝=unlit 夜色深洞（skullPile
// 手法）内嵌 P.stone 提亮石珠。兽首种类走 build(opts)：kind='horned' 弯角 / 'tusked' 獠牙。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'mountedHead',
  place: 'wallDecor',
  band: 'high',
  tags: ['bone'],
  behaviors: [],
  build({ kind = 'horned', teeth = 4, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('mountedHead');
    // 木盾挂板：厚板缺角（猎物钉板）
    const plaque = K.box({ color: shade(P.woodDark, 0.05), size: [3.2, 3.2, 0.3], family: 'wood' });
    K.chip(plaque, { corner: [1, 1, 1], amount: 0.3 });
    g.add(K.put(plaque, 0, 1.72, 0.15));
    // 颅骨：压扁低模球（骨色 stone 族，后半入板贴墙）
    const cr = K.sphereLo({ color: P.bone, r: 1.02, seg: 1, jitter: 0.07, rng: r });
    K.scaleXYZ(cr, 1.0, 0.9, 1.12);
    g.add(K.put(cr, 0, 2.5, 0.95));
    // 眉骨 + 长吻 + 下颌（魔物感：粗眉压眼、方吻前伸）
    g.add(K.put(K.box({ color: shade(P.boneDark, -0.04), size: [1.75, 0.3, 0.55] }), 0, 2.72, 1.6));
    const snoutLen = kind === 'tusked' ? 1.5 : 1.15;
    g.add(K.put(K.box({ color: shade(P.bone, -0.07), size: [0.98, 0.74, snoutLen] }), 0, 2.05, 1.05 + snoutLen / 2));
    g.add(K.put(K.box({ color: P.boneDark, size: [0.86, 0.3, snoutLen - 0.1] }), 0, 1.55, 1.0 + (snoutLen - 0.1) / 2));
    // 鼻孔暗洞（unlit 夜色）
    g.add(K.put(K.box({ color: P.night, size: [0.2, 0.24, 0.08], family: 'unlit' }), 0, 2.21, 1.05 + snoutLen - 0.02));
    // 牙齿：颌缝小方块两排
    const nt = Math.max(0, Math.min(6, Math.round(teeth)));
    for (let i = 0; i < nt; i++) {
      const tx = -0.3 + (i % 2) * 0.6;
      const tz = 1.35 + Math.floor(i / 2) * 0.45;
      g.add(K.put(K.box({ color: shade(P.bone, 0.08), size: [0.13, 0.24, 0.13] }), tx, 1.72, tz));
    }
    // 眼窝：夜色深洞 + 嵌石（unlit 洞盘贴颅面，stone 族石珠凸出洞面读作嵌石）
    for (const ex of [-0.44, 0.44]) {
      const socket = K.cyl({ color: P.night, r: 0.21, h: 0.16, seg: 6, family: 'unlit' });
      K.tilt(socket, Math.PI / 2, 0, 0);               // 轴 y→z 朝前
      g.add(K.put(socket, ex, 2.6, 1.97));
      const gem = K.sphereLo({ color: shade(P.stone, 0.3), r: 0.12, seg: 0 });
      K.scaleXYZ(gem, 1, 1, 0.6);
      g.add(K.put(gem, ex, 2.6, 2.03));
    }
    // 角 / 獠牙（兽首种类）
    if (kind === 'horned') {
      for (const s of [-1, 1]) {
        const horn = K.cyl({ color: shade(P.bone, -0.2), r: 0.24, rTop: 0.1, h: 1.5, seg: 5 });
        K.tilt(horn, 0, 0, -s * 0.95);                 // 向外上扬
        g.add(K.put(horn, s * 0.8, 3.05, 0.95));
        const tip = K.cone({ color: shade(P.bone, -0.26), r: 0.1, h: 0.55, seg: 5 });
        K.tilt(tip, 0, 0, -s * 0.95);
        g.add(K.put(tip, s * 1.63, 3.65, 0.95));
      }
    } else {
      for (const s of [-1, 1]) {                       // 獠牙：自下颌两侧上翘前伸
        const tusk = K.cone({ color: shade(P.bone, -0.12), r: 0.13, h: 1.0, seg: 5 });
        K.tilt(tusk, 0.55, 0, s * 0.15);
        g.add(K.put(tusk, s * 0.32, 2.1, 2.3));
      }
    }
    return g;
  },
};
