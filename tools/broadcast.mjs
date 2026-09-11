// broadcast：headless 对局直播守护进程（只读观察者 + SSE 推流）。
//
//   node tools/broadcast.mjs [--port 5199] [--interval 250]
//   观战页：http://localhost:5177/watch.html?port=5199&session=<会话名>
//
// 端口选 5199（不是 5177/5178）：Vite dev 的端口被占时会自动 +1，localhost 在 Windows
// 又优先解析 IPv6，撞上就是「curl 打到 Vite」的迷惑现场。守护进程固定绑 127.0.0.1。
//
// 设计要点（与 tools/playSession.mjs、src/bridge/wire.js 的分工）：
//   · 它是**只读观察者**：轮询 tmp/playtests/*.json，绝不自造 session、绝不写会话文件。
//     agent 照旧用 tools/headlessPlay.mjs 出招，此处被动跟上——agent 工作流零改动。
//   · 会话文件是唯一事实源；内存态由 freshState + 全量重放得到（确定性，见 PLAYBOOK）。
//     文件一有新增动作，只对**新增的那些**开流（历史动作静默重放，不重播给观众）。
//   · 战斗「演出」= bridge presenter 的动画指令。这里不建真 Stage，而是把 presenter
//     接到 tap sequencer：指令描述符（可序列化，见 wire.js）直接推给浏览器，由浏览器
//     用本地 sequencer 重建播放（指令的 start 只依赖随指令带的数据，见 wire.js 头注释）。
//   · 没有 Stage 回 finish → tap 用 setTimeout(0) 让指令落回 idle（保留「同步忙闲」语义：
//     一次动作的同步结算期间 pendingCount > 0，与前端行为一致）。
//   · 迟到观众：补当前这场战斗的指令缓冲（battleBuf，battle:begin 处重置）再续播；
//     mode=replay 从第 0 个动作整局重放（独立状态实例，不动直播状态）。
//   · 会话懒加载：只有「文件有变化」或「有人订阅」才载入重放，44 个历史会话不拖慢启动。
import http from 'node:http';
import fs from 'node:fs';
import mitt from 'mitt';

import AnimationSequencer from '../src/core/anim/sequencer.js';
import { EventNames } from '../src/bridge/events.js';
import { createBridgePresenter } from '../src/bridge/presenter.js';
import { createStateSync } from '../src/bridge/stateSync.js';
import { projectBattle, projectCardFull } from '../src/bridge/projection.js';
import { instructionRecord, toWire } from '../src/bridge/wire.js';
import { deriveBattleSeed } from '../src/core/run/runFlow.js';
import { getEnemyDefinition } from '../src/core/enemies/registry.js';
import { getSkillDefinition } from '../src/core/skills/registry.js';
import { sceneIdForFloor } from '../src/stage/scenes/rooms/index.js';

import {
  freshState, exec, render, listSessions, readSession, sessionPath, stageCn, defOf,
} from './playSession.mjs';

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] != null ? argv[i + 1] : dflt;
};
const PORT = Number.parseInt(argOf('port', '5199'), 10);
const INTERVAL = Number.parseInt(argOf('interval', '250'), 10);
const DEV_ORIGIN = argOf('origin', 'http://localhost:5177');
// 观战页起在本机还是公网站点时，索引页的链接形态不同：
// 本机 → ?port=<中继端口>；公网 → 不带参数（观战页按 hostname 自动走同源 /relay，免 CORS/混合内容）
const ORIGIN_IS_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(DEV_ORIGIN);

// 当前战斗指令缓冲上限（迟到观众的回放窗口）：条数 + 体积双限，防长战斗吃内存
const BUF_MAX_RECORDS = 800;
const BUF_MAX_BYTES = 12 * 1024 * 1024;
const ACT_FEED_MAX = 60; // agent 出招流保留条数

// ---------- 复合 presenter：recording（文本渲染日志）+ bridge presenter（演出指令） ----------
// createRecordingPresenter 是 Proxy，缺省方法即记录；这里要「先记录、再转发」。
function createRecordingForwardPresenter(target) {
  const rec = {
    calls: [],
    clear() { rec.calls.length = 0; },
  };
  return new Proxy(rec, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (typeof prop !== 'string') return undefined;
      return (...args) => {
        t.calls.push({ method: prop, args });
        target[prop]?.(...args);
      };
    },
  });
}

