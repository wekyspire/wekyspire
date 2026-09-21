// 存档制作器（dev 工具，不进构建产物）：把「声明式 spec」或「headless 会话现场」变成一个
// 合法存档 JSON，落到 tmp/saves/<名>.json——浏览器随后用
//     http://localhost:5177/?debug=1&save=<名>
// 一步跳到该状态，跑**真实前后端链路**复现/调试（不用再逐层打过去）。
//
// 用法：
//   node tools/saveForge.mjs --spec tmp/specs/t2.json          # 从 spec 文件（可带 --out 覆盖名字）
//   node tools/saveForge.mjs --out t2 --floor 2 --room campTraining --hp 40 --money 300 \
//        --leino fire=2 --add-card onePunch --relic greatSword --training 1
//   node tools/saveForge.mjs --from-session 我的会话 --out 现场1   # headless 玩到哪就存哪
//
// 为什么这样造档：**一切经 core 的真实构造函数与守卫**（createRun / grantRelic /
// refreshRunModifiers / 调试原语 ops.js），所以产出必然是"游戏自己会认可的状态"——
// 不会出现手写存档字段缺项（baseStats/relicUses/rngState…）导致的假 bug。
//
// spec 字段（全部可选，缺省 = 开局状态）：
//   { name, seed, floor, stage: 'prep'|'room'|'end', room, storyMode,
//     player: { hp, maxHp, mana, maxMana, actionPoints, maxActionPoints, money,
//               maxHandSize, trainingCount, ascensionCount, bodyLevel, relicSlots,
//               leino: { fire, wood, air, body } },
//     deck: [defId...], relics: [relicId...], abilities: [abilityId...],
//     encounter: [enemyId...], relicsEquip: true }

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import '../src/core/content/index.js'; // 内容登记（副作用 import，必须在造局之前）
import Player, { PLAYER_BASE_HP, PLAYER_BASE_AP } from '../src/core/state/player.js';
import { createSkillRuntime } from '../src/core/state/skillRuntime.js';
import { createRun, advanceFloor, generateEncounter } from '../src/core/run/runFlow.js';
import { BODY_STARTER_DECK } from '../src/core/content/bodySkills.js';
import { snapshotRun } from '../src/shell/saves.js';
import { hasSkill } from '../src/core/skills/registry.js';
import { hasRelic, getRelicDefinition } from '../src/core/relics/registry.js';
import { hasAbility } from '../src/core/abilities/registry.js';
import { hasEnemy } from '../src/core/enemies/registry.js';
import { equipRelic, refreshRunModifiers } from '../src/core/run/prep.js';
import * as ops from '../src/core/debug/ops.js';
import { freshState, exec, readSession } from './playSession.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'tmp', 'saves');

// ---------- 参数解析：--spec 文件 / 逐个 flag / --from-session ----------
// 玩家数值字段的友好别名（左 = 命令行写法，右 = player 上的字段名）
const NUM_ALIASES = {
  hp: 'hp', maxhp: 'maxHp', mana: 'mana', maxmana: 'maxMana',
  ap: 'maxActionPoints', maxap: 'maxActionPoints', actionpoints: 'actionPoints',
  money: 'money', hand: 'maxHandSize', maxhand: 'maxHandSize',
  training: 'trainingCount', ascension: 'ascensionCount', body: 'bodyLevel', slots: 'relicSlots',
};
// 结构字段（不落进 player）——白名单之外的一律报错（静默忽略参数是调试工具的大忌）
const STRUCT_FLAGS = new Set(['seed', 'floor', 'stage', 'room']);

function parseArgs(argv) {
  const out = { spec: null, from: null, out: null, flags: {}, deck: [], relics: [], abilities: [], encounter: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`参数 ${a} 缺值`);
      return v;
    };
    if (a === '--spec') out.spec = next();
    else if (a === '--from-session' || a === '--from') out.from = next();
    else if (a === '--out' || a === '-o') out.out = next();
    else if (a === '--add-card' || a === '--card') out.deck.push(next());
    else if (a === '--relic') out.relics.push(next());
    else if (a === '--ability') out.abilities.push(next());
    else if (a === '--enemy') out.encounter.push(next());
    else if (a === '--leino') {
      const [k, v] = String(next()).split('=');
      if (k === 'body') out.flags.body = Number(v);   // 体修不是灵脉维度（走 bodyLevel，见 ops.setLeinoLevel）
      else (out.flags.leino ??= {})[k] = Number(v);
    } else if (a === '--no-equip') out.flags.relicsEquip = false;
    else if (a.startsWith('--')) {
      const key = a.slice(2).toLowerCase().replace(/-/g, '');
      if (STRUCT_FLAGS.has(key)) out.flags[key] = next();
      else if (NUM_ALIASES[key]) out.flags[NUM_ALIASES[key]] = next();
      else throw new Error(`未知参数：${a}（可用：--floor --stage --room --hp --maxhp --money --mana --ap `
        + `--hand --training --ascension --body --slots --leino fire=2 --add-card --relic --ability --enemy --seed）`);
    } else throw new Error(`未知参数：${a}`);
  }
  return out;
}

