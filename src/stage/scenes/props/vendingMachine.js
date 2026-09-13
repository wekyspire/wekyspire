// 自动售货机（休息房：瑞米售货机 / 商店房）：两层货架的玻璃门立柜 + 右侧操作列 + 底部出货口。
// 原点=底面中心（y=0 落地），宽 3.6 / 深 1.9 / 高约 6.8。
// ⚠ **宽度是硬指标**（用户 2026-09-12 报「太窄，两件物品挤在一起」）：货架区要装下两层 ×
// 每层两件、且两件之间留出可读的货道缝——所以柜体做成「矮胖柜台机」而不是瘦高立柜。
//
// 造型意图（用户定 2026-09-11）：**两层货架、每层最多摆 2 件、正面一块玻璃门**。
// 货架区做成**真凹腔**（上/下横梁 + 左右立柱围出开口，背板整块 unlit 恒亮 = "柜内一直亮着"），
// 玻璃门是独立的 doorPivot 子组（铰链在货架区左缘）——商店房"开门取货"由 rig 绕 Y 转这个枢轴。
// 四个货位是四个**锚点**（animRole 无、仅 Object3D + 托盘）：货品本体是**遗物/药水的 billboard
// + 价格**（用户定 2026-09-12），由 rig 按快照把卡片立在托盘上（道具侧保持无状态；见 rig 的 setStock）。
//
// 可动件契约（build() 返回的 Group 上挂 `userData.parts`）：
//   parts.body          整机（受击/开机微抖）
//   parts.doorPivot     玻璃门枢轴（绕 Y 旋开；门板+门框+把手都是它的子件）
//   parts.slots[4]      { index, anchor }——两层的四个货位锚点（rig 在 anchor 上立货品卡片）
//   parts.bay           货架区开口的**局部包围盒**（{ x, y, z, w, h }，供 RoomStage 怼脸取景）
//   parts.flap          出货口翻板（出货时向外弹一下）
//   parts.marquee       顶灯牌发光带（rig 闪烁/呼吸）
//   parts.display       价格/余额显示条（rig 可烘字/闪）
//   ⚠ 不得进静态合批（配方 guaranteed 条目加 `live: true`）。
//
// 布光职责：同老虎机/银行机——自带 unlit 发光面（柜内背板/灯带/按钮） + `lamp` 标签
// （配方层出无火焰点光池：货柜的暖白光池落在门前）。

import * as THREE from 'three';
import { P, K, shade, mergeStatic } from '../kit/index.js';

const BAY = { t: 0.14 };   // 货架区开口的内退（背板离前脸）

