// animationSequencer.js — 新一代动画队列/执行器
// 抽象说明
// - 指令（Instruction）具有：
//   id: string
//   status: 'pending' | 'running' | 'finished'
//   tags: Set<string>         // 默认至少包含 'all'
//   waitTags: Set<string>     // 默认至少包含 'all'
//   durationMs: number        // 指令超时时强制完成时长，可为 Infinity
//   start: (ctx) => void      // 启动逻辑，在进入 running 时触发
//   meta?: any                // 透传数据（可选）
// - 可执行判定（假设更符合直觉的语义）：
//   指令 X 可以开始执行，当且仅当 序列中“位于 X 之前且与 X.waitTags 存在“交集”的所有指令”均已 finished。
//   这样等待标签表示“我需要等待的类别”，默认 ['all'] 即等待所有前序指令。
// - 结束条件：
//   1) 前端通过事件总线发出 'animation-instruction-finished'，携带 { id }；或
//   2) 指令超时：running 状态下超过 durationMs（有限时）则强制完成。

import frontendEventBus from '../frontendEventBus.js';

// 生成唯一ID
function genId() { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

// 工具：集合交集是否非空
function hasIntersection(a, b) {
  for (const x of a) { if (b.has(x)) return true; }
  return false;
}

// Sequencer 单例
class AnimationSequencer {
  constructor() {
    this._instructions = [];   // 保序数组
    this._idToTimer = new Map();

    // 监听来自前端的“动画完成”通知，从而完成对应指令来支持不定长度动画编排
    frontendEventBus.on('animation-instruction-finished', (payload = {}) => {
      const id = payload?.id;
      if (id) this.finish(id, 'frontend');
    });
  }

  // —— 指令入队（低层API） ——
  enqueueInstruction({ tags = ['all'], waitTags, durationMs = Infinity, start, meta } = {}) {
    const id = genId();
    const instr = {
      id,
      status: 'pending',
      // 所有指令都拥有 all 标签
      tags: new Set([...(tags || []), 'all']),
      // 等待标签：未显式给出时，默认等待 all；显式给出则按调用者提供
      waitTags: new Set(waitTags === undefined ? ['all'] : (waitTags || [])),
      durationMs: durationMs,
      start: typeof start === 'function' ? start : () => {},
      meta: meta,
      _startedAt: 0,
    };
    this._instructions.push(instr);
    // 入队后尝试推进
    this._pump();
    return id;
  }

  // —— 完成某条指令 ——
  finish(id, reason = 'manual') {
    const instr = this._instructions.find(i => i.id === id);
    if (!instr) return false;
    if (instr.status === 'finished') return true;

    // 结束本条
    instr.status = 'finished';
    // 清理超时器
    const t = this._idToTimer.get(id);
    if (t) {
      clearTimeout(t);
      this._idToTimer.delete(id);
    }

    // 释放已完成的指令节点（保持顺序，过滤已完成条目）
    this._instructions = this._instructions.filter(i => i.status !== 'finished');

    // 推进后续可能可运行的指令
    this._pump();
    return true;
  }

  // —— 内部：尝试启动所有“可执行”的 pending 指令（自左向右） ——
  _pump() {
    let startedAny = false;
    for (let i = 0; i < this._instructions.length; i++) {
      const ins = this._instructions[i];
      if (!ins || ins.status !== 'pending') continue;
      if (!this._canExecute(i)) continue;
      this._startInstruction(ins);
      startedAny = true;
    }
    return startedAny;
  }

  // 可执行判定：所有位于 index 之前、且与 waitTags 有交集的，都必须 finished
  _canExecute(index) {
    const current = this._instructions[index];
    if (!current) return false;
    for (let j = 0; j < index; j++) {
      const prev = this._instructions[j];
      if (!prev) continue;
      if (prev.status === 'finished') continue;
      if (hasIntersection(prev.tags, current.waitTags)) {
        return false;
      }
    }
    return true;
  }

  _startInstruction(instr) {
    instr.status = 'running';
    instr._startedAt = Date.now();
    try {
      instr.start({ id: instr.id, meta: instr.meta, emit: (name, payload) => frontendEventBus.emit(name, payload) });
    } catch (err) {
      console.error('[animationSequencer] start logic error:', err);
    }
    if (isFinite(instr.durationMs) && instr.durationMs >= 0) {
      const timerId = setTimeout(() => {
        this.finish(instr.id, 'timeout');
      }, Math.max(0, instr.durationMs));
      this._idToTimer.set(instr.id, timerId);
    }
  }
}

// 单例导出
const animationSequencer = new AnimationSequencer();

export default animationSequencer;