function mergeSpec(args) {
  let spec = {};
  if (args.spec) {
    const file = path.isAbsolute(args.spec) ? args.spec : path.join(ROOT, args.spec);
    spec = JSON.parse(fs.readFileSync(file, 'utf-8'));
  }
  const f = args.flags;
  const player = { ...(spec.player ?? {}) };
  const numKeys = ['hp', 'maxHp', 'mana', 'maxMana', 'actionPoints', 'maxActionPoints',
    'money', 'maxHandSize', 'trainingCount', 'ascensionCount', 'bodyLevel', 'relicSlots'];
  for (const k of numKeys) if (f[k] != null) player[k] = Number(f[k]);
  if (f.leino) player.leino = { ...(player.leino ?? {}), ...f.leino };
  const room = f.room ?? spec.room ?? null;
  const out = {
    ...spec,
    name: args.out ?? spec.name ?? (args.from ? `from-${args.from}` : 'save'),
    seed: f.seed != null ? Number(f.seed) : spec.seed,
    floor: f.floor != null ? Number(f.floor) : spec.floor,
    stage: f.stage ?? spec.stage ?? (room ? 'room' : 'prep'),
    room,
    storyMode: spec.storyMode,
    player,
    deck: spec.deck ?? null,            // null = 用初始卡组（精确控制走 spec 文件）
    extraDeck: [...args.deck],          // --add-card：在基线（初始卡组/上面的 deck）之上追加
    relics: spec.relics ?? null,        // null = 用开局遗物（大剑）
    extraRelics: [...args.relics],      // --relic：追加
    abilities: [...(spec.abilities ?? []), ...args.abilities],
    encounter: [...(spec.encounter ?? []), ...args.encounter],
    relicsEquip: spec.relicsEquip !== false && f.relicsEquip !== 'false',
  };
  return out;
}

const need = (cond, msg) => { if (!cond) throw new Error(msg); };
const assertSkill = (id) => { need(hasSkill(id), `未注册的卡牌 id：${id}`); return id; };
const assertRelic = (id) => { need(hasRelic(id), `未注册的遗物 id：${id}`); return id; };
const assertAbility = (id) => { need(hasAbility(id), `未注册的能力 id：${id}`); return id; };
const assertEnemy = (id) => { need(hasEnemy(id), `未注册的敌人 id：${id}`); return id; };

// ---------- spec → 存档 ----------
function buildFromSpec(spec) {
  const notes = [];
  const seed = spec.seed ?? 20260919;
  const run = createRun({
    seed,
    player: new Player({ maxHp: PLAYER_BASE_HP, maxMana: 3, maxActionPoints: PLAYER_BASE_AP }),
  });
  run.storyMode = !!spec.storyMode;
  run.debugMode = true;   // 造出来的档一律是调试档（读档恢复 stage/room 现场）

  // 卡组（缺省 = 初始卡组；--add-card 追加在基线之上）
  const deckIds = [...(spec.deck ?? BODY_STARTER_DECK), ...(spec.extraDeck ?? [])];
  run.player.deck = deckIds.map(id => createSkillRuntime(assertSkill(id)));

  // 遗物：先清掉 createRunState 塞的开局遗物，再按 spec 发（缺省 = 大剑；--relic 追加）
  const relicIds = [...(spec.relics ?? ['greatSword']), ...(spec.extraRelics ?? [])];
  run.player.relics = [];
  run.player.equippedRelics = [];
  for (const id of relicIds) assertRelic(id);

  // 楼层：逐层 advanceFloor（遭遇/资源按 seed 确定性生成，与真实游玩同路）
  const floor = Math.max(1, Math.min(Number(spec.floor ?? 1), run.totalFloors));
  while (run.floor < floor) advanceFloor(run);

  // 玩家数值：一律走调试原语（与面板同一套守卫：上限类写 baseStats 再重算）。
  // 顺序铁律（2026-09-21 实踩修正）：**先 leino 后标量**——`leino.body` 是 `bodyLevel`
  // 的别名，两者都写时后处理者才算数；旧实现按对象键序走，spec 里同时写
  // `bodyLevel: 3` 与 `leino: { body: 0 }` 时后者会把体修等级静默打回 0（造出来的档
  // 看着像 3 级，实际 0 级）。数值冲突直接报错，不静默取一个（调试工具的大忌）。
  const player = spec.player ?? {};
  if (player.leino) {
    for (const [dim, lv] of Object.entries(player.leino)) {
      if (lv == null) continue;
      if (dim === 'body') {
        if (player.bodyLevel != null && Number(player.bodyLevel) !== Number(lv)) {
          throw new Error(`player.bodyLevel(${player.bodyLevel}) 与 player.leino.body(${lv}) 冲突`
            + '——两者是同一个字段（体修等级），只写其一');
        }
        ops.setPlayerField(run, 'bodyLevel', lv);   // 体修不是灵脉维度，落 bodyLevel
      } else {
        ops.setLeinoLevel(run, dim, lv);
      }
    }
  }
  // 上限类（max*）**先于**当前值处理：setPlayerField('hp') 会按当时的上限裁剪
  // （p.hp = min(hp, maxHp)）——spec 若 hp 与 maxHp 同写而 hp 先落地，就会被旧上限裁掉
  // （2026-09-21 实踩：写 hp:70 / maxHp:70 造出来的档是 65/70）。
  const scalarKeys = Object.keys(player).filter(k => k !== 'leino' && player[k] != null)
    .sort((a, b) => Number(b.startsWith('max')) - Number(a.startsWith('max')));
  for (const k of scalarKeys) ops.setPlayerField(run, k, player[k]);

  // 能力（走注册表校验；不触发授予流程）
  for (const id of (spec.abilities ?? [])) {
    assertAbility(id);
    if (!run.player.abilities.includes(id)) run.player.abilities.push(id);
  }

  // 遗物入包 + 装备（槽位不够的留在背包里并记一条 note）
  for (const id of relicIds) ops.grantRelicById(run, id);
  refreshRunModifiers(run);
  if (spec.relicsEquip !== false) {
    for (const id of relicIds) {
      const def = getRelicDefinition(id);
      if (def?.nonSlot) continue;
      try { equipRelic(run, id); } catch { notes.push(`遗物「${def?.name ?? id}」未能装备（槽位不足）`); }
    }
  }

  // 本层遭遇（可选覆盖；缺省用楼层自适应生成）
  if (spec.encounter?.length) {
    for (const id of spec.encounter) assertEnemy(id);
    run.encounter = [...spec.encounter];
  }

  // 阶段/房间：'room' 走 core 的进房初始化（商店掷货架等），其余归一为 prep（落到该层）
  const stage = spec.stage ?? (spec.room ? 'room' : 'prep');
  if (stage === 'room') {
    need(!!spec.room, 'stage=room 需要给 room 房型');
    ops.enterRoom(run, spec.room);
  } else {
    run.gameStage = stage === 'end' ? 'end' : 'prep';
    run.currentRoom = null;
    run.roomData = null;
    run.encounter = run.encounter ?? generateEncounter(run);
  }
  if (notes.length) console.log('注意：', notes.join('；'));
  return { run, notes };
}

