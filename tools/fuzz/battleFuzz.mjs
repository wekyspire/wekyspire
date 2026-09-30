// 随机战斗自对弈 fuzz（测试体系层 1+2，node 侧纯结算——无渲染无动画等待）。
//
// 用法：
//   node tools/fuzz/battleFuzz.mjs [--games 30] [--floors 8] [--seed 1000] [--min-coverage 0.6]
//
// 设计（2026-09-29 与用户定稿）：
//   · 内容（卡牌数值/敌人/遗物）频繁改——不测内容，测**系统级不变量**：
//     每步结算后断言 zone 无重复/总数不缩水（丢卡必炸）、hp/资源边界、终局合法。
//   · 零预言（无 oracle）：随机战斗没有正确答案，靠不变量性质兜底。
//   · 覆盖统计（层 2）：聚合全部局后断言技能打出覆盖率 ≥ 阈值——防「随机从未
//     碰到某条路径」的静默盲区；不达标列出从未打出的卡。
//   · 失败可复现：打印 seed + 局号，同 seed 重跑即同一随机流。
//
// 退出码：全绿 0；不变量炸/覆盖不达标 1。

import '../../src/core/content/index.js'; // 触发登记（技能/敌人/遗物/效果/事件）
import { RunDriver } from '../../src/core/run/runDriver.js';
import { allSkills } from '../../src/core/skills/registry.js';
import { allEnemies } from '../../src/core/enemies/registry.js';
import { canUseSkill } from '../../src/core/skills/helpers.js';

// ---------- 参数 ----------
const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] != null ? Number(args[i + 1]) : dflt;
};
const GAMES = arg('games', 30);
const FLOORS = arg('floors', 8);
const SEED_BASE = arg('seed', 1000);
const MIN_COVERAGE = arg('min-coverage', 0.6);

// 可入随机卡组的技能池：有费用字段即玩家卡（敌人技能/内部件不带 cost）。
const SKILL_POOL = allSkills().filter(s => s?.cost != null).map(s => s.id);
if (SKILL_POOL.length < 10) {
  console.error(`技能池异常：仅 ${SKILL_POOL.length} 张（登记未生效？）`);
  process.exit(1);
}

// 简单 RNG（mulberry32）：卡组随机用独立流，不与 core 的战斗 rng 抢种子语义。
function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 随机卡组：14 张，每张至多重复 2 次（保底分布广）。 */
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

// ---------- 不变量断言（每步结算后跑） ----------
const ZONE_KEYS = ['hand', 'deck', 'burnt', 'pending'];

function checkInvariants(battle, baseline, ctx) {
  const bs = battle.ctx.battleState;
  // ① zone 并集无重复 uniqueID（一张卡同时在两区 = 结构性 zone bug）
  const seen = new Set();
  for (const z of ZONE_KEYS) {
    for (const c of bs.zones[z]) {
      if (seen.has(c.uniqueID)) {
        throw new Error(`卡 ${c.defId}(${c.uniqueID}) 同时存在于多个 zone`);
      }
      seen.add(c.uniqueID);
    }
  }
  // ② 卡守恒（下界）：四区总数 ≥ 基线（造牌只增；无机制允许凭空消失——
  //    消耗进 burnt、转化换 id 不减量）。缩水 = 丢卡。
  if (seen.size < baseline) {
    throw new Error(`卡守恒破坏：四区 ${seen.size} < 基线 ${baseline}（丢卡）`);
  }
  // ③ 资源与生命边界
  const p = battle.ctx.player;
  if (!(p.hp >= 0 && p.hp <= p.maxHp)) throw new Error(`玩家 hp 越界：${p.hp}/${p.maxHp}`);
  if ((p.shield ?? 0) < 0) throw new Error(`护盾为负：${p.shield}`);
  if ((p.mana ?? 0) < 0 || (p.actionPoints ?? 0) < 0) {
    throw new Error(`资源为负：mana=${p.mana} ap=${p.actionPoints}`);
  }
  // ④ 敌人边界（死亡单位 hp 可为 0 或负溢出？——minHp 地板应保 ≥0）
  for (const e of bs.enemies) {
    if (e.hp < 0 || e.hp > e.maxHp) {
      throw new Error(`敌人 ${e.defId} hp 越界：${e.hp}/${e.maxHp}${e.isDead?.() ? '（已死）' : ''}`);
    }
  }
}

// ---------- 覆盖统计（层 2 聚合） ----------
const cov = {
  cardsPlayed: new Map(),   // defId -> 次数
  enemiesFought: new Map(), // defId -> 局数
  effectsSeen: new Map(),   // effectId -> 次数
  inputs: new Map(),        // input kind -> 次数
  turnsTotal: 0,
};

