// floorEnemyGenerator：按楼层难度挑选遭遇编成（run 层，确定性）。
// 难度制 v2（2026-09-24 用户定稿：**取消单敌人难度缩放**）：
//   1. 每只敌人只有一组**固定数值**（设计卡写多少，玩家就看到多少——数值语义不再发散）；
//      敌人元数据只剩 `{ base, floorMin, floorMax }` + 可选 `unique / elite`：
//      base = 固定难度（该敌的战力档位）、楼层区间 = 允许出没层、unique 每场至多一只、
//      elite 挡在普通通配池外只经精英房出场；
//   2. 楼层难度 D(floor) 仍是一层的战斗总预算（曲线见下）；Boss 层走独立难度表；
//   3. 模板（主题编成）= 固定结构 + 楼层区间 + **编成难度**（各槽 base 之和）；
//   4. 生成 = 在「本层允许、且编成难度落在 [D−2, D+2] 漂移窗内」的模板里，
//      按「编成难度距 D 越近越常出」加权随机取一，槽位再按敌人 base 就近取材；
//   5. 后处理不变：同种错拍 / 石茧群延迟苏醒 / 音叉群错拍（见文件尾）。
// 确定性：编成选取全部由 deriveBattleSeed(run.seed, floor) 派生 rng 驱动，
// 同 seed 同 floor 恒定（回放/测试可复现）。

import { createRng } from '../state/rng.js';
import { allEnemies, getEnemyDefinition } from '../enemies/registry.js';
import { deriveBattleSeed, isBossFloor, FLOORS_PER_CHAPTER, TOTAL_FLOORS } from './runFlow.js';

// ---- 楼层难度曲线（调平衡只动这里）----
// 章1 表驱动（用户 2026-09-24 上调后重新配平），章 2–4 每 2 层 +1；
// Boss 层难度按章取值。D 是一层战斗的总预算，与编成难度对齐（漂移 ±2）。
const CHAPTER_START = [1, 12, 23, 34];            // 各章普通层起点
const CHAPTER_BASE = [2, 9, 13, 17];              // 各章起始难度
const CHAPTER1_CURVE = [2, 4, 5, 6, 6, 6, 7, 7, 7, 7]; // 章1 表驱动（v2 离散难度：与怪物 base 1–3 匹配）
const BOSS_DIFFICULTY = [8, 11, 14, 18];

/** 楼层难度（Boss 层返回 Boss 难度；越界钳到 1..44）。 */
export function floorDifficulty(floor) {
  const f = Math.min(Math.max(1, Math.floor(floor)), TOTAL_FLOORS);
  if (isBossFloor(f)) return BOSS_DIFFICULTY[f / FLOORS_PER_CHAPTER - 1];
  if (f <= 10) return CHAPTER1_CURVE[f - 1];
  const ch = CHAPTER_START.findIndex((s, i) =>
    f >= s && (i === CHAPTER_START.length - 1 || f < CHAPTER_START[i + 1]));
  return CHAPTER_BASE[ch] + Math.floor((f - CHAPTER_START[ch]) / 2);
}

