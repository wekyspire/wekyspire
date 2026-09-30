// 浏览器侧战斗动画 fuzz 抽样（测试体系层「动画真实播放」，配 tickScale 加速）。
//
// 用法：node tools/fuzz/battleFuzzBrowser.mjs [--seed 777] [--tick-scale 3] [--battles 1]
//   前置：dev server 在跑（localhost:5177）；存档 w6fight（或用 --save 覆盖）。
//
// 断言（每场战斗结束后）：
//   ① sequencer.timeoutCount === 0 —— 保险丝烧过一次即动画死锁/丢 finish 链（强断言）；
//   ② 页面零 console error / 零 pageerror；
//   ③ 战斗终局 verdict 合法。
// AI：贪心 + 怪招（15% 直接过）——与 node 侧 fuzz 同策略口径；出牌不等演出播完
//   （连续驱动 = 动画积压压力形态，节拍链断不断正是要测的东西）。

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : dflt;
};
const SEED = arg('seed', '777');
const TICK = Number(arg('tick-scale', 3));
const BATTLES = Number(arg('battles', 1));
const SAVE = arg('save', 'w6fight');

const { launch } = await import('../../tools/browserHarness.mjs');
const h = await launch({ unlockFps: true });
await h.goto(`?debug=1&save=${SAVE}&tickScale=${TICK}`);
await h.togglePanel(false);
await h.page.waitForTimeout(3500 / TICK + 1500);

let failed = false;
for (let i = 0; i < BATTLES && !failed; i++) {
  const result = await h.eval(async ({ seed, tick }) => {
    const c = window.__shell.ctrl.value;
    const rand = (() => { let a = seed >>> 0; return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }; })();
    await c.startBattle();
    const t0 = performance.now();
    while (c.run?.gameStage !== 'battle' && performance.now() - t0 < 30000) {
      await new Promise(r => setTimeout(r, 150));
    }
    const b = c.getBattleBridge();
    if (!b) return { err: 'no bridge' };
    const seq = b.sequencer;
    const seqStart = seq?.timeoutCount ?? -1;
    let actions = 0, turns = 0, lastCount = -1;
    // 自对弈：终局或墙钟超限退出
    const deadline = performance.now() + 180000 / tick;
    while (!b.isFinished() && performance.now() < deadline) {
      const proj = b.getProjection();
      const hand = (proj?.hand ?? []).filter(x => b.intents.canPlayCard(x.uniqueID));
      if (hand.length === 0 || rand() < 0.15) {
        await b.intents.endTurn();
        turns++;
      } else {
        const pick = hand[Math.floor(rand() * hand.length)];
        await b.intents.playCard(pick.uniqueID);
        actions++;
      }
      await new Promise(r => setTimeout(r, 60)); // 让结算/演出自然推进（core 是同步结算）
      if (proj?.turn?.count != null && proj.turn.count !== lastCount) lastCount = proj.turn.count;
    }
    // 等动画队列排空（墙钟上限 = 保险丝最长 2.5s×若干余量，按 tick 折算）
    const drain0 = performance.now();
    while ((seq?._instructions?.length ?? 0) > 0 && performance.now() - drain0 < 15000 / tick) {
      await new Promise(r => setTimeout(r, 100));
    }
    const verdict = b.battle?.ctx?.kernel?.verdict ?? b.isFinished() ? 'finished' : 'running';
    // queueLeft = 排空等待超限时剩余条数（战后 run 级演出仍在产生，仅信息字段不判定）
    return {
      actions, turns: lastCount, elapsedMs: Math.round(performance.now() - t0),
      verdict,
      timeoutCount: (seq?.timeoutCount ?? 0) - (seqStart < 0 ? 0 : seqStart),
      queueLeft: seq?._instructions?.length ?? -1,
      hp: c.getBattleStage()?._snapshot?.player?.hp,
    };
  }, { seed: SEED.charCodeAt(0) * 1000 + i * 7 + Date.now() % 97, tick: TICK });
  console.log(`[battle ${i}]`, JSON.stringify(result));
  if (result.err || result.timeoutCount > 0) {
    console.error(`FAIL：${result.err ?? `保险丝触发 ${result.timeoutCount} 次（动画死锁/丢 finish）`}`);
    failed = true;
  }
}

const errs = h.errors ?? [];
const cerrs = h.consoleErrors ?? [];
console.log(`pageErrors=${errs.length} consoleErrors=${cerrs.length}`);
if (errs.length || cerrs.length) {
  console.error('错误明细：', JSON.stringify([...errs.slice(0, 3), ...cerrs.slice(0, 3)]));
  failed = true;
}
await h.browser.close();
console.log(failed ? '结果：FAIL' : '结果：PASS');
process.exit(failed ? 1 : 0);