/** 战斗策略（每步被 RunDriver 调）：不变量夹断 + 简单 AI（贪心+怪招）。 */
function makePolicy(seed) {
  const rand = rng32(seed ^ 0xBEEF);
  return (battle) => {
    const bs = battle.ctx.battleState;
    checkInvariants(battle, battle.__fuzzBaseline, { turn: bs.turn });
    const hand = bs.zones.hand;
    const usable = hand.filter(s => canUseSkill(battle.ctx, s));
    const r = rand();
    if (usable.length === 0) return null;
    if (r < 0.15) return null;                    // 怪招①：攒牌直接过（滚出长战斗）
    if (r < 0.45) {                               // 怪招②：随机打（含"坏牌"）
      const pick = usable[Math.floor(rand() * usable.length)];
      cov.cardsPlayed.set(pick.defId, (cov.cardsPlayed.get(pick.defId) ?? 0) + 1);
      return pick;
    }
    // 主策略：优先 AP/费用付得起的攻击牌（伤害推进局），否则任意可用
    const attack = usable.find(s => {
      const d = s.def ?? null;
      return d?.damage != null || d?.id != null;
    });
    const pick = attack ?? usable[0];
    cov.cardsPlayed.set(pick.defId, (cov.cardsPlayed.get(pick.defId) ?? 0) + 1);
    return pick;
  };
}

/** 结算期输入应答：随机选（不是前 N——分支覆盖更广）。 */
function randomInput(seed) {
  const rand = rng32(seed ^ 0xF00D);
  return (request = {}) => {
    cov.inputs.set(request.kind ?? '?', (cov.inputs.get(request.kind ?? '?') ?? 0) + 1);
    if (request.kind === 'confirm') return rand() < 0.5;
    const cands = request.candidates ?? [];
    const count = Math.min(request.count ?? 1, cands.length);
    const pool = [...cands];
    const out = [];
    for (let i = 0; i < count && pool.length; i++) {
      out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0]);
    }
    return out;
  };
}

// ---------- 主循环 ----------
function countZones(battle) {
  const z = battle.ctx.battleState.zones;
  return ZONE_KEYS.reduce((n, k) => n + z[k].length, 0);
}

function scanEffects(battle) {
  const bs = battle.ctx.battleState;
  for (const u of [battle.ctx.player, ...bs.enemies, ...bs.allies]) {
    for (const e of u.effects ?? []) {
      cov.effectsSeen.set(e.effectId ?? '?', (cov.effectsSeen.get(e.effectId ?? '?') ?? 0) + 1);
    }
  }
}

let failures = 0;
const t0 = Date.now();
for (let g = 0; g < GAMES; g++) {
  const seed = SEED_BASE + g;
  const rand = rng32(seed);
  try {
    const d = new RunDriver({
      seed, totalFloors: FLOORS,
      deck: randomDeck(rand),
      battlePolicy: makePolicy(seed),
      onInput: randomInput(seed),
    });
    d.start();
    // 基线在首场战斗开打后立一次（开局抽牌已完成）
    let steps = 0;
    while (!d.isFinished() && d.floor <= FLOORS && steps++ < 400) {
      d.step();
      if (d.lastBattle && d.lastBattle.__fuzzBaseline == null) {
        d.lastBattle.__fuzzBaseline = countZones(d.lastBattle);
      }
      if (d.lastBattle) {
        cov.turnsTotal = Math.max(cov.turnsTotal, d.lastBattle.ctx.battleState.turn.count);
        for (const e of d.run.encounter ?? []) cov.enemiesFought.set(e, (cov.enemiesFought.get(e) ?? 0) + 1);
        if (d.run.gameStage !== 'battle') scanEffects(d.lastBattle);
      }
    }
  } catch (err) {
    failures++;
    console.error(`\n[FAIL] 局 #${g} seed=${seed}：${err.message}`);
    console.error(`  复现：node tools/fuzz/battleFuzz.mjs --games 1 --seed ${seed}`);
    if (failures >= 3) { console.error('连续失败过多，提前终止'); break; }
  }
}

// ---------- 覆盖报告（层 2） ----------
const played = [...cov.cardsPlayed.keys()];
const coverage = played.length / SKILL_POOL.length;
const neverPlayed = SKILL_POOL.filter(id => !cov.cardsPlayed.has(id));
const ms = Date.now() - t0;
console.log(`\n===== fuzz 汇总（${GAMES} 局 / 每局 ≤${FLOORS} 层 / ${ms}ms）=====`);
console.log(`技能池 ${SKILL_POOL.length}，打出过 ${played.length}（覆盖率 ${(coverage * 100).toFixed(1)}%）`);
console.log(`遭遇敌种 ${cov.enemiesFought.size} / 池 ${allEnemies().length}；效果种 ${cov.effectsSeen.size}；输入类 ${[...cov.inputs.keys()].join(',') || '无'}；最长单局回合 ${cov.turnsTotal}`);
if (neverPlayed.length) {
  console.log(`从未打出（${neverPlayed.length}）：${neverPlayed.slice(0, 20).join(' ')}${neverPlayed.length > 20 ? ' …' : ''}`);
}
if (failures > 0) { console.error(`\n结果：FAIL（${failures}/${GAMES} 局炸不变量）`); process.exit(1); }
if (coverage < MIN_COVERAGE) {
  console.error(`\n结果：FAIL（覆盖率 ${(coverage * 100).toFixed(1)}% < 阈值 ${MIN_COVERAGE * 100}%——提高 --games 或调整 AI 策略）`);
  process.exit(1);
}
console.log('结果：PASS');
