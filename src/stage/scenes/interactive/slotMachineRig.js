// 老虎机 rig（用户定 2026-09-11）：把 `props/slotMachine.js` 的可动件驱动起来。
// 反馈分层（原则：交互反馈丰富且分层）：
//   · 常驻：机体微微抖动（"活着"）+ 彩灯缓慢呼吸
//   · hover：机体轻微上浮放大 + 彩灯提亮（由交互层调用 setHover）
//   · 拉杆：拉杆快速拉下 → 缓慢弹起（弹性回位）；三点亮起同步起转
//   · 转轮：**四段时序，全程 C1 连续**（用户定 2026-09-11："转久一点、减速曲线细一点、
//     锁定前要有卡入位的回滚/滑入"）：
//       ① 起转加速 → ② 长匀速（中间轮最久） → ③ 指数减速（尾段"将停未停"地缓缓蹭过去，
//       即真机那种"自然停下会卡在两格之间"的悬念） → ④ **卡入位**：阻尼弹簧把已经冲过
//       槽位 OVERSHOOT 的鼓拉回来，带一点回滚+过冲，读作机械卡销咬合。
//     左右两侧先锁、中间最后（`CRUISE_T`），落槽瞬间有"咔"式小弹跳。
//     落槽目标由后端结果决定（后端在拉杆瞬间就算好了）：rig 只负责把轮盘转到那一面。
//   · 中奖：屏幕彩灯按档位分级的灯效（小奖=跑马灯，大奖=跑马+全亮爆闪+机体激动抖动），
//     并让机体抖动幅度随档位提升。
// 纯 Stage 层：不读 Core、不读 Bridge；输入只有「拉杆时给定的结果」（调用方从 Core 拿）。

import * as THREE from 'three';
import { P, familyMaterial } from '../kit/index.js';
import { sharedPropArtCache } from '../../art/propArt.js';

const Z = Math.PI * 2;
const FLAP_DUR = 0.44;   // 翻牌一次（上叶折下 + 新叶落下）的时长（秒）

// rig 内部临时量（避免逐帧分配）：只在同一次 update 内使用，不得跨调用持有
const TMP_RED = new THREE.Color(P.potionRed);
const TMP_M4 = new THREE.Matrix4();
const TMP_V3 = new THREE.Vector3();

// 档位 → 灯效/抖动强度（细节是可调参数：先给一版手感，视觉门里再调）
const TIER_FX = {
  none: { chase: 0, flash: 0, shake: 0.0, seconds: 0.5, dim: 0.45 },
  minor: { chase: 9, flash: 0.35, shake: 0.05, seconds: 1.6, dim: 0.0 },
  major: { chase: 16, flash: 1.0, shake: 0.16, seconds: 2.6, dim: 0.0 },
};

// ---- 转轮时序参数（秒 / rad·s⁻¹）----
const ACCEL = 0.34;          // ① 起转加速时长（末速 = CRUISE_V，接上匀速 → 速度连续）
const CRUISE_V = 26;         // ② 匀速角速度
const BRAKE_SPAN = 1.35;     // ③ 减速段时长（≈3.2τ，末速收到 V·e⁻³·² ≈ 4%，即"还在缓缓蹭"）
const TAU = BRAKE_SPAN / 3.2; // 指数时间常数（由 BRAKE_SPAN 反推，两者必须一致）
const SETTLE = 0.42;         // ④ 卡入位时长
const OVERSHOOT = 0.2;       // 自然停下时"冲过槽位"的角度（rad）——卡入位要把它拉回来
const ZETA = 0.42;           // 卡入位阻尼比（<1：有一点回弹过冲）
const OMEGA = 15;            // 卡入位弹簧角频率
// 各轮匀速段时长：**左右两侧快、中间最久**（中间最后咬合；轮与轮的锁定间隔也由它拉开）
const CRUISE_T = [0.7, 1.3, 1.0];

/**
 * 让轮盘停在某个图案面 —— **推导（别再凭感觉改）**：
 * 鼓面按角度分带：图案 k 占 `[k/N,(k+1)/N)` 扇区（`props/slotMachine.js` 的
 * `p(a) = (sin a·r, y, cos a·r)`），故带心 `a_k = (k+0.5)/N·2π`。
 * 以绕 X 旋转 θ 时，处于角度 a 的面移到 `a − θ`；要让带心朝正前（角度 0）需
 * `θ ≡ a_k (mod 2π)`。取 `θ = a_k − 2π`（**负向**，与转轮自旋方向一致；
 * 调用方还会继续减整圈，模 2π 不变）。
 * 常见错法：用 `−a_k` 或 `−k/N·2π` —— 那会把**两带接缝**摆到正前（怼脸一眼可见）。
 */
const angleFor = (k, n) => (((k % n) + 0.5) / n) * Z - Z;

