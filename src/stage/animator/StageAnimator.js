// StageAnimator（§4.5）：旧 utils/animator.js 的 three 版重写。
// 注册表 uniqueID → { object3D, state, currentTweens }，状态机契约保留：
//   idle      待命，无动画，保持现有变换不变
//   tracking  锚点跟踪：锚点（LayoutEngine）变化时平滑归位（如手牌）
//   animating 执行指令动画中（打出/抽取/移动…）
//   dragging  被玩家拖拽中（休整阶段换序等）
// 无外部干预时状态只会自动回落 idle；进入其他状态必须显式调用。
//
// tween 工厂可注入（缺省 gsap timeline），node 单测用同步假 tween 验证状态机。
// 完成回调链：BattleStage 在 animate() 的 onComplete 里回发 animation-instruction-finished。

import gsap from 'gsap';

export const ANIMATOR_STATES = Object.freeze({
  IDLE: 'idle',
  TRACKING: 'tracking',
  ANIMATING: 'animating',
  DRAGGING: 'dragging',
});

const TRACKING_DURATION_MS = 300;
const TRACKING_EASE = 'power1.out';
const DEFAULT_EASE = 'power2.out';

// 默认 tween：一条 timeline 同步推 position/scale/rotation，返回可 kill 句柄
// delayMs：延迟启动（用于"停留"节拍——保持某姿态一段时间再进下一步）
// onUpdate(progress)：逐帧进度回调——只服务通用键补间（进度代理 {t:0→1}）。
//   gsap 原生 onUpdate 不带实参，这里必须显式回传被补间键的当前值，
//   否则消费方（曲线飞行的 sample(t)）拿到 undefined → NaN 变换 → 飞行全程不可见
// 导出供 BattleStage 的非注册表 FX（overlay 脉冲等不阻塞队列的小动画）复用
const HANDLED_KEYS = new Set(['x', 'y', 'z', 'scale', 'rotation']);
export function gsapTween(object3D, to, { durationMs, ease = DEFAULT_EASE, onComplete, delayMs = 0, onUpdate = null } = {}) {
  const duration = Math.max(0.001, durationMs / 1000);
  const delay = Math.max(0, delayMs / 1000);
  const tl = gsap.timeline({ onComplete });
  if (to.x != null || to.y != null || to.z != null) {
    tl.to(object3D.position, { x: to.x ?? object3D.position.x, y: to.y ?? object3D.position.y, z: to.z ?? object3D.position.z, duration, ease, delay }, 0);
  }
  if (to.scale != null) {
    tl.to(object3D.scale, { x: to.scale, y: to.scale, duration, ease, delay }, 0);
  }
  if (to.rotation != null) {
    tl.to(object3D.rotation, { z: to.rotation, duration, ease, delay }, 0);
  }
  // 通用键（进度代理 {t: 0→1} 等）：直接补间在目标对象上（曲线飞行等自管 onUpdate 的演出）
  const rest = {};
  for (const k of Object.keys(to)) {
    if (!HANDLED_KEYS.has(k)) rest[k] = to[k];
  }
  if (Object.keys(rest).length) {
    const progressKey = Object.keys(rest)[0];
    tl.to(object3D, {
      ...rest,
      duration, ease, delay,
      onUpdate: onUpdate ? () => onUpdate(object3D[progressKey]) : undefined,
    }, 0);
  }
  // 纯延迟（无属性变化）：用于停留
  if (to.x == null && to.y == null && to.z == null && to.scale == null && to.rotation == null && !Object.keys(rest).length) {
    tl.to({}, { duration: 0.001, delay }, 0);
  }
  return tl;
}

export class StageAnimator {
  /**
   * @param {object} options
   *   layoutEngine: LayoutEngine   tracking 状态的锚点来源
   *   tween: (object3D, to, opts) => { kill() }   缺省 gsap 实现
   */
  constructor({ layoutEngine = null, tween = gsapTween } = {}) {
    this._layout = layoutEngine;
    this._tween = tween;
    this._registry = new Map(); // id -> { object3D, state, tweens: [] }
  }

  register(id, object3D) {
    if (id == null || !object3D) throw new Error('StageAnimator.register: id 与 object3D 必填');
    this._killTweens(id);
    this._registry.set(id, { object3D, state: ANIMATOR_STATES.IDLE, tweens: [] });
  }

  unregister(id) {
    this._killTweens(id);
    this._registry.delete(id);
  }

