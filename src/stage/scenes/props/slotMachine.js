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

// 转轮图案（5 档）：`key` 对应美术图 `assets/props/symbol_<key>`（由 rig 侧贴到带面上），
// `color` 是**贴图未就绪 / 无贴图时的兜底带色**（顶点色衬底一直画着，alpha 镂空处露的就是它）。
// ⚠ 鼓面数 = 本数组长度；rig 的落面角按同一长度分带，改长度即改"轮盘有几个面"。
export const SLOT_SYMBOLS = Object.freeze([
  { key: 'cherry', color: P.potionRed },
  { key: 'seven', color: P.gold },
  { key: 'gem', color: P.gold },
  { key: 'apple', color: P.potionGreen },
  { key: 'clover', color: P.potionGreen },
]);

/**
 * 转轮鼓几何：**不透明衬底 + 逐带贴图覆盖层**。
 * **带心口径**：图案 k 占角度扇区 `[k/N, (k+1)/N)`，带心在 `(k+0.5)/N·2π` ——
 * rig 的落面角按同一口径取负带心（两处必须一致，否则每格停在两带接缝上）。
 * 结构（两套顶点，共用同一坐标系）：
 *   ① 衬底：侧面按带分段顶点色 + 两端暗盖 —— 永远画着，贴图 alpha 镂空处露出来的就是它
 *      （**不能只画贴图**：alpha 透明会看穿鼓身，看到被剔除的内背面/后景）；
 *   ② 覆盖层：每带一份四边形（UV 0..1，半径 +gap 抬出衬底表面防 z-fighting），
 *      每带一个 **geometry group** → rig 可用 5 个独立材质（各带一张图）一次贴上。
 * 覆盖层 group 的 materialIndex = 带序号 k（0..N-1），rig 按 `userData.symbolKeys[k]` 取图。
 * 逐面顶点色（每段 4 个独立顶点，避免色带跨面插值）；图案 k 的带心在角度 `k/N·2π`，
 * 故绕 X 转 `-k/N·2π` 即把它转到正前。
 */
