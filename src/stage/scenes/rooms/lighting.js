// 房型配方层 · 布光预设（SCENE_TASKS T3.3）：torch / moon / boss-rim 三预设。
// 铁律（CATALOG §6）：光源资产只声明"有火"，光参数全部集中在此——资产禁私设 PointLight。
// 基础结构移植 dungeon3D 已调好的光参（半球保底 + 唯一投影主光 + 战线主补光 + 假反弹），
// 预设差异 = 主光来源/强度配比/染色口径。火点光由 composeRoom 收集的 fireAnchors 生成。

import * as THREE from 'three';
import { P, desatColor } from '../kit/index.js';
import { FLOOR_Y } from '../dungeon3D.js';
import { LEFT_WALL_X } from './walls.js';

// 幽火点光基准（three 物理光度学 candela；同 dungeon3D TORCH_LIGHT_BASE 口径）
const FIRE_BASE = 1150;

// ---- 灯光去饱和（用户 2026-09-11：tonemap 后场景过饱和且偏蓝）----
// 处方在 kit 的 `desatColor`（保持亮度、压饱和度、冷色额外多去一档）。**每个建灯处都过一遍**：
// 灯只留轻微色倾向，画面颜色交给材质反照率——原来月光/反光/战场补光全是高饱和蓝
// （0x9db4ec/0x8298d4/0x93a5d8），叠加 tone mapping 后整场读成"蓝"。
// 单位染色底（preset.tint）也走同一处方：那是"单位受到的照明估计"，同样不该带高饱和蓝。
const desat = (c) => desatColor(c).getHex();
const desatRGB = (t) => {
  const c = desatColor(new THREE.Color(t[0], t[1], t[2]));
  return [c.r, c.g, c.b];
};
// 火：保留更多暖色倾向（幽火仍是幽火，只是不再偏紫）
const desatFire = (c) => desatColor(c, { k: 0.35, cap: 0.45 }).getHex();
const FLAME_RATE = 12; // 每火火焰粒子 /秒（同 dungeon3D）

/**
 * 月光平行光（唯一投影光）的 shadow 配置——dungeon3D 多轮调试实录直接继承：
 *   position 沿光轴反移 145 让整面高墙（+460）落在阴影近平面之前（防上半墙采样空=恒亮漏光）；
 *   shadow 相机须盖住加高加宽后的左墙 + 房间；bias 防自阴影痤疮。
 */
function makeMoonlight(intensity) {
  const moon = new THREE.DirectionalLight(desat(0x9db4ec), intensity);
  moon.position.set(LEFT_WALL_X - 145, 145, -29);
  moon.target.position.set(30, FLOOR_Y, 0);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  const sc = moon.shadow.camera;
  sc.left = -200; sc.right = 200; sc.top = 600; sc.bottom = -120;
  sc.near = 10; sc.far = 600;
  moon.shadow.bias = -0.0015;
  return moon;
}

