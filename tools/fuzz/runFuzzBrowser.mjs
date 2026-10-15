// run 级浏览器 soak（P0 防回归基建）：整层循环（战斗 → 领奖 → 进房 → 离房）
// 驱动真实页面，每步落定后手动采样静止态断言器——泄漏的锁/残留演出位在当晚可见。
//
// 用法：node tools/fuzz/runFuzzBrowser.mjs [--floors 6] [--save w6fight] [--tick-scale 3]
//   前置：dev server 在跑（localhost:5177）；存档存在（saveForge 产出）。
//
// 断言：
//   ① 每步落定后 window.__quiescence.sample() 且 violations 增量 === 0；
//   ② 每场战斗 sequencer.timeoutCount 增量 === 0（battleFuzzBrowser 同口径）；
//   ③ 页面零 console error / 零 pageerror。
// 逃生舱：奖励/房间卡住 >5s 时经调试门面 setFloor 硬跳（顺路锻炼 swapAnyToMap
// 重置路径），计为 escape 并汇报——escape > 0 提示流程有洞，但不判 FAIL（义务门
// 挡住无上下文的离开属合法行为）。

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : dflt;
};
const FLOORS = Number(arg('floors', 6));
const SAVE = arg('save', 'w6fight');
const TICK = Number(arg('tick-scale', 3));

const { launch } = await import('../../tools/browserHarness.mjs');
const h = await launch({ unlockFps: true });
await h.goto(`?debug=1&save=${SAVE}&tickScale=${TICK}`);
await h.togglePanel(false);
// 等 shell 就位再探帧率：固定墙钟在 vite 冷转换（大改后首跑）下会赶在 __shell 之前
await h.waitFor('!!window.__shell?.stageManager', { timeout: 30000 });
await h.page.waitForTimeout(3000 / TICK + 1500);
console.log('帧率探针：', JSON.stringify(await h.fps())); // 环境健康留档（GPU 争抢时结果打折）
await h.eval(() => {
  // 截获 sequencer 保险丝 warn（console.error 之外的第一绊线）——FAIL 时输出明细
  window.__fuseWarns = [];
  const orig = console.warn;
  console.warn = (...a) => {
    const s = a.map((x) => { try { return typeof x === 'string' ? x : JSON.stringify(x); } catch { return String(x); } }).join(' ');
    window.__fuseWarns.push(s.slice(0, 400));
    orig(...a);
  };
});

const evalx = (fn, payload) => h.eval(fn, payload);

/** 页面内：等条件（快照条件式，墙钟上限）。 */
const waitStage = async (cond, timeoutMs = 60000) => evalx(
  ({ cond, timeout }) => new Promise((resolve) => {
    const c = window.__shell.ctrl.value;
    const t0 = performance.now();
    const tick = () => {
      let ok = false;
      try { ok = eval(cond); } catch { ok = false; }
      if (ok) return resolve(true);
      if (performance.now() - t0 > timeout) return resolve(false);
      setTimeout(tick, 120);
    };
    void c;
    tick();
  }), { cond, timeout: timeoutMs });

/**
 * 页面内：等真静止时刻再采样（sample() 只在 idle 时执行——离房后黑幕未揭/爬升在队
 * 时是恒非 idle，直接采样 = 空转假绿）。返回：-1 无断言器 / -2 超时未见静止 / ≥0 新增违例数。
 */
const sampleQuiescence = (timeoutMs = 20000) => evalx(
  ({ timeout }) => new Promise((resolve) => {
    const q = window.__quiescence;
    if (!q) return resolve(-1);
    const before = q.state.violations;
    const t0 = performance.now();
    const tick = () => {
      if (q.sample()) return resolve(q.state.violations - before);
      if (performance.now() - t0 > timeout) return resolve(-2);
      setTimeout(tick, 200);
    };
    tick();
  }), { timeout: timeoutMs });

