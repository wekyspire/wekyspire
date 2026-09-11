// 大油画（CATALOG #77）：「昏暗人物画，厚框深影」——wallDecor 中带（wood+unlit 双族）。
// 原点=画框底缘中点（z=0 贴墙面，+z 朝室内，y 向上）：厚框深出墙面，框口内衬
// shade(P.woodDark) 压暗窄缘读作深影；画布=unlit 暗底片（不吃光、稳定读暗），人物剪影=
// 苍白面孔 + 深色肩身 + 合手小块（shade 拉暗反差），左幅暗条压回底色让半身没入阴影。
// 变体走 build(opts)：画幅宽高（人物结构随之缩放）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'paintingGrand',
  place: 'wallDecor',
  band: 'mid',
  tags: ['wood'],
  behaviors: [],
  build({ w = 7, h = 9, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('paintingGrand');
    const bw = 0.85;                     // 框缘宽
    const fd = 0.8;                      // 框厚（深影厚度）
    const inW = w - 2 * bw, inH = h - 2 * bw;
    // 厚框四缘（wood 族，微色差出旧木手工感）
    const tone = [shade(P.wood, -0.02), shade(P.wood, -0.08), shade(P.woodDark, 0.06)][Math.floor(r() * 3)];
    g.add(K.put(K.box({ color: tone, size: [w, bw, fd], family: 'wood' }), 0, h - bw / 2, fd / 2));
    g.add(K.put(K.box({ color: shade(P.wood, -0.06), size: [w, bw, fd], family: 'wood' }), 0, bw / 2, fd / 2));
    const side = shade(P.woodDark, 0.04);
    g.add(K.put(K.box({ color: side, size: [bw, inH, fd], family: 'wood' }), -(w - bw) / 2, h / 2, fd / 2));
    g.add(K.put(K.box({ color: side, size: [bw, inH, fd], family: 'wood' }), (w - bw) / 2, h / 2, fd / 2));
    // 框影内衬：压暗 woodDark 窄缘骑在框口内沿、退进框深（读作框内投影）
    const lw = 0.34, lz = 0.5, ld = 0.3;
    const lin = shade(P.woodDark, -0.22);
    g.add(K.put(K.box({ color: lin, size: [inW + lw * 2, lw, ld], family: 'wood' }), 0, h - bw, lz));
    g.add(K.put(K.box({ color: lin, size: [inW + lw * 2, lw, ld], family: 'wood' }), 0, bw, lz));
    g.add(K.put(K.box({ color: lin, size: [lw, inH, ld], family: 'wood' }), -(w - bw) / 2, h / 2, lz));
    g.add(K.put(K.box({ color: lin, size: [lw, inH, ld], family: 'wood' }), (w - bw) / 2, h / 2, lz));
    // 画布底片：unlit 暗底（边缘藏进框后，仅框口内可见）
    g.add(K.put(K.box({ color: shade(P.clayDark, -0.34), size: [inW + 0.2, inH + 0.2, 0.1], family: 'unlit' }), 0, h / 2, 0.36));
    // 人物剪影（unlit 色块，反差全走 shade）：
    const torso = K.box({ color: shade(P.woodDark, -0.42), size: [inW * 0.62, h * 0.34, 0.07], family: 'unlit' });
    g.add(K.put(torso, 0, h * 0.3, 0.47));              // 肩身：深色大块
    const head = K.sphereLo({ color: shade(P.bone, -0.5), r: h * 0.075, seg: 1, jitter: 0.1, rng: r, family: 'unlit' });
    K.scaleXYZ(head, 0.9, 1.05, 0.38);
    g.add(K.put(head, 0, h * 0.56, 0.38));              // 苍白面孔：微亮浮于暗底
    g.add(K.put(K.box({ color: shade(P.bone, -0.62), size: [0.55, 0.3, 0.06], family: 'unlit' }), 0, h * 0.42, 0.47)); // 合手
    g.add(K.put(K.box({ color: shade(P.clayDark, -0.36), size: [inW * 0.3, inH, 0.06], family: 'unlit' }), -inW * 0.36, h / 2, 0.52)); // 左幅暗条
    // 框底铭牌：小铜牌微凸出框面
    g.add(K.put(K.box({ color: shade(P.gold, -0.18), size: [1.15, 0.42, 0.09], family: 'wood' }), 0, bw / 2, fd + 0.02));
    return g;
  },
};
