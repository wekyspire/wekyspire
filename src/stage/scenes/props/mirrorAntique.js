// 古镜（CATALOG2 编号 110）：「椭圆框+雾面反光片」——wallDecor 中带（metal+unlit 双族）。
// 原点=墙面挂点投影（z=0 贴墙、+z 朝室内，主体正 y 近原点）；band=mid，全高约 5.1。
// 椭圆=先拉局部 z 再转倒的低模圆盘（cyl 转倒朝前，局部 z 伸长读作纵向椭圆）；框=
// 双层铁环（压暗外环 + 提亮内缘逐层前凸）；镜片=unlit 银灰微亮片（不吃光平面读雾面
// 反光）+ 斜向亮擦痕两道读玻璃反光；顶饰菱花 + 沿框锈斑压扁球（岁月感）。
// 变体走 build(opts)：patina 锈斑数（0~4）/glint 反光条有无/tall 椭圆纵向比（1.15/1.32）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'mirrorAntique',
  place: 'wallDecor',
  band: 'mid',
  tags: ['metal', 'quarters'],
  behaviors: [],
  build({ patina = 2, glint = true, tall = 1.32, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('mirrorAntique');
    const ey = Math.min(1.45, Math.max(1.1, tall));        // 椭圆纵向拉伸比
    const cy = 2.4;                                        // 镜心 y（底缘 ~0.42）
    // 椭圆盘零件：cyl 轴转倒朝 +z、先 scale 局部 z 再 tilt（旋转后局部 z 落到世界 y）
    const ovalDisc = (rad, h, color, family) => {
      const m = K.cyl({ color, r: rad, h, seg: 10, family });
      K.scaleXYZ(m, 1, 1, ey);
      K.tilt(m, Math.PI / 2);
      return m;
    };
    // 双层铁环：压暗外环（贴墙）+ 提亮内缘（前凸一档）
    g.add(K.put(ovalDisc(1.5, 0.45, shade(P.iron, -0.16), 'metal'), 0, cy, 0.24));
    g.add(K.put(ovalDisc(1.28, 0.22, shade(P.iron, 0.06), 'metal'), 0, cy, 0.36));
    // 雾面镜片：unlit 银灰微亮（不吃光读反光）+ 斜向亮擦痕两道
    g.add(K.put(ovalDisc(1.19, 0.07, shade(P.silver, -0.08), 'unlit'), 0, cy, 0.42));
    if (glint) {
      const g1 = K.box({ color: shade(P.silver, 0.3), size: [0.32, 1.9, 0.05], family: 'unlit' });
      K.tilt(g1, 0, 0, -0.52);
      g.add(K.put(g1, -0.5, cy + 0.4, 0.47));
      const g2 = K.box({ color: shade(P.silver, 0.3), size: [0.18, 0.9, 0.05], family: 'unlit' });
      K.tilt(g2, 0, 0, -0.52);
      g.add(K.put(g2, 0.3, cy - 0.55, 0.47));
    }
    // 顶饰：框顶菱花 + 上珠
    const crest = K.box({ color: shade(P.iron, 0.12), size: [0.78, 0.78, 0.22], family: 'metal' });
    K.tilt(crest, 0, 0, Math.PI / 4);
    g.add(K.put(crest, 0, cy + 1.5 * ey + 0.26, 0.32));
    g.add(K.put(K.sphereLo({ color: shade(P.iron, 0.2), r: 0.14, seg: 0, family: 'metal' }), 0, cy + 1.5 * ey + 0.78, 0.32));
    // 锈斑：沿框缘的压扁小球（青绿锈色读岁月）
    const np = Math.min(4, Math.max(0, Math.round(patina)));
    for (let i = 0; i < np; i++) {
      const a = (i / Math.max(1, np)) * Math.PI * 1.7 + 0.4 + r() * 0.3;
      const blob = K.sphereLo({
        color: [P.mossDark, shade(P.mossDark, 0.14), shade(P.iron, -0.34)][i % 3],
        r: 0.26 + r() * 0.1, seg: 0, jitter: 0.2, rng: r, family: 'metal',
      });
      K.scaleXYZ(blob, 1, 0.55, 0.4);
      g.add(K.put(blob, Math.cos(a) * 1.5, cy + Math.sin(a) * 1.5 * ey, 0.42));
    }
    return g;
  },
};
