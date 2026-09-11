// 老虎机（休息房·赌厅**可动组件**）：立柜 + 三**转轮鼓** + 顶灯牌 + 侧拉杆 + 屏幕彩灯。
// 原点=底面中心（y=0 落地），柜体宽约 3.4 / 深约 2.4 / 高约 8.4。
//
// **可动件契约**（用户定 2026-09-11：老虎机/银行机是场景中有复杂动画的可动组件）：
//   build() 返回的 Group 上挂 `userData.parts`：
//     parts.body       整体（中奖激动时整体抖动）
//     parts.leverPivot 拉杆枢轴（绕 Z 旋转 = 拉下/弹起；杆与球头是它的子件）
//     parts.reels[]    三个**转轮鼓**（真圆柱：侧面按图案分带逐面顶点色 + 两端暗色盖；
//                      绕 X 旋转 = 换面；每组 userData.symbols 是图案色序，index 是当前面）
//     parts.bulbs[]    屏幕一圈彩灯（rig 换成独立材质后逐灯驱动）
//   ⚠ 不得进静态合批（配方 guaranteed 条目加 `live: true`）。
//
// 近景细节（用户定 2026-09-11：怼脸能看见的部分要够细）：屏幕框（四边金属压边）+ 付款线 +
// 窗内暗背板 + 拉杆座/护罩 + 投币口/出币盘/按钮 + 踢脚板。**滚轴鼓走吃光族**（M.stone）——
// 聚焦追光要能把它照亮（见 interactive/slotMachineRig.js 与 rooms/lighting.js 的 setFocus）。
//
// 布光职责：自带 unlit 发光面（彩灯/顶灯牌/按钮） + `lamp` 标签（配方层出无火焰点光池）。
// ⚠ 网格数已到 `interactive` 预算上限（60，见 test/sceneProps.test.js）：再加件必须同时删件。

import * as THREE from 'three';
import { P, K, shade, M } from '../kit/index.js';

// 转轮图案（占位色：等美术资产到位换成纹理面）
export const SLOT_SYMBOLS = [P.potionRed, P.potionGreen, P.potionBlue, P.gold];

/**
 * 转轮鼓几何：侧面按图案分带（每带再分若干段，读作圆柱弧面）+ 两端暗色盖。
 * **带心口径**：图案 k 占角度扇区 `[k/N, (k+1)/N)`，带心在 `(k+0.5)/N·2π` ——
 * rig 的落面角按同一口径取负带心（两处必须一致，否则每格停在两带接缝上）。
 * 逐面顶点色（每段 4 个独立顶点，避免色带跨面插值）；材质用 kit 的 unlit 共享族
 * （资产禁自建材质是契约）。图案 k 的带心在角度 `k/N·2π`，故绕 X 转 `-k/N·2π` 即把它转到正前。
 */