/**
 * 建一个「可观察」的对局状态：presenter 的每条动画指令都经 onRecord 抛出。
 * @param onRecord (rec) => void 指令/生命周期记录出口
 * @param onBattle (S, battle) => void 战斗装配完成、startBattle 之前
 */
function createObservedState(seed, { onRecord, onBattle = null }) {
  const st = { battle: null, dirty: true, seq: 0, cached: null };

  const makePresenter = (S) => {
    const frontendBus = mitt();
    const backendBus = mitt();
    const sink = new AnimationSequencer({
      bus: frontendBus, finishedEvent: EventNames.ANIMATION_INSTRUCTION_FINISHED,
    });
    // 后端事件（战斗日志等）直接转发给观众：这些是纯数据、且本地就是即时呈现的
    // （前端 HUD 日志同样不等动画）。BATTLE_END 除外——它必须由队列尾闸那条
    // 镜像指令在动画播完后发，否则终局横幅会早于死亡演出
    backendBus.on('*', (event, payload) => {
      if (event === EventNames.BATTLE_END) return;
      onRecord({ t: 'b', event, payload: toWire(payload) ?? null });
    });
    // tap sequencer：与 AnimationSequencer 同接口（pendingCount/findPending 语义一致），
    // 额外职责只有两条——把描述符抛给 onRecord、用定时器补上「Stage 回执」
    const sequencer = {
      enqueueInstruction(opts) {
        const id = sink.enqueueInstruction(opts);
        const rec = instructionRecord(opts);
        if (rec) onRecord(rec);
        setTimeout(() => sink.finish(id), 0);
        return id;
      },
      finish: (id, reason) => sink.finish(id, reason),
      cancelAll: () => sink.cancelAll(),
      get pendingCount() { return sink.pendingCount; },
      findPending: (predicate) => sink.findPending(predicate),
    };

    let projectionDirty = true;
    const getProjection = () => {
      if (!st.battle) return st.cached; // 战斗已散场：交回最后一次快照（幂等，seq 不变）
      if (projectionDirty) {
        st.cached = projectBattle(st.battle);
        st.cached.seq = ++st.seq;
        projectionDirty = false;
      }
      return st.cached;
    };

    const stateSync = createStateSync({
      sequencer,
      getPresenter: () => presenter,
      onDirty: () => { projectionDirty = true; },
    });

    const presenter = createBridgePresenter({
      sequencer, frontendBus, backendBus,
      markDirty: stateSync.markDirty,
      getSnapshot: () => { stateSync.clearDirty(); return getProjection(); },
      projectCard: (rt) => (st.battle ? projectCardFull(st.battle, rt) : null),
    });
    // 动作收尾补一次同步（无 Stage 回执时队列已空 → 立即补，等价前端「排空即追平」）
    S.afterAction = () => stateSync.markDirty();
    return createRecordingForwardPresenter(presenter);
  };

  return freshState(seed, {
    makePresenter,
    onBattle: (s, battle) => { st.battle = battle; onBattle?.(s, battle); },
  });
}

// ---------- 战斗生命周期记录（观战页据此建/收舞台） ----------
function battleBeginRecord(S) {
  const bs = S.battle.battleState;
  const brief = (u) => ({ uniqueID: u.uniqueID, defId: u.defId ?? null, name: u.name, maxHp: u.maxHp });
  const seed = deriveBattleSeed(S.run.seed, S.run.floor);
  return {
    t: 'battle', phase: 'begin', floor: S.run.floor, totalFloors: S.run.totalFloors,
    scene: sceneIdForFloor(S.run.floor),
    // 房间种子 = 战斗种子 + 层号派生（与 runController.js:187 同源）
    sceneSeed: `${seed}:room:${S.run.floor}`,
    enemies: bs.enemies.filter(u => !u.isDead()).map(brief),
    allies: bs.allies.map(brief),
    roster: { deck: S.run.player.deck.map(c => c.defId) },
  };
}

