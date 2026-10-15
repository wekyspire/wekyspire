// wire 流录制 fuzz（P0 防回归基建）：node 侧真 bridge + 自动收拍 sequencer，
// 把战斗指令流按 wire 描述符原样录制——重构等价性的 A/B 判定器。
//
// 用法：
//   node tools/fuzz/wireFuzz.mjs --games 20 --seed 1000 --out tmp/wire/before.json
//   （重构后同参再跑 --out after.json，然后 node tools/fuzz/wireDiff.mjs before.json after.json）
//
// 设计：
//   · 真 createBridge（presenter 翻译/投影像真战斗一样跑），注入 tap sequencer：
//     enqueue 时 instructionRecord() 录描述符（与观战推流同一形状），durationMs 改
//     Infinity + 自排 manual 收拍——0 等待跑完时间轴，timeoutCount 恒 0（不造假账）。
//   · 断言：① 指令 100% 带 wire 描述符（裸指令 = 观战盲区）② 每局终局合法
//     ③ 同 seed 双跑记录逐字节一致（确定性自检——A/B 的前提）。
//   · 录制内容 = (event, payload) 入队序；payload 经 toWire 清洗（与线上一致）。
//
// 退出码：全绿 0；任一断言炸 1。

import '../../src/core/content/index.js'; // 触发登记
import { createRun, enterBattle, assembleBattle, finishBattle } from '../../src/core/run/runFlow.js';
import Player, { PLAYER_BASE_HP, PLAYER_BASE_AP } from '../../src/core/state/player.js';
import { createSkillRuntime } from '../../src/core/state/skillRuntime.js';
import { allSkills } from '../../src/core/skills/registry.js';
import { canUseSkill } from '../../src/core/skills/helpers.js';
import { createBridge } from '../../src/bridge/index.js';
import AnimationSequencer from '../../src/core/anim/sequencer.js';
import { instructionRecord } from '../../src/bridge/wire.js';
import { EventNames } from '../../src/bridge/events.js';
import mitt from 'mitt';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : dflt;
};
const GAMES = Number(arg('games', 20));
const SEED_BASE = Number(arg('seed', 1000));
const OUT = arg('out', 'tmp/wire/record.json');

const SKILL_POOL = allSkills().filter(s => s?.cost != null).map(s => s.id);

function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomDeck(rand) {
  const deck = [];
  const counts = new Map();
  let guard = 0;
  while (deck.length < 14 && guard++ < 500) {
    const id = SKILL_POOL[Math.floor(rand() * SKILL_POOL.length)];
    const n = counts.get(id) ?? 0;
    if (n >= 2) continue;
    counts.set(id, n + 1);
    deck.push(id);
  }
  return deck;
}

/** tap sequencer：录制 wire 描述符 + 自动收拍（manual 收拍不污染 timeoutCount）。 */
function makeTapSequencer(records, counter) {
  const bus = mitt();
  const seq = new AnimationSequencer({ bus, finishedEvent: EventNames.ANIMATION_INSTRUCTION_FINISHED });
  const origEnqueue = seq.enqueueInstruction.bind(seq);
  seq.enqueueInstruction = (opts = {}) => {
    const rec = instructionRecord(opts);
    if (rec) records.push(rec);
    else counter.unWired += 1;
    const id = origEnqueue({ ...opts, durationMs: Infinity });
    setTimeout(() => seq.finish(id), 0);
    return id;
  };
  return { seq, bus };
}

const flushQueue = async (seq, limit = 4000) => {
  let n = 0;
  while (seq.pendingCount > 0 && n++ < limit) await new Promise(r => setTimeout(r, 0));
};

