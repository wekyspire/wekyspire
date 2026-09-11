// screenImpactFX：受伤全屏演出件（震荡 + 渐晕），由 BattleStage 在伤害节拍驱动。
// 组成：
//   ├─ ScreenShake：全屏震荡——对注册相机（世界透视 + UI 正交）施加逐帧位移偏移，
//   │   双 pass 同步偏移 = 真·全屏震（场景与 UI 一起晃）。幅度/时长随受击烈度增长，
//   │   线性包络衰减，正弦双轴抖动（每次 impulse 随机相位，重复受击不重样）。
//   │   震荡是 non-blocking FX（不进动画队列、不占节拍），与粒子/读数同律。
//   └─ DamageVignette：视角边缘压暗压红渐晕——友军受击时播放（uiScene 顶层覆盖面，
//       径向渐变贴图：中心全透明，边角暗红）。峰值随烈度、指数释放。
//
// 烈度口径（damageSeverity）：生命值伤害全值 + 护盾吸收 ×0.2——护盾受击严重度低
// （用户定），震荡/渐晕强度都吃同一口径，演出与结算同源不漂移。
// node 无 document 时渐晕退化为纯色面（不烘贴图），状态机照常可单测。

import * as THREE from 'three';
import { WORLD_HEIGHT, UI_CAMERA_LOOK_AT_Y } from '../StageManager.js';

// ---- 烈度 → 演出参数映射（世界高度 100 基准） ----
// 饱和曲线（MIN + (MAX-MIN) × min(1, 烈度/SAT)）：小伤害大幅减弱（1 点直伤只是
// 桌面轻磕），重击仍冲到顶——线性「基础值+斜率」会让轻击也震得像重击（用户反馈）
const SHIELD_SEVERITY_FACTOR = 0.2;  // 护盾吸收的烈度折算系数
const SHAKE_SAT_SEVERITY = 26;       // 烈度饱和点：达到此值幅度/时长封顶
const SHAKE_AMP_MIN = 0.14;          // 最小幅度（世界单位）：轻击几乎只是微颤
const SHAKE_AMP_MAX = 4.2;           // 上限 ≈ 屏高 4%：重击到顶也不再晕屏
const SHAKE_DUR_MIN = 0.14;          // 最小时长（秒）
const SHAKE_DUR_MAX = 0.8;
const SHAKE_FREQ_X = 34;             // 双轴抖动角频率（rad/s，互质防同步拍频）
const SHAKE_FREQ_Y = 41;
const SHAKE_AXIS_RATIO = 0.72;       // 纵向幅度系数：横向为主的甩动感

const VIGNETTE_PEAK_BASE = 0.12;     // 轻击渐晕几乎不可感（压暗是重击特权）
const VIGNETTE_PEAK_PER_SEVERITY = 0.024;
const VIGNETTE_PEAK_MAX = 0.85;
const VIGNETTE_RELEASE_TAU = 0.45;   // 指数释放时间常数（秒）：峰值后约 0.3s 肉眼可感

/** 受击烈度：生命值伤害全值 + 护盾吸收 ×0.2。震荡与渐晕共用的唯一口径。 */
export function damageSeverity(dealt, shieldAbsorbed) {
  return Math.max(0, (dealt ?? 0)) + Math.max(0, (shieldAbsorbed ?? 0)) * SHIELD_SEVERITY_FACTOR;
}

export class ScreenShake {
  /** @param {{ cameras: THREE.Camera[] }} options 每帧施加偏移的相机集（基位在构造时锁定） */
  constructor({ cameras = [] } = {}) {
    this._cams = [...cameras].map(cam => ({ cam, base: cam.position.clone() }));
    this._amp = 0;   // 当前幅度（世界单位）
    this._dur = 0;   // 本次震荡总时长（秒）
    this._t = 0;     // 包络时间
    this._phX = 0;
    this._phY = 0;
    this._active = false;
  }

  /** 触发一次震荡。strength = damageSeverity 口径的烈度值（饱和曲线映射）。 */
  impulse(strength) {
    const s = Math.min(1, Math.max(0, strength) / SHAKE_SAT_SEVERITY);
    const amp = SHAKE_AMP_MIN + (SHAKE_AMP_MAX - SHAKE_AMP_MIN) * s;
    const dur = SHAKE_DUR_MIN + (SHAKE_DUR_MAX - SHAKE_DUR_MIN) * s;
    // 连击合并：幅度取「余存包络与新击」较大者，时长取「剩余与新击」较长者——
    // 不叠加（防连续小额伤害叠出超限抖动），但也不让前一击把后一击吃掉
    const remain = this._active ? this._amp * (1 - this._t / this._dur) : 0;
    const remainTime = this._active ? this._dur - this._t : 0;
    this._amp = Math.max(remain, amp);
    this._dur = Math.max(remainTime, dur);
    this._t = 0;
    this._phX = Math.random() * Math.PI * 2;
    this._phY = Math.random() * Math.PI * 2;
    this._active = true;
  }