function runSnapshot(S) {
  const p = S.run.player;
  return {
    t: 'run', floor: S.run.floor, totalFloors: S.run.totalFloors,
    stage: S.run.gameStage, stageCn: stageCn(S.run.gameStage), result: S.run.result ?? null,
    hp: p.hp, maxHp: p.maxHp, shield: p.shield,
    mana: p.mana, maxMana: p.maxMana,
    actionPoints: p.actionPoints, maxActionPoints: p.maxActionPoints,
    money: p.money, leino: { ...p.leino }, bodyLevel: p.bodyLevel ?? 0,
    trainingCount: p.trainingCount, ascensionCount: p.ascensionCount,
    abilities: [...(p.abilities ?? [])], relics: [...(p.equippedRelics ?? [])],
    deck: S.run.player.deck.map(c => ({ defId: c.defId, name: defOf(c)?.name ?? c.defId })),
    encounter: (S.run.encounter ?? []).map(e => ({
      defId: e.defId, name: getEnemyDefinition(e.defId)?.name ?? e.defId, maxHp: e.maxHp,
    })),
  };
}

const recBytes = (rec) => (rec.payload ? JSON.stringify(rec.payload).length : 0) + 96;

// ---------- 过渡时刻（观战专用） ----------
// 战斗之外的阶段（战前准备/战后奖励/奖励房/进阶/终局）在正式壳里由 Vue 面板直接读
// core 呈现，没有走 sequencer 的演出节拍——观战页若只照搬事件流，这些决策会一闪而过。
// 因此中继在这里把「阶段过渡」整理成结构化记录（含三选一候选与所选标记），由观战页
// 用自己的队列按时长逐个播放。**只服务观战**：core / 正式前端零改动。
const MOMENT_CMDS = new Set(['pack', 'take', 'skip', 'act', 'dim', 'seed', 'ability', 'reroll']);
const STAGE_TITLE = { prep: '战前准备', reward: '战后奖励', room: '奖励房', ascension: '进阶', end: '终局' };

const cardBriefOf = (rt) => {
  const def = defOf(rt);
  if (!def) return null;
  const cost = def.cost ?? {};
  const costText = [
    cost.mana === 'X' ? 'X魏启' : (cost.mana ? `${cost.mana}魏启` : null),
    cost.actionPoint ? `${cost.actionPoint}AP` : null,
  ].filter(Boolean).join(' ') || '0费';
  let text = '';
  try { text = def.describe ? String(def.describe()) : ''; } catch { text = ''; }
  return { name: def.name, tier: def.tier ?? null, costText, text };
};

function momentFor(S, action, index) {
  const run = S.run;
  const cmd = String(action).trim().split(/\s+/)[0];
  const outcome = S.lastOutcome ?? '';
  const battleResult = /^[⚔💀]/.test(outcome); // 战斗结算/终局
  if (!MOMENT_CMDS.has(cmd) && !battleResult) return null;

  const m = {
    t: 'moment', index, action, outcome,
    floor: run.floor, totalFloors: run.totalFloors,
    stage: run.gameStage, stageCn: stageCn(run.gameStage),
    title: battleResult ? `第 ${run.floor} 层 · 战斗结果` : `第 ${run.floor} 层 · ${STAGE_TITLE[run.gameStage] ?? run.gameStage}`,
    lines: outcome.split('；').filter(Boolean),
    candidates: null, card: null,
  };

  // 拿牌：附三选一候选（领取后 rw.skillChoices 仍在，chosenSkill 标出所选）+ 所选卡面
  const rw = run.rewards;
  if (rw?.chosenSkill) {
    const taken = rw.chosenSkill;
    m.candidates = (rw.skillChoices ?? []).map(id => ({
      name: getSkillDefinition(id)?.name ?? id,
      tier: getSkillDefinition(id)?.tier ?? null,
      taken: id === taken,
    }));
  }
  if (cmd === 'take' || (cmd === 'act' && action.trim().split(/\s+/)[1] === 'take')) {
    const tail = run.player.deck[run.player.deck.length - 1];
    m.card = tail ? cardBriefOf(tail) : null;
  }
  // 训练房抓牌候选（roomData 未清时给出，方便看到是几选一）
  if (cmd === 'act' && Array.isArray(run.roomData?.drawChoices)) {
    m.candidates = run.roomData.drawChoices.map(id => ({
      name: getSkillDefinition(id)?.name ?? id,
      tier: getSkillDefinition(id)?.tier ?? null,
      taken: false,
    }));
  }
  return m;
}