function drumGeometry({ radius, width, colors, segPerBand = 4, coreColor }) {
  const bands = colors.length;
  const seg = bands * segPerBand;
  const pos = [];
  const col = [];
  const push = (v, c) => { pos.push(v[0], v[1], v[2]); col.push(c.r, c.g, c.b); };
  const tmp = new THREE.Color();
  const bandColor = (i, k) => {
    // 带内轻微明暗分档：让圆柱面读得出弧度（越靠带缘越暗）
    const edge = Math.abs(((i % segPerBand) / segPerBand) * 2 - 1);
    return tmp.set(colors[k]).multiplyScalar(1 - 0.16 * edge);
  };
  // **轴向 = X**（窗口宽度方向）：真老虎机的滚轮绕左右向的水平轴转，图案面朝观众。
  // 面点 = (x, sin a·r, cos a·r)（a=0 即正前 +z）；x 是轴向（= 鼓宽）。
  const hx = width / 2;
  const P3 = (a, x) => [x, Math.sin(a) * radius, Math.cos(a) * radius];
  // ---- 侧面：seg 段 × 2 三角（每段独立四顶点 → 色带边界干净）----
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2;
    const a1 = ((i + 1) / seg) * Math.PI * 2;
    const k = Math.floor(i / segPerBand) % bands;
    const c = bandColor(i, k).clone();
    const vA = P3(a0, -hx), vB = P3(a1, -hx), vC = P3(a1, hx), vD = P3(a0, hx);
    // 绕序必须**朝外**（轴向改到 X 后原绕序变内向 → 被背面剔除，整根鼓看不见）
    push(vA, c); push(vD, c); push(vC, c);
    push(vA, c); push(vC, c); push(vB, c);
  }
  // ---- 两端盖：扇形（暗色，读作鼓轴端面；在 ±X 面上）----
  const cap = new THREE.Color(coreColor);
  for (const [x, flip] of [[hx, false], [-hx, true]]) {
    const cSeg = 12;
    for (let i = 0; i < cSeg; i++) {
      const a0 = (i / cSeg) * Math.PI * 2;
      const a1 = ((i + 1) / cSeg) * Math.PI * 2;
      const p0 = P3(a0, x), p1 = P3(a1, x), ctr = [x, 0, 0];
      if (flip) { push(ctr, cap); push(p0, cap); push(p1, cap); }
      else { push(ctr, cap); push(p1, cap); push(p0, cap); }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

export default {
  id: 'slotMachine',
  place: 'prop',
  mount: 'floor',
  tags: ['machine', 'metal', 'container', 'lamp', 'casino', 'interactive'],
  footprint: { x: 5.6, z: 3.6 },
  behaviors: [],
  build({ bodyH = 6.4, reelCount = 3, marqueeW = 3.2, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('slotMachine');
    const W = 3.4, D = 2.4, T = 0.32;
    const iron = shade(P.iron, -0.08);
    const gold = P.gold;

    // 投币窗尺寸（**必须早于柜体**：柜体是围绕开口拼出来的，不是一整块箱子）
    const y0 = 0.64;
    const winY = y0 + bodyH * 0.52;
    const winW = W - 1.0;
    // 开口高度 ≈ 一格图案：开口要**明显小于鼓直径**，把转轮裁成"窗口里的一格图案"——
    // 开口≥鼓径时整根鼓（含上下相邻图案）都露出来，读作三行机而不是单线机；
    // 开口过高则每根鼓只剩一条竖条（读作窗格里立着三根柱子，不像滚轴）。
    const winH = bodyH * 0.19;
    const drumR = 0.9;

    // ================= 柜体（带**真实开窗**）=================
    // 病灶备忘：早期版本柜体是一整块箱子，窗口只是正面上的暗色矩形 + 从箱面探出的鼓顶——
    // 怼脸看到的是一块平的色块（不是滚轴），"暗背板"也埋在箱子里根本没露面。
    // 现在 = 上/下横梁 + 左右立柱围出真开口，鼓退到开口后方（真凹腔），暗背板才是屏底。
    g.add(K.put(K.box({ color: shade(P.iron, -0.26), size: [W + 0.34, 0.3, D + 0.24], family: 'metal' }),
      0, 0.15, 0));
    g.add(K.put(K.box({ color: shade(P.iron, -0.18), size: [W + 0.18, 0.34, D + 0.12], family: 'metal' }),
      0, 0.47, 0));
    const cabTop = y0 + bodyH, cabBot = y0;
    const openTop = winY + winH / 2, openBot = winY - winH / 2;
    const postW = Math.max(0.42, (W - winW) / 2);
    g.add(K.put(K.box({ color: iron, size: [W, cabTop - openTop, D], family: 'metal' }),
      0, (openTop + cabTop) / 2, 0));                                    // 上横梁
    g.add(K.put(K.box({ color: iron, size: [W, openBot - cabBot, D], family: 'metal' }),
      0, (cabBot + openBot) / 2, 0));                                    // 下横梁
    for (const sx of [-1, 1]) {
      g.add(K.put(K.box({ color: shade(iron, -0.04), size: [postW, winH, D], family: 'metal' }),
        sx * (winW / 2 + postW / 2), winY, 0));                          // 左右立柱
    }
    // 背板（开口后方的暗底：腔体自成一个暗箱，鼓在前、背板在最后）
    // ⚠ 原另有一层"机身后侧的侧影背板"，怼脸/正面都看不到（网格数已到 interactive 预算上限），已删。
    // 柜体金饰：两侧立柱 + 上横箍（各 1 件）
    for (const sx of [-1, 1]) {
      g.add(K.put(K.box({ color: gold, size: [T * 0.8, bodyH, T * 0.8], family: 'metal' }),
        sx * (W / 2 - 0.12), y0 + bodyH / 2, D / 2 - 0.1));
    }
    g.add(K.put(K.box({ color: gold, size: [W, T * 0.7, T * 0.7], family: 'metal' }), 0, y0 + bodyH - 0.1, D / 2 - 0.1));

    // ================= 屏幕窗（怼脸主角）=================
    // 窗内暗背板（腔底，隔着鼓在最后；开窗后它才真正可见）
    g.add(K.put(K.box({ color: P.night, size: [winW + 1.0, winH + 1.6, 0.3], family: 'metal' }),
      0, winY, -0.62));
    // 四边金属压边（bezel）：上下各一条 + 左右各一条（内侧亮一档，读作倒角）
    const bzT = 0.26, bzD = 0.42;
    g.add(K.put(K.box({ color: shade(gold, 0.06), size: [winW + 0.9, bzT, bzD], family: 'metal' }),
      0, openTop + bzT / 2, D / 2 + 0.06));
    g.add(K.put(K.box({ color: shade(gold, -0.08), size: [winW + 0.9, bzT, bzD], family: 'metal' }),
      0, openBot - bzT / 2, D / 2 + 0.06));
    for (const sx of [-1, 1]) {
      g.add(K.put(K.box({ color: shade(gold, 0.02), size: [bzT, winH + 0.4, bzD], family: 'metal' }),
        sx * (winW / 2 + 0.42), winY, D / 2 + 0.06));
    }
    // 付款线（经典老虎机的横向标线）：**画在滚轴之前**（真机是印在前玻璃上的），
    // 否则会被鼓身挡住（早期版本就埋在鼓里看不见）
    g.add(K.put(K.box({ color: shade(P.potionRed, 0.12), size: [winW + 0.2, 0.055, 0.07], family: 'unlit' }),
      0, winY, D / 2 + 0.16));

    // ================= 三个转轮鼓 =================
    const cellW = winW / reelCount;
    const reels = [];
    for (let i = 0; i < reelCount; i++) {
      const cx = -winW / 2 + cellW * (i + 0.5);
      const drum = new THREE.Group();       // 绕 X 旋转换面
      const radius = drumR;
      // **鼓退到开口后方**（前表面比柜面低 0.07 = 真凹腔；背面仍在柜内 D/2 之内），
      // 开口比鼓径小 → 只看见正前那一格图案 + 上下极窄的邻格边。
      drum.position.set(cx, winY, D / 2 - radius - 0.07);
      const mesh = new THREE.Mesh(
        drumGeometry({ radius, width: cellW - 0.08, colors: SLOT_SYMBOLS, coreColor: shade(P.night, 0.14) }),
        // **吃光族**（不是 unlit）：滚轴要能被"聚焦追光"照亮——zoomin 时房间压暗、屏幕被打亮，
        // 才是"照亮老虎机屏幕"（unlit 会让鼓面恒定亮度、追光打在屏上毫无反应）。顶点色照旧承载图案。
        M.stone,
      );
      drum.add(mesh);
      drum.userData.symbols = SLOT_SYMBOLS;
      // 初始就**停在图案面上**（三根各停一个不同图案，读作"待机的真机"）。
      // 不设的话 rotation=0 会把两带接缝摆在正前（付款线上是半红半金的拼色），很假。
      const initIdx = i % SLOT_SYMBOLS.length;
      drum.userData.index = initIdx;
      drum.rotation.x = -(((initIdx + 0.5) / SLOT_SYMBOLS.length) * Math.PI * 2);
      g.add(drum);
      reels.push(drum);
    }

    // ================= 屏幕彩灯（rig 换独立材质后逐灯驱动）=================
    // **必须挂在压边框上**：沿压边中心线矩形排布、球心嵌进框体一点。早期版本把它们悬在窗口
    // 前方 0.42 处（无依托），怼脸看就是一圈浮空的球（用户报障）。
    const bulbs = [];
    const ringZ = D / 2 + 0.06 + bzD / 2 - 0.05;     // 压边前表面稍内，读作"嵌在框上"
    const rTopY = openTop + bzT / 2, rBotY = openBot - bzT / 2;
    const rSideX = winW / 2 + 0.42;
    const spanX = winW / 2 + 0.24;
    const ring = [];
    for (let i = 0; i < 5; i++) {                     // 上下边各 5 颗（间距均匀）
      const x = -spanX + (i / 4) * spanX * 2;
      ring.push([x, rTopY], [x, rBotY]);
    }
    for (const sx of [-1, 1]) {                       // 左右边各 2 颗
      ring.push([sx * rSideX, winY + 0.42], [sx * rSideX, winY - 0.42]);
    }
    // 彩灯**逐颗不同色**（用户定："多加几个彩灯"）：色序写在 userData.tint 上，
    // rig 的常亮呼吸/中奖灯效都按这颗的底色走（rig 会换掉材质，这里只负责登记色相）。
    const RING_TINTS = [P.gold, P.potionRed, P.flameCore, P.potionGreen, P.gold, P.potionBlue];
    ring.forEach(([bx, by], i) => {
      const tint = RING_TINTS[i % RING_TINTS.length];
      const mesh = K.sphereLo({ color: tint, r: 0.15, family: 'unlit' });
      mesh.position.set(bx, by, ringZ);
      mesh.userData.animRole = 'bulb';
      mesh.userData.tint = tint;
      g.add(mesh);
      bulbs.push(mesh);
    });

    // ================= 顶灯牌 =================
    const my = y0 + bodyH + 0.5;
    g.add(K.put(K.box({ color: shade(P.iron, -0.15), size: [marqueeW, 1.0, 0.6], family: 'metal' }),
      0, my, D / 2 - 0.3));
    g.add(K.put(K.box({ color: P.ember, size: [marqueeW - 0.5, 0.34, 0.1], family: 'unlit' }),
      0, my + 0.1, D / 2 + 0.02));

    // ================= 正面图案装饰（怼脸细节，用户定 2026-09-11："多加彩灯、条纹"）=================
    // 立柱上的双色细条（红 pinstripe + 金边）：立柱是窗口两侧最显近景的平面，纯色太空
    for (const sx of [-1, 1]) {
      g.add(K.put(K.box({ color: shade(P.potionRed, -0.12), size: [0.09, winH + 0.6, 0.05], family: 'metal' }),
        sx * (winW / 2 + 0.25), winY, D / 2 + 0.035));
      g.add(K.put(K.box({ color: gold, size: [0.045, winH + 0.6, 0.05], family: 'metal' }),
        sx * (winW / 2 + 0.40), winY, D / 2 + 0.035));
    }
    // 窗口与操作台之间的双横线（金粗 + 红细）：把正面切成"窗 / 腰线 / 台面"三段
    g.add(K.put(K.box({ color: gold, size: [W - 0.5, 0.08, 0.05], family: 'metal' }),
      0, openBot - 0.34, D / 2 + 0.03));
    g.add(K.put(K.box({ color: shade(P.potionRed, -0.1), size: [W - 1.3, 0.05, 0.05], family: 'metal' }),
      0, openBot - 0.6, D / 2 + 0.03));
    // 顶灯牌两侧的小彩灯（unlit 常亮，与屏幕圈灯同族语汇）→ 见下方"额头"装饰
    // 额头（窗顶横梁正面）：怼脸时**最大的一片留白**——一条金带 + 红菱形徽记把它收住
    g.add(K.put(K.box({ color: gold, size: [W - 0.7, 0.09, 0.05], family: 'metal' }),
      0, cabTop - 0.62, D / 2 + 0.03));
    g.add(K.put(
      K.tilt(K.box({ color: shade(P.potionRed, -0.05), size: [0.32, 0.32, 0.05], family: 'metal' }), 0, 0, Math.PI / 4),
      0, cabTop - 1.25, D / 2 + 0.03,
    ));

    // ================= 操作台（怼脸下部）=================
    const py = y0 + bodyH * 0.2;
    // 台面（略外挑，前沿亮一档读作厚度）
    g.add(K.put(K.box({ color: shade(P.iron, 0.03), size: [W - 0.4, 0.34, 0.9], family: 'metal' }),
      0, py, D / 2 - 0.20));
    g.add(K.put(K.box({ color: shade(P.iron, 0.12), size: [W - 0.4, 0.09, 0.9], family: 'metal' }),
      0, py + 0.2, D / 2 - 0.20));
    // 投币口（金框 + 暗缝）
    g.add(K.put(K.box({ color: gold, size: [0.5, 0.16, 0.22], family: 'metal' }),
      -0.75, py + 0.26, D / 2 - 0.02));
    g.add(K.put(K.box({ color: P.night, size: [0.34, 0.05, 0.1], family: 'metal' }),
      -0.75, py + 0.26, D / 2 + 0.06));
    // 三颗按钮（金圈 + 玻璃芯，unlit 自发光）
    for (let i = 0; i < 3; i++) {
      const bx = 0.15 + i * 0.62;
      g.add(K.put(K.cyl({ color: gold, r: 0.22, h: 0.12, seg: 8, family: 'metal' }),
        bx, py + 0.26, D / 2 - 0.04));
      g.add(K.put(K.cyl({
        color: [P.potionRed, P.flameCore, P.potionBlue][i], r: 0.13, h: 0.1, seg: 8, family: 'unlit',
      }), bx, py + 0.32, D / 2 - 0.04));
    }
    // 出币盘（凹槽 + 盘底）
    g.add(K.put(K.box({ color: P.night, size: [1.7, 0.74, 0.4], family: 'metal' }),
      0, y0 + 0.36, D / 2 + 0.06));
    g.add(K.put(K.box({ color: gold, size: [1.4, 0.12, 0.34], family: 'metal' }),
      0, y0 + 0.04, D / 2 + 0.06));
    // 底部踢脚板（近景收边）
    g.add(K.put(K.box({ color: shade(P.iron, -0.3), size: [W - 0.1, 0.5, 0.16], family: 'metal' }),
      0, 0.42, D / 2 + 0.14));

    // ================= 侧拉杆（枢轴在柜体外）=================
    // 座 + 护罩（一件）与枢轴分离：护罩固定在柜上，枢轴带着杆摆动
    g.add(K.put(K.box({ color: shade(P.iron, -0.22), size: [0.5, 0.9, 0.72], family: 'metal' }),
      W / 2 + 0.1, winY - 0.9, 0));
    const leverPivot = new THREE.Group();
    leverPivot.position.set(W / 2 + 0.22, winY - 0.9, 0);
    // 轴心圆盘（读作转轴）
    leverPivot.add(K.put(K.cyl({ color: shade(P.iron, -0.1), r: 0.26, h: 0.3, seg: 8, family: 'metal' }),
      0, 0, 0));
    const rodMesh = K.cyl({ color: shade(P.silver, 0.16), r: 0.12, h: 2.0, seg: 6, family: 'metal' });
    rodMesh.userData.animRole = 'leverRod';
    leverPivot.add(K.put(rodMesh, 0.28, 0.92, 0));
    const knobMesh = K.sphereLo({ color: shade(P.copper, 0.18), r: 0.34, jitter: 0.03, rng: r, family: 'metal' });
    knobMesh.userData.animRole = 'leverKnob';
    leverPivot.add(K.put(knobMesh, 0.56, 1.86, 0));
    g.add(leverPivot);

    g.userData.parts = { body: g, leverPivot, reels, bulbs };
    g.userData.interactive = 'slot';
    return g;
  },
};
