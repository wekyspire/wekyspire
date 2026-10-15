// DedicatedSequencer —— 前端专属演出编排队列（双 sequencer 裁决，2026-10-14 用户定）。
//
// 与经典 AnimationSequencer（core/anim/sequencer.js）的分工：
//   · **经典 sequencer = 后端单向数据流**：bridge 把战斗指令（wire 描述符）排进它、
//     舞台演出完在总线上回执。它保持最小形态（tags/waitTags/durationMs/start/meta/wire），
//     不加任何前端词汇——那个形态在无数卡牌动画改进与效果修正中被验证，不许污染。
//   · **本类 = 前端微演出编排**：由前端逻辑 enqueueInstruction（房间/幕间/塔楼/问句呈现/
//     流程指令壳），词汇面向前端舒适：onEnd（apply-point 'end' 完成钩子）、owner +
//     cancelByOwner（切幕强杀/属主清理）、tagAll:false（退出 'all'——流程指令内部还要
//     往本队列排 cutscene 步骤/特写链，带 'all' 会互等死锁）、finish 带回值。
//     通过 EventBus 收到后端指令时也在此编排呈现，resolve 后由前端逻辑把决策传回后端。
//   两个实例天然隔离：后端节拍与前端编排互不干扰；就算前端编排出混沌也只在前端，
//     影响范围可控。动画执行器（舞台）需要对两个队列分别回执——回执走各自实例的
//     总线（构造时各自注入，不共用）。
//
// 本实现与经典类同构（_pump/_canExecute/_startInstruction 与其一致），刻意不做继承：
// 两者词汇与生命周期已分叉，共享内部只会让经典侧被迫暴露扩展缝。

