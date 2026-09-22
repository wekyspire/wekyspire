// headlessPlay：LLM 可玩的文本界面（一次性 CLI，replay 式会话）。
//
// 引擎在 tools/playSession.mjs（与直播守护进程 tools/broadcast.mjs 共用同一份
// exec/render，输出不漂移）；本文件只做命令行解析与输出。
//
// 用法：
//   node tools/headlessPlay.mjs <会话名> new <种子>        # 建档（从零开局）
//   node tools/headlessPlay.mjs <会话名> load <存档名>      # 建档（从存档快照起跑：调好的构筑直接开打）
//   node tools/headlessPlay.mjs <会话名>                    # 看状态
//   node tools/headlessPlay.mjs <会话名> <动作...>          # 玩
//   node tools/headlessPlay.mjs <会话名> help               # 动作表
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  HELP, freshState, freshStateFromSave, exec, render, renderDeck, renderLib, renderRelics, renderTerms,
  sessionDir, sessionPath, stageCn, writeSession,
} from './playSession.mjs';

// ---------- 调试：PLAYTRACE=<defId> 重放时逐动作打印该卡去向（排查报告用） ----------
const TRACE = process.env.PLAYTRACE ?? null;
function traceLine(S, action) {
  const bs = S.battle?.battleState;
  const where = [];
  if (bs) {
    for (const z of ['hand', 'deck', 'burnt', 'pending']) {
      const n = bs.zones[z].filter(c => c.defId === TRACE).length;
      if (n) where.push(`${z}×${n}${z === 'hand' && bs.zones.hand.some(c => c.defId === TRACE && c.isActivated) ? '★' : ''}`);
    }
  }
  const p = S.run.player;
  console.error(`[trace] ${action} | 层${S.run.floor} ${stageCn(S.run.gameStage)} 回合${bs?.turn.count ?? '-'}`
    + ` | HP${p.hp}/${p.maxHp} 盾${p.shield} 燃烧${p.getEffectStacks('burn')} | ${where.join(' ') || '场上无'}`
    + ` | 构筑×${S.run.player.deck.filter(c => c.defId === TRACE).length}`);
}

// ---------- 入口 ----------
const [, , sessionName, ...argv] = process.argv;
if (!sessionName || sessionName === 'help') { console.log(HELP); process.exit(0); }
fs.mkdirSync(sessionDir, { recursive: true });
const file = sessionPath(sessionName);

if (argv[0] === 'new') {
  const seed = Number.parseInt(argv[1] ?? '', 10);
  if (!Number.isInteger(seed)) { console.error('用法: new <种子数字> [路线]（路线 = body/fire/wood/air，缺省 body）'); process.exit(1); }
  const route = argv[2] ?? 'body';
  if (!['body', 'fire', 'wood', 'air'].includes(route)) { console.error(`未知路线：${route}（可选 body/fire/wood/air）`); process.exit(1); }
  if (fs.existsSync(file)) {
    console.error(`会话已存在：${file}`);
    console.error(`（不用再 new：直接给动作即可，例如 node tools/headlessPlay.mjs ${sessionName} state）`);
    process.exit(1);
  }
  fs.writeFileSync(file, JSON.stringify({ seed, route, actions: [] }, null, 2));
  console.log(`已建档 ${sessionName}（种子 ${seed} · 路线 ${route}）`);
  process.exit(0);
}
// load：从**存档快照**建档（核心是 core/run/saveRestore.js——与浏览器读档同一份原语，
// 所以 headless 与 `?debug=1&save=<名>` 看到的局面必然一致）。存档名 → tmp/saves/<名>.json；
// 带路径分隔符或 .json 后缀 → 按路径读（面板导出的存档 JSON 可直接喂进来）。
if (argv[0] === 'load') {
  const target = argv[1];
  const force = argv.includes('--force') || argv.includes('-f');
  if (!target) { console.error('用法: load <存档名|路径.json> [--force]（存档名 = tmp/saves/<名>.json）'); process.exit(1); }
  if (fs.existsSync(file) && !force) {
    console.error(`会话已存在：${file}`);
    console.error(`（要换档请先删掉它，或换个会话名，或加 --force 重建：`
      + `node tools/headlessPlay.mjs ${sessionName} load ${target} --force）`);
    process.exit(1);
  }
  const cwd = process.cwd();
  const looksPath = /[\\/]/.test(target) || /\.json$/i.test(target);
  const savePath = path.isAbsolute(target) ? target
    : looksPath ? path.resolve(cwd, target)
      : path.join(cwd, 'tmp', 'saves', `${target}.json`);
  let save;
  try { save = JSON.parse(fs.readFileSync(savePath, 'utf8')); }
  catch (err) { console.error(`✗ 存档读取失败：${savePath}（${err.message}）`); process.exit(1); }
  if (!save || typeof save !== 'object' || !save.player || save.floor == null) {
    console.error(`✗ 不是合法存档（缺 player/floor）：${savePath}`);
    process.exit(1);
  }
  save.name = save.name ?? path.basename(savePath, '.json');
  fs.writeFileSync(file, JSON.stringify({ seed: save.seed, save, saveName: save.name, actions: [] }, null, 2));
  const stage = save.debugMode ? `调试档（${save.gameStage ?? 'prep'}${save.currentRoom ? ' · ' + save.currentRoom : ''}）` : '真实档（检查点=prep）';
  console.log(`已建档 ${sessionName}（从存档「${save.name}」起跑）`);
  console.log(`  第 ${save.floor}/${save.totalFloors ?? '?'} 层 · ${stage} · 卡组 ${save.player.deck.length} 张 `
    + `· 能力 ${save.player.abilities.length} 项 · 遗物 ${save.player.relics.length} 件 · HP ${save.player.hp}/${save.player.maxHp}`);
  console.log(`下一步：node tools/headlessPlay.mjs ${sessionName} state ｜ 战斗动作会自动开战（也可先 fight）`);
  process.exit(0);
}
if (!fs.existsSync(file)) { console.error(`会话不存在：${file}（先 new）`); process.exit(1); }
// 会话文件读取带瞬态重试：Windows 下刚写入/被轮询（broadcast/杀软扫描）短暂占用的
// 文件偶发 open 失败——r22 实报「紧接上一条命令的调用 exit 1 无 ✗」即此处裸抛。
// 重试间隔给足 AV 扫描窗口；仍失败则由顶层 catch 统一 ✗。
function readSessionJson(path, tries = 5) {
  let lastErr = null;
  for (let i = 0; i < tries; i++) {
    try { return JSON.parse(fs.readFileSync(path, 'utf8')); } catch (err) { lastErr = err; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40); // 同步 sleep 40ms
  }
  throw lastErr;
}
let data;
try {
  data = readSessionJson(file);
} catch (err) {
  console.error(`✗ 会话文件读取失败：${err.message}（状态未变，请原样重试一次）`);
  process.exit(1);
}
const action = argv.join(' ').trim();
// 纯视图命令不进 exec；preview 只读（进 exec 取结果但不入档）
const pureView = !action || /^(state|help|terms|deck|lib|relics)$/.test(action);
const noRecord = pureView || action.startsWith('preview');