/** 单个转轮的整段动画计划（解析式求值：不累积误差、段间 C1 连续）。 */
function planReel(a0, k, n, cruiseT) {
  const base = angleFor(k, n);
  const aAccel = 0.5 * CRUISE_V * ACCEL;                 // 加速段走过角
  const aBrake = CRUISE_V * TAU * (1 - Math.exp(-BRAKE_SPAN / TAU));
  // 想要的自然停车位（匀速段用时 = cruiseT）
  const stopWanted = a0 - (aAccel + CRUISE_V * cruiseT + aBrake);
  // 选圈数：让"冲过槽位 OVERSHOOT 的自然停车位"尽量贴近 stopWanted。
  // **符号**：轮盘往 −角 方向转，故目标角在起点下方 → turns 取正（写反会让轮盘倒转，
  // 位移算成负的、匀速段被夹到下限，三根轮的锁定时长也会被压平）。
  const turns = Math.round((base - stopWanted - OVERSHOOT) / Z);
  const target = base - Z * turns;                       // 最终锁定角
  const stopAngle = target - OVERSHOOT;                  // 减速段终点（略过槽位）
  // 反解匀速时长，使三段位移精确落在 stopAngle 上（圈数取整带来的不足由它补）
  const cruise = Math.max(0.3, ((a0 - stopAngle) - aAccel - aBrake) / CRUISE_V);
  const tBrake = ACCEL + cruise;
  const v0 = -CRUISE_V * Math.exp(-BRAKE_SPAN / TAU);    // 减速段末速（仍在往负向蹭）
  const wd = OMEGA * Math.sqrt(1 - ZETA * ZETA);
  return {
    target, targetIndex: k % n, a0, aAccel, aBrake, cruise, tBrake, stopAngle, v0,
    tLock: tBrake + BRAKE_SPAN + SETTLE,
    x0: -OVERSHOOT, c1: (v0 + ZETA * OMEGA * (-OVERSHOOT)) / wd, wd,
  };
}

/** 计划 → 任意时刻的转角（四段解析式拼接；段间位置与速度都连续）。 */
function angleAt(p, t) {
  if (t <= 0) return p.a0;
  if (t < ACCEL) return p.a0 - (0.5 * CRUISE_V * t * t) / ACCEL;
  if (t < p.tBrake) return p.a0 - p.aAccel - CRUISE_V * (t - ACCEL);
  const sB = t - p.tBrake;
  if (sB < BRAKE_SPAN) {
    const aBrakeStart = p.a0 - p.aAccel - CRUISE_V * p.cruise;
    return aBrakeStart - CRUISE_V * TAU * (1 - Math.exp(-sB / TAU));
  }
  // 卡入位：阻尼弹簧（初位移 -OVERSHOOT + 初速 = 减速段末速 → 与上一段速度也连续）
  const s = sB - BRAKE_SPAN;
  if (s >= SETTLE) return p.target;
  const x = Math.exp(-ZETA * OMEGA * s) * (p.x0 * Math.cos(p.wd * s) + p.c1 * Math.sin(p.wd * s));
  return p.target + x;
}