function genId() { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

function hasIntersection(a, b) {
  for (const x of a) { if (b.has(x)) return true; }
  return false;
}

export class DedicatedSequencer {
  /** @param options bus: mitt 总线（完成回执来源；start 的 emit 即此总线） */
  constructor({ bus, finishedEvent = 'animation-instruction-finished' }) {
    this._instructions = [];
    this._idToTimer = new Map();
    this._bus = bus;
    this._finishedEvent = finishedEvent;
    /** 保险丝触发计数（reason='timeout' 累计，仅增不清）：正常局应为 0。 */
    this.timeoutCount = 0;
    this.finishReasons = { timeout: 0, frontend: 0, manual: 0 };
    this._idleCbs = new Set();
    this._wasEmpty = true;    // 构造即空：首次入队前不误报翻沿
    this._firingIdle = false; // 回调重入保护：回调内同步入队/排空不再翻沿触发
    bus.on(finishedEvent, (payload = {}) => {
      // 舞台回执可带 result（完成回值，本地词汇）——原样转交 finish 落账
      if (payload?.id) this.finish(payload.id, { reason: 'frontend', result: payload.result });
    });
  }

  enqueueInstruction({ tags = ['all'], waitTags, durationMs = Infinity, start, onEnd = null, meta, wire = null, owner = null, tagAll = true } = {}) {
    const id = genId();
    this._instructions.push({
      id,
      status: 'pending',
      // tagAll:false = 退出自动 'all'（流程指令/闸门类：默认等待者不等它——否则
      // 战斗节拍会等全程流程 = 互等死锁）。要等它的指令须显式写进 waitTags。
      tags: new Set(tagAll ? [...(tags || []), 'all'] : (tags || [])),
      waitTags: new Set(waitTags === undefined ? ['all'] : (waitTags || [])),
      durationMs,
      start: typeof start === 'function' ? start : () => {},
      onEnd, // 完成钩子（apply-point 'end'）：finish 的每条完成路径（回执/保险丝/manual）
             // 都执行；cancelAll/cancelByOwner 不执行（取消 = 流程被弃，载荷可由状态重导）
      meta,
      wire, // 可序列化描述符（直播推流用；本地路径不读）
      owner, // 属主（舞台实例/流程令牌）：cancelByOwner 的取消键，不过 wire（本地词汇）
      result: undefined, // finish 带回值（选卡答案等，本地词汇）
      _startedAt: 0,
    });
    this._pump();
    return id;
  }

  /**
   * 完成一条指令。opts：{ reason: 'manual'|'frontend'|'timeout', result? }——
   * reason 兼容裸字符串写法；result 为完成回值（如选卡答案），仅存指令记录
   * 供等待方/测试读取，不上 wire（wire 是入队时刻单向 tap，完成事件线上不存在）。
   */
  finish(id, opts = 'manual') {
    const reason = typeof opts === 'string' ? opts : (opts?.reason ?? 'manual');
    const result = typeof opts === 'string' ? undefined : opts?.result;
    const instr = this._instructions.find(i => i.id === id);
    if (!instr) return false;
    instr.status = 'finished';
    instr.result = result;
    this.finishReasons[reason] = (this.finishReasons[reason] ?? 0) + 1;
    if (reason === 'timeout') {
      this.timeoutCount += 1;
      console.warn('[sequencer] 节拍超时被保险丝强杀（动画未正常回 finish）：', instr.meta);
    }
    const t = this._idToTimer.get(id);
    if (t) {
      clearTimeout(t);
      this._idToTimer.delete(id);
    }
    this._instructions = this._instructions.filter(i => i.status !== 'finished');
    // apply-point 'end' 载荷落地：不区分完成原因（回执/保险丝/manual）——保险丝强杀时
    // 载荷照样应用，正是它取代「杀指令不清状态」型兜底保险丝的理由
    if (typeof instr.onEnd === 'function') {
      try {
        instr.onEnd({ reason, result, meta: instr.meta });
      } catch (err) {
        console.error('[sequencer] onEnd logic error:', err);
      }
    }
    this._pump();
    return true;
  }

  /** 按属主取消：摘除该属主的全部未完成指令（含在播的，未启动的不再执行），返回摘除数。 */
  cancelByOwner(owner) {
    if (owner == null) return 0;
    let n = 0;
    for (const instr of this._instructions) {
      if (instr.owner !== owner || instr.status === 'finished') continue;
      const t = this._idToTimer.get(instr.id);
      if (t) { clearTimeout(t); this._idToTimer.delete(instr.id); }
      instr.status = 'finished';
      n++;
    }
    if (n > 0) this._instructions = this._instructions.filter(i => i.status !== 'finished');
    this._pump();
    return n;
  }

  // 瞬落：清空全部指令（含 running 的定时器），未启动的 start 不再执行。
  // 动画不可序列化——读档恢复/中途退出时演出直接落到稳态
  cancelAll() {
    for (const t of this._idToTimer.values()) clearTimeout(t);
    this._idToTimer.clear();
    this._instructions = [];
    this._checkIdle();   // 瞬落也算一次排空（换台后的补发刷新由此兑现）
  }

  get pendingCount() {
    return this._instructions.length;
  }

  findPending(predicate) {
    return this._instructions.find(i => i.status !== 'finished' && predicate(i)) ?? null;
  }

  /**
   * 空闲沿订阅（P4a notify 门控的时钟）：忙→空的每一次翻沿触发一次回调。
   * **稳定空闲语义**：翻沿后延迟一个微任务再触发、触发前重查非空即自灭——
   * `finish → 同步接续入队`的接力窗口（如吞噬金币 holdBeat 收尾 → flight 入队，
   * 两条语句间队列瞬时真空）不当场误判为空闲。cancelAll（换台瞬落）同样翻沿。
   * 返回退订函数。
   */
  onIdle(cb) {
    this._idleCbs.add(cb);
    return () => this._idleCbs.delete(cb);
  }

  _checkIdle() {
    const empty = this._instructions.length === 0;
    if (empty && !this._wasEmpty) {
      queueMicrotask(() => {
        if (this._instructions.length !== 0 || this._firingIdle) return;
        this._firingIdle = true;
        try {
          for (const cb of [...this._idleCbs]) {
            try { cb(); } catch (err) { console.error('[sequencer] idle callback error:', err); }
          }
        } finally {
          this._firingIdle = false;
        }
      });
    }
    this._wasEmpty = empty;
  }

  _pump() {
    for (let i = 0; i < this._instructions.length; i++) {
      const ins = this._instructions[i];
      if (!ins || ins.status !== 'pending') continue;
      if (!this._canExecute(i)) continue;
      this._startInstruction(ins);
    }
    this._checkIdle();
  }

  _canExecute(index) {
    const current = this._instructions[index];
    if (!current) return false;
    for (let j = 0; j < index; j++) {
      const prev = this._instructions[j];
      if (!prev || prev.status === 'finished') continue;
      if (hasIntersection(prev.tags, current.waitTags)) return false;
    }
    return true;
  }

  _startInstruction(instr) {
    instr.status = 'running';
    instr._startedAt = Date.now();
    try {
      instr.start({
        id: instr.id,
        meta: instr.meta,
        emit: (name, payload) => this._bus.emit(name, payload),
      });
    } catch (err) {
      console.error('[sequencer] start logic error:', err);
    }
    // 同步自完结（start 内即 finish）：不再武装保险丝——死后武装的 fuse 会迟至引爆
    // 打空（指令已移除），污染 finishReasons 且无谓占定时器
    if (instr.status === 'finished') return;
    if (Number.isFinite(instr.durationMs) && instr.durationMs >= 0) {
      const timerId = setTimeout(() => this.finish(instr.id, { reason: 'timeout' }), Math.max(0, instr.durationMs));
      this._idToTimer.set(instr.id, timerId);
    }
  }
}

export default DedicatedSequencer;