// ---------- 会话观察器（轮询 → 只对新动作开流） ----------
class SessionWatcher {
  constructor(name) {
    this.name = name;
    this.seed = null;
    this.streamed = 0;
    this.live = false;   // false = 追赶重放期（只入缓冲、不广播）
    this.buf = [];       // 当前战斗的指令缓冲（迟到观众的回放窗口）
    this.bufBytes = 0;
    this.acts = [];      // agent 出招流（最近 N 条）
    this.subs = new Set();
    this.S = null;
    this.error = null;
  }

  _record(rec) {
    if (rec.t === 'battle' && rec.phase === 'begin') { this.buf = []; this.bufBytes = 0; }
    this.buf.push(rec);
    this.bufBytes += recBytes(rec);
    while (this.buf.length > BUF_MAX_RECORDS || this.bufBytes > BUF_MAX_BYTES) {
      this.bufBytes -= recBytes(this.buf.shift());
    }
    if (this.live) this._broadcast(rec);
  }

  _broadcast(rec) {
    const line = `data: ${JSON.stringify(rec)}\n\n`;
    for (const sub of this.subs) {
      try { sub.res.write(line); } catch { /* 断开的连接由 close 事件清理 */ }
    }
  }

  _send(sub, rec) {
    try { sub.res.write(`data: ${JSON.stringify(rec)}\n\n`); } catch { /* 忽略已断连接 */ }
  }

  _reset(seed) {
    this.seed = seed;
    this.streamed = 0;
    this.live = false;
    this.buf = [];
    this.bufBytes = 0;
    this.acts = [];
    this.error = null;
    this.S = createObservedState(seed, {
      onRecord: (rec) => this._record(rec),
      onBattle: (S) => this._record(battleBeginRecord(S)),
    });
  }

  /** 全量追赶：此期间记录只入缓冲，之后转入直播（首建 watcher / 会话被重写时用）。 */
  _rebaseline(data) {
    this._reset(data.seed);
    for (let i = 0; i < data.actions.length; i++) {
      if (!this._step(data.actions[i], i, true)) break;
    }
    this.live = true;
  }

  /** 执行一个动作；失败则记录错误并停止跟进（改配置后旧记录失效等，不猜不修补）。
   *  silent=true 时只入缓冲/出招流，不广播（追赶期用）。 */
  _step(action, index, silent = false) {
    try {
      exec(this.S, action);
    } catch (err) {
      this.error = `重放第 ${index + 1} 个动作失败：${err.message}`;
      this.streamed = index + 1;
      if (this.live && !silent) this._broadcast({ t: 'error', message: this.error, actionIndex: index });
      return false;
    }
    this.S.afterAction?.();
    this.streamed = index + 1;
    const act = {
      t: 'act', index, action, floor: this.S.run.floor,
      stage: this.S.run.gameStage, outcome: this.S.lastOutcome ?? '',
    };
    this.acts.push(act);
    if (this.acts.length > ACT_FEED_MAX) this.acts.shift();
    if (this.live && !silent) { this._broadcast(act); this._broadcast(runSnapshot(this.S)); }
    // 阶段过渡的结构化记录（观战页用它按节奏播「时刻卡」；正式游戏无此概念）
    const moment = momentFor(this.S, action, index);
    if (moment) this._record(moment);
    return true;
  }

  /** 文件有变化时调用。首次见到某会话：历史静默追上，最后一条作为直播首拍。 */
  poll() {
    const data = readSession(this.name);
    if (!data) return false; // 会话不存在或写入中途：下个轮询再试
    if (this.S === null) {
      this._reset(data.seed);
      const liveFrom = Math.max(0, data.actions.length - 1);
      for (let i = 0; i < liveFrom; i++) {
        if (!this._step(data.actions[i], i, true)) { this.live = true; return true; }
      }
      this.live = true;
      for (let i = liveFrom; i < data.actions.length; i++) {
        if (!this._step(data.actions[i], i)) break;
      }
      return true;
    }
    if (data.seed !== this.seed || data.actions.length < this.streamed) {
      this._broadcast({ t: 'reset', reason: '会话被重写' });
      this._rebaseline(data);
      return true;
    }
    if (data.actions.length === this.streamed) return false;
    for (let i = this.streamed; i < data.actions.length; i++) {
      if (!this._step(data.actions[i], i)) break;
    }
    return true;
  }

