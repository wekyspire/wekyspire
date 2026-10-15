// 静止态断言器（P0 防回归基建，RUN_FLOW_REFACTOR_RESEARCH §五）：
// 「静止时刻」（队列排空 + cutscene 空闲 + 无全屏模态）里周期断言编排层的手工
// 状态位全部回到稳态——泄漏的单飞锁、残留的保险丝、悬空的回执在发生当晚可见，
// 而不是等玩家撞上（粉碎双入口类 bug 的第一绊线）。
//
// 只断言不修复：检查项由各域以闭包注册（runController 装配），返回失败描述数组
// （空 = 通过）。违例 console.warn 一集一次（不刷屏），计数暴露给工具
// （window.__quiescence，runFuzzBrowser 读它作强断言）。
//
// battleQuiescent = 战斗卡死语义谓词（span 闸门保险丝的本体，P1 前先用在这里）：
// battle 存活 ∧ 无 pendingInput ∧ 队列排空——内核同步结算、等待必经 pendingInput，
// 三者同时成立只剩「真卡死」一个稳态。后台标签/玩家长考天然免疫（谓词读内核
// 状态，与渲染帧无关）。

/** 战斗卡死谓词（连续 persist 拍成立才算，拍间毫秒级瞬态是微任务接力）。 */
export function battleQuiescent({ alive, pendingInput, queueCount }) {
  return alive && !pendingInput && queueCount === 0;
}

/**
 * 语义谓词保险丝（span 闸门专用）：probe 持续为真（无合法长寿命态）才引爆。
 * 与「队列无活动」「帧心跳」都不同——前者在玩家长考必误报（队列排空是常态），
 * 后者保护对象不存在（闸门链路内核事件驱动，不依赖渲染帧；后台标签免疫）。
 * @param {object} options
 *   probe: () => boolean true = 卡死态成立
 *   onTrip: () => void 引爆动作（如 finish 闸门）
 *   intervalMs / strikes / capMs：检测间隔 / 连续命中拍数 / 绝对上限。
 *   **缺省无绝对上限**（战斗时长无界、战中 AFK 合法——span 闸门的设计约束）；
 *   需要绝对上限的调用方显式传。
 * @returns {() => void} 停止函数（dispose 调用）
 */
export function createPredicateFuse({ probe, onTrip, intervalMs = 2000, strikes = 3, capMs = Infinity }) {
  let hit = 0;
  const deadline = Date.now() + capMs;
  const timer = setInterval(() => {
    if (Date.now() > deadline) { clearInterval(timer); return; }
    if (!probe()) { hit = 0; return; }
    if (++hit >= strikes) { clearInterval(timer); onTrip(); }
  }, intervalMs);
  return () => clearInterval(timer);
}

/**
 * @param {object} options
 *   isIdle: () => boolean 静止时刻判定（队列排空 + cutscene 空闲 + 无全屏模态）
 *   intervalMs: 采样间隔（缺省 2000，对齐 flightWatchdog 节拍）
 * @returns {{ add, dispose, state }} add(name, fn, { persist }?)；fn: () => string[]
 */
export function createQuiescenceChecker({ isIdle, intervalMs = 2000 } = {}) {
  const checks = new Map();   // name -> { fn, persist, strikes }
  const active = new Set();   // 报警中的名字（一集一次的去重键）
  const state = { violations: 0, failing: [] };

  const sample = () => {
    if (!isIdle?.()) return;
    const failing = [];
    for (const [name, c] of checks) {
      let errs;
      try { errs = c.fn() ?? []; } catch (err) { errs = [`检查项抛异常：${err?.message ?? err}`]; }
      if (!errs.length) { c.strikes = 0; continue; }
      if (++c.strikes < c.persist) continue;
      failing.push(...errs.map((e) => `${name}: ${e}`));
      if (!active.has(name)) {
        active.add(name);
        console.warn(`[quiescence] ${name} 违例：${errs.join('；')}`);
      }
    }
    for (const name of active) {
      if (!checks.get(name) || checks.get(name).strikes === 0) active.delete(name);
    }
    state.failing = failing;
    state.violations += failing.length;
  };

  const timer = setInterval(sample, intervalMs);
  return {
    add(name, fn, { persist = 1 } = {}) { checks.set(name, { fn, persist, strikes: 0 }); },
    /** 手动采样一次；返回是否真的执行了（soak 等工具据此等真静止时刻，防空转假绿）。 */
    sample: () => { const ran = isIdle?.() ?? false; if (ran) sample(); return ran; },
    dispose() { clearInterval(timer); },
    state,
  };
}
