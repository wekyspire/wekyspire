// 协程剧本运行器（fx 架构脊柱之一，2026-09-22 定稿，fx-architecture-plan）：
// 一切「一次性编排演出」（伤害命中、Boss 转阶段、cutscene 走位、运镜）写成扁平
// async 协程，替代 BattleStage 里四层 onComplete 套娃。选协程不选声明式时间线
// 的理由：需求里有「等待事件」（PCG notify / 玩家输入 / 节拍边界）与分支
// （转阶段按血量），GSAP timeline 表达不了控制流，async/await 天然可以；
// GSAP 留作底层补间引擎不动。
//
// 剧本示例：
//   const h = runScript(async (ctx) => {
//     await ctx.tween(unitId, { x: x0 + 1.5 }, { durationMs: 80, ease: 'power1.in' });
//     ctx.spawn(async (c) => { /* 并行子演出，随父本一起被杀 */ });
//     await Promise.all([ctx.tween(a, ...), ctx.custom(b, ...)]);   // 并行
//     await ctx.waitEvent(bus, 'some-event');                        // 等事件
//   }, { animator });
//   h.promise.then(() => ...);  // 结束（含被杀）必达；异常吞进 {error}
//
// kill 语义（结构化取消）：kill() 后所有在途 wait/tween/waitEvent 立即以
// ScriptKilled 拒绝 → 协程沿 await 链直接展开退出，**后续语句不再执行**
// （防场景拆除后残段继续改世界）；onKill 注册的清理函数同步执行。
// kill 是拆除级语义：animator 注册对象的补间被杀时其状态机停在 animating，
// 由下一次 animate/enterTracking 自愈（注册表随舞台销毁的场合无需处理）。
import { gsapTween } from '../animator/StageAnimator.js';

const KILLED = Symbol('fx-script-killed');

class ScriptKilled extends Error {
  constructor() { super('fx script killed'); this[KILLED] = true; }
}

export function isScriptKill(err) { return !!(err && err[KILLED]); }

export class ScriptContext {
  /** @param {object} opts animator: StageAnimator（注册对象补间来源，可空——纯 raw 演出不需要） */
  constructor({ animator = null } = {}) {
    this._animator = animator;
    this._killed = false;
    this._pending = new Set();   // 在途承诺 { cancel, reject }
    this._killHooks = [];
  }

  get killed() { return this._killed; }

  /** 注册清理钩子（关材质/还道具/停 emitter）。kill 与正常结束都会触发。 */
  onKill(fn) {
    if (this._killed) { try { fn(); } catch (_) {} return; }
    this._killHooks.push(fn);
  }

  /** 补间注册对象（单位/卡牌，走 StageAnimator 状态机）。未注册 id 按 animator 约定立即完成。 */
  tween(id, to, opts = {}) {
    return this._track((done, setCancel) => {
      const handle = this._animator?.animate(id, to, { ...opts, onComplete: () => done() }) ?? null;
      setCancel(() => { try { handle?.kill(); } catch (_) {} });
      if (!handle) done(); // 无 animator 或未注册：幂等，无害
    });
  }

  /** 补间非注册对象（灯光/道具/相机等裸 Object3D/普通对象），直达 gsap。 */
  tweenRaw(target, to, opts = {}) {
    return this._track((done, setCancel) => {
      const handle = gsapTween(target, to, { ...opts, onComplete: () => done() });
      setCancel(() => { try { handle?.kill(); } catch (_) {} });
    });
  }

  /** 自管轨迹补间（animateCustom 包装：onUpdate(t) 逐帧进度，t∈[0,1]）。 */
  custom(id, { durationMs = 300, ease, delayMs = 0, onUpdate = null } = {}) {
    return this._track((done, setCancel) => {
      const handle = this._animator?.animateCustom(id, {
        durationMs, ease, delayMs, onUpdate, onComplete: () => done(),
      }) ?? null;
      setCancel(() => { try { handle?.kill(); } catch (_) {} });
      if (!handle) done();
    });
  }

  /** 纯停留。 */
  wait(ms) {
    return this._track((done, setCancel) => {
      const t = setTimeout(() => done(), Math.max(0, ms));
      setCancel(() => clearTimeout(t));
    });
  }

  /** 等总线事件（filter 返回真即收）；命中即自摘监听，kill 时也会摘除，不泄漏。 */
  waitEvent(bus, event, filter = null) {
    return this._track((done, setCancel) => {
      const handler = (payload) => {
        if (filter && !filter(payload)) return;
        bus.off(event, handler);
        done(payload);
      };
      bus.on(event, handler);
      setCancel(() => bus.off(event, handler));
    });
  }

  /** 派生子剧本：fire-and-forget 并行演出，随父本一起被杀。 */
  spawn(fn) {
    const child = runScript(fn, { animator: this._animator });
    this.onKill(() => child.kill());
    return child;
  }

  // body(done, setCancel) 同步执行；done 幂等（kill 后或重复调用变 no-op）。
  _track(body) {
    if (this._killed) return Promise.reject(new ScriptKilled());
    const entry = { cancel: () => {}, reject: null };
    this._pending.add(entry);
    let resolveRef;
    const p = new Promise((resolve, reject) => {
      entry.reject = reject;
      resolveRef = resolve;
    });
    let settled = false;
    const done = (value) => {
      if (settled || !this._pending.has(entry)) return;
      settled = true;
      this._pending.delete(entry);
      resolveRef(value);
    };
    try {
      body(done, (fn) => { entry.cancel = fn; });
    } catch (err) {
      this._pending.delete(entry);
      entry.reject(err);
    }
    p.catch(() => {}); // fire-and-forget 调用位不 await，kill 拒绝不得成未处理拒绝
    return p;
  }

  kill() {
    if (this._killed) return;
    this._killed = true;
    for (const entry of this._pending) {
      try { entry.cancel(); } catch (_) {}
      entry.reject(new ScriptKilled());
    }
    this._pending.clear();
    this._dispose();
  }

  _dispose() {
    const hooks = this._killHooks;
    this._killHooks = [];
    for (const fn of hooks) { try { fn(); } catch (_) {} }
  }
}

/**
 * 起一个剧本协程。
 * @returns {{ ctx: ScriptContext, promise: Promise<{killed:boolean, error?:Error}>, kill(): void }}
 *   promise 必达（正常完 / 被杀 / 异常吞进 error——剧本异常不许炸穿节拍链）
 */
export function runScript(fn, opts = {}) {
  const ctx = new ScriptContext(opts);
  const promise = (async () => {
    try {
      await fn(ctx);
      return { killed: ctx.killed };
    } catch (err) {
      if (isScriptKill(err)) return { killed: true };
      console.error('[fx/script] 剧本异常（已吞，不影响节拍链）:', err);
      return { killed: ctx.killed, error: err };
    } finally {
      ctx._dispose();
    }
  })();
  return { ctx, promise, kill: () => ctx.kill() };
}