// ---- 战斗模板（主题编成）----
// slots：{ fixed?: defId }——fixed 为钉死位，其余为通配位（从当层可用池就近取材）。
// 模板适用条件：楼层 ∈ [minFloor,maxFloor]，且编成难度落在 [D−2, D+2] 漂移窗内。
// 编成难度 = 各槽位难度之和：钉死位取该敌 base；通配位取当层池的「代表难度」
// （池面 base 的众数低值——通配位是变量，模板难度只作锚，实际编成由取材时的
// 就近原则贴线）。
const TEMPLATES = [
  { id: 'tutorial', name: '教学单挑', minFloor: 1, maxFloor: 1, slots: [{ fixed: 'slime' }] },
  { id: 'slimeWar', name: '史莱姆战', minFloor: 2, maxFloor: 10, slots: [{ fixed: 'slime' }, {}] },
  { id: 'duo', name: '双人组', minFloor: 2, maxFloor: 24, slots: [{}, {}] },
  // —— 第一章主题编成（设计卡 battle_gameplay/ENEMIES_1.md §4）——
  { id: 'chainBlast', name: '连环爆', minFloor: 6, maxFloor: 10, slots: [{ fixed: 'blastPod' }, { fixed: 'blastPod' }, { fixed: 'stoneCocoon' }] },
  { id: 'twinClock', name: '钟摆双塔', minFloor: 5, maxFloor: 10, slots: [{ fixed: 'pufferToad' }, { fixed: 'pufferToad' }] },
  { id: 'reef', name: '礁石滩', minFloor: 6, maxFloor: 10, slots: [{ fixed: 'rockSnail' }, { fixed: 'rockSnail' }] },
  { id: 'mudFlat', name: '淤泥滩', minFloor: 4, maxFloor: 10, slots: [{ fixed: 'rockSnail' }, { fixed: 'slime' }, { fixed: 'slime' }] },
  // —— 章1「塔基爆发」编队（2026-09-14 用户设计；wiki 魔物爆发：F/E 级杂鱼起步）——
  { id: 'infestation', name: '虫群风暴', minFloor: 2, maxFloor: 10, slots: [{ fixed: 'buzzbug' }, { fixed: 'buzzbug' }, { fixed: 'buzzbug' }, {}] },
  { id: 'thornPatch', name: '草丛', minFloor: 3, maxFloor: 10, slots: [{ fixed: 'thornWeed' }, { fixed: 'thornWeed' }, {}] },
  { id: 'staticField', name: '静电原野', minFloor: 4, maxFloor: 12, slots: [{ fixed: 'staticPuff' }, { fixed: 'staticPuff' }] },
  { id: 'digSite', name: '掘地场', minFloor: 5, maxFloor: 12, slots: [{ fixed: 'diggerMole' }, { fixed: 'diggerMole' }, {}] },
  { id: 'beetleTide', name: '甲虫潮', minFloor: 6, maxFloor: 14, slots: [{ fixed: 'carrionBeetle' }, { fixed: 'carrionBeetle' }, { fixed: 'carrionBeetle' }, {}] },
  { id: 'resonance', name: '共振带', minFloor: 8, maxFloor: 14, slots: [{ fixed: 'staticPuff' }, { fixed: 'staticPuff' }, { fixed: 'diggerMole' }] },
  { id: 'rotGarden', name: '腐蔓园', minFloor: 6, maxFloor: 12, slots: [{ fixed: 'mossBall' }, { fixed: 'thornWeed' }, { fixed: 'buzzbug' }] },
  { id: 'slimeTide', name: '史莱姆潮', minFloor: 12, maxFloor: 14, slots: [{ fixed: 'bigSlime' }, { fixed: 'slime' }] },
  { id: 'shadowAmbush', name: '影袭', minFloor: 12, maxFloor: 30, slots: [{ fixed: 'shadowblade' }, {}] },
  // —— 第二~四章主题编队（2026-09-13 总策划批次）——
  { id: 'palaceGuard', name: '宫廷卫队', minFloor: 12, maxFloor: 21, slots: [{ fixed: 'palaceGuard' }, {}] },
  { id: 'honorGuard', name: '仪仗队', minFloor: 14, maxFloor: 21, slots: [{ fixed: 'herald' }, { fixed: 'palaceGuard' }, {}] },
  { id: 'drunkHall', name: '醉鬼客厅', minFloor: 23, maxFloor: 30, slots: [{ fixed: 'tippler' }, { fixed: 'tippler' }] },
  { id: 'archiveVault', name: '禁书库', minFloor: 34, maxFloor: 43, slots: [{ fixed: 'tomeWarden' }, { fixed: 'bookWorm' }, { fixed: 'bookWorm' }] },
  { id: 'trio', name: '三人众', minFloor: 12, maxFloor: 43, slots: [{}, {}, {}] },
  // 血牛互斥：钉死位已有一只龟/像时，通配位排除其余血牛（双龟/龟+像是马拉松病灶）
  { id: 'shellLine', name: '龟甲阵', minFloor: 23, maxFloor: 32, slots: [{ fixed: 'rockshell' }, { exclude: ['rockshell', 'gargoyle', 'tomeWarden'] }] },
  { id: 'colossus', name: '巨像', minFloor: 23, maxFloor: 32, slots: [{ fixed: 'gargoyle' }, { exclude: ['rockshell', 'gargoyle', 'tomeWarden'] }] },
  // —— 第四章特色战斗（族A 玻璃连炮 / 族B 巨兽渐强 / 族C 机制反制 + 机制四件套）——
  { id: 'guardQuad', name: '典礼方阵', minFloor: 36, maxFloor: 43, slots: [{ fixed: 'wardStatue' }, { fixed: 'wardStatue' }, { fixed: 'wardStatue' }, { fixed: 'wardStatue' }] },
  { id: 'guardPhalanx', name: '受戒典礼', minFloor: 36, maxFloor: 43, slots: [{ fixed: 'wardStatue' }, { fixed: 'wardStatue' }, { fixed: 'wardStatue' }, { fixed: 'wardStatue' }, { fixed: 'shieldBearer' }] },
  { id: 'forkDuet', name: '音叉双鸣', minFloor: 36, maxFloor: 43, slots: [{ fixed: 'tuningFork' }, { fixed: 'tuningFork' }] },
  { id: 'candleSwarm', name: '烛火群', minFloor: 36, maxFloor: 43, slots: [{ fixed: 'candleSpirit' }, { fixed: 'candleSpirit' }, { fixed: 'candleSpirit' }] },
  { id: 'archiveTitan', name: '档案巨像', minFloor: 36, maxFloor: 43, slots: [{ fixed: 'archiveColossus' }] },
  { id: 'devourLair', name: '噬书巢穴', minFloor: 36, maxFloor: 43, slots: [{ fixed: 'bookDevourer' }, {}] },
  { id: 'inkTide', name: '墨海涨潮', minFloor: 36, maxFloor: 43, slots: [{ fixed: 'inkTideCore' }, { fixed: 'bookWorm' }] },
  { id: 'mirrorHall', name: '镜厅', minFloor: 37, maxFloor: 43, slots: [{ fixed: 'oracleOrb' }, { fixed: 'galeGolem' }] },
  { id: 'scriptorium', name: '禁阅室', minFloor: 36, maxFloor: 43, slots: [{ fixed: 'censorScribe' }] },
  { id: 'ledgerOffice', name: '账房', minFloor: 36, maxFloor: 43, slots: [{ fixed: 'ledgerImp' }] },
  { id: 'monitorPost', name: '监察岗', minFloor: 36, maxFloor: 43, slots: [{ fixed: 'acadMonitor' }, {}] },
  { id: 'consecration', name: '受戒仪仗', minFloor: 37, maxFloor: 43, slots: [{ fixed: 'riteAltar' }, { fixed: 'galeGolem' }, { fixed: 'shieldBearer' }] },
  { id: 'phalanxWall', name: '方阵阻击', minFloor: 36, maxFloor: 43, slots: [{ fixed: 'repeaterBallista' }, { fixed: 'shieldBearer' }, {}] },
  { id: 'binderVault', name: '装订库', minFloor: 36, maxFloor: 43, slots: [{ fixed: 'binderPython' }, { fixed: 'tomeWarden' }] },
  // 精英怪房（elite: true——只在精英层启用，见 isEliteFloor）
  { id: 'eliteSolo', name: '精英独战', minFloor: 4, maxFloor: 43, elite: true, slots: [{ elite: true }] },
  { id: 'elitePair', name: '精英押队', minFloor: 4, maxFloor: 43, elite: true, slots: [{ elite: true }, {}] },
];

