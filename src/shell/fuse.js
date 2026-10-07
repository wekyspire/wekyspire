// 命名保险丝袋：「等一个可能永远不来的回执」的兜底定时器集合。
// 同 key 重复 arm = 重置计时；超时触发后自动出袋；clearAll 供 dispose 一把清。

export class FuseBag {
  constructor() { this._timers = new Map(); }

  arm(key, ms, onTimeout) {
    this.clear(key);
    this._timers.set(key, setTimeout(() => {
      this._timers.delete(key);
      onTimeout?.();
    }, ms));
  }

  clear(key) {
    const t = this._timers.get(key);
    if (t == null) return;
    clearTimeout(t);
    this._timers.delete(key);
  }

  clearAll() {
    for (const t of this._timers.values()) clearTimeout(t);
    this._timers.clear();
  }
}
