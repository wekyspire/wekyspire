// 通用动画指令队列（自 bridge/sequencer.js 抽出，S1 去战斗化）：
// - 指令 { id, status, tags, waitTags, durationMs, start, meta, wire }
// - wire：可选的「指令描述符」——指令的可序列化投影（{ event, payload }），供
//   直播推流读取（tools/broadcast.mjs 的流式 tap）。本队列自身完全不碰它，
//   本地播放路径行为与不存在该字段时逐字节一致（惰性载荷，见 enqueueInstruction）
// - 可执行判定：位于 X 之前且与 X.waitTags 有交集的指令全部 finished，X 才能 start
//   （默认 waitTags=['all'] = 等待所有前序；tags/waitTags 都自动含 'all'，
//    注意：'all' 标签使默认情况下指令严格串行；要并行需显式 waitTags: []）
// - 结束：总线收到完成事件（finishedEvent，缺省 animation-instruction-finished）
//   携带 { id }，或 durationMs 超时强杀
// - start 回调可同步自完结（sequencer.finish(id) / emit 完成事件）：重入安全，
//   完成会立即泵起后续指令（cutscene 尾闸/dialogue 闸门依赖此语义）
// - cancelAll：全部指令瞬间清空（不执行未启动的 start）——离局/读档恢复用
// 跨层编排：battle（bridge presenter）/ room / tower / cutscene 共用同一实例时，
// 指令按入队顺序 + tags 依赖定序，即"终局动画 → 幕间黑幕 → 塔楼抵达"这类
// 跨层演出链的统一时钟。fire-and-forget 微特效（粒子/hover）不进队列。
function genId() { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; }

function hasIntersection(a, b) {
  for (const x of a) { if (b.has(x)) return true; }
  return false;
}

export default class AnimationSequencer {
  /**
   * @param {object} options
   *   bus: mitt 总线（完成事件的来源；start 的 emit 即此总线）
   *   finishedEvent: 完成回执事件名（各层协议统一，缺省同 bridge）
   */
  constructor({ bus, finishedEvent = 'animation-instruction-finished' }) {
    this._instructions = [];
    this._idToTimer = new Map();
    this._bus = bus;
    this._finishedEvent = finishedEvent;
    bus.on(finishedEvent, (payload = {}) => {
      if (payload?.id) this.finish(payload.id, 'frontend');
    });
  }

  enqueueInstruction({ tags = ['all'], waitTags, durationMs = Infinity, start, meta, wire = null } = {}) {
    const id = genId();
    this._instructions.push({
      id,
      status: 'pending',
      tags: new Set([...(tags || []), 'all']),
      waitTags: new Set(waitTags === undefined ? ['all'] : (waitTags || [])),
      durationMs,
      start: typeof start === 'function' ? start : () => {},
      meta,
      wire, // 可序列化描述符（直播推流用；本地路径不读）
      _startedAt: 0,
    });
    this._pump();
    return id;
  }

  finish(id, reason = 'manual') {
    const instr = this._instructions.find(i => i.id === id);
    if (!instr) return false;
    if (instr.status === 'finished') return true;
    instr.status = 'finished';
    // 保险丝强杀必须可见：静默跳拍会让后续节拍提前衔接，症状是各种"动画 glich"，
    // 无警告则无法定位（本表是节拍卫生的第一绊线）
    if (reason === 'timeout') {
      console.warn('[sequencer] 节拍超时被保险丝强杀（动画未正常回 finish）：', instr.meta);
    }
    const t = this._idToTimer.get(id);
    if (t) {
      clearTimeout(t);
      this._idToTimer.delete(id);
    }
    this._instructions = this._instructions.filter(i => i.status !== 'finished');
    this._pump();
    return true;
  }

  // 瞬落：清空全部指令（含 running 的定时器），未启动的 start 不再执行。
  // 动画不可序列化——读档恢复/中途退出时演出直接落到稳态
  cancelAll() {
    for (const t of this._idToTimer.values()) clearTimeout(t);
    this._idToTimer.clear();
    this._instructions = [];
  }

  // 当前未完成指令数（测试/调试）
  get pendingCount() {
    return this._instructions.length;
  }

  // 查询队列中首个满足条件的未完成指令（Stage 用：展示卡判断后续是否已有自己的
  // 离场节拍在排队——有则停留展示位等收，不回跟踪）。只读，不改状态
  findPending(predicate) {
    return this._instructions.find(i => i.status !== 'finished' && predicate(i)) ?? null;
  }

  _pump() {
    for (let i = 0; i < this._instructions.length; i++) {
      const ins = this._instructions[i];
      if (!ins || ins.status !== 'pending') continue;
      if (!this._canExecute(i)) continue;
      this._startInstruction(ins);
    }
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
    if (Number.isFinite(instr.durationMs) && instr.durationMs >= 0) {
      const timerId = setTimeout(() => this.finish(instr.id, 'timeout'), Math.max(0, instr.durationMs));
      this._idToTimer.set(instr.id, timerId);
    }
  }
}

export { AnimationSequencer };