  /** 确保已载入（订阅/查询时用）。 */
  ensure() {
    if (this.S === null) {
      const data = readSession(this.name);
      if (data) this._rebaseline(data);
    }
    return this.S !== null;
  }

  /** 迟到观众入场：握手 + 局况 + 出招流 + 当前战斗缓冲，随后续播直播。 */
  attach(sub) {
    this.subs.add(sub);
    this.ensure();
    this._send(sub, { t: 'hello', session: this.name, seed: this.seed, mode: 'live', error: this.error });
    if (!this.S) return () => this.subs.delete(sub);
    this._send(sub, runSnapshot(this.S));
    for (const a of this.acts) this._send(sub, a);
    // 缓冲里若没有本场战斗的开头（守护进程起于战斗中），补一条合成 battle:begin，
    // 让晚到的观众至少能建起舞台、从当前局面看起
    const hasBegin = this.buf.some(r => r.t === 'battle' && r.phase === 'begin');
    if (!hasBegin && this.S.battle && this.S.run.gameStage === 'battle') {
      this._send(sub, battleBeginRecord(this.S));
    }
    for (const rec of this.buf) this._send(sub, rec);
    this._send(sub, { t: 'buffered', count: this.buf.length });
    return () => this.subs.delete(sub);
  }

  /** 整局重放（mode=replay）：独立状态实例，逐动作开流给单个订阅者。 */
  replay(sub) {
    const data = readSession(this.name);
    if (!data) { this._send(sub, { t: 'error', message: '会话不存在' }); return () => {}; }
    const S = createObservedState(data.seed, {
      onRecord: (rec) => this._send(sub, rec),
      onBattle: (s) => this._send(sub, battleBeginRecord(s)),
    });
    this._send(sub, { t: 'hello', session: this.name, seed: data.seed, mode: 'replay', total: data.actions.length });
    let stopped = false;
    const timer = setTimeout(() => {
      for (let i = 0; i < data.actions.length && !stopped; i++) {
        try { exec(S, data.actions[i]); } catch (err) {
          this._send(sub, { t: 'error', message: `重放第 ${i + 1} 个动作失败：${err.message}` });
          return;
        }
        S.afterAction?.();
        this._send(sub, {
          t: 'act', index: i, action: data.actions[i],
          floor: S.run.floor, stage: S.run.gameStage, outcome: S.lastOutcome ?? '',
        });
        this._send(sub, runSnapshot(S));
        this._send(sub, { t: 'act-end', index: i });
      }
      this._send(sub, { t: 'replay-end' });
    }, 30);
    return () => { stopped = true; clearTimeout(timer); };
  }
}

// ---------- HTTP + SSE ----------
const watchers = new Map();
const fileStamps = new Map(); // 会话名 → `${mtimeMs}:${size}`（懒加载：只在文件真的变了才载入）
const seedCache = new Map();  // 会话名 → { stamp, seed }（列表页要显示种子，未载入的会话轻量读一次）

const watcherFor = (name) => {
  let w = watchers.get(name);
  if (!w) { w = new SessionWatcher(name); watchers.set(name, w); }
  return w;
};

/** 只取 seed（列表页用）：按文件指纹缓存，避免每次请求都解析大文件。 */
function seedOf(name) {
  const stamp = fileStamps.get(name);
  const hit = seedCache.get(name);
  if (hit && hit.stamp === stamp) return hit.seed;
  const data = readSession(name);
  const seed = data?.seed ?? null;
  seedCache.set(name, { stamp, seed });
  return seed;
}