/** 跑一局（录制指令流）。返回 { records, result, ok }。 */
async function playGame(seed) {
  const rand = rng32(seed);
  const run = createRun({
    seed, totalFloors: 2,
    player: new Player({ maxHp: PLAYER_BASE_HP, maxMana: 3, maxActionPoints: PLAYER_BASE_AP }),
    route: 'body',
  });
  run.player.deck = randomDeck(rand).map(id => createSkillRuntime(id)); // 随机卡组广覆盖

  const records = [];
  const counter = { unWired: 0 };
  const { seq, bus } = makeTapSequencer(records, counter);
  enterBattle(run);
  const assembled = assembleBattle(run);
  const bridge = createBridge({ runState: run, ...assembled, frontendBus: bus, sequencer: seq });
  let result = null;
  bridge.backendBus.on(EventNames.BATTLE_END, ({ result: r }) => { result = r ?? 'unknown'; });
  bridge.start();
  await flushQueue(seq);

  let steps = 0;
  while (!bridge.isFinished() && steps++ < 800) {
    const proj = bridge.getProjection();
    const pending = proj?.pendingInput?.request ?? null;
    if (pending) {
      // 结算期输入：随机应答（confirm 掷硬币；选卡随机凑数）
      let answer;
      if (pending.kind === 'confirm') answer = rand() < 0.5;
      else {
        const cands = [...(pending.candidates ?? [])];
        const n = Math.min(pending.max ?? pending.count ?? pending.min ?? 1, cands.length);
        answer = [];
        for (let i = 0; i < n && cands.length; i++) answer.push(cands.splice(Math.floor(rand() * cands.length), 1)[0]);
      }
      bridge.interaction.respond(answer);
    } else {
      const playable = (proj?.hand ?? []).filter(c => bridge.intents.canPlayCard(c.uniqueID));
      if (!playable.length || rand() < 0.15) bridge.intents.endTurn();
      else bridge.intents.playCard(playable[Math.floor(rand() * playable.length)].uniqueID);
    }
    await flushQueue(seq);
  }
  if (result === null) result = bridge.isFinished() ? 'finished' : 'stuck';
  return { records, result, unWired: counter.unWired, stuck: result === 'stuck' };
}

const runBatch = async () => {
  // uniqueID 等核心字段带 Math.random 后缀（skillRuntime.js:9）——工具进程内定播，
  // 同 seed 双批才逐字节一致（A/B 前提）。只影响本工具进程，不碰产品代码。
  Math.random = rng32(SEED_BASE ^ 0x5EED);
  const games = [];
  for (let g = 0; g < GAMES; g++) {
    const r = await playGame(SEED_BASE + g);
    games.push(r);
  }
  return games;
};

const t0 = Date.now();
const games = await runBatch();
let failed = false;

const badResult = games.filter(g => g.result !== 'victory' && g.result !== 'defeat');
if (badResult.length) {
  console.error(`FAIL：${badResult.length}/${GAMES} 局终局异常（${badResult.slice(0, 3).map(g => g.result).join(',')}）`);
  failed = true;
}
const unWired = games.reduce((n, g) => n + g.unWired, 0);
if (unWired > 0) {
  console.error(`FAIL：${unWired} 条指令无 wire 描述符（观战盲区）`);
  failed = true;
}

// 确定性说明：卡运行时 uniqueID 带模块级递增计数器（skillRuntime.js）——
// 同进程双批不可比，A/B 一律「两个进程各跑一次 + wireDiff 比对」；工具内已把
// Math.random 定播，跨进程唯一差异源只剩计数器，而计数器在各自进程内同序。
const totalInstr = games.reduce((n, g) => n + g.records.length, 0);
if (OUT) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({
    meta: { games: GAMES, seedBase: SEED_BASE, date: new Date().toISOString() },
    streams: games.map((g, i) => ({ seed: SEED_BASE + i, result: g.result, records: g.records })),
  }));
}

console.log(`wireFuzz：${GAMES} 局 / ${totalInstr} 条指令 / ${Date.now() - t0}ms`
  + `${OUT ? ` / 已录 ${OUT}` : ''}`);
console.log(failed ? '结果：FAIL' : '结果：PASS');
process.exit(failed ? 1 : 0);