let S;
try {
  S = data.save ? freshStateFromSave(data.save) : freshState(data.seed, { route: data.route ?? 'body' });
  // 回放失败必须指出是第几个动作（第 7 轮 H：裸错误「当前不在战斗阶段」无从定位脱节动作）
  for (let i = 0; i < data.actions.length; i++) {
    try { exec(S, data.actions[i]); if (TRACE) traceLine(S, data.actions[i]); }
    catch (err) { throw new Error(`回放第 ${i + 1}/${data.actions.length} 个动作「${data.actions[i]}」失败：${err.message}`); }
  }
  if (!pureView) exec(S, action);
} catch (err) {
  console.error(`✗ ${err.message}`);
  console.error('（动作未入档，状态未变）当前状态：');
  try { console.log(render(S)); } catch { /* 状态本身异常时保持纯报错 */ }
  process.exit(1);
}
if (!noRecord) {
  // 乐观并发守卫（X3 巡检实报：多 agent 并行时两个进程读同一快照、各自追加后互相
  // 覆盖/动作错序——「未下发的动作入档」。写入前重读文件核对动作序列未变，
  // 变了就拒绝写入；写盘走 tmp+rename 原子替换，读侧不再可能看到半个文件）。
  // 整段包 try/catch：入档层的任何异常（重读/校验/写盘/改名）一律 ✗ + exit 1——
  // r21 实报「动作静默丢失（无 ✗、重发即成功）」：执行成功但写盘抛错时旧版直接
  // 崩栈退出，调用方的 ✗ 检测抓不到，动作无声蒸发。宁可吵不可哑。
  try {
    const before = readSessionJson(file);
    const beforeActions = Array.isArray(before.actions) ? before.actions : [];
    if (before.seed !== data.seed
      || (data.save && before.save?.savedAt !== data.save.savedAt)
      || beforeActions.length !== data.actions.length
      || beforeActions.some((a, i) => a !== data.actions[i])) {
      console.error('✗ 会话在回放期间被另一个进程改写了（并发写冲突）——本次动作未入档。'
        + '请重新执行该动作（不要并行调用同一会话）。');
      process.exit(1);
    }
    before.actions.push(action);
    // 原子写走 files.mjs 的加固实现：rename 对 Windows 瞬态锁（杀毒/索引器）EPERM/EBUSY
    // 退避重试。旧版在此内联 writeFileSync+renameSync 且无重试——命中瞬态锁即 rename 抛错，
    // 表现为「动作执行成功但入档失败」静默丢失（tmp/playtests 里成堆的孤儿 .tmp-<pid>
    // 就是这条无重试路径遗留的），锁窗口稍长时进程还会被拖住像卡死。统一走 writeSession。
    writeSession(sessionName, before);
  } catch (writeErr) {
    console.error(`✗ 动作执行成功但入档失败：${writeErr.message}（本次动作未入档，请原样重发一次）`);
    process.exit(1);
  }
}
if (action === 'help') console.log(HELP);
else {
  // 渲染兜底：走到这里动作已入档（或纯视图）——渲染崩溃时必须如实告知入档状态，
  // 不能让裸栈 exit 1 诱导调用方「原样重发」（会把已入档的动作再执行一遍）
  try {
    if (action === 'deck') console.log(renderDeck(S));
    else if (action === 'lib') console.log(renderLib(S));
    else if (action === 'relics') console.log(renderRelics(S));
    else if (action === 'terms') console.log(renderTerms(S));
    else console.log(render(S));
  } catch (renderErr) {
    console.error(`✗ 动作${noRecord ? '（纯视图）' : '已入档'}但状态渲染失败：${renderErr.message}`
      + `${noRecord ? '' : '——先用 state 核对，不要盲目重发'}`);
    process.exit(1);
  }
}
