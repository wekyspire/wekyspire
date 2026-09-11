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
  // 灯池强度系数：机器灯池**推到了机身前方**（见 composeRoom 的 LAMP_FRONT_PUSH），
  // 离受光面比'埋机箱里'近得多，同 base 会把正面照爆成白光 —— 按 gain 压到 ~1/10（0.34→0.10：正红壳体在高光下会先丢色相变粉，
  // 实测机壳像素 (249,143,137) 即过曝，压到 0.10 后由房间中央光主导 → 深红）。
  lampGain: 0.10,
  lampColor: shade(P.glowCyan, 0.15),   // **冷色**：银行机连灯池都发冷光（用户定）
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

    // 小屏：幽青自发光（比老虎机的转轮窗更小更冷）。**屏幕是嵌进面板的凹口**（用户定：
    // "正面来点起伏"）——外框厚出柜面、屏面退到框内，四周留出倒角阴影。
    const sy = y0 + bodyH * 0.66;
    const bzW = 1.6, bzH = 1.06, bzZ = D / 2 + 0.20;      // 外框（厚，凸出柜面 0.32）
    g.add(K.put(K.box({ color: shade(P.iron, -0.16), size: [bzW, bzH, 0.44], family: 'metal' }),
      0, sy, bzZ - 0.1));
    g.add(K.put(K.box({ color: shade(P.iron, -0.30), size: [1.32, 0.8, 0.06], family: 'metal' }),
      0, sy, bzZ + 0.02));                                // 凹腔底（屏就贴在它前面一点）
    // 屏幕与扫描线：kit 图元（unlit 顶点色）；**材质由 rig 换成独立实例**后逐帧驱动
    const screen = K.put(K.box({ color: P.glowCyan, size: [1.25, 0.72, 0.05], family: 'unlit' }),
      0, sy, bzZ + 0.09);
    screen.userData.animRole = 'screen';
    screen.userData.screenText = '余额 0';   // rig 用 bakeBoldText 烘上去 + 闪烁
    g.add(screen);
    const scanline = K.put(K.box({ color: shade(P.glowCyan, -0.5), size: [1.25, 0.1, 0.05], family: 'unlit' }),
      0, sy - 0.32, bzZ + 0.12);
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

    // ================= 正面起伏（用户定 2026-09-11："至少正面来点起伏"）=================
    // ① 两根竖向壁柱：从底座通到顶，凸出柜面 0.14 —— 把正面切成"左柱 / 屏 / 右柱"三段
    for (const sx of [-1, 1]) {
      g.add(K.put(K.box({ color: shade(P.stone, 0.04), size: [0.24, bodyH + 0.2, 0.28], family: 'stone' }),
        sx * (W / 2 - 0.22), y0 + bodyH / 2 + 0.1, D / 2 + 0.06));
    }
    // ② 中缝凹槽（两柱之间一条暗竖缝 + 上下端头，读作钣金拼接）
    g.add(K.put(K.box({ color: shade(P.night, 0.18), size: [0.1, bodyH - 0.1, 0.1], family: 'metal' }),
      0, y0 + bodyH / 2, D / 2 + 0.02));
    // ③ 操作台唇边：键盘斜台外沿的挡边（原来台面是平的，没有层次）
    g.add(K.put(K.box({ color: shade(P.iron, -0.24), size: [2.0, 0.14, 0.12], family: 'metal' }),
      0, y0 + bodyH * 0.34 - 0.02, D / 2 + 0.14));
    // ④ 顶冠：比柜身宽一档的檐板 + 一道凹线（机构感、也给顶部收边）
    g.add(K.put(K.box({ color: shade(P.stone, 0.06), size: [W + 0.16, 0.16, D + 0.1], family: 'stone' }),
      0, y0 + bodyH + 0.42, 0));
    g.add(K.put(K.box({ color: shade(P.night, 0.2), size: [W + 0.18, 0.06, D + 0.12], family: 'metal' }),
      0, y0 + bodyH + 0.33, 0));

    // 侧面一小块散热栅（铁件细条，打散大平面）
    for (let i = 0; i < 4; i++) {
      g.add(K.put(K.box({ color: shade(P.iron, -0.26), size: [0.1, 0.5, 0.9], family: 'metal' }),
        W / 2 + 0.02, y0 + 1.0 + i * 0.6, -0.2));
    }
    // 顶部指示灯带（三个独立材质小灯：处理中逐灯闪）
    const bulbs = [];
    for (let i = 0; i < 3; i++) {
      // 冷银指示灯（原来偏红，和"冷漠安静"的定调不符）：闪动只由 rig 在操作时驱动
      const mesh = K.sphereLo({ color: shade(P.silver, -0.4), r: 0.13, family: 'unlit' });
      mesh.position.set(W / 2 - 0.75 + i * 0.4, y0 + bodyH + 0.42, 0);
      mesh.userData.animRole = 'bulb';
      g.add(mesh);
      bulbs.push(mesh);
    }

    // ================= 冷感细节（用户定 2026-09-11：银行机要"冷漠安静"）=================
    // ① 屏幕遮光罩：屏上方一块前倾的板 —— 机构感、把屏幕压进阴影里（冷）
    const hood = K.box({ color: shade(P.iron, -0.28), size: [1.86, 0.1, 0.44], family: 'metal' });
    K.tilt(hood, 0.34, 0, 0);
    g.add(K.put(hood, 0, sy + 0.62, D / 2 + 0.16));
    // ② 屏下冷光灯带：unlit 冷青细条（自己会亮，配合 bloom 给屏幕一圈冷光）
    g.add(K.put(K.box({ color: P.glowCyan, size: [1.5, 0.05, 0.06], family: 'unlit' }),
      0, sy - 0.5, D / 2 + 0.2));
    // ③ 插卡槽（右）+ 卡片微光：读作"要插卡才能用"的冷机器
    g.add(K.put(K.box({ color: shade(P.iron, -0.34), size: [0.7, 0.12, 0.24], family: 'metal' }),
      -0.66, sy - 0.2, D / 2 + 0.08));
    g.add(K.put(K.box({ color: shade(P.silver, -0.15), size: [0.5, 0.05, 0.1], family: 'unlit' }),
      -0.66, sy - 0.2, D / 2 + 0.16));
    // ④ 背面散热排（细密百叶，打散大平面；机构感）
    for (let i = 0; i < 5; i++) {
      g.add(K.put(K.box({ color: shade(P.iron, -0.3), size: [W - 0.6, 0.06, 0.1], family: 'metal' }),
        0, y0 + 2.4 + i * 0.16, -D / 2 - 0.05));
    }
    // ⑤ 底座棱线（更方更硬的落地感）
    g.add(K.put(K.box({ color: shade(P.stone, -0.3), size: [W + 0.3, 0.12, D + 0.24], family: 'stone' }),
      0, 0.38, 0));
    g.userData.parts = { body: g, screen, scanline, bulbs };
    g.userData.interactive = 'bank';

    return g;
  },
};
