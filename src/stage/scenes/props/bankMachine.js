// 银行机（休息房·赌厅副陈设）：灰扑扑的旧柜机——投币口、出钞口、小屏与键盘块。
// 与老虎机成对出现（SLOT_MACHINE.md：老虎机很慷慨，银行机很吝啬）：造型上刻意更矮更素、
// 无金饰、屏更小更冷（幽青），读作"机能机"而非"赌具"。
// 原点=底面中心（y=0 落地），宽约 2.8 / 深约 2.2 / 高约 5.6。
//
// 布光职责：同 slotMachine——自带 unlit 发光面 + `lamp` 标签（配方层出无火焰点光池）。

import * as THREE from 'three';
import { P, K, shade } from '../kit/index.js';

export default {
  id: 'bankMachine',
  place: 'prop',
  mount: 'floor',
  tags: ['machine', 'metal', 'container', 'lamp', 'casino', 'interactive'],
  footprint: { x: 3.6, z: 2.8 },
  behaviors: [],
  build({ bodyH = 4.6, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('bankMachine');
    const W = 2.6, D = 2.0;
    const body = shade(P.stone, -0.1);

    // 底座（比老虎机更方的矮墩）
    g.add(K.put(K.box({ color: shade(P.stone, -0.22), size: [W + 0.24, 0.34, D + 0.18], family: 'stone' }),
      0, 0.17, 0));

    // 柜身：花岗/铁灰方柜 + 顶部斜面（旧柜台机的形状）
    const y0 = 0.34;
    g.add(K.put(K.box({ color: body, size: [W, bodyH, D], family: 'stone' }), 0, y0 + bodyH / 2, 0));
    const lid = K.box({ color: shade(P.stone, -0.04), size: [W - 0.1, 0.5, D - 0.1], family: 'stone' });
    K.tilt(lid, -0.22, 0, 0);
    g.add(K.put(lid, 0, y0 + bodyH + 0.12, -0.06));

    // 小屏：幽青自发光（比老虎机的转轮窗更小更冷）+ 屏框（铁件）
    const sy = y0 + bodyH * 0.66;
    g.add(K.put(K.box({ color: shade(P.iron, -0.1), size: [1.7, 1.15, 0.24], family: 'metal' }),
      0, sy, D / 2 + 0.02));
    // 屏幕与扫描线：kit 图元（unlit 顶点色）；**材质由 rig 换成独立实例**后逐帧驱动
    const screen = K.put(K.box({ color: P.glowCyan, size: [1.25, 0.72, 0.1], family: 'unlit' }),
      0, sy, D / 2 + 0.16);
    screen.userData.animRole = 'screen';
    g.add(screen);
    const scanline = K.put(K.box({ color: shade(P.glowCyan, -0.5), size: [1.25, 0.1, 0.1], family: 'unlit' }),
      0, sy - 0.32, D / 2 + 0.17);
    scanline.userData.animRole = 'scanline';
    g.add(scanline);

    // 键盘块：三行小键（unlit 微光，读作指示灯）+ 斜台
    const ky = y0 + bodyH * 0.34;
    const pad = K.box({ color: shade(P.iron, -0.16), size: [1.9, 0.24, 0.9], family: 'metal' });
    K.tilt(pad, -0.5, 0, 0);
    g.add(K.put(pad, 0, ky, D / 2 - 0.24));
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 4; col++) {
        g.add(K.put(K.box({ color: shade(P.silver, -0.25 + row * 0.06), size: [0.26, 0.08, 0.18], family: 'metal' }),
          -0.66 + col * 0.44, ky + 0.32 - row * 0.2, D / 2 - 0.06 + row * 0.16));
      }
    }

    // 投币口（细缝，金边）与出钞口（更宽的暗槽）
    g.add(K.put(K.box({ color: P.gold, size: [0.6, 0.1, 0.2], family: 'metal' }),
      0.62, sy - 0.62, D / 2 + 0.06));
    g.add(K.put(K.box({ color: P.night, size: [1.1, 0.34, 0.3], family: 'metal' }),
      -0.3, y0 + 0.5, D / 2 + 0.08));
    g.add(K.put(K.box({ color: shade(P.iron, -0.2), size: [1.1, 0.1, 0.3], family: 'metal' }),
      -0.3, y0 + 0.31, D / 2 + 0.09));

    // 侧面一小块散热栅（铁件细条，打散大平面）
    for (let i = 0; i < 4; i++) {
      g.add(K.put(K.box({ color: shade(P.iron, -0.26), size: [0.1, 0.5, 0.9], family: 'metal' }),
        W / 2 + 0.02, y0 + 1.0 + i * 0.6, -0.2));
    }
    // 顶部指示灯带（三个独立材质小灯：处理中逐灯闪）
    const bulbs = [];
    for (let i = 0; i < 3; i++) {
      const mesh = K.sphereLo({ color: shade(P.potionRed, -0.35), r: 0.13, family: 'unlit' });
      mesh.position.set(W / 2 - 0.75 + i * 0.4, y0 + bodyH + 0.42, 0);
      mesh.userData.animRole = 'bulb';
      g.add(mesh);
      bulbs.push(mesh);
    }
    g.userData.parts = { body: g, screen, scanline, bulbs };
    g.userData.interactive = 'bank';

    return g;
  },
};
