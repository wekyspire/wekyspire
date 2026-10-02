// 投射物抵达追踪（2026-10-02 用户定：投射物 CPU 权威——飞行由 CPU 补间逐帧驱动，
// 抵达是可知事件；伤害节拍（命中爆/受击）await 真实抵达，取代 impactDelayMs 猜测）。
// 结构：按单位 uniqueID 的 FIFO 抵达队列（同目标连发：第 i 拍伤害消费第 i 发登记）。
// 消费侧用 acquire：无在飞登记时短暂等一次「登记出现」（节拍次序竞态兜底——
// 施术拍登记恒在前，本窗口只兜异常路径），超时按「此拍无投射物」放行；抵达等待
// 也有超时——投射物被连杀/保险丝强杀时节拍链不许挂。
export function createProjectileTracker() {
  const queues = new Map();   // uid → Promise[]（已登记未消费的抵达承诺）
  const waiters = new Map();  // uid → [resolve]（等登记出现的 acquire）

  // 发射侧（arcProjectile track 参数）：登记一次「飞向 unit 的飞行」
  function track(unit, flight) {
    const uid = unit?.uniqueID;
    if (uid == null || !flight) return;
    const ws = waiters.get(uid);
    if (ws?.length) { ws.shift()(flight); return; }
    const q = queues.get(uid) ?? [];
    q.push(flight);
    queues.set(uid, q);
  }

  // 消费侧（伤害节拍）：取该单位下一发的抵达承诺； resolves Promise<flight|null>
  function acquire(unit, { registerMs = 120, timeoutMs = 900 } = {}) {
    const uid = unit?.uniqueID;
    if (uid == null) return Promise.resolve(null);
    const q = queues.get(uid);
    if (q?.length) {
      const flight = q.shift();
      // 抵达等待 cap：飞行承诺正常由 arcProjectile 落定/被杀解决，超时纯兜底
      return Promise.resolve(Promise.race([
        flight, new Promise(r => setTimeout(r, timeoutMs)),
      ]));
    }
    return new Promise((resolve) => {
      const entry = (flight) => {
        clearTimeout(t);
        resolve(Promise.race([flight, new Promise(r => setTimeout(r, timeoutMs))]));
      };
      const ws = waiters.get(uid) ?? [];
      ws.push(entry);
      waiters.set(uid, ws);
      const t = setTimeout(() => {
        const cur = waiters.get(uid);
        if (cur) {
          const i = cur.indexOf(entry);
          if (i >= 0) cur.splice(i, 1);
        }
        resolve(null);
      }, registerMs);
    });
  }

  // 新一次施术拍起跑前清场：上一张卡无人消费的登记（群燃件等无伤害拍的飞行）
  // 不得漏进下一张卡的伤害拍
  function reset() {
    queues.clear();
    for (const ws of waiters.values()) for (const w of ws) w(null);
    waiters.clear();
  }

  return { track, acquire, reset };
}

// 伤害拍两侧的共用门（主受击拍与命中爆点消费同一抵达时刻）：
// tracked = 施术拍发射（tracker.acquire）；owned = 伤害拍自持发射（arrived() 回执）。
export function trackedGate(tracker, unit) {
  const p = (async () => { const f = await tracker.acquire(unit); if (f) await f; })();
  return { gate: () => p };
}
export function ownedGate() {
  let arrive;
  const p = new Promise(r => { arrive = r; });
  return { gate: () => p, arrived: () => arrive() };
}
