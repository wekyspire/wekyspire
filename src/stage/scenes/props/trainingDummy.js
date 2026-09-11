// 训练木人（CATALOG2 编号 53）：「桩身横臂+旧盔歪戴」——军事类 prop/floor（桩木 wood + 铁盔 metal + 眼缝 unlit 三族）。
// 原点=底面中心；鼓座+防滑垫板承独桩，上横臂贯穿桩身、一头微沉（用旧松脱、端头削角），
// 下一侧短撑斜出；桩身两面锤凹暗斑（压扁 sphereLo 半嵌桩面）；桩顶歪戴旧盔：
// 压扁球盔 + 宽檐 + 鼻柱 + unlit 眼缝暗线横贯脸前，整盔侧倾读「歪戴」。
// 变体走 build(opts)：横臂倾角/盔歪角/锤凹数（0~3）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'trainingDummy',
  place: 'prop',
  mount: 'floor',
  tags: ['wood', 'metal', 'barrack'],
  footprint: { x: 4, z: 2.6 },
  behaviors: [],
  build({ arm = 0.07, helm = 0.24, dents = 2, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('trainingDummy');
    // 鼓座 + 防滑垫板承独桩
    g.add(K.put(K.box({ color: P.woodDark, size: [2.7, 0.26, 0.72], family: 'wood' }), 0, 0.13, 0));
    g.add(K.put(K.cyl({
      color: shade(P.wood, -0.06), r: 1.12, rTop: 1.04, h: 0.75, seg: 8, family: 'wood',
    }), 0, 0.63, 0));
    // 桩身：独木柱略收顶、微歪的手工感
    const post = K.cyl({ color: P.wood, r: 0.44, rTop: 0.37, h: 6.35, seg: 6, family: 'wood' });
    K.jitter(post, r, { rot: 0.012 });
    g.add(K.put(post, 0, 3.72, 0));
    // 横臂：贯穿桩身的厚木梁，一头微沉（用旧松脱），抬端削角
    const beam = K.box({ color: P.woodDark, size: [3.5, 0.42, 0.42], family: 'wood' });
    K.chip(beam, { corner: [1, 0, 1], amount: 0.12 });
    K.tilt(beam, 0, 0, Math.min(Math.max(arm, -0.15), 0.15));
    g.add(K.put(beam, 0, 5.35, 0));
    // 下撑短腿：斜出一侧
    g.add(K.put(K.tilt(K.box({
      color: P.woodDark, size: [1.7, 0.3, 0.3], family: 'wood',
    }), 0, 0, -0.14), 0.95, 3.05, 0));
    // 桩身锤凹暗斑：压扁 sphereLo 半嵌桩面（深浅微差）
    for (let i = 0; i < Math.min(Math.max(dents, 0), 3); i++) {
      const dent = K.sphereLo({
        color: shade(P.woodDark, -0.16), r: 0.4, seg: 0, jitter: 0.22, rng: r, family: 'wood',
      });
      K.scaleXYZ(dent, 1, 1, 0.45);
      K.tilt(dent, 0, r() * Math.PI, 0);
      g.add(K.put(dent, (r() - 0.5) * 0.2, 4.1 + i * 0.85, 0.33));
    }
    // 旧盔歪戴：宽檐 + 檐上收口 + 压扁球盔 + 鼻柱 + unlit 眼缝暗线，整盔侧倾
    const helmGrp = K.grp(
      K.put(K.cyl({ color: shade(P.iron, -0.14), r: 0.82, h: 0.15, seg: 8, family: 'metal' }), 0, 7.0, 0),
      K.put(K.cyl({
        color: shade(P.iron, 0.02), r: 0.74, rTop: 0.68, h: 0.2, seg: 8, family: 'metal',
      }), 0, 7.14, 0),
      K.put(K.scaleXYZ(K.sphereLo({
        color: shade(P.iron, 0.08), r: 0.68, seg: 0, family: 'metal',
      }), 1, 0.72, 1), 0, 7.34, 0),
      K.put(K.box({ color: shade(P.iron, -0.1), size: [0.16, 0.52, 0.16], family: 'metal' }), 0, 7.18, 0.66),
      K.put(K.box({ color: P.night, size: [0.68, 0.12, 0.3], family: 'unlit' }), 0, 7.42, 0.55),
    );
    K.tilt(helmGrp, 0.03, 0.08, Math.min(Math.max(helm, 0.05), 0.4));
    g.add(K.put(helmGrp, 0, 0, 0));
    return g;
  },
};