// Boss 表（Boss 只经 boss 分支出场，永不进通配池）：按楼层定 Boss 身份。
// 值为数组 = 候选池（rng.pick 抽一），值为字符串 = 固定 Boss。
// 11 层火主题三候选 / 22 层三题 / 33 层四考 / 44 层终塔神兵躯壳——
// 设计与缩放口径见 ENEMY_GENERATION.md §4.3。
const BOSS_OF_FLOOR = Object.freeze({
  11: ['pyro', 'kardas', 'mefm1'],
  22: ['knightCommander', 'candleWarden', 'bishopMarchand'],
  33: ['gluttonLord', 'intactDrone', 'greenhouseQueen', 'essenceEater'],
  44: ['divineShell'],
});
const BOSS_IDS = new Set(Object.values(BOSS_OF_FLOOR).flat());

// 精英层排期（确定性，好记好测）：每章第 6、9 层（6/9、17/20、28/31、39/42）。
// 该章尚无精英内容时（精英池为空）自动回落普通编成。
export const isEliteFloor = (floor) =>
  floor % FLOORS_PER_CHAPTER === 6 || floor % FLOORS_PER_CHAPTER === 9;

// 当层可用敌人（通配池 / 精英池）：楼层区间命中 + 非 Boss + 精英标志匹配。
// **按 id 排序**（2026-09-24 定）：取材池的顺序决定 rng.pick 的落点，排序后
// 生成流与内容文件组织方式彻底解耦（拆分/挪动不改遭遇分布）。
// difficulty 缺失视为不可生成（防御）。
function eligiblePool(floor, elite = false) {
  return allEnemies().filter(def =>
    !BOSS_IDS.has(def.id)
    && Boolean(def.difficulty?.elite) === elite
    && eligibleAtFloor(def, floor)).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function eligibleAtFloor(def, floor) {
  const d = def.difficulty;
  return Boolean(d) && floor >= d.floorMin && floor <= d.floorMax;
}

// 槽位取材池：钉死位 = 该敌人自身；精英槽 = 当层精英池；通配位 = 当层普通池。
// slot.exclude：通配位排除指定敌 id（血牛互斥——双龟/龟+像是马拉松病灶）。
function slotPool(slot, floor) {
  if (slot.fixed) return [getEnemyDefinition(slot.fixed)];
  const pool = eligiblePool(floor, slot.elite === true);
  return slot.exclude?.length ? pool.filter(def => !slot.exclude.includes(def.id)) : pool;
}

// 槽位代表难度：钉死位取自身 base；通配位取当层池 base 的「众数低值」
// （池面常见档——通配位是变量，模板难度只作锚，实际由取材时的就近原则贴线）。
function slotBase(slot, floor) {
  const pool = slotPool(slot, floor);
  if (pool.length === 0) return null;
  if (slot.fixed) return pool[0].difficulty.base;
  // 池面 base 的最小值作代表（通配位倾向取低，与「先凑基础再抬升」的取材直觉一致）
  return Math.min(...pool.map(x => x.difficulty.base));
}

// 模板编成难度 = 各槽代表难度之和。任一槽无可用取材 → 模板不可用（返回 null）。
function templateCost(tpl, floor) {
  let sum = 0;
  for (const slot of tpl.slots) {
    const b = slotBase(slot, floor);
    if (b == null) return null;
    sum += b;
  }
  return sum;
}

// 漂移窗：编成难度允许偏离楼层预算 ±2。
const DRIFT = 2;

/**
 * 生成一层遭遇：返回**可序列化描述符**数组（run.encounter 落此，存档/回放安全）：
 *   { defId, maxHp, attack, difficulty }——maxHp/attack 为该敌固定数值（不再缩放），
 *   difficulty 仅为展示/调试（该敌 base）。Boss 层恒单 Boss；普通层走模板 + 漂移加权。
 */
export function generateEncounter(run) {
  const floor = Math.min(Math.max(1, run.floor), TOTAL_FLOORS);
  const rng = createRng(deriveBattleSeed(run.seed, floor) ^ 0x5EED);
  if (isBossFloor(floor)) {
    const chapter = floor / FLOORS_PER_CHAPTER - 1;
    const entry = BOSS_OF_FLOOR[floor] ?? 'pyro';
    const bossId = Array.isArray(entry) ? rng.pick(entry) : entry;
    const bossDef = getEnemyDefinition(bossId);
    // v2：Boss 不再缩放——难度仅作展示/调试（取当章 Boss 难度，封顶 def.base 以兼容
    // 候选池里 base 不齐的旧定义；数值恒用授权面板）。
    const d = Math.min(BOSS_DIFFICULTY[chapter], bossDef.difficulty.base);
    return [descriptorOf(bossId, d)];
  }

  const D = floorDifficulty(floor);
  const eliteDay = isEliteFloor(floor) && eligiblePool(floor, true).length > 0;

  // 候选模板：楼层命中 + 精英标志匹配 + 编成难度落在漂移窗内。
  const candidates = TEMPLATES
    .map(tpl => ({ tpl, cost: templateCost(tpl, floor) }))
    .filter(x => x.cost != null
      && Boolean(x.tpl.elite) === eliteDay
      && floor >= x.tpl.minFloor && floor <= x.tpl.maxFloor
      && Math.abs(x.cost - D) <= DRIFT);
  if (candidates.length === 0) {
    // 兜底：漂移窗内无货时取编成难度最近者（贴线收场，不报错——用户上调曲线后
    // 允许某些楼层只有一两套模板可选）。
    const fallback = TEMPLATES
      .map(tpl => ({ tpl, cost: templateCost(tpl, floor) }))
      .filter(x => x.cost != null
        && Boolean(x.tpl.elite) === eliteDay
        && floor >= x.tpl.minFloor && floor <= x.tpl.maxFloor)
      .sort((a, b) => Math.abs(a.cost - D) - Math.abs(b.cost - D));
    if (fallback.length === 0) throw new Error(`楼层 ${floor} 无可用战斗模板（难度 D=${D}）`);
    candidates.push(fallback[0]);
  }

  // 加权随机：编成难度距 D 越近权重越高（差 0 → 4，差 1 → 2，差 2 → 1）。
  const weighted = [];
  for (const c of candidates) {
    const weight = 4 - 2 * Math.abs(c.cost - D);
    for (let i = 0; i < weight; i++) weighted.push(c);
  }
  const picked = rng.pick(weighted).tpl;

  // 槽位取材：钉死位直接用；通配位从池里按 base 就近取材（优先贴槽位代表难度），
  // unique 敌人已被前面槽位占用则不再进池。
  const used = new Set();
  const slots = picked.slots.map((slot) => {
    if (slot.fixed) { used.add(slot.fixed); return { defId: slot.fixed, d: getEnemyDefinition(slot.fixed).difficulty.base }; }
    const full = slotPool(slot, floor);
    const avail = full.filter(x => !(x.unique && used.has(x.id)));
    const poolOfSlot = avail.length > 0 ? avail : full;
    // 就近取材：池里谁的 base 离槽位代表难度最近取谁（并列随机）
    const target = slotBase(slot, floor);
    const nearest = Math.min(...poolOfSlot.map(x => Math.abs(x.difficulty.base - target)));
    const cands = poolOfSlot.filter(x => Math.abs(x.difficulty.base - target) === nearest);
    const def = rng.pick(cands);
    used.add(def.id);
    return { defId: def.id, d: def.difficulty.base };
  });

  const out = slots.map(s => descriptorOf(s.defId, s.d));

  // ---- 编成后处理（与 v1 相同）----
  // 石茧群：同层第二只起延迟一回合苏醒且难度更低（苏醒越晚越弱）
  const cocoons = out.map((s, i) => (s.defId === 'stoneCocoon' ? i : -1)).filter(i => i >= 0);
  if (cocoons.length > 1) {
    for (const i of cocoons.slice(1)) {
      out[i] = descriptorOf('stoneCocoon', out[i].difficulty, { wakeDelay: 2, wakeStrength: 1 });
    }
  }
  // 同种错拍：同 defId 多只按 0/1 交错起始节拍（例外：典礼方阵刻意齐拍、音叉/石茧自带错拍）
  const SYNC_EXEMPT = new Set(['wardStatue', 'tuningFork', 'stoneCocoon']);
  const nthOf = new Map();
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    if (SYNC_EXEMPT.has(s.defId) || s.wakeDelay != null) continue;
    const n = (nthOf.get(s.defId) ?? 0) + 1;
    nthOf.set(s.defId, n);
    if (n % 2 === 0) out[i] = { ...s, actionIndex: 1 };
  }
  // 音叉群：第二只起 wakeDelay=1（两台大振恒错拍）
  const forks = out.map((s, i) => (s.defId === 'tuningFork' ? i : -1)).filter(i => i >= 0);
  if (forks.length > 1) {
    for (const i of forks.slice(1)) {
      out[i] = descriptorOf('tuningFork', out[i].difficulty, { wakeDelay: 1 });
    }
  }
  return out;
}

/** 描述符 = defId + 固定数值（v2：不再缩放，unit 即用授权面板）。extra 供变体参数。 */
function descriptorOf(defId, difficulty, extra = {}) {
  const def = getEnemyDefinition(defId);
  const unit = def.createUnit();
  return { defId, maxHp: unit.maxHp, attack: unit.attack, difficulty, ...extra };
}

/** 描述符/裸 id → 敌人实例（战斗装配用；裸 id 兼容测试直塞 ['slime'] 的旧写法）。 */
export function spawnEnemy(entry) {
  if (typeof entry === 'string') return getEnemyDefinition(entry).createUnit();
  const unit = getEnemyDefinition(entry.defId).createUnit();
  unit.maxHp = entry.maxHp ?? unit.maxHp;
  unit.hp = unit.maxHp;
  if (entry.attack != null) unit.attack = entry.attack;
  if (entry.wakeDelay != null) unit.wakeDelay = entry.wakeDelay;
  if (entry.wakeStrength != null) unit.wakeStrength = entry.wakeStrength;
  if (entry.actionIndex != null) unit.actionIndex = entry.actionIndex;
  return unit;
}