function drumGeometry({ radius, width, colors, segPerBand = 4, coreColor, overlay = false, overlayGap = 0.02,
  iconHalf = 0.31, iconSeg = 3, iconUv = { u0: 0.18, u1: 0.85, v0: 0.207, v1: 0.852 } }) {
  const bands = colors.length;
  const seg = bands * segPerBand;
  const pos = [];
  const col = [];
  const uv = [];
  const push = (v, c, u = 0, w = 0) => {
    pos.push(v[0], v[1], v[2]);
    col.push(c.r, c.g, c.b);
    uv.push(u, w);
  };
  const tmp = new THREE.Color();
  const bandColor = (i, k) => {
    // 带内轻微明暗分档：让圆柱面读得出弧度（越靠带缘越暗）
    const edge = Math.abs(((i % segPerBand) / segPerBand) * 2 - 1);
    return tmp.set(colors[k]).multiplyScalar(1 - 0.16 * edge);
  };
  // **轴向 = X**（窗口宽度方向）：真老虎机的滚轮绕左右向的水平轴转，图案面朝观众。
  // 面点 = (x, sin a·r, cos a·r)（a=0 即正前 +z）；x 是轴向（= 鼓宽）。
  const hx = width / 2;
  const P3 = (a, x, r = radius) => [x, Math.sin(a) * r, Math.cos(a) * r];
  // ---- ① 衬底侧面：seg 段 × 2 三角（每段独立四顶点 → 色带边界干净）----
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
  // ---- ① 两端盖：扇形（暗色，读作鼓轴端面；在 ±X 面上）----
  const cap = new THREE.Color(coreColor);
  for (const [x, flip] of [[hx, false], [-hx, true]]) {
    const cSeg = 6;      // 端盖扇形段数（预算紧：6 段足够读作圆盘）
    for (let i = 0; i < cSeg; i++) {
      const a0 = (i / cSeg) * Math.PI * 2;
      const a1 = ((i + 1) / cSeg) * Math.PI * 2;
      const p0 = P3(a0, x), p1 = P3(a1, x), ctr = [x, 0, 0];
      if (flip) { push(ctr, cap); push(p0, cap); push(p1, cap); }
      else { push(ctr, cap); push(p1, cap); push(p0, cap); }
    }
  }
  // ---- ② 覆盖层：每带一张**方形图案补丁**（rig 逐带贴图）----
  // 为什么要"方形补丁"而不是"整条带"：带面在世界里是 0.72(宽) × 1.13(弧长) 的窄长条，
  // 直接把方图铺满整条带 → 图标被纵向拉长 1.56 倍（用户报障）。现在补丁是正方形，
  // 且只采素材的图标包围盒（`iconUv`），宽高比 1:1 映射 → 不变形。
  // 画框不在鼓上：**静止的"窗口分格框"**画在窗口内（见 buildCellFrames），
  // 这样"框发光、图案不发光"天经地义，也省掉鼓上那圈顶点。
  // 分组（materialIndex）：0..N-1 = 各带图案；N = 衬底。
  // ⚠ 一旦 rig 把 material 换成**数组**，three 只画有 group 的区间（projectObject 按组遍历）——
  // 所以衬底也必须登记成一个 group。
  const groups = [{ start: 0, count: pos.length / 3, material: bands }];
  if (overlay) {
    const rIcon = radius + overlayGap * 1.6;         // 抬出衬底表面，防 z-fighting
    const halfAngle = (a) => a / radius;             // 弧长 → 角度
    for (let k = 0; k < bands; k++) {
      const start = pos.length / 3;
      const c = tmp.set(colors[k]).clone();          // 未贴图时与衬底同色（不出现白条）
      const aC = ((k + 0.5) / bands) * Math.PI * 2;  // 带心
      const half = halfAngle(iconHalf);
      for (let j = 0; j < iconSeg; j++) {
        const a0 = aC - half + (j / iconSeg) * half * 2;
        const a1 = aC - half + ((j + 1) / iconSeg) * half * 2;
        // v 沿弧向（贴图 flipY：画布 y 向下 → v 向上，故用 (1 - y) 映射）
        const v0 = iconUv.v0 + (j / iconSeg) * (iconUv.v1 - iconUv.v0);
        const v1 = iconUv.v0 + ((j + 1) / iconSeg) * (iconUv.v1 - iconUv.v0);
        const vA = P3(a0, -iconHalf, rIcon), vB = P3(a1, -iconHalf, rIcon);
        const vC2 = P3(a1, iconHalf, rIcon), vD = P3(a0, iconHalf, rIcon);
        push(vA, c, iconUv.u0, v0); push(vD, c, iconUv.u1, v0); push(vC2, c, iconUv.u1, v1);
        push(vA, c, iconUv.u0, v0); push(vC2, c, iconUv.u1, v1); push(vB, c, iconUv.u0, v1);
      }
      groups.push({ start, count: pos.length / 3 - start, material: k });
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  for (const g of groups) geo.addGroup(g.start, g.count, g.material);
  geo.computeVertexNormals();
  return geo;
}

export default {
  id: 'slotMachine',
  place: 'prop',
  mount: 'floor',
  tags: ['machine', 'metal', 'container', 'lamp', 'casino', 'interactive'],
  // 灯池强度系数：机器灯池**推到了机身前方**（见 composeRoom 的 LAMP_FRONT_PUSH），
  // 离受光面比'埋机箱里'近得多，同 base 会把正面照爆成白光 —— 按 gain 压到 ~1/10（0.34→0.10：正红壳体在高光下会先丢色相变粉，
  // 实测机壳像素 (249,143,137) 即过曝，压到 0.10 后由房间中央光主导 → 深红）。
  lampGain: 0.10,
  lampColor: shade(P.gold, 0.3),   // 机器自带暖金色（不占彩灯串的颜色轮转位）
  footprint: { x: 5.6, z: 3.6 },
  behaviors: [],
  build({ bodyH = 6.4, reelCount = 3, marqueeW = 3.2, rng } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('slotMachine');
    const W = 3.4, D = 2.4, T = 0.32;
    const iron = shade(P.iron, -0.08);
    const gold = P.gold;
    // 外壳正红（用户定 2026-09-11：对标可乐机——稍偏暗、纯度高）：只刷**壳体大面**，
    // 五金件（灯牌框/拉杆/操作台/踢脚板）保持铁色，红金+黑铁才有赌具的硬质感。
    const shell = P.machineRed;
    const shellDark = shade(P.machineRed, -0.28);

    // 投币窗尺寸（**必须早于柜体**：柜体是围绕开口拼出来的，不是一整块箱子）
    const y0 = 0.64;
    const winY = y0 + bodyH * 0.52;
    const winW = W - 1.0;
    // 开口高度 ≈ 一格图案：开口要**明显小于鼓直径**，把转轮裁成"窗口里的一格图案"——
    // 开口≥鼓径时整根鼓（含上下相邻图案）都露出来，读作三行机而不是单线机；
    // 开口过高则每根鼓只剩一条竖条（读作窗格里立着三根柱子，不像滚轴）。
    const winH = bodyH * 0.19;
    const cellW = winW / reelCount;   // 单格宽（分格框/转轮鼓/锁定指示灯共用口径）
    const drumR = 0.9;

    // ================= 柜体（带**真实开窗**）=================
    // 病灶备忘：早期版本柜体是一整块箱子，窗口只是正面上的暗色矩形 + 从箱面探出的鼓顶——
    // 怼脸看到的是一块平的色块（不是滚轴），"暗背板"也埋在箱子里根本没露面。
    // 现在 = 上/下横梁 + 左右立柱围出真开口，鼓退到开口后方（真凹腔），暗背板才是屏底。
    g.add(K.put(K.box({ color: shellDark, size: [W + 0.34, 0.3, D + 0.24], family: 'metal' }),
      0, 0.15, 0));
    g.add(K.put(K.box({ color: shade(shell, -0.16), size: [W + 0.18, 0.34, D + 0.12], family: 'metal' }),
      0, 0.47, 0));
    const cabTop = y0 + bodyH, cabBot = y0;
    const openTop = winY + winH / 2, openBot = winY - winH / 2;
    const postW = Math.max(0.42, (W - winW) / 2);
    g.add(K.put(K.box({ color: shell, size: [W, cabTop - openTop, D], family: 'metal' }),
      0, (openTop + cabTop) / 2, 0));                                    // 上横梁
    g.add(K.put(K.box({ color: shell, size: [W, openBot - cabBot, D], family: 'metal' }),
      0, (cabBot + openBot) / 2, 0));                                    // 下横梁
    for (const sx of [-1, 1]) {
      g.add(K.put(K.box({ color: shade(shell, -0.08), size: [postW, winH, D], family: 'metal' }),
        sx * (winW / 2 + postW / 2), winY, 0));                          // 左右立柱
    }
    // 背板（开口后方的暗底：腔体自成一个暗箱，鼓在前、背板在最后）
    // ⚠ 原另有一层"机身后侧的侧影背板"，怼脸/正面都看不到（网格数已到 interactive 预算上限），已删。
    // 柜体金饰：两侧立柱 + 顶部横箍（各 1 件）。**前脸一律落在 L1 带（→1.308）**，
    // 不再贴柜面 1.20 前后 0.01 徘徊（那是窗框区闪烁的来源之一）。
    for (const sx of [-1, 1]) {
      g.add(K.put(K.box({ color: gold, size: [T * 0.8, bodyH, T * 0.8], family: 'metal' }),
        sx * (W / 2 - 0.12), y0 + bodyH / 2, D / 2 - 0.02));
    }
    g.add(K.put(K.box({ color: gold, size: [W, T * 0.7, T * 0.7], family: 'metal' }), 0, y0 + bodyH - 0.1, D / 2 - 0.03));

    // ================= 屏幕窗（怼脸主角）=================
    // **前脸分层口径（消除 z-fighting，用户报障）**：一切贴在正面的件都按"离面深度带"排布，
    // 相邻带差 ≥0.04，绝不留两片共面（共面 = 深度精度内互相闪烁）。
    //   L0 柜面 1.200 ｜ L1 立柱金饰 →1.228 ｜ L2 压边框 →1.410 ｜ L3 灯泡/指示灯（嵌进框）1.350
    //   ｜ L4 付款线 1.450 ｜ L5 额头/腰线饰片 1.23~1.31
    // 另外压边框**不许比柜体宽**（早前 1.62+0.13=1.75 越过了柜宽 1.7，和柜侧/立柱交叉）。
    // 窗内暗背板（腔底，隔着鼓在最后；开窗后它才真正可见）
    g.add(K.put(K.box({ color: P.night, size: [winW + 1.0, winH + 1.6, 0.3], family: 'metal' }),
      0, winY, -0.62));
    // 四边金属压边（bezel）：上下各一条 + 左右各一条，围出一个**恰好套住开口**的方框
    // （带条宽 bzT：外缘 = winW/2 + bzT = 1.42，落在柜侧立柱内侧 1.432 之内 → 不再交叉）
    const bzT = 0.22, bzD = 0.34;
    const bzZ = D / 2 + 0.04;                 // 框中心：前脸 1.41（离柜面 0.21）
    g.add(K.put(K.box({ color: shade(gold, 0.06), size: [winW + bzT * 2, bzT, bzD], family: 'metal' }),
      0, openTop + bzT / 2, bzZ));
    g.add(K.put(K.box({ color: shade(gold, -0.08), size: [winW + bzT * 2, bzT, bzD], family: 'metal' }),
      0, openBot - bzT / 2, bzZ));
    for (const sx of [-1, 1]) {
      g.add(K.put(K.box({ color: shade(gold, 0.02), size: [bzT, winH + bzT * 2, bzD], family: 'metal' }),
        sx * (winW / 2 + bzT / 2), winY, bzZ));
    }
    // 付款线（经典老虎机的横向标线）：**画在滚轴之前**（真机是印在前玻璃上的），
    // 否则会被鼓身挡住；也必须在压边框之前，否则被框的内缘切掉
    g.add(K.put(K.box({ color: shade(P.potionRed, 0.12), size: [winW + 0.24, 0.055, 0.07], family: 'unlit' }),
      0, winY, bzZ + bzD / 2 + 0.04));

    // ================= 横向拨针（转轮正上方，rig 驱动）=================
    // 真机窗口上缘有根横向指示针：转轮一开转就被带着抖/偏，稳定后慢慢归位（用户定 2026-09-11）。
    // 枢轴自带（整根针绕中点摆），针体只有 1 个 mesh（网格预算已顶格）。
    const needlePivot = new THREE.Group();
    needlePivot.position.set(0, openTop - 0.06, D / 2 - 0.10);
    needlePivot.add(K.put(
      K.box({ color: shade(P.gold, 0.10), size: [winW * 0.86, 0.07, 0.08], family: 'metal' }),
      0, 0, 0,
    ));
    g.add(needlePivot);

    // ================= 窗口分格框（静止，自带灯带光）=================
    // 三根转轮的正前各镶一个**方框**（内口 = 图案补丁口径）：框发光、图案不发光，
    // 顺带把三个转轮在视觉上分开（真机的窗口就是分格的）。整组拼成**一个 mesh**
    // （网格预算只剩 1 个空位）。unlit 顶点色乘到 HDR → 走 bloom 的亮部通道。
    {
      const fh = 0.36;          // 框外半宽（略大于图案补丁的 iconHalf=0.30）
      const fi = 0.30;          // 框内口半宽 = 图案补丁半宽
      const fz = D / 2 - 0.02;  // 在鼓前、压边框之后
      const fcol = new THREE.Color(P.gold).multiplyScalar(2.6);   // unlit + HDR → 自发光
      const fpos = [];
      const fcolArr = [];
      const quad = (x0, y0, x1, y1) => {
        const v = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
        for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
          for (const idx of [a, b, c]) {
            fpos.push(v[idx][0], v[idx][1], fz);
            fcolArr.push(fcol.r, fcol.g, fcol.b);
          }
        }
      };
      for (let i = 0; i < reelCount; i++) {
        const cx = -winW / 2 + cellW * (i + 0.5);
        const y0 = winY - fh, y1 = winY + fh;
        quad(cx - fh, y1 - (fh - fi), cx + fh, y1);        // 上边
        quad(cx - fh, y0, cx + fh, y0 + (fh - fi));        // 下边
        quad(cx - fh, y0, cx - fi, y1);                    // 左边
        quad(cx + fi, y0, cx + fh, y1);                    // 右边
      }
      const fgeo = new THREE.BufferGeometry();
      fgeo.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
      fgeo.setAttribute('color', new THREE.Float32BufferAttribute(fcolArr, 3));
      fgeo.computeVertexNormals();
      const fmesh = new THREE.Mesh(fgeo, M.unlit);          // kit 共享族（资产禁自建材质）
      fmesh.userData.animRole = 'cellFrame';
      g.add(fmesh);
    }

    // ================= 三个转轮鼓 =================
    const reels = [];
    for (let i = 0; i < reelCount; i++) {
      const cx = -winW / 2 + cellW * (i + 0.5);
      const drum = new THREE.Group();       // 绕 X 旋转换面
      const radius = drumR;
      // **鼓退到开口后方**（前表面比柜面低 0.07 = 真凹腔；背面仍在柜内 D/2 之内），
      // 开口比鼓径小 → 只看见正前那一格图案 + 上下极窄的邻格边。
      drum.position.set(cx, winY, D / 2 - radius - 0.07);
      const mesh = new THREE.Mesh(
        drumGeometry({
          radius, width: cellW - 0.08, coreColor: shade(P.night, 0.14),
          colors: SLOT_SYMBOLS.map((sy) => sy.color),
          overlay: true,                       // 方形画框 + 方形图案补丁（rig 贴 symbol_<key> 美术图）
          // 画框自带光（unlit 顶点色，乘到 HDR 让 bloom 拾它）——**图案本身不发光**：
          // 图案走吃光族，只被灯光照亮。iconHalf = 图案补丁半宽（世界单位，正方形不拉伸）
          iconHalf: 0.30,
        }),
        // **吃光族**（不是 unlit）：滚轴要能被"聚焦追光"照亮——zoomin 时房间压暗、屏幕被打亮，
        // 才是"照亮老虎机屏幕"（unlit 会让鼓面恒定亮度、追光打在屏上毫无反应）。顶点色照旧承载图案。
        M.stone,
      );
      drum.add(mesh);
      drum.userData.symbols = SLOT_SYMBOLS.map((sy) => sy.key);
      drum.userData.symbolKeys = SLOT_SYMBOLS.map((sy) => `symbol_${sy.key}`);   // assets/props/*
      drum.userData.drumMesh = mesh;
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
    const reelLamps = [];
    const ringZ = bzZ + bzD / 2 - 0.06;              // 嵌进压边前脸（L3），球心在框体内
    const rTopY = openTop + bzT / 2, rBotY = openBot - bzT / 2;
    const rSideX = winW / 2 + bzT / 2;
    const spanX = winW / 2 + bzT / 2;
    // 彩灯**逐颗不同色**（用户定："多加几个彩灯"）：色相写在 userData.tint 上，
    // rig 的常亮呼吸/中奖灯效都按这颗的底色走（rig 会换掉材质，这里只负责登记色相）。
    // 注意不要用 flameCore 这类近白色：亮起来会整圈糊成白（用户报障过）。
    const RING_TINTS = [P.gold, P.potionRed, P.potionBlue, P.potionGreen, P.gold, P.ember];
    let tintI = 0;
    const addBulb = (bx, by) => {
      const tint = RING_TINTS[tintI++ % RING_TINTS.length];
      const mesh = K.sphereLo({ color: tint, r: 0.15, family: 'unlit' });
      mesh.position.set(bx, by, ringZ);
      mesh.userData.animRole = 'bulb';
      mesh.userData.tint = tint;
      g.add(mesh);
      bulbs.push(mesh);
    };
    for (const sx of [-1, 1]) addBulb(sx * rSideX, rTopY);              // 上边两端各一颗（同在压边框上）
    for (let i = 0; i < 5; i++) addBulb(-spanX + (i / 4) * spanX * 2, rBotY);  // 下边 5 颗
    for (const sx of [-1, 1]) {                                        // 左右边各 2 颗
      addBulb(sx * rSideX, winY + 0.42);
      addBulb(sx * rSideX, winY - 0.42);
    }
    // **三颗"锁定指示灯"**（用户定 2026-09-11）：正对三根转轮的正上方，体量略大——
    // rig 驱动：转轮没停时灭、停稳后亮（一眼看出哪一根咬合了）。
    for (let i = 0; i < reelCount; i++) {
      const lamp = K.sphereLo({ color: shade(P.gold, -0.35), r: 0.2, family: 'unlit' });
      lamp.position.set(-winW / 2 + cellW * (i + 0.5), rTopY, ringZ + 0.07);
      lamp.userData.animRole = 'reelLamp';
      g.add(lamp);
      reelLamps.push(lamp);
    }

    // ================= 顶灯牌 =================
    // 牌体前脸退到 1.15（**不许和柜面 1.20 共面**：共面只在 y=7.04 相接，远看就是一条闪缝）
    const my = y0 + bodyH + 0.5;
    g.add(K.put(K.box({ color: shade(shell, -0.22), size: [marqueeW, 1.0, 0.5], family: 'metal' }),
      0, my, D / 2 - 0.36));
    g.add(K.put(K.box({ color: P.ember, size: [marqueeW - 0.5, 0.34, 0.1], family: 'unlit' }),
      0, my + 0.1, D / 2 - 0.11));

    // ================= 正面图案装饰（怼脸细节，用户定 2026-09-11："多加彩灯、条纹"）=================
    // 立柱上的红细线：**贴在最外的金立柱脸上**（L1.5 带）——早前那条金线在 x=±1.60
    // 被压边框整个吞掉、还和立柱前脸共面闪烁，已删。
    for (const sx of [-1, 1]) {
      g.add(K.put(K.box({ color: shade(P.potionRed, -0.12), size: [0.07, winH + 0.5, 0.08], family: 'metal' }),
        sx * (W / 2 - 0.12), winY, D / 2 + 0.14));
    }
    // 窗口与操作台之间的双横线（金粗 + 红细，L5 带 1.235~1.305）：把正面切成"窗 / 腰线 / 台面"三段
    g.add(K.put(K.box({ color: gold, size: [W - 0.5, 0.08, 0.07], family: 'metal' }),
      0, openBot - 0.34, D / 2 + 0.07));
    g.add(K.put(K.box({ color: shade(P.potionRed, -0.1), size: [W - 1.3, 0.05, 0.07], family: 'metal' }),
      0, openBot - 0.6, D / 2 + 0.07));
    // 额头（窗顶横梁正面 = **roller 正上方**）：整块**画牌**——美术图 `assets/props/slot_machine`。
    // 道具只出几何 + `artKey` 标记，纹理由 rig/Stage 侧惰性套上（见 `stage/art/propArt.js`：
    // 道具资产契约禁自建材质，带贴图的材质属表现层）。牌后垫一层暗底框，未加载时读作一块空招牌。
    // ⚠ 依赖 `slotMachineRig` 套图——配方里必须给这台机器 `live: true`，否则牌子永远是暗底。
    const signW = 2.16;
    const signH = signW / (600 / 662);                    // 与素材同比例（600×662），不拉伸
    const signY = (openTop + cabTop) / 2;
    g.add(K.put(K.box({ color: shade(P.iron, -0.34), size: [signW + 0.20, signH + 0.20, 0.06], family: 'metal' }),
      0, signY, D / 2 + 0.055));
    const sign = K.put(K.box({ color: shade(P.night, 0.22), size: [signW, signH, 0.06], family: 'unlit' }),
      0, signY, D / 2 + 0.10);
    sign.userData.animRole = 'artPanel';
    sign.userData.artKey = 'slot_machine';
    g.add(sign);

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

    g.userData.parts = { body: g, leverPivot, reels, bulbs, reelLamps, needle: needlePivot };
    g.userData.interactive = 'slot';
    return g;
  },
};