// ---------- headless 会话 → 存档 ----------
// ⚠ 旧会话可能因内容变更（守卫/数值/新机制）在重放的某一步失败——那不是本工具的错，
// 但你多半仍想要「跑到断点为止」的现场。所以：**遇错即停 + 报警 + 用此刻状态造档**
// （继续往后重放毫无意义：时间线已经分叉，产出的档会撒谎）。
function buildFromSession(name) {
  const data = readSession(name);   // { seed, actions: [] }
  const S = freshState(data.seed);
  const actions = data.actions ?? [];
  let done = 0;
  for (const a of actions) {
    try { exec(S, a); done += 1; } catch (err) {
      console.warn(`重放到第 ${done + 1}/${actions.length} 步失败（${a}）：${err?.message ?? err}`);
      console.warn('→ 用失败前的状态造档（后续动作不再重放）');
      break;
    }
  }
  const run = S.run;
  run.debugMode = true;   // 转出来的档按调试档处理（现场可能是房内/进阶中）
  console.log(`会话「${name}」重放 ${done}/${actions.length} 个动作 → 第 ${run.floor} 层 / ${run.gameStage}`
    + `${run.currentRoom ? ' / ' + run.currentRoom : ''}；第 ${done} 步：${S.lastOutcome || '（无）'}`);
  return { run, notes: [] };
}

// ---------- 主流程 ----------
try {
  const args = parseArgs(process.argv.slice(2));
  // 无参 = 打印用法（把文件头的注释块当 help：单一事实源，别另写一份文档）
  const hasInput = args.from || args.spec || args.out
    || Object.keys(args.flags).length || args.deck.length || args.relics.length
    || args.abilities.length || args.encounter.length;
  if (!hasInput) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf-8')
      .split('\n').filter(l => l.startsWith('//')).join('\n'));
    process.exit(0);
  }
  const spec = args.from ? null : mergeSpec(args);
  const { run } = args.from ? buildFromSession(args.from) : buildFromSpec(spec);
  const save = snapshotRun(run);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const name = (args.out ?? spec?.name ?? `from-${args.from}`).replace(/[^A-Za-z0-9_-]/g, '_');
  const file = path.join(OUT_DIR, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(save, null, 1));

  const equipped = run.player.equippedRelics.length;
  console.log(`已写入 ${path.relative(ROOT, file)}`);
  console.log(`  第 ${run.floor}/${run.totalFloors} 层 · ${run.gameStage}${run.currentRoom ? ' · ' + run.currentRoom : ''}`
    + ` · 卡组 ${run.player.deck.length} 张 · 遗物 ${run.player.relics.length} 件（装备 ${equipped}）`
    + ` · HP ${run.player.hp}/${run.player.maxHp} · 金 ${run.player.money}`);
  console.log(`浏览器起跑： http://localhost:5177/?debug=1&save=${name}`);
} catch (err) {
  console.error('造档失败：', err?.message ?? err);
  process.exit(1);
}
