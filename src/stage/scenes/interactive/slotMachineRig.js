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
import { P, shade } from '../kit/index.js';

const Z = Math.PI * 2;

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
  const bulbs = parts?.bulbs ?? [];
  // 转轮面数由资产决定（道具导出 SYMBOLS 长度）；资产侧只有 kit 共享材质，
  // 彩灯的逐帧改色**由 rig 持独立材质**（资产禁自建材质是契约）。
  const SYM = reels[0]?.userData?.symbols?.length ?? 5;
  for (const b of bulbs) b.material = new THREE.MeshBasicMaterial({ color: P.gold });
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
    win: null,           // { tier, t, fx }
    shake: 0,            // 剩余抖动时间
    shakeAmp: 0,
  };

  // ---- 彩灯：常态呼吸 + 灯效（逐灯独立材质，直接改 color）----
  // **逐颗底色**来自资产登记的 userData.tint（一圈彩灯颜色不同才有"赌具"味），缺省暖金。
  const bulbOn = new THREE.Color(P.flameCore);
  const tintOf = (b) => b.userData?.tint ?? P.gold;
  const bulbWarm = (b) => new THREE.Color(shade(tintOf(b), 0.1));
  const bulbDim = (b) => new THREE.Color(shade(tintOf(b), -0.22));

  function paintBulbs(level = 0) {
    // level 0 = 常态（暗金呼吸）；>0 = 中奖灯效强度
    bulbs.forEach((b, i) => {
      const breathe = 0.5 + 0.5 * Math.sin(st.t * 1.6 + i * 0.5);
      if (st.win) {
        const fx = st.win.fx;
        const chaseOn = fx.chase > 0 && ((i + Math.floor(st.win.t * fx.chase)) % 3 === 0);
        const flashOn = fx.flash > 0 && Math.sin(st.win.t * 18) > 1 - fx.flash * 2;
        const on = chaseOn || flashOn;
        b.material.color.copy(on ? bulbOn : bulbWarm(b));
      } else {
        // 常态：呼吸（整体偏亮——彩灯是"亮着的"，暗一档就变成没通电的塑料球）
        const base = bulbDim(b).lerp(bulbWarm(b), 0.5 + 0.35 * breathe + 0.35 * st.hover);
        b.material.color.copy(base);
      }
    });
  }
  // ---- 拉杆 ----
  function pull({ tier = 'minor', symbols = null } = {}) {
    if (st.spin) return false;                      // 转轮中不能再拉（调用方另有防抖）
    st.pulling = true;
    st.leverRelease = 0;
    st.win = null;
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
    // 追光（相机怼脸）时抑制抖动：屏幕上的位移在近景会被放大得"晃得厉害"，
    // 此时机器只该有极轻微的呼吸感（用户 2026-09-11：再缩一倍 → calm ≈ 0.16）。
    st.focus += ((st.focusTarget ?? 0) - st.focus) * Math.min(1, dt * 5);
    const calm = 1 - 0.84 * st.focus;

    // ---- 常驻抖动：机体微微抖（幅度小但持续；中奖时叠加"激动"抖动）----
    const idleAmp = (st.hover > 0.5 ? 0.02 : 0.012) * calm;
    let shakeX = 0, shakeY = 0, shakeZ = 0;
    if (st.shake > 0) {
      st.shake = Math.max(0, st.shake - dt);
      const k = st.shakeAmp * (st.shake > 0 ? 1 : 0) * calm;
      shakeX = Math.sin(st.t * 46) * k;
      shakeY = Math.abs(Math.sin(st.t * 38)) * k * 0.7;
      shakeZ = Math.cos(st.t * 52) * k * 0.5;
    }
    body.position.set(
      basePos.x + Math.sin(st.t * 13.3 + st.phase) * idleAmp + shakeX,
      basePos.y + Math.abs(Math.sin(st.t * 9.7 + st.phase)) * idleAmp * 0.6 + shakeY,
      basePos.z + Math.cos(st.t * 11.1 + st.phase) * idleAmp * 0.5 + shakeZ,
    );
    body.rotation.z = (Math.sin(st.t * 7.3 + st.phase) * 0.004 + shakeZ * 0.02) * calm;
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
      lever.rotation.z = st.leverAngle;
      // 闪光：朝冷白插值（拉下瞬间最亮）
      for (const lp of leverParts) {
        lp.mesh.material.color.copy(lp.base).lerp(new THREE.Color(P.flameCore), leverFlash * 0.75);
      }
    }

    // ---- 转轮：① 加速 → ② 长匀速 → ③ 指数减速（将停未停）→ ④ 卡入位（阻尼弹回槽位）----
    if (st.spin) {
      const s = st.spin;
      s.elapsed += dt;
      reels.forEach((r, i) => {
        if (s.locked[i]) return;
        const p = s.plans[i];
        if (s.elapsed >= p.tLock) {
          r.rotation.x = p.target;                                 // 硬落槽（离散、无累积误差）
          r.userData.index = p.targetIndex ?? r.userData.index;
          s.locked[i] = true;
          st.shake = Math.max(st.shake, 0.09);                     // 落槽小弹跳
          st.shakeAmp = Math.max(st.shakeAmp, 0.02);
        } else {
          r.rotation.x = angleAt(p, s.elapsed);
        }
      });
      if (s.locked.every(Boolean)) {
        const tier = s.tier;
        st.spin = null;
        st.win = { tier, t: 0, fx: TIER_FX[tier] ?? TIER_FX.none };
        if (st.win.fx.shake > 0) { st.shake = st.win.fx.seconds; st.shakeAmp = st.win.fx.shake; }
      }
    }

    // ---- 中奖灯效推进 ----
    if (st.win) {
      st.win.t += dt;
      if (st.win.t > st.win.fx.seconds) st.win = null;
    }
    paintBulbs(st.win ? 1 : 0);
  }

  return {
    pull,
    update,
    setHover: (on) => { st.hoverTarget = on ? 1 : 0; },
    /** 追光（相机怼脸）开关：抑制抖动幅度——近景里同样的位移看起来会剧烈得多。 */
    setFocus: (on) => { st.focusTarget = on ? 1 : 0; },
    isBusy: () => !!st.spin,
    state: st,
  };
}