export const LIGHTING_PRESETS = {
  // 对比度总处方（对照手工大厅调定，数值经 gallery URL 参数 A/B 共调）：
  // 环境光一律压到 ~1.0/0.12——逐项单开都不亮，叠加却把全场洗成牛奶蓝（衰减都很慢：
  // hemi 无衰减、fill 平行光无衰减、火 decay 1.8 + 15 盏互叠是最大洗墙源）。
  // 亮度交给局部光池（月光束/战火/战场补光 glow 5200@195 只罩战场），远墙可见性交给雾处方。
  // 单开诊断截图见 tmp/diag-*.png。
  moon: {
    hemi: [0x3a4666, 0x232030, 1.1],
    moon: 2.2,
    fill: 0.12,
    bounce: [[140, 105], [100, 90]],
    battleGlow: [0x93a5d8, 5200, 195],
    centerFill: [0x8a9ac8, 3400, 170],
    fire: { base: FIRE_BASE * 0.5, dist: 140, cap: 12 },
    tint: { base: [0.52, 0.55, 0.75], fireGain: [0.16, 0.20, 0.48], radius: 58 },
  },
  // 火把主导（1-2 章基调）：月光弱（小窗/无窗），火点光扛场景亮度（仍冷调幽火，暖橙禁用）
  torch: {
    hemi: [0x3a4666, 0x232030, 1.0],
    moon: 0.9, // 窄高窗进光量比旧小窗大，月光略抬让光束可读（火仍是主角）
    fill: 0.12,
    bounce: [[120, 100], [90, 90]],
    battleGlow: [0x93a5d8, 5200, 195],
    centerFill: [0x8a9ac8, 3800, 170],
    fire: { base: FIRE_BASE * 0.56, dist: 145, cap: 14 },
    tint: { base: [0.5, 0.53, 0.72], fireGain: [0.18, 0.22, 0.5], radius: 64 },
  },
  // 赌厅（休息房·老虎机/银行机）：**外围光再压一档、亮度靠中央光撑**（用户定 2026-09-11）。
  // 处方读法：吊灯暖金光池（centerFill）是全场主亮源 → 机器/彩灯灯池（lamp）是第二层 →
  // 环境/月光/地面反弹/中景补光/烛火全部退成"暗底"（对比度来源：华丽聚光 vs 破烂四周）。
  // 暖调=赌厅基调（冷幽底色只留一点点方向感），与要塞/庄园的冷蓝划开。
  casino: {
    hemi: [0x4a3a52, 0x2a1e24, 0.38],    // 环境光再压一档（外围光），底色偏暖紫（烛光/彩灯染过）
    moon: 0.06,                          // 无窗：月光只剩方向感
    fill: 0.04,
    bounce: [[50, 86], [38, 74]],        // 地面反弹收一档（别把四周从暗里拉回来）
    battleGlow: [0xc79a68, 2200, 145],   // 中景补光改暖金，强度再收
    centerFill: [0xffc87a, 5600, 180],   // ★中央光撑亮度：暖金吊灯光池（原为冷紫 2500）
    fire: { base: FIRE_BASE * 0.5, dist: 125, cap: 4 },        // 烛位减到 4：外围点缀，不参与撑亮度
    // 灯池（机器 + 彩灯串）：机器暖金、彩灯串按后面几位彩灯色（colors 轮转，见 lamp 循环）
    lamp: {
      color: 0xffb45a, base: 4200, dist: 140, cap: 8,
      // 彩灯串的颜色轮转：**暖金 + 嫣红/紫/白**（用户定：不要绿——赌厅是暖调，
      // 绿光在暖色机器前很突兀）。机器自带显式 lampColor，不占这些轮转位。
      colors: [0xffb45a, 0xff8a6a, 0xc06a8a, 0x9a8ad8, 0xd8d0e8, 0xffd06a],
    },
    // 焦点布光（zoomin 时）：外围统一压暗 dim + **正面补光**把机器中央屏幕区打亮（setFocus）。
    // base/offset/dist 经 restGallery 实拍 A/B 定：光心在屏幕正前方 ~14（贴太近=整面洗白、
    // 太远=照到整间屋子）；dist 收到 70 让光池只罩机器，别把大厅重新点亮。
    focus: { color: 0xffdcae, base: 1000, dist: 70, offset: 14, dim: 0.72, rise: 3.2, lift: 0.08 },
    tint: { base: [0.6, 0.5, 0.54], fireGain: [0.28, 0.21, 0.32], radius: 60 },
  },
  // 营地·训练场（休息房 2026-09-11）：**火光主导的暖调**——与赌厅"中央暖金吊灯撑亮度"不同，
  // 这里的光源是地上的篝火/火盆（火点光基数更高、罩得更远、盏数更多），环境光压到最低
  // （"暗处围着火"的营地感），再留一道高窗月光做冷暖对比。
  camp: {
    hemi: [0x453a34, 0x2a221c, 1.05],
    moon: 0.6,                           // 高窗透进一点月光：给暖火光做冷暖对比
    fill: 0.11,
    bounce: [[100, 100], [80, 88]],      // 地面反弹（火光的地面池之外再垫一层）
    battleGlow: [0xc9a077, 5600, 185],   // 中景暖补光：撑住"营地是亮的"（低于火、高于环境）
    centerFill: [0xffbe86, 6200, 180],   // 中央暖光：与火叠成双层暖光池（全场主亮源）
    fire: { base: FIRE_BASE * 1.0, dist: 155, cap: 10 },    // ★火是主角（基数/距离/盏数全高）
    lamp: {
      color: 0xffc07a, base: 2000, dist: 110, cap: 6,
      // 灯笼串：暖为主，留一点粉紫变化（整圈同色会读成廉价跑马灯）
      colors: [0xffc07a, 0xffab6a, 0xd8986a, 0xc8a0b8, 0xd8d0e8],
    },
    focus: { color: 0xffd9a8, base: 1100, dist: 78, offset: 15, dim: 0.7, rise: 3.0, lift: 0.06 },
    // 单位染色底同样偏暖（火光照人）：base 暖中性、fireGain 暖橙
    tint: { base: [0.64, 0.57, 0.5], fireGain: [0.3, 0.2, 0.12], radius: 66 },
  },
  // 商店房（休息房 2026-09-12）：**亮堂的店**——瑞米的售货机是暖白灯管，全场没有火光主导，
  // 靠中央暖白光池 + 售货机灯池撑亮度（比赌厅干净、比营地亮），环境光比两间休息房都高一档。
  // 基调定在"暖白"（不是赌厅的暖金、不是营地的橙火）：货架上的商品要读得清色相。
  shop: {
    hemi: [0x4a463a, 0x2a2720, 0.95],
    moon: 0.16,                          // 室内：只留一道高窄缝的方向感
    fill: 0.1,
    bounce: [[86, 92], [66, 82]],        // 地面反弹（灯下的地面池）
    battleGlow: [0xdccaa0, 5200, 190],   // 中景暖白补光
    centerFill: [0xffe2b4, 6600, 185],   // ★中央光撑亮度：暖白顶灯光池
    fire: { base: FIRE_BASE * 0.35, dist: 130, cap: 5 },   // 烛位是边角点缀（店里不靠火；cap 只管盏数）
    lamp: {
      color: 0xffe6c4, base: 2600, dist: 120, cap: 6,
      // 灯串：暖白为主，留一点冷白变化（灯管的"管"感）
      colors: [0xffe6c4, 0xfff0d8, 0xd8e0e8, 0xffd8a8, 0xe8e4d8],
    },
    // 焦点布光（zoomin 看货架）：正面暖白补光把玻璃柜里的货打亮——比赌厅的暖金更"白"，
    // 否则 relic 立绘的色相会被金色染偏（商品要读得准）
    focus: { color: 0xfff0d8, base: 1150, dist: 76, offset: 15, dim: 0.72, rise: 3.1, lift: 0.07 },
    tint: { base: [0.62, 0.6, 0.56], fireGain: [0.24, 0.19, 0.14], radius: 64 },
  },
  // Boss 血色侧逆光：主光来自敌后右上的血色 rim，月光低压、雾重（雾参数走配方）
  'boss-rim': {
    hemi: [0x463a4a, 0x281e28, 1.0],
    moon: 1.0,
    fill: 0.12,
    bounce: [[120, 100], [90, 90]],
    battleGlow: [0xa08aa0, 6000, 200],
    centerFill: [0xa08098, 3600, 175],
    rim: { color: 0x9a5a6a, intensity: 1.5, position: [170, 100, -170], target: [0, FLOOR_Y, -10] },
    fire: { base: FIRE_BASE * 0.55, dist: 145, cap: 12 },
    tint: { base: [0.55, 0.5, 0.66], fireGain: [0.22, 0.14, 0.4], radius: 60 },
  },
};