export function createSlotMachineRig({ object, parts, seed = 'slot' }) {
  const body = parts?.body ?? object;
  const lever = parts?.leverPivot ?? null;
  const reels = parts?.reels ?? [];
  // 彩灯/锁定指示灯 = InstancedMesh（{ mesh, tints }）：颜色走 instanceColor，rig 逐帧 setColorAt
  // （资产侧不再逐灯建网格/材质，见 props/slotMachine.js 的预算回本注释）。
  const bulbRing = parts?.bulbs ?? null;
  const lampRing = parts?.reelLamps ?? null;
  const needle = parts?.needle ?? null;
  const gate = parts?.gate ?? null;
  const gateOpenY = parts?.gateOpenY ?? 0;
  const gateClosedY = parts?.gateClosedY ?? 0;
  const demonTint = new THREE.Color(parts?.demonTint ?? P.potionRed);
  const crusher = parts?.crusher ?? null;
  // 转轮面数由资产决定（道具导出 SYMBOLS 长度）；资产侧只有 kit 共享材质，
  // 彩灯/指示灯的逐帧改色**由 rig 持独立材质**（资产禁自建材质是契约）。
  const SYM = reels[0]?.userData?.symbols?.length ?? 5;
  // 锁定指示灯配色（用户定 2026-09-11：锁定前灭、锁定后亮）：暗铁 / 亮金 / 中奖闪用
  // **亮度一律乘算、不调 shade()**：① shade 是朝白插值，提亮会同时去饱和（提两档就白）；
  // ② 乘到真 HDR（线性 >1）才能进 bloom 的亮部通道——管线是 HDR 的，自发光体就得写 >1。
  const brighten = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
  const lampOff = brighten(P.iron, 0.5);
  const lampOn = brighten(P.gold, 12);
  const lampOnDim = brighten(P.gold, 4);
  const lampLit = brighten(P.gold, 20);
  // 画牌（额头招牌）：道具只留了 artKey，纹理在这里惰性套上——**逐帧试取**而不是订阅加载事件，
  // 因为 rig 的生命周期由宿主随手 end()，订阅会在重建时漏成幽灵回调。
  const artPanels = [];
  object.traverse((o) => { if (o.userData?.artKey) artPanels.push(o); });
  /** 画牌贴图：就绪即套（一次性）。图未就绪就留给 update 逐帧重试。 */
  function applyArtPanels() {
    for (let i = artPanels.length - 1; i >= 0; i--) {
      const panel = artPanels[i];
      const tex = sharedPropArtCache.getTexture(panel.userData.artKey);
      if (!tex) continue;
      panel.material = new THREE.MeshBasicMaterial({ map: tex });
      artPanels.splice(i, 1);
    }
  }
  applyArtPanels();   // 预载命中时"建好就贴上"，不会先闪一下空招牌
  // 轮盘图案：每根鼓的每个带面一张美术图（`assets/props/symbol_*`，带 alpha 镂空）。
  // 整组齐了才换（不然会出现"半根鼓有图、半根还是色块"）；材质数组末位留给衬底（见 drumGeometry）。
  const reelArt = reels.map((reel) => ({
    reel,
    keys: reel.userData.symbolKeys ?? null,
    mesh: reel.userData.drumMesh ?? reel.children[0],
    done: false,
  }));
  function applyReelArt() {
    for (const item of reelArt) {
      if (item.done || !item.keys || !item.mesh) continue;
      const texs = item.keys.map((k) => sharedPropArtCache.getTexture(k));
      if (texs.some((t) => !t)) continue;
      const baseMat = item.mesh.material;                 // 原衬底材质（kit 共享族）
      item.mesh.material = [
        ...texs.map((tex) => {
          const m = familyMaterial('stone');              // 图案走**吃光族**：只被照亮，不自发光
          m.map = tex;
          // **alphaTest 而不是 transparent**：镂空处直接丢弃片元，旋转时没有半透明排序问题
          m.alphaTest = 0.5;
          m.needsUpdate = true;
          return m;
        }),
        baseMat,                                          // 衬底（含端盖）
      ];
      item.done = true;
    }
  }
  applyReelArt();

  // ---- 粉碎口 + 摇杆次数计数器（用户定 2026-09-11）----
  // 资产只出几何与可点热区（userData.pickId），逐帧驱动与烘焙全在 rig：
  //   · 计数器面板 = 一张自绘 canvas（七格刻度 + 数字滚动），材质由 rig 建
  //   · 投料口暗腔 = 可点热区（粉碎时闪红）；金牙 = 咬合缩放 + 进度满时发亮
  //   · 金币迸出 = rig 自建的 InstancedMesh（不进资产预算，见 SCENE_PROP_WORKFLOW §预算）
  const counter = crusher?.counter ?? null;
  const throat = crusher?.throat ?? null;
  const jaw = crusher?.jaw ?? null;
  let counterCanvas = null; let counterCtx = null; let counterTex = null;
  if (counter && typeof document !== 'undefined') {
    counterCanvas = document.createElement('canvas');
    counterCanvas.width = 320; counterCanvas.height = 160;
    counterCtx = counterCanvas.getContext('2d');
    counterTex = new THREE.CanvasTexture(counterCanvas);
    counterTex.colorSpace = THREE.SRGBColorSpace;
    counterTex.anisotropy = 4;
    counter.material = new THREE.MeshBasicMaterial({ map: counterTex });
  }
  if (throat) throat.material = new THREE.MeshBasicMaterial({ color: P.night });
  if (jaw) jaw.material = new THREE.MeshBasicMaterial({ color: brighten(P.gold, 0.7) });

  /** 计数器面板 = **翻牌（split-flap）显示**（用户定 2026-09-11："要做成翻牌显示，
   *  不是能量条"）：两张卡（当前值 / 上限），每张分上下两片叶子 + 中缝；数字变化时上半片
   *  像真翻牌一样折叠落下（见 drawFlap 的两段时序）。刻度点阵那种"能量条"读法已删。 */
  function drawFlap(ctx, bx, by, w, h, digit, { dim = false, ready = false, from = digit, flip = 1 } = {}) {
    const mid = by + h / 2;
    const face = (top) => {
      if (ready) return top ? '#3d3522' : '#2e2818';
      if (dim) return top ? '#12161e' : '#0e1117';
      return top ? '#262c3a' : '#1c212d';
    };
    ctx.fillStyle = face(true); ctx.fillRect(bx, by, w, h / 2);
    ctx.fillStyle = face(false); ctx.fillRect(bx, mid, w, h / 2);
    const size = Math.round(h * 0.60);
    const colorOn = ready ? '#ffeaa8' : (dim ? '#6d7688' : '#f2f6ff');
    const colorOld = dim ? '#5b6376' : '#c9d2e8';
    /** 画整字的**半张**：裁到该半叶，再绕中缝竖向缩放（1→0 = 折下，0→1 = 落下）。 */
    const half = (text, which, scale, col) => {
      ctx.save();
      ctx.beginPath();
      if (which === 'top') ctx.rect(bx, by, w, h / 2); else ctx.rect(bx, mid, w, h / 2);
      ctx.clip();
      ctx.translate(bx + w / 2, mid);
      ctx.scale(1, Math.max(0.002, scale));
      ctx.translate(-(bx + w / 2), -mid);
      ctx.font = `bold ${size}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = 7;
      ctx.strokeStyle = 'rgba(4,6,11,0.8)';
      ctx.strokeText(text, bx + w / 2, by + h / 2);
      ctx.fillStyle = col;
      ctx.fillText(text, bx + w / 2, by + h / 2);
      ctx.restore();
    };
    if (flip >= 1) {
      half(digit, 'top', 1, colorOn);
      half(digit, 'bottom', 1, colorOn);
    } else if (flip < 0.5) {
      half(from, 'bottom', 1, colorOn);                        // 下半：还是旧牌
      half(from, 'top', 1 - flip / 0.5, colorOld);             // 上半：折叠落下
    } else {
      half(digit, 'bottom', 1, colorOn);                       // 下半：已换新牌
      half(digit, 'top', (flip - 0.5) / 0.5, colorOn);         // 上半：落下展开
    }
    // 中缝（阴影 + 一道细亮线 = 真翻牌两片叶子的接缝）与卡边
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(bx, mid - 2, w, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(bx, mid + 2, w, 1);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx + 1, by + 1, w - 2, h - 2);
  }

  /** 画整块计数器：槽底 + 两张翻牌（当前值 / 上限）+ 中间的斜杠。 */
  function drawCounter(shown, from, flip, every, ready) {
    if (!counterCtx) return;
    const ctx = counterCtx;
    const W = counterCanvas.width; const H = counterCanvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#090c12';
    ctx.fillRect(0, 0, W, H);
    const cw = 104; const chh = 118; const cy = (H - chh) / 2;
    ctx.font = 'bold 46px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(180,192,220,0.42)';
    ctx.fillText('/', 160, H / 2);
    drawFlap(ctx, 26, cy, cw, chh, String(Math.min(shown, every)), {
      ready, from: String(Math.min(from, every)), flip,
    });
    drawFlap(ctx, 190, cy, cw, chh, String(every), { dim: true });
  }
  const redrawCounter = () => {
    const d = st.devour;
    if (!d || !counterTex) return;
    drawCounter(d.shown, d.from, d.flip, d.every, d.ready);
    counterTex.needsUpdate = true;
  };
  /** 计数器下行：`{ progress, every, ready }`（= core/run/panelSnapshot 的 snap.slot.devour）。
   *  首次同步直接落位（不播翻牌）；此后目标值变化 → 由 update 推一次**翻牌**动画。 */
  function setDevour({ progress = 0, every = 7, ready = false } = {}) {
    const want = Math.max(0, Math.min(every, ready ? every : progress));
    if (!st.devour) {
      st.devour = { shown: want, from: want, target: want, every, ready, flip: 1, flipping: false };
      redrawCounter();
      return true;
    }
    const d = st.devour;
    const styleChanged = d.every !== every || d.ready !== ready;
    d.every = every; d.ready = ready;
    if (want !== d.target) {
      d.target = want;
      d.from = d.shown;      // 翻牌从"上一次落定的数字"起翻
      d.shown = want;
      d.flip = 0;
      d.flipping = true;
    }
    if (styleChanged && !d.flipping) redrawCounter();
    return true;
  }
  /** 进度是否已满（宿主据此决定粉碎口是否可点）。 */
  const devourReady = () => !!st.devour?.ready;

  // ---- 金币迸出（粉碎演出收尾）----
  const COIN_N = 16;
  let coinMesh = null;
  const coinState = { t: 0, life: 1.15, pos: [], vel: [] };
  function ensureCoinMesh() {
    if (coinMesh) return coinMesh;
    coinMesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(0.13, 0),
      familyMaterial('unlit', { color: brighten(P.gold, 5) }),
      COIN_N,
    );
    coinMesh.frustumCulled = false;
    coinMesh.visible = false;
    coinMesh.userData.rigOwned = 'slotCoins';
    body.add(coinMesh);
    return coinMesh;
  }
  function spawnCoins() {
    const mesh = ensureCoinMesh();
    const cx = crusher?.mawX ?? 0;
    const cy = (crusher?.mawY ?? 2) + 0.25;
    const cz = (crusher?.mawZ ?? 1.3) + 0.15;
    coinState.pos = [];
    coinState.vel = [];
    for (let i = 0; i < COIN_N; i++) {
      coinState.pos.push(new THREE.Vector3(cx, cy, cz));
      coinState.vel.push(new THREE.Vector3(
        (Math.random() - 0.5) * 2.2, 1.4 + Math.random() * 1.8, 1.6 + Math.random() * 1.6,
      ));
    }
    coinState.t = 0;
    mesh.visible = true;
  }
  /** 粉碎演出：金牙咬合 + 机壳剧震 + 口内闪红 + 金币迸出。正忙时返回 false。 */
  function crush() {
    if (st.crushFx || st.spin) return false;
    st.crushFx = { t: 0, seconds: 1.3, flash: 0 };
    st.shake = Math.max(st.shake, 0.5);
    st.shakeAmp = Math.max(st.shakeAmp, 0.06);
    spawnCoins();
    return true;
  }

  // 拉杆：材质独立化（悬停/拉下时能闪光提示——它是"这台能点"的关键部件）
  const leverParts = [];
  lever?.traverse((o) => {
    if (!o.isMesh) return;
    o.material = o.material.clone();
    const base = o.material.color.clone();
    o.material.emissive = new THREE.Color(0x000000);
    leverParts.push({ mesh: o, base });
  });
  let leverFlash = 0;
  const basePos = body.position.clone();   // 机器由 composeRoom 定位——抖动只能在基准位附近
  const baseScale = body.scale.x || 1;

  const st = {
    t: 0,
    phase: Math.random() * 10,
    hover: 0,            // 0..1 hover 权重（平滑过渡）
    focus: 0,            // 0..1 追光权重（相机怼脸时抑制抖动，见 calm）
    pulling: false,
    leverAngle: 0,       // 0 = 静止，负 = 拉下
    leverRelease: 0,     // 弹起进度（0..1）
    spin: null,          // { elapsed, tier, locked: [bool], plans: [planReel…] }（见文件头时序）
    spinEnergy: 0,       // 0..1 转轮当前动能（驱动整机震动/拨杆共振）
    needleTilt: 0,       // 拨针摆角（弹簧积分）
    needleVel: 0,
    demonK: 0,           // 0..1 恶魔态风格权重（灯效/彩灯偏暗红）
    gateK: 0,            // 0 = 开门（闸口收起），1 = 关门（盖住开口）
    reelsDemon: false,   // 转盘是否已换成恶魔盘
    seq: null,           // 闸口/换盘的时序脚本（见 runSeq）
    win: null,           // { tier, t, fx }
    shake: 0,            // 剩余抖动时间
    shakeAmp: 0,
    devour: null,        // { value, target, every, ready }：计数器（value 连续量 → 数字滚动）
    crushFx: null,       // { t, seconds, flash }：粉碎演出
  };

  // ---- 彩灯：常态呼吸 + 灯效（InstancedMesh + instanceColor，逐实例写色）----
  // **逐颗底色**来自资产登记的 tints[]（一圈彩灯颜色不同才有"赌具"味），缺省暖金。
  // "亮起"用**乘算提亮**保住色相（详见下方 brighten 注释）——近白（flameCore）或朝白插值
  // 都会把整圈彩灯糊成白色（用户报障"彩灯亮起的时候都一律显示为白色"）。
  const bulbTints = bulbRing?.tints ?? [];
  const lampTints = lampRing?.tints ?? [];
  const bulbMesh = bulbRing?.mesh ?? null;
  const lampMesh = lampRing?.mesh ?? null;
  // 三档亮度（线性乘算）：暗 → 常态亮（淡 bloom）→ 中奖爆亮（强 bloom）。
  // 阈值 1.45：常态 ×10 让多数色相刚过阈值（有一层薄光晕），爆闪 ×18 明显发光。
  const bulbWarm = (t) => brighten(t, 10);
  const bulbDim = (t) => brighten(t, 3);
  const bulbLit = (t) => brighten(t, 18);

  function paintBulbs(level = 0) {
    // level 0 = 常态（暗金呼吸）；>0 = 中奖灯效强度
    for (let i = 0; i < bulbTints.length; i++) {
      const tint = bulbTints[i];
      const breathe = 0.5 + 0.5 * Math.sin(st.t * 1.6 + i * 0.5);
      if (st.win) {
        const fx = st.win.fx;
        const chaseOn = fx.chase > 0 && ((i + Math.floor(st.win.t * fx.chase)) % 3 === 0);
        // 爆闪用**占空比**而不是 `> 1 - flash*2`（flash=1 时那个判据恒真 → 只会一直亮、
        // 没有"闪"的节奏）：flash=1 约 63% 占空，flash=0.35 约 33%。
        const flashOn = fx.flash > 0 && Math.sin(st.win.t * 18) > 1 - fx.flash * 1.4;
        const on = chaseOn || flashOn;
        bulbMesh.setColorAt(i, on ? bulbLit(tint) : bulbWarm(tint));
      } else {
        // 常态：呼吸（整体偏亮——彩灯是"亮着的"，暗一档就变成没通电的塑料球）
        const base = bulbDim(tint).lerp(bulbWarm(tint), 0.5 + 0.35 * breathe + 0.35 * st.hover);
        bulbMesh.setColorAt(i, base);
      }
    }
    if (bulbMesh.instanceColor) bulbMesh.instanceColor.needsUpdate = true;
    // ---- 三颗锁定指示灯：**转轮没停就灭、停稳就亮**（用户定 2026-09-11）----
    // 中奖时随灯效闪（用各灯自己的底色，不再糊白）。
    for (let i = 0; i < lampTints.length; i++) {
      const locked = st.spin ? !!st.spin.locked[i] : true;   // 待机 = 已在槽位上 = 亮
      if (st.win) {
        const fx = st.win.fx;
        const on = (fx.chase > 0 && Math.floor(st.win.t * fx.chase) % 2 === 0)
          || (fx.flash > 0 && Math.sin(st.win.t * 18) > 1 - fx.flash * 1.4);
        lampMesh.setColorAt(i, on ? lampLit : lampOnDim);
      } else if (locked) {
        lampMesh.setColorAt(i, lampOn);
      } else {
        lampMesh.setColorAt(i, lampOff);
      }
    }
    if (lampMesh?.instanceColor) lampMesh.instanceColor.needsUpdate = true;
  }
  // ---- 恶魔 roll 的机械演出（用户定 2026-09-11）----
  // 闸口 = 盖住转轮窗的板：关 → 换盘 → 开。整段是**时序脚本**（每步 dur + 插值函数），
  // 由 update 推进；脚本跑完前 isBusy() 为真（宿主据此禁掉拉杆/输入）。
  // 恶魔态风格（彩灯 + 光照偏暗红）走 demonK 权重，与机械动画解耦——宿主可单独拉。
  function runSeq(steps) {
    st.seq = { steps, i: 0, t: 0 };
  }
  /** 进入恶魔 roll：关闸 → 换恶魔盘 → 开闸（期间 demonK 拉满）。 */
  function demonEnter() {
    if (st.seq || st.spin) return false;
    st.demonWant = 1;
    runSeq([
      { dur: 0.42, fn: (t) => { st.gateK = t; } },                       // 关闸
      { dur: 0.18, fn: () => { swapReels(true); } },                     // 关着换盘
      { dur: 0.42, fn: (t) => { st.gateK = 1 - t; } },                   // 开闸
    ]);
    return true;
  }
  /** 退出恶魔 roll：关闸 → 换回普通盘 → 开闸（demonK 归零）。 */
  function demonExit() {
    if (st.seq) return false;
    st.demonWant = 0;
    runSeq([
      { dur: 0.42, fn: (t) => { st.gateK = t; } },
      { dur: 0.18, fn: () => { swapReels(false); } },
      { dur: 0.42, fn: (t) => { st.gateK = 1 - t; } },
    ]);
    return true;
  }
  /** 换盘：恶魔盘 = 占位暗红（素材到位后在这里换 symbolKeys 取图）。 */
  function swapReels(demon) {
    st.reelsDemon = demon;
    for (const r of reels) {
      const mesh = r.userData.drumMesh;
      if (!mesh) continue;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of mats) {
        if (!m?.color) continue;
        if (demon) { if (!m.userData.__base) m.userData.__base = m.color.clone(); m.color.copy(demonTint); }
        else if (m.userData?.__base) { m.color.copy(m.userData.__base); delete m.userData.__base; }
      }
    }
  }
  function stepSeq(dt) {
    const q = st.seq;
    if (!q) return;
    q.t += dt;
    const step = q.steps[q.i];
    const t = Math.min(1, step.dur > 0 ? q.t / step.dur : 1);
    step.fn(t);
    if (q.t >= step.dur) { q.i += 1; q.t = 0; if (q.i >= q.steps.length) st.seq = null; }
  }

  // ---- 拉杆 ----
  function pull({ tier = 'minor', symbols = null } = {}) {
    if (st.spin) return false;                      // 转轮中不能再拉（调用方另有防抖）
    st.pulling = true;
    st.leverRelease = 0;
    st.win = null;
    st.shake = Math.max(st.shake, 0.12);            // 拉杆瞬间整机一顿（起转的"踹一脚"）
    st.shakeAmp = Math.max(st.shakeAmp, 0.03);
    st.spin = {
      elapsed: 0,
      tier,
      locked: reels.map(() => false),
      // 每轮的整段动画计划在拉杆瞬间一次算定（后端此时已给结果）——解析式求值，
      // 圈数让"自然停车位"落在槽位稍前方，末段卡入位把它拉回槽位。
      plans: reels.map((r, i) => {
        const s = symbols?.[i];
        const k = Number.isInteger(s) ? s % SYM : Math.floor(Math.random() * SYM);
        return planReel(r.rotation.x, k, SYM, CRUISE_T[i % CRUISE_T.length]);
      }),
    };
    return true;
  }

  function update(dt) {
    st.t += dt;
    stepSeq(dt);                                   // 闸口/换盘时序
    st.demonK += ((st.demonWant ?? 0) - st.demonK) * Math.min(1, dt * 3.5);
    if (gate) gate.position.y = gateOpenY + (gateClosedY - gateOpenY) * st.gateK;
    applyArtPanels();   // 画牌贴图：图刚解码完的那一帧贴上（之后就空转）
    applyReelArt();     // 轮盘图案同理
    // 追光（相机怼脸）时抑制抖动：屏幕上的位移在近景会被放大得"晃得厉害"，
    // 此时机器只该有极轻微的呼吸感（用户 2026-09-11：再缩一倍 → calm ≈ 0.16）。
    st.focus += ((st.focusTarget ?? 0) - st.focus) * Math.min(1, dt * 5);
    const calm = 1 - 0.84 * st.focus;

    // ---- 横向拨针：被转轮带着抖/偏，停轮后弹簧归位（用户定 2026-09-11）----
    if (needle) {
      const target = -st.spinEnergy * 0.055;              // 转得越猛，针被压得越偏
      const K_SPRING = 90, DAMP = 9;                      // 欠阻尼（ζ≈0.47）→ 归位带一点回摆
      st.needleVel += (target - st.needleTilt) * K_SPRING * dt - st.needleVel * DAMP * dt;
      st.needleTilt += st.needleVel * dt;
      const wob = st.spinEnergy > 0.001 ? Math.sin(st.t * 33 + st.phase) * 0.014 * st.spinEnergy : 0;
      needle.rotation.z = (st.needleTilt + wob) * calm;
    }

    // ---- 常驻抖动：机体微微抖（幅度小但持续；中奖时叠加"激动"抖动）----
    // **层次反馈**（用户定）：转轮高速转动时整机跟着震（转盘带动机构），转速降下来震动也弱，
    // 落槽瞬间再叠一次"咔"式弹跳；追光怼脸时统一按 calm 压制。
    const idleAmp = (st.hover > 0.5 ? 0.02 : 0.012) * calm;
    const vibAmp = 0.05 * st.spinEnergy * calm;
    let shakeX = 0, shakeY = 0, shakeZ = 0;
    if (st.shake > 0) {
      st.shake = Math.max(0, st.shake - dt);
      const k = st.shakeAmp * (st.shake > 0 ? 1 : 0) * calm;
      shakeX = Math.sin(st.t * 46) * k;
      shakeY = Math.abs(Math.sin(st.t * 38)) * k * 0.7;
      shakeZ = Math.cos(st.t * 52) * k * 0.5;
    }
    // 转动震动：高频 + 沿机体轴向为主（真机是被三根鼓带着左右晃）
    const vibX = st.spinEnergy > 0.001 ? Math.sin(st.t * 37) * vibAmp : 0;
    const vibY = st.spinEnergy > 0.001 ? Math.abs(Math.sin(st.t * 31)) * vibAmp * 0.8 : 0;
    body.position.set(
      basePos.x + Math.sin(st.t * 13.3 + st.phase) * idleAmp + shakeX + vibX,
      basePos.y + Math.abs(Math.sin(st.t * 9.7 + st.phase)) * idleAmp * 0.6 + shakeY + vibY,
      basePos.z + Math.cos(st.t * 11.1 + st.phase) * idleAmp * 0.5 + shakeZ,
    );
    body.rotation.z = (Math.sin(st.t * 7.3 + st.phase) * 0.004 + shakeZ * 0.02
      + (st.spinEnergy > 0.001 ? Math.sin(st.t * 41) * 0.0035 * st.spinEnergy : 0)) * calm;
    // hover：轻微上浮放大（配合灯提亮）
    st.hover += ((st.hoverTarget ?? 0) - st.hover) * Math.min(1, dt * 8);
    const hoverBoost = 1 + 0.025 * st.hover;
    body.scale.setScalar(baseScale * hoverBoost);

    // ---- 拉杆：快速拉下 → 缓慢弹起（弹性回位）；悬停/拉下时闪光提示 ----
    leverFlash = Math.max(0, leverFlash - dt * 2.2);
    if (lever) {
      const wantFlash = st.pulling || st.hover > 0.5 ? 1 : 0;
      leverFlash = Math.max(leverFlash, wantFlash * Math.min(1, dt * 6 + leverFlash));
      if (st.pulling) {
        st.leverAngle += (-1.05 - st.leverAngle) * Math.min(1, dt * 16);
        if (st.leverAngle < -1.0) { st.pulling = false; st.leverRelease = 0; }
      } else {
        st.leverRelease = Math.min(1, st.leverRelease + dt * 0.9);   // 缓慢弹起（约 1.1s）
        const e = 1 - Math.pow(1 - st.leverRelease, 3);              // easeOutCubic
        const overshoot = Math.sin(st.leverRelease * Math.PI) * 0.12;
        st.leverAngle = -1.05 * (1 - e) + overshoot * (1 - e);
      }
      lever.rotation.z = st.leverAngle
        + (st.spinEnergy > 0.001 ? Math.sin(st.t * 47) * 0.03 * st.spinEnergy : 0);  // 转轮带着拨杆共振
      // 闪光：朝冷白插值（拉下瞬间最亮）
      for (const lp of leverParts) {
        lp.mesh.material.color.copy(lp.base).lerp(new THREE.Color(P.flameCore), leverFlash * 0.75);
      }
    }

    // ---- 转轮：① 加速 → ② 长匀速 → ③ 指数减速（将停未停）→ ④ 卡入位（阻尼弹回槽位）----
    // 顺带测**当前转速**（角度差分）：转轮的动能驱动"机体随转轮一起震"（层次反馈，用户定）。
    if (st.spin) {
      const s = st.spin;
      s.elapsed += dt;
      let topSpeed = 0;
      reels.forEach((r, i) => {
        if (s.locked[i]) return;
        const p = s.plans[i];
        const a = s.elapsed >= p.tLock ? p.target : angleAt(p, s.elapsed);
        const prev = s.prevAngle?.[i];
        if (prev !== undefined && dt > 1e-4) {
          topSpeed = Math.max(topSpeed, Math.abs(a - prev) / dt);
        }
        if (!s.prevAngle) s.prevAngle = reels.map((rr) => rr.rotation.x);
        s.prevAngle[i] = a;
        if (s.elapsed >= p.tLock) {
          r.rotation.x = p.target;                                 // 硬落槽（离散、无累积误差）
          r.userData.index = p.targetIndex ?? r.userData.index;
          s.locked[i] = true;
          st.shake = Math.max(st.shake, 0.09);                     // 落槽小弹跳
          st.shakeAmp = Math.max(st.shakeAmp, 0.022);
          st.needleVel += (i % 2 === 0 ? -1 : 1) * 2.6;            // 拨针被咬合震一下（左右反向）
        } else {
          r.rotation.x = a;
        }
      });
      // 转速归一（匀速段 = 1）→ 平滑一下（落槽瞬间差分会有尖刺）
      const e = Math.min(1, topSpeed / CRUISE_V);
      st.spinEnergy += (e - st.spinEnergy) * Math.min(1, dt * 12);
      if (s.locked.every(Boolean)) {
        const tier = s.tier;
        st.spin = null;
        st.win = { tier, t: 0, fx: TIER_FX[tier] ?? TIER_FX.none };
        if (st.win.fx.shake > 0) { st.shake = st.win.fx.seconds; st.shakeAmp = st.win.fx.shake; }
      }
    } else if (st.spinEnergy > 0) {
      st.spinEnergy = Math.max(0, st.spinEnergy - dt * 1.6);       // 停轮后余震收干净
    }

    // ---- 中奖灯效推进 ----
    if (st.win) {
      st.win.t += dt;
      if (st.win.t > st.win.fx.seconds) st.win = null;
    }

    // ---- 摇杆次数计数器：目标值变化后推一次翻牌动画（两片叶子折下/落下）----
    // 状态推进不依赖 canvas（headless 也走），只有重绘才需要计数器贴图
    if (st.devour?.flipping) {
      const d = st.devour;
      d.flip = Math.min(1, d.flip + dt / FLAP_DUR);
      if (d.flip >= 1) d.flipping = false;
      redrawCounter();
    }
    // ---- 粉碎口外观：进度满 → 金牙/面板脉动发亮；粉碎瞬间 → 口内闪红 ----
    const readyK = st.devour?.ready && !st.crushFx ? 1 : 0;
    if (jaw?.material) {
      const flash = st.crushFx?.flash ?? 0;
      // 闪白克制一点：咬合瞬间 ×3.4 已足够进 bloom 亮部通道，×7 会把上下牙糊成一坨白
      const k = 0.7 + readyK * (1.5 + 1.1 * Math.sin(st.t * 5.2)) + flash * 3.4;
      jaw.material.color.copy(brighten(P.gold, k));
    }
    if (throat?.material) {
      const flash = Math.min(1, st.crushFx?.flash ?? 0);
      throat.material.color.copy(P.night).lerp(TMP_RED, flash);
    }
    if (counter?.material) {
      // 面板整体亮度乘子（贴图 × color）：满格时脉动——HDR 乘到 >1 才进 bloom 亮部通道
      counter.material.color.setScalar(1 + readyK * (0.3 + 0.25 * Math.sin(st.t * 6.1)));
    }
    // ---- 粉碎演出推进：咬合（jaw 绕口心上下收放）+ 金币抛物 ----
    if (st.crushFx) {
      const c = st.crushFx;
      c.t += dt;
      const close = Math.min(1, c.t / 0.20);
      const reopen = Math.max(0, Math.min(1, (c.t - 0.30) / 0.55));
      // 咬合只收到 0.55：上下牙**交错**才读得出"牙"，压到 0.15 两排会叠成一坨金色实心块
      if (jaw) jaw.scale.y = (1 - 0.45 * close) + 0.45 * close * reopen;
      c.flash = close * (1 - reopen);
      if (c.t >= c.seconds) {
        st.crushFx = null;
        if (jaw) jaw.scale.y = 1;
        if (throat?.material) throat.material.color.copy(P.night);
      }
    }
    if (coinMesh?.visible) {
      coinState.t += dt;
      const m4 = TMP_M4; const sc = TMP_V3;
      for (let i = 0; i < COIN_N; i++) {
        const p = coinState.pos[i]; const v = coinState.vel[i];
        v.y -= 9.5 * dt;
        p.addScaledVector(v, dt);
        if (p.y < 0.35) { p.y = 0.35; v.set(0, 0, 0); }
        const fade = Math.max(0, Math.min(1, 1 - Math.max(0, coinState.t - 0.62) / 0.45));
        m4.makeTranslation(p.x, p.y, p.z);
        m4.scale(sc.setScalar(fade));
        coinMesh.setMatrixAt(i, m4);
      }
      coinMesh.instanceMatrix.needsUpdate = true;
      if (coinState.t >= coinState.life) coinMesh.visible = false;
    }
    paintBulbs(st.win ? 1 : 0);
  }

  return {
    pull,
    update,
    setHover: (on) => { st.hoverTarget = on ? 1 : 0; },
    /** 追光（相机怼脸）开关：抑制抖动幅度——近景里同样的位移看起来会剧烈得多。 */
    setFocus: (on) => { st.focusTarget = on ? 1 : 0; },
    // 恶魔 roll（宿主编排；美术未到位时转盘走占位暗红）
    demonEnter, demonExit,
    isDemon: () => !!st.reelsDemon || (st.demonWant ?? 0) > 0,
    setDemonStyle: (k) => { st.demonWant = Math.max(0, Math.min(1, k)); },
    isBusy: () => !!st.spin || !!st.seq || !!st.crushFx,
    // 粉碎入口（吞噬）：计数器下行 + 粉碎演出
    setDevour,
    devourReady,
    crush,
    /** 可点热区（宿主射线拾取用）：投料口暗腔 + 计数器面板。 */
    crusherTargets: () => [throat, counter].filter(Boolean),
    /** 热区 → 语义名（宿主派发意图用）：'crusher' = 投料口，'counter' = 计数器。 */
    pickNameOf: (obj) => {
      if (obj === throat) return 'crusher';
      if (obj === counter) return 'counter';
      return null;
    },
    state: st,
  };
}