export default {
  id: 'vendingMachine',
  place: 'prop',
  mount: 'floor',
  tags: ['machine', 'metal', 'container', 'glass', 'lamp', 'interactive'],
  // 灯池：**暖白**（柜内灯管/灯带的口径，不是赌具的暖金也不是银行机的冷青）。
  // gain 压到 ~0.05：灯池被 composeRoom 推到门前（LAMP_FRONT_PUSH），太近会把机壳照爆。
  // 灯池再收一档（0.12→0.07）：柜面大面积是玻璃，池子贴太近会在玻璃上打出白色高光斑，
  // 把柜内的货全糊掉（用户 2026-09-12 报"一排看不到两个物品"的真凶之一）
  // 2026-09-12 二次：单池落在**货架中段**，怼脸时光心正对敞开的柜门 → 柜内背板被照爆
  // （一团白光把两排货糊掉）。灯池只留**柜脚一段**（地面上"这台亮着"），柜内亮度全交给
  // unlit 背板与商品卡自己（怼脸时高位的池子也会在货架上方糊出一团白光，用户报"中间一团亮"）。
  lampGain: 0.05,
  lampColor: shade(P.wax, -0.04),
  lampBands: [
    { h: 0.1, gain: 0.9 },    // 低位：柜脚/出货口一带（地面光池 + 机器的"落地感"）
  ],
  footprint: { x: 3.2, z: 2.4 },
  behaviors: [],
  build({ rng = null } = {}) {
    const g = new THREE.Group();
    const r = rng ?? K.createRng('vendingMachine');
    const W = 3.6, D = 1.9, bodyH = 6.3, plinthH = 0.5;
    const y0 = plinthH;                       // 柜身底
    const cabTop = y0 + bodyH;
    const iron = shade(P.iron, -0.06);
    const ironDark = shade(P.iron, -0.3);
    const steel = shade(P.silver, -0.18);
    const lighting = shade(P.wax, -0.1);      // 柜内灯色（暖白）

    // ================= 底座 + 踢脚 =================
    g.add(K.put(K.box({ color: ironDark, size: [W + 0.3, plinthH, D + 0.24], family: 'metal' }),
      0, plinthH / 2, 0));
    g.add(K.put(K.box({ color: shade(P.iron, -0.16), size: [W + 0.06, 0.22, D + 0.06], family: 'metal' }),
      0, plinthH + 0.11, 0));

    // ================= 货架区开口（真凹腔：横梁 + 立柱）=================
    // 前脸分层口径（同老虎机，杜绝共面闪烁）：L0 柜面 D/2=0.90 ｜ L1 门框 0.98 ｜
    // L2 玻璃 1.02 ｜ L3 把手 1.10 ｜ L4 操作列面板 0.96 ｜ L5 灯牌 0.92
    const controlW = 0.74;                    // 右侧操作列宽
    const bayW = W - controlW - 0.46;         // 货架区开口宽（≈2.4：两层 × 两件 + 货道缝）
    const bayCx = -W / 2 + 0.23 + bayW / 2;   // 开口中心 x
    const bayTop = cabTop - 0.95;             // 开口顶（上方留给灯牌）
    const bayBot = y0 + 1.35;                 // 开口底（下方留给出货口）
    const bayH = bayTop - bayBot;
    const shelfY = [bayBot + bayH * 0.26, bayBot + bayH * 0.66];   // 两层货位的**物品中心**高

    // 柜身：上/下横梁 + 左右立柱（围出开口）
    g.add(K.put(K.box({ color: iron, size: [W, cabTop - bayTop, D], family: 'metal' }),
      0, (bayTop + cabTop) / 2, 0));
    g.add(K.put(K.box({ color: iron, size: [W, bayBot - (y0 + 0.22), D], family: 'metal' }),
      0, (y0 + 0.22 + bayBot) / 2, 0));
    const postW = Math.max(0.2, (W - bayW) / 2);
    for (const sx of [-1, 1]) {
      g.add(K.put(K.box({ color: shade(iron, 0.03), size: [postW, bayH, D], family: 'metal' }),
        sx < 0 ? (-W / 2 + postW / 2) : (W / 2 - postW / 2), (bayBot + bayTop) / 2, 0));
    }
    // 两侧立柱上的竖向亮饰条（玻璃柜的"框架灯"感；unlit 微光）
    for (const sx of [-1, 1]) {
      g.add(K.put(K.box({ color: lighting, size: [0.06, bayH * 0.86, 0.05], family: 'unlit' }),
        sx * (bayW / 2 + 0.06) + bayCx, (bayBot + bayTop) / 2, D / 2 - 0.02));
    }
    // 柜内背板（**unlit 恒亮** = "柜里一直亮着"，也是玻璃门后最远的一层）
    g.add(K.put(K.box({ color: shade(lighting, -0.52), size: [bayW + 0.36, bayH + 0.3, 0.16], family: 'unlit' }),
      bayCx, (bayBot + bayTop) / 2, -D / 2 + BAY.t + 0.4));
    // 柜内顶/底（暗，别让开口读成通到底的黑洞）
    g.add(K.put(K.box({ color: ironDark, size: [bayW + 0.2, 0.12, D - 0.5], family: 'metal' }),
      bayCx, bayTop - 0.06, -0.02));
    g.add(K.put(K.box({ color: ironDark, size: [bayW + 0.2, 0.12, D - 0.5], family: 'metal' }),
      bayCx, bayBot + 0.06, -0.02));

    // ================= 两层货架 + 四个货位 =================
    // 层板：每层一块（上表面托住物品），两块之间是"第 1 层"的空间
    const boardT = 0.1;
    const boardY = [bayBot + bayH * 0.5, bayBot + 0.12];
    for (const by of boardY) {
      g.add(K.put(K.box({ color: steel, size: [bayW - 0.06, boardT, D - 0.62], family: 'metal' }),
        bayCx, by, -0.06));
      // 层板前沿的灯带（unlit：把"每层亮着"读出来；压一档别抢货品）
      g.add(K.put(K.box({ color: shade(lighting, -0.18), size: [bayW - 0.1, 0.05, 0.05], family: 'unlit' }),
        bayCx, by + 0.02, D / 2 - 0.4));
    }
    // 货道隔片：每层一道竖向薄隔（真机的货道读法）——**两件一眼读成两格**，
    // 也顺带把"每层恰好两件"的规格写进几何（比只靠间距更稳）
    for (const by of boardY) {
      g.add(K.put(K.box({ color: shade(steel, -0.16), size: [0.04, 1.02, D - 0.66], family: 'metal' }),
        bayCx, by + 0.57, -0.06));
    }
    // 四个货位：每层 2 件。**货品本体不在这里**——商店房要的是「遗物/药水的 billboard +
    // 价格」（用户定 2026-09-12），由 rig 按快照的货架把卡片**立在托盘上**（见 rig 的 setStock）。
    // 道具侧只给一个**货位锚点**（立卡片的落点：托盘上表面）与四张托盘，几何保持无状态。
    const slots = [];
    shelfY.forEach((sy, layer) => {
      [-1, 1].forEach((side, col) => {
        const index = layer * 2 + col;
        const x = bayCx + side * (bayW * 0.25);
        const anchor = new THREE.Object3D();
        anchor.position.set(x, sy - 0.33, D / 2 - 0.5);   // 托盘上表面（卡片由此往上立）
        anchor.userData.slot = index;
        g.add(anchor);
        slots.push({ index, anchor });
      });
    });
    // 货位托盘（每件下面一块"托盘"，把四件在视觉上分格；静态件，随壳体合批）
    for (const s of slots) {
      g.add(K.put(K.box({ color: shade(steel, -0.24), size: [0.66, 0.05, 0.54], family: 'metal' }),
        s.anchor.position.x, s.anchor.position.y - 0.025, s.anchor.position.z - 0.28));
    }

    // ================= 玻璃门（独立枢轴：铰链在开口左缘）=================
    const doorPivot = new THREE.Group();
    doorPivot.position.set(bayCx - bayW / 2 - 0.06, 0, D / 2 + 0.08);
    const dW = bayW + 0.16, dH = bayH + 0.2;
    // 门板（**frost 族** = 磨砂玻璃：大面积近景透明面不反高光，见 kit/materials 注释。
    // ⚠ 玻璃色**偏暗**：浅色玻璃（wax）叠在亮柜内会整面发白，货品全被洗掉）
    doorPivot.add(K.put(K.box({ color: shade(P.iron, 0.06), size: [dW, dH, 0.05], family: 'frost' }),
      dW / 2, (bayBot + bayTop) / 2, 0));
    // 门框（四边）+ 把手（竖条）：金属件，跟着门一起动
    const fr = 0.11;
    doorPivot.add(K.put(K.box({ color: iron, size: [dW, fr, 0.09], family: 'metal' }),
      dW / 2, bayTop + 0.06, 0));
    doorPivot.add(K.put(K.box({ color: iron, size: [dW, fr, 0.09], family: 'metal' }),
      dW / 2, bayBot - 0.04, 0));
    for (const bx of [0.05, dW - 0.05]) {
      doorPivot.add(K.put(K.box({ color: iron, size: [fr, dH, 0.09], family: 'metal' }), bx, (bayBot + bayTop) / 2, 0));
    }
    doorPivot.add(K.put(K.box({ color: shade(P.copper, 0.1), size: [0.09, 1.5, 0.13], family: 'metal', }),
      dW - 0.24, (bayBot + bayTop) / 2 - 0.2, 0.06));
    g.add(doorPivot);

    // ================= 右侧操作列：投币口 / 按键阵 / 显示条 / 读卡缝 =================
    const colCx = W / 2 - controlW / 2 - 0.12;
    const colBot = y0 + 0.7, colTop = cabTop - 0.9;
    // 面板（比柜面浮出一点，L4 带）
    g.add(K.put(K.box({ color: shade(iron, 0.04), size: [controlW, colTop - colBot, 0.16], family: 'metal' }),
      colCx, (colBot + colTop) / 2, D / 2 - 0.02));
    // 价格/余额显示条（unlit：rig 烘字）
    const display = K.put(K.box({ color: shade(lighting, 0.2), size: [controlW - 0.16, 0.4, 0.1], family: 'unlit' }),
      colCx, colTop - 0.34, D / 2 + 0.06);
    display.userData.animRole = 'display';
    g.add(display);
    // 按键阵（3×3，unlit 微光；矩阵排布读作"选货键"）
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        g.add(K.put(K.cyl({
          color: shade(P.wax, -0.25), r: 0.1, h: 0.08, seg: 6, family: 'unlit',
        }), colCx - 0.2 + col * 0.2, colTop - 1.1 - row * 0.3, D / 2 + 0.04));
      }
    }
    // 投币/读卡缝（金属框 + 暗缝）
    g.add(K.put(K.box({ color: steel, size: [0.44, 0.2, 0.1], family: 'metal' }),
      colCx, colBot + 1.15, D / 2 + 0.03));
    g.add(K.put(K.box({ color: P.night, size: [0.32, 0.06, 0.06], family: 'unlit' }),
      colCx, colBot + 1.15, D / 2 + 0.08));
    // 门锁孔（小圆点，读作"这台机器有锁"）
    g.add(K.put(K.cyl({ color: shade(P.copper, -0.1), r: 0.09, h: 0.1, seg: 6, family: 'metal' }),
      colCx, colBot + 0.5, D / 2 + 0.05));

    // ================= 出货口（底部）：暗槽 + 可动翻板 =================
    const dispY = y0 + 0.72;
    g.add(K.put(K.box({ color: ironDark, size: [bayW + 0.6, 1.0, 0.22], family: 'metal' }),
      bayCx, dispY, D / 2 - 0.06));
    g.add(K.put(K.box({ color: P.night, size: [bayW + 0.3, 0.74, 0.2], family: 'unlit' }),
      bayCx, dispY, D / 2 + 0.02));
    const flap = K.put(K.box({ color: shade(steel, -0.1), size: [bayW + 0.2, 0.56, 0.07], family: 'metal' }),
      bayCx, dispY + 0.06, D / 2 + 0.1);
    flap.userData.animRole = 'flap';
    g.add(flap);
    // 出货口上沿的暗红提示条（"取货口"标记）
    g.add(K.put(K.box({ color: shade(P.machineRed, -0.2), size: [bayW + 0.2, 0.07, 0.05], family: 'unlit' }),
      bayCx, dispY + 0.56, D / 2 + 0.1));

    // ================= 顶灯牌（marquee）：招牌面 + 发光带 =================
    const marqueeY = cabTop - 0.5;
    g.add(K.put(K.box({ color: iron, size: [W, 1.0, D - 0.4], family: 'metal' }),
      0, marqueeY, -0.06));
    const marquee = K.put(K.box({ color: shade(lighting, 0.35), size: [W - 0.5, 0.42, 0.1], family: 'unlit' }),
      0, marqueeY + 0.06, D / 2 - 0.26);
    marquee.userData.animRole = 'marquee';
    g.add(marquee);
    // 招牌下沿的两道色带（红/金，售货柜的"招徕"感；静态件）
    g.add(K.put(K.box({ color: shade(P.machineRed, -0.1), size: [W - 0.3, 0.09, 0.07], family: 'unlit' }),
      0, marqueeY - 0.42, D / 2 - 0.22));
    g.add(K.put(K.box({ color: shade(P.gold, -0.05), size: [W - 0.62, 0.06, 0.07], family: 'unlit' }),
      0, marqueeY - 0.58, D / 2 - 0.22));
    // 顶盖（薄板压边）
    g.add(K.put(K.box({ color: ironDark, size: [W + 0.14, 0.14, D + 0.1], family: 'metal' }),
      0, cabTop + 0.07, 0));

    // ================= 静态子件合并（预算回本；同老虎机口径）=================
    // 壳体/横梁/立柱/层板/托盘/操作列/顶牌…相对机身完全不动，此前是几十个独立 mesh。
    // 后处理：把"不在 parts 里"的散件按材质族合并（世界变换烘进顶点）。
    let pickBody = null;
    {
      const animated = new Set([doorPivot, flap, marquee, display, ...slots.map(s => s.anchor)]);
      const statics = new THREE.Group();
      for (const c of [...g.children]) {
        if (c.isMesh && !animated.has(c)) statics.add(c);
      }
      if (statics.children.length) {
        const merged = mergeStatic(statics);
        merged.name = 'vendingStatics';
        g.add(merged);
        pickBody = merged;   // 机身拾取靶（**不含玻璃门**：门会把柜内商品卡的射线全挡住）
      }
    }

    g.userData.parts = {
      body: g, doorPivot, slots, flap, marquee, display,
      // 机身拾取靶（RoomStage 用它登记"点机器本体"）：不含门/翻板/灯牌/卡片
      pickBody,
      // 货架区开口的局部口径（供取景：怼脸看货架时框这一块，而不是整机）
      bay: { x: bayCx, y: (bayBot + bayTop) / 2, z: D / 2 - 0.3, w: bayW + 0.36, h: bayH + 0.2 },
    };
    g.userData.interactive = 'vending';
    return g;
  },
};