  has(id) { return this._registry.has(id); }
  getState(id) { return this._registry.get(id)?.state || null; }
  getObject(id) { return this._registry.get(id)?.object3D || null; }

  enterIdle(id) {
    const entry = this._registry.get(id);
    if (!entry) return;
    this._killTweens(id);
    entry.state = ANIMATOR_STATES.IDLE;
  }

  enterDragging(id) {
    const entry = this._registry.get(id);
    if (!entry) return;
    this._killTweens(id);
    entry.state = ANIMATOR_STATES.DRAGGING;
  }

  /** 进入锚点跟踪，并立即向当前锚点归位一次。 */
  enterTracking(id, { durationMs = TRACKING_DURATION_MS } = {}) {
    const entry = this._registry.get(id);
    if (!entry) return;
    this._killTweens(id);
    entry.state = ANIMATOR_STATES.TRACKING;
    this._trackToAnchor(id, durationMs);
  }

  /** 布局变化后重放所有 tracking 元素的归位（由 BattleStage 在重排后调用）。 */
  syncTracking({ durationMs = TRACKING_DURATION_MS } = {}) {
    for (const [id, entry] of this._registry) {
      if (entry.state === ANIMATOR_STATES.TRACKING) this._trackToAnchor(id, durationMs);
    }
  }

  /**
   * 指令动画：推到指定变换。进入 animating，完成后自动回落 idle。
   * @returns 完成回调在 opts.onComplete
   */
  animate(id, to, opts = {}) {
    const entry = this._registry.get(id);
    if (!entry) {
      // 未注册目标：立即完成而不是静默丢失（否则调用方的 finish 链会断，队列停摆）
      opts.onComplete?.();
      return null;
    }
    this._killTweens(id);
    entry.state = ANIMATOR_STATES.ANIMATING;
    const handle = this._tween(entry.object3D, to, {
      ...opts,
      onComplete: () => {
        entry.state = ANIMATOR_STATES.IDLE;
        opts.onComplete?.();
      },
    });
    entry.tweens.push(handle);
    return handle;
  }

  /** 指令动画：推到命名锚点 / 显式锚点。 */
  animateToAnchor(id, anchor, opts = {}) {
    const target = typeof anchor === 'string' ? this._layout?.getNamedAnchor(anchor) : anchor;
    if (!target) return null;
    return this.animate(id, target, opts);
  }

  /**
   * 自定义演出动画：补间一个进度代理 t∈[0,1]，逐帧回调 onUpdate(t)——
   * 曲线飞行/淡入淡出等自管轨迹的动画由此表达，同时保持状态机语义
   * （ANIMATING 期间布局跟踪让位，完成后自动回落 idle，kill 走注册表）。
   * onUpdate 只在真 gsap 下逐帧触发；同步测试 tween 至少保证 onComplete
   * （调用方在 onComplete 里硬化终态，使无 onUpdate 的路径也能落位）。
   */
  animateCustom(id, { durationMs = 300, ease, delayMs = 0, onUpdate = null, onComplete } = {}) {
    const entry = this._registry.get(id);
    if (!entry) {
      onComplete?.();
      return null;
    }
    this._killTweens(id);
    entry.state = ANIMATOR_STATES.ANIMATING;
    const proxy = { t: 0 };
    const handle = this._tween(proxy, { t: 1 }, {
      durationMs, ease, delayMs, onUpdate,
      onComplete: () => {
        entry.state = ANIMATOR_STATES.IDLE;
        onComplete?.();
      },
    });
    entry.tweens.push(handle);
    return handle;
  }

  _trackToAnchor(id, durationMs) {
    const entry = this._registry.get(id);
    const anchor = this._layout?.getAnchor(id);
    if (!entry || !anchor) return;
    // 锚点是布局产物，带元数据（containerKey 等）——只取变换键喂给 tween，
    // 不把整个对象透传（元数据键会被补间到物体上，gsap 报 Missing plugin）
    const handle = this._tween(entry.object3D, {
      x: anchor.x, y: anchor.y, z: anchor.z, scale: anchor.scale, rotation: anchor.rotation,
    }, { durationMs, ease: TRACKING_EASE });
    entry.tweens.push(handle);
  }

  _killTweens(id) {
    const entry = this._registry.get(id);
    if (!entry) return;
    for (const t of entry.tweens) { try { t.kill(); } catch (_) {} }
    entry.tweens = [];
  }
}
