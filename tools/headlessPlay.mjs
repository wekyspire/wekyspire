// headlessPlay：LLM 可玩的文本界面（一次性 CLI，replay 式会话）。
//
// 引擎在 tools/playSession.mjs（与直播守护进程 tools/broadcast.mjs 共用同一份
// exec/render，输出不漂移）；本文件只做命令行解析与输出。
//
// 用法：
//   node tools/headlessPlay.mjs <会话名> new <种子>        # 建档
//   node tools/headlessPlay.mjs <会话名>                    # 看状态
//   node tools/headlessPlay.mjs <会话名> <动作...>          # 玩
//   node tools/headlessPlay.mjs <会话名> help               # 动作表
import fs from 'node:fs';

import {
  HELP, freshState, exec, render, renderDeck, renderLib, renderRelics, renderTerms,
  sessionDir, sessionPath, stageCn,
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
  if (!Number.isInteger(seed)) { console.error('用法: new <种子数字>'); process.exit(1); }
  if (fs.existsSync(file)) {
    console.error(`会话已存在：${file}`);
    console.error(`（不用再 new：直接给动作即可，例如 node tools/headlessPlay.mjs ${sessionName} state）`);
    process.exit(1);
  }
  fs.writeFileSync(file, JSON.stringify({ seed, actions: [] }, null, 2));
  console.log(`已建档 ${sessionName}（种子 ${seed}）`);
  process.exit(0);
}
if (!fs.existsSync(file)) { console.error(`会话不存在：${file}（先 new）`); process.exit(1); }
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const action = argv.join(' ').trim();
// 纯视图命令不进 exec；preview 只读（进 exec 取结果但不入档）
const pureView = !action || /^(state|help|terms|deck|lib|relics)$/.test(action);
const noRecord = pureView || action.startsWith('preview');

let S;
try {
  S = freshState(data.seed);
  for (const a of data.actions) { exec(S, a); if (TRACE) traceLine(S, a); }
  if (!pureView) exec(S, action);
} catch (err) {
  console.error(`✗ ${err.message}`);
  console.error('（动作未入档，状态未变）当前状态：');
  try { console.log(render(S)); } catch { /* 状态本身异常时保持纯报错 */ }
  process.exit(1);
}
if (!noRecord) {
  data.actions.push(action);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
if (action === 'help') console.log(HELP);
else if (action === 'deck') console.log(renderDeck(S));
else if (action === 'lib') console.log(renderLib(S));
else if (action === 'relics') console.log(renderRelics(S));
else if (action === 'terms') console.log(renderTerms(S));
else console.log(render(S));
