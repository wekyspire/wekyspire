// screenImpactFX：受伤全屏演出件（震荡 + 渐晕），由 BattleStage 在伤害节拍驱动。
// 组成：
//   ├─ ScreenShake：全屏震荡——向相机导演登记一路叠加偏移通道，导演 commit 时把
//   │   世界相机与 UI 正交相机同步位移（双 pass 同步偏移 = 真·全屏震，场景与 UI 一起晃）。
//   │   幅度/时长随受击烈度增长，线性包络衰减，正弦双轴抖动（每次 impulse 随机相位，
//   │   重复受击不重样）。震荡是 non-blocking FX（不进动画队列、不占节拍），与粒子/读数同律。
//   │   与运镜天然可叠加：震荡震它的，flyTo 飞它的，两路各写各的数据、互不覆盖。
//   └─ DamageVignette：视角边缘压暗压红渐晕（uiScene 顶层覆盖面，径向渐变贴图：
//       中心全透明，边角暗红）。两层：①受击脉冲（友军受伤时播，峰值随烈度、指数
//       释放）②低血常驻档（hp ≤ 20% 状态驱动，慢呼吸起伏、不随释放消退——
//       BattleStage 每帧按快照血量推 lowHp；受击脉冲叠加其上）。
//
// 烈度口径（damageSeverity）：生命值伤害全值 + 护盾吸收 ×0.2——护盾受击严重度低
// ，震荡/渐晕强度都吃同一口径，演出与结算同源不漂移。
// node 无 document 时渐晕退化为纯色面（不烘贴图），状态机照常可单测。

import * as THREE from 'three';
import { WORLD_HEIGHT, UI_CAMERA_LOOK_AT_Y } from '../StageManager.js';

// ---- 烈度 → 演出参数映射（世界高度 100 基准） ----
// 饱和曲线（MIN + (MAX-MIN) × min(1, 烈度/SAT)）：小伤害大幅减弱（1 点直伤只是
// 桌面轻磕），重击仍冲到顶——线性「基础值+斜率」会让轻击也震得像重击（反馈）
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
// 低血常驻档（状态驱动，不随释放衰减）：hp 跌破阈值起、越低越浓（到地板值封顶），
// 慢呼吸起伏——读「持续的危险状态」而非静止贴图。受击脉冲叠加其上（和封顶）
const LOW_HP_THRESHOLD = 0.20;       // 血量占比阈值（20% 以下起）
const LOW_HP_FLOOR = 0.06;           // 到此占比常驻档拉满
const LOW_HP_PEAK = 0.30;            // 常驻档满值透明度（要压得住屏、又不糊视野）
const LOW_HP_BREATH_RATE = 2.0;      // 呼吸角频率（rad/s）
const LOW_HP_BREATH_DEPTH = 0.12;    // 呼吸深度（±12%）

/** 血量占比 → 低血常驻档强度（0..1）；player 投影缺省/满血返回 0。 */
export function lowHpVignetteLevel(player) {
  if (!player || !(player.maxHp > 0)) return 0;
  const ratio = Math.max(0, player.hp) / player.maxHp;
  const t = (LOW_HP_THRESHOLD - ratio) / (LOW_HP_THRESHOLD - LOW_HP_FLOOR);
  return Math.min(1, Math.max(0, t));
}

/** 受击烈度：生命值伤害全值 + 护盾吸收 ×0.2。震荡与渐晕共用的唯一口径。 */
export function damageSeverity(dealt, shieldAbsorbed) {
  return Math.max(0, (dealt ?? 0)) + Math.max(0, (shieldAbsorbed ?? 0)) * SHIELD_SEVERITY_FACTOR;
}