/**
 * 按预设组装灯光。fireAnchors=[{x,y,z}]（composeRoom 从 lightSource 道具收集的火位）；
 * lampAnchors=[{x,y,z,gain}]（`lamp` 标签的自发光体：机器/彩灯串，只出光池不出火）。
 * @returns {group, torches, moonlight, tint, update(dt, particles, camPos), setFocus(target|null), focusLight}
 */
export function createLighting(key, fireAnchors = [], lampAnchors = []) {
  const preset = LIGHTING_PRESETS[key];
  if (!preset) throw new Error(`lighting: 未知布光预设 "${key}"`);
  const group = new THREE.Group();
  group.name = `lighting:${key}`;

  const hemi = new THREE.HemisphereLight(desat(preset.hemi[0]), desat(preset.hemi[1]), preset.hemi[2]);
  group.add(hemi);

  const moonlight = makeMoonlight(preset.moon);
  group.add(moonlight, moonlight.target);

  if (preset.rim) {
    const rim = new THREE.DirectionalLight(desat(preset.rim.color), preset.rim.intensity);
    rim.position.set(...preset.rim.position);
    rim.target.position.set(...preset.rim.target);
    group.add(rim, rim.target);
  }

  const fill = new THREE.DirectionalLight(desat(0x66779e), preset.fill);
  fill.position.set(30, 60, 200);
  group.add(fill);

  // 月光落地反弹（假 GI）：两处光池点光——位置离开墙面（贴墙会把挂饰打得过艳，
  // "unlit 壁画刺眼"的病灶），向房间中线收，只打地板光池
  const [bounceA, bounceB] = preset.bounce;
  const pA = new THREE.PointLight(desat(0x8298d4), bounceA[0], bounceA[1], 1.8);
  pA.position.set(-10, FLOOR_Y + 6, -12);
  const pB = new THREE.PointLight(desat(0x8298d4), bounceB[0], bounceB[1], 1.8);
  pB.position.set(-10, FLOOR_Y + 6, 16);
  group.add(pA, pB);

  // 战场主补光（光照焦点）：悬战线中点上空的大点光，物理衰减让战场亮、四周暗。
  // 距离收在 ~195：只罩战场+近墙——收太小全场黑洞，收太大（260=整房）又把墙面洗平
  const [glowColor, glowBase, glowDist = 195] = preset.battleGlow;
  const battleGlow = new THREE.PointLight(desat(glowColor), glowBase, glowDist, 2.0);
  battleGlow.position.set(-4, FLOOR_Y + 60, -22);
  group.add(battleGlow);

  // 房间中央虚拟光：框住战场中央附近的道具/单位，把玩家注意力收到战区（用户定）
  const [cfColor, cfBase, cfDist] = preset.centerFill;
  const centerFill = new THREE.PointLight(desat(cfColor), cfBase, cfDist, 2.0);
  centerFill.position.set(-4, FLOOR_Y + 42, -20);
  group.add(centerFill);

  // 灯池（`lamp` 锚：机器/招牌/彩灯这类自发光体）：**只出点光、不出火焰粒子**——
  // 与火点光共用同一套处方字段风格（preset.lamp = { color, base, dist, cap }）。
  // 无闪烁（机器灯是稳的），也不投影（避免机器自遮挡出现硬边）。
  // 锚可带 gain（道具 def 的 lampGain）：彩灯串这类"外围小灯"按减半出池，别抢机器/中央光。
  const lampLights = [];
  if (preset.lamp) {
    // 颜色：锚自带 color 优先（道具 def 的 lampColor）；否则按 `colors` 轮转（**gain 降序后**
    // 前几个必然留给 gain=1 的机器，彩灯串拿到后面的彩灯色）；再否则预设单色。
    const ring = preset.lamp.colors;
    let ringI = 0;   // 只有"没自带颜色"的锚才吃轮转位（否则显式色会被机器占用而错位）
    lampAnchors.slice(0, preset.lamp.cap ?? 6).forEach((a) => {
      const base = (preset.lamp.base ?? 900) * (a.gain ?? 1);
      // ⚠ 这里同时覆盖 **PCG 道具的 lampColor**（a.color）：可放置物体的光源与预设灯同一处方
      const color = desat(a.color ?? (ring ? ring[ringI++ % ring.length] : (preset.lamp.color ?? P.glowCyan)));
      const light = new THREE.PointLight(color, base, preset.lamp.dist ?? 90, 1.8);
      light.position.set(a.x, a.y, a.z);
      group.add(light);
      lampLights.push({ light, base, baseColor: new THREE.Color(color) });
    });
  }

  // 火点光：一火一灯（cap 上限，超出的火只留几何火苗不发光——宁缺毋滥，光池过多会洗亮全场）
  const torches = [];
  for (const a of fireAnchors.slice(0, preset.fire.cap)) {
    const light = new THREE.PointLight(desatFire(P.fireLight), preset.fire.base, preset.fire.dist, 1.8);
    light.position.set(a.x, a.y + 3, a.z + 2);
    group.add(light);
    torches.push({
      x: a.x, y: a.y, z: a.z, light,
      phase: (a.x * 7.13 + a.z * 3.71) % (Math.PI * 2), // 确定性相位（由坐标派生）
      intensity: 1, emitterAcc: 0,
    });
  }

  // ---- 焦点布光（用户定 2026-09-11：zoomin 时"压暗背景、把机器屏幕照亮"）----
  // setFocus(target|null) 后 update 在 focusK 上缓动：
  //   · 外围光池（环境/月光/补光/反弹/中央光/灯池/烛火）统一乘 (1 - focusK*dim) → 背景沉下去；
  //   · 另开一盏观众侧补光落在 target↔相机连线上（相机方向 offset 处）——机器朝向观众的那面
  //     被照亮，读作舞台追光。屏幕/灯珠是 unlit 族（不吃光），所以它们的自发光不受影响。
  const focusCfg = preset.focus ?? {
    color: 0xffdcae, base: 1000, dist: 70, offset: 14, dim: 0.72, rise: 3.2, lift: 0.08,
  };
  const focusLight = new THREE.PointLight(desat(focusCfg.color), 0, focusCfg.dist, 2.0);
  focusLight.visible = false;
  group.add(focusLight);
  let focusTarget = null;   // Vector3 | null
  let focusWant = 0;        // 目标强度 0..1
  let focusK = 0;           // 缓动后的实际强度（每帧驱动光强与压暗系数）
  const focusDir = new THREE.Vector3();

  // 外围光清单：base 强度在 setFocus 时被统一压暗（焦点光不在此列）
  const peripheral = [
    { light: hemi, base: preset.hemi[2] },
    { light: moonlight, base: preset.moon },
    { light: fill, base: preset.fill },
    { light: pA, base: bounceA[0] },
    { light: pB, base: bounceB[0] },
    { light: battleGlow, base: glowBase },
    { light: centerFill, base: cfBase },
  ];

  // 灯池染色（用户定 2026-09-11）：恶魔 roll 期间整机光照要偏暗红——灯池是静态建的，
  // 运行期改色走这个句柄（k=0 恢复本色，k=1 全量替换）。**只染灯池**（机器/彩灯串），
  // 不动中央光/月光（房间基调仍归预设）。
  const lampTintTarget = new THREE.Color();
  let lampTintK = 0;
  function setLampTint(color, k = 1) {
    if (color != null) lampTintTarget.set(color);
    lampTintK = THREE.MathUtils.clamp(k, 0, 1);
  }

  /** 聚焦/取消聚焦：target=null 或 strength=0 时缓动回常规布光。 */
  function setFocus(target, { strength = 1 } = {}) {
    if (!target) { focusTarget = null; focusWant = 0; return; }
    focusTarget = (target.isVector3
      ? target.clone()
      : new THREE.Vector3(target.x, target.y, target.z));
    focusWant = THREE.MathUtils.clamp(strength, 0, 1);
  }

  let time = 0;
  /** 帧驱动：焦点缓动与压暗 + 幽火闪烁 + 火焰粒子发射（同 dungeon3D 口径） */
  function update(dt, particles = null, camPos = null) {
    time += dt;
    // 焦点缓动
    focusK += (focusWant - focusK) * Math.min(1, dt * (focusCfg.rise ?? 3.2));
    if (Math.abs(focusWant - focusK) < 0.003) focusK = focusWant;
    const periph = 1 - focusK * (focusCfg.dim ?? 0.72);
    for (const p of peripheral) p.light.intensity = p.base * periph;
    for (const l of lampLights) {
      l.light.intensity = l.base * periph;
      if (lampTintK > 0.001) l.light.color.copy(l.baseColor).lerp(lampTintTarget, lampTintK);
      else if (!l.light.color.equals(l.baseColor)) l.light.color.copy(l.baseColor);
    }

    if (focusK > 0.001 && focusTarget) {
      focusLight.visible = true;
      focusLight.intensity = (focusCfg.base ?? 3600) * focusK;
      focusLight.position.copy(focusTarget);
      if (camPos) {
        focusDir.copy(camPos).sub(focusTarget);
        if (focusDir.lengthSq() > 1e-4) focusLight.position.addScaledVector(focusDir.normalize(), focusCfg.offset ?? 14);
      } else {
        focusLight.position.z += focusCfg.offset ?? 14;
      }
      focusLight.position.y += (focusCfg.offset ?? 14) * (focusCfg.lift ?? 0.08);
    } else {
      focusLight.visible = false;
      focusLight.intensity = 0;
    }

    for (const t of torches) {
      t.intensity = 1
        + 0.16 * Math.sin(time * 11 + t.phase)
        + 0.08 * Math.sin(time * 23 + t.phase * 1.7);
      t.light.intensity = preset.fire.base * t.intensity * periph;
      if (particles) {
        t.emitterAcc += dt * FLAME_RATE;
        while (t.emitterAcc >= 1) {
          t.emitterAcc -= 1;
          particles.spawn(t.x + (Math.random() - 0.5) * 1.6, t.y + 2.2, {
            count: 1, z: t.z, color: Math.random() < 0.35 ? 0xcfd8ff : 0x8a9ae8,
            speed: 4.2, ttl: 0.6, gravity: 2, size: 1.3,
          });
        }
      }
    }
  }

  // 单位染色底（"单位受到的照明估计"）：与灯同一处方去饱和，否则单位整体泛蓝
  const tint = {
    base: desatRGB(preset.tint.base),
    fireGain: desatRGB(preset.tint.fireGain),
    radius: preset.tint.radius,
  };
  return {
    group, torches, moonlight, tint, update, setFocus, focusLight,
    setLampTint,   // (color, k) 灯池染色：恶魔 roll 等运行期换风格
  };
}