function scanFiles() {
  const changed = [];
  const seen = new Set();
  for (const name of listSessions()) {
    seen.add(name);
    let st;
    try { st = fs.statSync(sessionPath(name)); } catch { continue; }
    const stamp = `${st.mtimeMs}:${st.size}`;
    if (fileStamps.get(name) !== stamp) {
      // 首次见到只记指纹：44 个历史会话不拖慢启动，真正载入留给「有变化」或「有人订阅」
      if (fileStamps.has(name)) changed.push(name);
      fileStamps.set(name, stamp);
    }
  }
  for (const name of [...fileStamps.keys()]) if (!seen.has(name)) fileStamps.delete(name);
  return changed;
}

const json = (res, code, body) => {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (url.pathname === '/health') return json(res, 200, { ok: true, loaded: [...watchers.keys()] });

  if (url.pathname === '/sessions') {
    scanFiles();
    return json(res, 200, listSessions().map(name => {
      const w = watchers.get(name);
      const s = w?.S?.run;
      return {
        name,
        loaded: !!w?.S,
        seed: w?.seed ?? seedOf(name),
        floor: s?.floor ?? null,
        totalFloors: s?.totalFloors ?? null,
        stage: s?.gameStage ?? null,
        result: s?.result ?? null,
        actions: w?.streamed ?? 0,
        error: w?.error ?? null,
      };
    }));
  }

  if (url.pathname === '/state') {
    const name = url.searchParams.get('session');
    const w = watcherFor(name);
    w.ensure();
    if (!w.S) return json(res, 404, { error: '会话不存在' });
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    return res.end(`${render(w.S)}\n`); // 与 CLI 的 console.log 同款收尾，便于逐字节对账
  }

  if (url.pathname === '/live') {
    const name = url.searchParams.get('session');
    const mode = url.searchParams.get('mode') ?? 'live';
    if (!name) return json(res, 400, { error: '缺少 session 参数' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('retry: 1500\n\n');
    const sub = { res };
    const w = watcherFor(name);
    const detach = mode === 'replay' ? w.replay(sub) : w.attach(sub);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* ignore */ } }, 15000);
    req.on('close', () => { clearInterval(ping); detach?.(); });
    return undefined;
  }

  if (url.pathname === '/') {
    scanFiles();
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    const rows = listSessions().map(name => {
      const w = watchers.get(name);
      const s = w?.S?.run;
      const label = s
        ? `第${s.floor}/${s.totalFloors}层 ${stageCn(s.gameStage)}${s.result ? `（${s.result}）` : ''} · ${w.streamed} 动作`
        : '未载入（首次订阅时重放）';
      const watch = `${DEV_ORIGIN}/watch.html`
        + (ORIGIN_IS_LOCAL ? `?port=${PORT}&session=${encodeURIComponent(name)}` : `?session=${encodeURIComponent(name)}`);
      return `<li><b>${name}</b> · ${label}`
        + ` — <a href="${watch}">观战</a> ｜ <a href="${watch}&mode=replay">整局重放</a>`
        + ` ｜ <a href="/state?session=${encodeURIComponent(name)}">文本状态</a></li>`;
    }).join('');
    return res.end(`<!DOCTYPE html><meta charset="utf-8"><title>魏启尖塔 · 直播中继</title>`
      + `<body style="font:14px/1.7 sans-serif;background:#111;color:#cdd6f4">`
      + `<h2>直播中继 :${PORT}</h2><ul>${rows || '<li>暂无会话</li>'}</ul>`
      + `<p>观战页走 dev server（默认 ${DEV_ORIGIN}）：<code>/watch.html?port=${PORT}&session=名字</code></p></body>`);
  }

  return json(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[broadcast] 直播中继已启动 http://127.0.0.1:${PORT}`);
  console.log(`[broadcast] 观战页：${DEV_ORIGIN}/watch.html?port=${PORT}&session=<会话名>`);
  console.log(`[broadcast] 会话索引：http://127.0.0.1:${PORT}/`);
});
server.on('error', (err) => {
  console.error(`[broadcast] 监听 ${PORT} 失败：${err.message}`);
  console.error('[broadcast] 换端口：node tools/broadcast.mjs --port <空闲端口>');
  process.exit(1);
});

setInterval(() => {
  for (const name of scanFiles()) watcherFor(name).poll();
}, INTERVAL);