export class ScreenShake {
  /**
   * @param {{ director: import('../fx/camera.js').CameraDirector, offsetId?: string }} options
   * 所有权口径（09-23 改）：**震荡不拥有相机**。它是相机导演的一路「叠加偏移通道」，
   * 每帧只把偏移登记给导演，由导演在渲染前与运镜/其它通道合成后落笔（世界相机 +
   * UI 正交相机按增量同步位移 = 真·全屏震）。
   * 旧写法是「启动时锁一份基位 + 每帧硬写 base+offset + 结束时 copy(base)」，那句
   * 「战斗期间世界相机只被本类移动」的前提早就没了（导演 flyTo 运镜、Boss 常驻微运动
   * 都是写入者）：推镜途中来一记震荡，画面被钉在起跳位、震荡结束再把相机硬拷回那份
   * 过期基位 = pyro 转段起点那一下肉眼可感的跳跃（pyro-cam-who.mjs 量得）。
   */
  constructor({ director, offsetId = 'shake' } = {}) {
    this._dir = director;
    this._id = offsetId;
    this._amp = 0;   // 当前幅度（世界单位）
    this._dur = 0;   // 本次震荡总时长（秒）
    this._t = 0;     // 包络时间
    this._clock = 0; // 连续时钟（sustain 阶段也要走相位——静止偏移不是抖动）
    this._phX = 0;
    this._phY = 0;
    this._active = false;
    this._sustain = 0; // 持续微震幅度（天斩压迫期；0 = 无）
    this._hadOffset = false; // 本轮是否写过通道（收口撤除的判据）
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

  /**
   * 持续微震（施术压迫期——天斩 dread 段）：level = 世界单位幅度，0 = 停。
   * 与 impulse 的包络互不干预——帧偏移取两者较大者；**忘了清零会把相机永久
   * 推歪**，调用方（模板协程）必须在收尾/onKill 归零。
   */
  sustain(level) {
    this._sustain = Math.max(0, level ?? 0);
  }

  /** 当前显示幅度（世界单位，含包络衰减与持续档；测试断言口）。 */
  get currentAmplitude() {
    const env = this._active ? this._amp * (1 - this._t / this._dur) : 0;
    return Math.max(env, this._sustain);
  }

  /** 帧推进：算偏移并登记到导演的本路通道（tick 里调用；落笔由导演 commit 统一做）。 */
  update(dt) {
    this._clock += dt;
    if (this._active) {
      this._t += dt;
      if (this._t >= this._dur) this._active = false;
    }
    const env = this._active ? this._amp * (1 - this._t / this._dur) : 0;
    const k = Math.max(env, this._sustain);
    if (k <= 0) {
      // 包络走完且无持续档：撤通道（残留会把相机永久推歪）；幂等
      if (this._hadOffset) { this._dir.clearOffset(this._id); this._hadOffset = false; }
      return;
    }
    this._hadOffset = true;
    this._dir.setOffset(
      this._id,
      k * Math.sin(this._clock * SHAKE_FREQ_X + this._phX),
      k * SHAKE_AXIS_RATIO * Math.sin(this._clock * SHAKE_FREQ_Y + this._phY),
      0, // z 不震：沿视向推拉会被透视放大成缩放感
    );
  }

  /** 退场复位：撤掉自己那路通道（相机已归下一舞台所有，别的什么都不碰）。 */
  dispose() {
    this._active = false;
    this._sustain = 0;
    this._dir.clearOffset(this._id);
  }
}

export class DamageVignette {
  constructor() {
    this._peak = 0;      // 本次脉冲峰值透明度
    this._timer = 0;     // 释放计时
    this._opacity = 0;   // 当前透明度（测试断言口）
    this._low = 0;       // 低血常驻档强度（0..1，状态驱动——由持有方每帧推）
    this._clock = 0;     // 常驻档呼吸钟

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

  /** 低血常驻档强度（0..1）：状态驱动，持有方在血量变化时每帧推（0 = 关）。 */
  lowHp(level) { this._low = Math.min(1, Math.max(0, level ?? 0)); }

  update(dt) {
    this._clock += dt;
    // 常驻档：慢呼吸起伏；与受击脉冲相加后封顶（低血时受击 = 泛红骤深，读得出叠加）
    const low = this._low * LOW_HP_PEAK
      * (1 - LOW_HP_BREATH_DEPTH + LOW_HP_BREATH_DEPTH * Math.sin(this._clock * LOW_HP_BREATH_RATE));
    if (this._peak <= 0) {
      this._opacity = low;   // 脉冲收尽：只剩常驻档（或全关）
    } else {
      this._timer += dt;
      const pulse = this._peak * Math.exp(-this._timer / VIGNETTE_RELEASE_TAU);
      this._opacity = Math.min(pulse + low, VIGNETTE_PEAK_MAX);
      if (pulse < 0.01) this._peak = 0;   // 脉冲收尽，常驻档接管
    }
    this.object.visible = this._opacity > 0.005;
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