const vBaseline = await h.eval(() => window.__quiescence?.state.violations ?? -1);
if (vBaseline === -1) { console.error('FAIL：window.__quiescence 不存在（调试局未装断言器？）'); await h.browser.close(); process.exit(1); }
let failed = false, escapes = 0;
for (let f = 0; f < FLOORS && !failed; f++) {
  // ---- 战斗 ----
  const battle = await evalx(async ({ seed }) => {
    const c = window.__shell.ctrl.value;
    await c.startBattle();
    const t0 = performance.now();
    while (c.run.gameStage !== 'battle' && performance.now() - t0 < 30000) {
      await new Promise(r => setTimeout(r, 150));
    }
    const b = c.getBattleBridge();
    if (!b) return { err: 'no bridge' };
    const seqStart = b.sequencer?.timeoutCount ?? 0;
    const rand = (() => { let a = seed >>> 0; return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }; })();
    const deadline = performance.now() + 300000 / 3;
    while (!b.isFinished() && performance.now() < deadline) {
      const proj = b.getProjection();
      const pending = proj?.pendingInput?.request;
      if (pending) {
        if (pending.kind === 'confirm') b.interaction.respond(true);
        else {
          const cands = [...(pending.candidates ?? [])];
          const n = Math.min(pending.max ?? pending.count ?? 1, cands.length);
          const out = [];
          for (let i = 0; i < n && cands.length; i++) out.push(cands.splice(Math.floor(rand() * cands.length), 1)[0]);
          b.interaction.respond(out);
        }
      } else {
        const playable = (proj?.hand ?? []).filter(x => b.intents.canPlayCard(x.uniqueID));
        if (!playable.length || rand() < 0.15) await b.intents.endTurn();
        else await b.intents.playCard(playable[Math.floor(rand() * playable.length)].uniqueID);
      }
      await new Promise(r => setTimeout(r, 60));
    }
    const drain0 = performance.now();
    while ((b.sequencer?._instructions?.length ?? 0) > 0 && performance.now() - drain0 < 60000 / 3) {
      await new Promise(r => setTimeout(r, 100));
    }
    return {
      result: c.run.result,
      stage: c.run.gameStage,
      deadline: !b.isFinished(),
      queueLeft: b.sequencer?._instructions?.length ?? -1,
      timeoutCount: (b.sequencer?.timeoutCount ?? 0) - seqStart,
    };
  }, { seed: 7919 + f * 104729 });

  console.log(`[floor ${f}] battle:`, JSON.stringify(battle));
  if (battle.err || battle.timeoutCount > 0) {
    console.error(`FAIL：${battle.err ?? `保险丝触发 ${battle.timeoutCount} 次`}`);
    failed = true; break;
  }
  if (battle.deadline) {
    console.error(`第 ${f} 层战斗 ${100}s 未打完（环境慢/真卡死）——跳过该层收口`);
    const qvEsc = await sampleQuiescence(8000); // 逃逸最可能伴随真泄漏：跳层前仍要采样
    if (qvEsc > 0) { console.error(`FAIL：战斗超时逃逸时静止态违例 ${qvEsc} 条`); failed = true; break; }
    await evalx(() => { window.__shell.ctrl.value.debug.setFloor(window.__shell.ctrl.value.run.floor + 1); });
    escapes++;
    continue;
  }

  // ---- 领奖 → 离开奖励 ----
  await waitStage(`window.__shell.ctrl.value.run.gameStage !== 'battle'`);
  const claimed = await evalx(async () => {
    const c = window.__shell.ctrl.value;
    if (c.run.gameStage !== 'reward') return c.run.gameStage;
    c.claimReward(null);
    await new Promise(r => setTimeout(r, 800));
    if (c.run.gameStage === 'reward') { // 卡住：逃生舱硬跳
      window.__shell.ctrl.value.debug.setFloor(c.run.floor + 1);
      return 'escape-reward';
    }
    return c.run.gameStage;
  });
  if (claimed === 'escape-reward') escapes++;
  console.log(`[floor ${f}] post-reward:`, claimed);

  // ---- 房间：能离则离，离不动走逃生舱 ----
  const left = await evalx(async () => {
    const c = window.__shell.ctrl.value;
    if (c.run.gameStage === 'end') return 'end';
    if (c.run.gameStage !== 'room') return c.run.gameStage;
    const room = c.run.currentRoom;
    try {
      if (room === 'event') c.leaveEvent();
      else if (room === 'slot') c.leaveSlot();
      else c.leaveRoom();
    } catch { /* 义务门抛错 = 合法拦截 */ }
    const t0 = performance.now();
    while (c.run.gameStage === 'room' && performance.now() - t0 < 5000) {
      await new Promise(r => setTimeout(r, 200));
    }
    if (c.run.gameStage === 'room') {
      window.__shell.ctrl.value.debug.setFloor(c.run.floor + 1);
      return `escape-room(${room})`;
    }
    return c.run.gameStage;
  });
  if (String(left).startsWith('escape')) escapes++;
  console.log(`[floor ${f}] room exit:`, left);

  // ---- 静止态断言（每层收口）----
  const qv = await sampleQuiescence();
  if (qv === -1) { console.error('FAIL：window.__quiescence 不存在（调试局未装断言器？）'); failed = true; break; }
  if (qv === -2) { console.error(`FAIL：第 ${f} 层收口 20s 内未出现静止时刻（演出链悬挂？）`); failed = true; break; }
  if (qv > 0) { console.error(`FAIL：第 ${f} 层收口静止态违例 ${qv} 条`); failed = true; break; }
  if (left === 'end') { console.log('到达终局，提前收束'); break; }
}

const errs = h.errors ?? [];
const cerrs = h.consoleErrors ?? [];
console.log(`pageErrors=${errs.length} consoleErrors=${cerrs.length} escapes=${escapes}`);
if (errs.length || cerrs.length) {
  console.error('错误明细：', JSON.stringify([...errs.slice(0, 3), ...cerrs.slice(0, 3)]));
  failed = true;
}
const vEnd = await h.eval(() => window.__quiescence.state.violations);
if (vEnd > vBaseline) {
  console.error(`FAIL：全程静止态违例净增 ${vEnd - vBaseline} 条（interval 腿在层间抓到）`);
  failed = true;
}
// dedicated 侧保险丝门（P3 审查 #2 的教训：正常路径烧保险丝 = timeoutCount 污染，
// 此前只盯 battle 经典侧，dedicated 无人断言）
const dedicatedFuse = await h.eval(() => window.__shell?.ctrl?.value?.sequencer?.timeoutCount ?? 0);
if (dedicatedFuse > 0) {
  console.error(`FAIL：dedicated 侧保险丝触发 ${dedicatedFuse} 次（正常路径 manual 收尾，不许烧）`);
  failed = true;
}
const fuseWarns = await h.eval(() => (window.__fuseWarns ?? []).filter(w => w.includes('[sequencer]') || w.includes('[quiescence]')));
if (fuseWarns.length) {
  console.error(`保险丝 warn 明细（${fuseWarns.length} 条）：`);
  for (const w of fuseWarns.slice(0, 4)) console.error(' ', w.slice(0, 360));
}
await h.browser.close();
console.log(failed ? '结果：FAIL' : `结果：${escapes ? 'PASS（含 ' + escapes + ' 次逃生舱——流程有洞待查）' : 'PASS'}`);
process.exit(failed ? 1 : 0);