  /** 当前显示幅度（世界单位，含包络衰减；测试断言口）。 */
  get currentAmplitude() {
    return this._active ? this._amp * (1 - this._t / this._dur) : 0;
  }

  /** 帧推进：把偏移写入相机（tick 尾调用——本帧逻辑用基位，渲染带偏移）。 */
  update(dt) {
    if (!this._active) return;
    this._t += dt;
    if (this._t >= this._dur) {
      this._active = false;
      for (const { cam, base } of this._cams) cam.position.copy(base); // 精确复位
      return;
    }
    const k = this._amp * (1 - this._t / this._dur); // 线性包络
    const ox = k * Math.sin(this._t * SHAKE_FREQ_X + this._phX);
    const oy = k * SHAKE_AXIS_RATIO * Math.sin(this._t * SHAKE_FREQ_Y + this._phY);
    for (const { cam, base } of this._cams) cam.position.set(base.x + ox, base.y + oy, base.z);
  }

  /** 退场复位：相机回基位（舞台 dispose 时必须调，防把偏移泄漏给下一舞台）。 */
  dispose() {
    this._active = false;
    for (const { cam, base } of this._cams) cam.position.copy(base);
  }
}

export class DamageVignette {
  constructor() {
    this._peak = 0;      // 本次脉冲峰值透明度
    this._timer = 0;     // 释放计时
    this._opacity = 0;   // 当前透明度（测试断言口）

    // 覆盖面：正交 UI 视界整幅（16:9 假定下世界宽 ≈177.8；宽高各放 18% 余量防裁边），
    // 挂 uiCamera 可见 z 区间顶端 + 显式 renderOrder——必须盖过查看器（z=80）等一切前景
    const W = WORLD_HEIGHT * 1.18 * (16 / 9);
    const H = WORLD_HEIGHT * 1.18;
    this.object = new THREE.Mesh(
      new THREE.PlaneGeometry(W, H),
      new THREE.MeshBasicMaterial({
        transparent: true, opacity: 0, depthTest: false, depthWrite: false,
        color: 0x1a0206, // node 退化底色（无贴图时的暗红近黑）
      }),
    );
    this.object.name = 'damageVignette';
    this.object.position.set(0, UI_CAMERA_LOOK_AT_Y, 490);
    this.object.renderOrder = 1000;
    this.object.visible = false;
    if (typeof document !== 'undefined') {
      this.object.material.map = bakeVignetteTexture();
      this.object.material.color.set(0xffffff);
      this.object.material.needsUpdate = true;
    }
  }

  /** 触发一次渐晕脉冲（友军受击）。strength = damageSeverity 口径的烈度值。 */
  pulse(strength) {
    const peak = Math.min(
      VIGNETTE_PEAK_BASE + Math.max(0, strength) * VIGNETTE_PEAK_PER_SEVERITY, VIGNETTE_PEAK_MAX,
    );
    this._peak = Math.max(this._peak * Math.exp(-this._timer / VIGNETTE_RELEASE_TAU), peak);
    this._timer = 0; // 连击续命：释放计时归零，余晖上叠新峰
  }

  get opacity() { return this._opacity; }

  update(dt) {
    if (this._peak <= 0) return;
    this._timer += dt;
    this._opacity = this._peak * Math.exp(-this._timer / VIGNETTE_RELEASE_TAU);
    if (this._opacity < 0.01) { // 收尽：隐藏面省一整幅透明过绘
      this._opacity = 0;
      this._peak = 0;
    }
    this.object.visible = this._opacity > 0;
    this.object.material.opacity = this._opacity;
  }

  dispose() {
    this.object.geometry.dispose();
    this.object.material.map?.dispose?.();
    this.object.material.dispose();
  }
}

// 渐晕贴图：正方形径向渐变（中心透明 → 边角暗红），面片拉伸到 16:9 后天然成椭圆渐晕。
// 压暗与压红一体：中带先泛红，边角沉入近黑红。
function bakeVignetteTexture() {
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const c = S / 2;
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  grad.addColorStop(0.52, 'rgba(0, 0, 0, 0)');
  grad.addColorStop(0.78, 'rgba(120, 10, 18, 0.38)');
  grad.addColorStop(1, 'rgba(26, 2, 6, 0.98)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
