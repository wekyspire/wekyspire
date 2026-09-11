// floorEnemyGenerator：按楼层难度预算生成遭遇编成（run 层，确定性）。
// 体系（2026-09 难度制，权威设计见 battle_gameplay/ENEMY_GENERATION.md）：
//   1. 楼层难度 D(floor)：开局几层陡升（教学单挑 → 双敌），此后每 2 层 +1 稳定爬升；
//      Boss 层（11/22/33/44）走独立的 Boss 难度表；
//   2. 每个敌人带难度元数据 { base, min, max, floorMin, floorMax }（content/enemies.js）：
//      实例难度 d ∈ [min,max]、楼层 ∈ [floorMin,floorMax] 才可生成——机制老旧或数值
//      漂移超出设计包络的敌人自然退役，不会出现「44 层超级史莱姆」；
//      另有 unique 标志（每场至多一只，如怨灵——成对出现会叠死输出轴）；
//   3. 属性加成**只由实例难度计算**（HP 倍率 + 攻击面板加成），楼层不再直接缩放：
//      高层变难靠「更难的敌人 + 更大的编成」表达，而不是线性吹大杂鱼面板；
//   4. 战斗模板（主题编成）：固定结构（如「史莱姆战 = 1 史莱姆 + 1 其他」）+ 楼层区间。
//      模板按「难度区间能覆盖 D」筛选后随机取用——编成强度稳定可控；
//   5. 预算分配：编成内实例难度之和 ≈ D（贪心：全员 min 起步，余量逐点随机抬到 max，
//      抬满仍不足则按最大可达收场——「接近层总和」的容差语义）。
// 确定性：编成与缩放全部由 deriveBattleSeed(run.seed, floor) 派生 rng 驱动，
// 同 seed 同 floor 恒定（回放/测试可复现）。

import { createRng } from '../state/rng.js';
import { allEnemies, getEnemyDefinition } from '../enemies/registry.js';
import { deriveBattleSeed, isBossFloor, FLOORS_PER_CHAPTER, TOTAL_FLOORS } from './runFlow.js';

// ---- 楼层难度曲线（调平衡只动这里）----
// 「开始几层较陡，后面稳定爬升」：
//   1-10（章1）：2 → 4 → 5 → 6 … 7（教学 → 双敌陡升，章末收平等着打 Boss）；
//   12-21（章2）：9 → 13；23-32（章3）：13 → 17；34-43（章4）：17 → 21（每 2 层 +1）。
// Boss 层难度按章取值（单只吃满预算，体型由难度缩放承载）。
// 章1 第 6 层压到 6（而非 7）：精英日挪到第 6 层后按 D 缩放会把雪狼吹到 126 血，
// 降一档让首精英保持 98 血的调定强度（试玩反馈：首个 Boss 前压力过高）。
const CHAPTER_START = [1, 12, 23, 34];            // 各章普通层起点
const CHAPTER_BASE = [2, 9, 13, 17];              // 各章起始难度
const CHAPTER1_CURVE = [2, 4, 5, 6, 6, 6, 7, 7, 7, 7]; // 章1 表驱动（陡升段，章末收平）
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

// ---- 实例难度 → 属性加成（全局唯一缩放口）----
// 难度单位 ≈ 「一步」：每 +1 难度 ≈ HP +40%、攻击约每 2 难 +1；d = anchor 即白板。
// 锚点两套（ENEMY_GENERATION.md）：普通敌人的基准数值按 d=2 授权（anchor 2）；
// 精英的基准数值按自身 base 难度授权（anchor = base，如雪狼 70 血 = 难5 白板），
// 否则全局公式会把高基准精英吹成团本 Boss。攻击加成慢于 HP：玩家 HP 也在长。
export function difficultyScaling(d, anchor = 2) {
  return {
    hpMult: Math.max(1, 1 + 0.4 * (d - anchor)),
    attackBonus: Math.max(0, Math.floor((d - anchor) / 2)),
  };
}

/** 就地按实例难度缩放一只已创建的敌人（锚点按敌种取：精英用 base，普通用 2）。 */
function scaleUnit(unit, d, anchor = 2) {
  const { hpMult, attackBonus } = difficultyScaling(d, anchor);
  unit.maxHp = Math.max(1, Math.round(unit.maxHp * hpMult));
  unit.hp = unit.maxHp;
  if (attackBonus > 0) unit.attack += attackBonus;
  return unit;
}

// ---- 战斗模板（主题编成）----
// slots：{ fixed?: defId }——fixed 为钉死位，其余为通配位（从当层可用池随机取）。
// 模板适用条件：楼层 ∈ [minFloor,maxFloor]，且「min 难度和 ≤ D」（买得起）；
// 优先取「max 难度和 ≥ D」（够得着）的模板，没有则取 max 和最大者（贴线收场）。
const TEMPLATES = [
  { id: 'tutorial', name: '教学单挑', minFloor: 1, maxFloor: 1, slots: [{ fixed: 'slime' }] },
  { id: 'slimeWar', name: '史莱姆战', minFloor: 2, maxFloor: 10, slots: [{ fixed: 'slime' }, {}] },
  { id: 'duo', name: '双人组', minFloor: 2, maxFloor: 24, slots: [{}, {}] },
  // —— 第一章主题编成（2026-09，设计卡 battle_gameplay/ENEMIES_1.md §7）——
  // 节奏型：用搭配逼出排序/防御时机的决策（快攻在这些场次收益偏高，故只留两套）
  // 2026-09-11 用户试玩后削：原「爆囊×2 + 石茧×2」四敌同时施压（两只石茧苏醒后每回合 20+ 伤
  // 叠爆囊死亡反伤）堪比精英，删掉一只石茧 → 三敌；难度份额改由前三槽分摊。
  { id: 'chainBlast', name: '连环爆', minFloor: 6, maxFloor: 10, slots: [{ fixed: 'blastPod' }, { fixed: 'blastPod' }, { fixed: 'stoneCocoon' }] },
  { id: 'twinClock', name: '钟摆双塔', minFloor: 5, maxFloor: 10, slots: [{ fixed: 'pufferToad' }, { fixed: 'pufferToad' }] },
  // 苦战型：给「慢慢磨」的牌组留位置——攻击弱、不成长、血巨厚，考的是稳挡 + 稳定输出节奏
  { id: 'reef', name: '礁石滩', minFloor: 6, maxFloor: 10, slots: [{ fixed: 'rockSnail' }, { fixed: 'rockSnail' }] },
  { id: 'mudFlat', name: '淤泥滩', minFloor: 4, maxFloor: 10, slots: [{ fixed: 'rockSnail' }, { fixed: 'slime' }, { fixed: 'slime' }] },
  { id: 'slimeTide', name: '史莱姆潮', minFloor: 12, maxFloor: 14, slots: [{ fixed: 'bigSlime' }, { fixed: 'slime' }] },
  { id: 'shadowAmbush', name: '影袭', minFloor: 12, maxFloor: 30, slots: [{ fixed: 'shadowblade' }, {}] },
  { id: 'trio', name: '三人众', minFloor: 12, maxFloor: 43, slots: [{}, {}, {}] },
  { id: 'shellLine', name: '龟甲阵', minFloor: 23, maxFloor: 43, slots: [{ fixed: 'rockshell' }, {}] },
  { id: 'colossus', name: '巨像', minFloor: 23, maxFloor: 43, slots: [{ fixed: 'gargoyle' }, {}] },
  // 精英怪房（elite: true——只在精英层启用，见 isEliteFloor）：1-2 敌，
  // 恒含一只高难精英（elite 槽从当层精英池按份额取材），余量可带一名杂鱼随从
  { id: 'eliteSolo', name: '精英独战', minFloor: 4, maxFloor: 43, elite: true, slots: [{ elite: true }] },
  { id: 'elitePair', name: '精英押队', minFloor: 4, maxFloor: 43, elite: true, slots: [{ elite: true }, {}] },
];
const BOSS_ID = 'pyro'; // Boss 只经 boss 分支出场，永不进通配池

// 精英层排期（确定性，好记好测）：每章第 6、9 层（6/9、17/20、28/31、39/42）。
// 2026-09 试玩后从 5/8 后挪：开局多一层普通战铺垫，再碰精英。
// 该章尚无精英内容时（精英池为空）自动回落普通编成——后续章节加精英零生成器改动。
export const isEliteFloor = (floor) =>
  floor % FLOORS_PER_CHAPTER === 6 || floor % FLOORS_PER_CHAPTER === 9;

// 当层可用敌人（通配池 / 精英池）：楼层区间命中 + 非 Boss + 精英标志匹配；
// difficulty 缺失视为不可生成（防御）。
function eligiblePool(floor, elite = false) {
  return allEnemies().filter(def =>
    def.id !== BOSS_ID
    && Boolean(def.difficulty?.elite) === elite
    && eligibleAtFloor(def, floor));
}

function eligibleAtFloor(def, floor) {
  const d = def.difficulty;
  return Boolean(d) && floor >= d.floorMin && floor <= d.floorMax;
}

// 槽位取材池：钉死位 = 该敌人自身；精英槽 = 当层精英池；通配位 = 当层普通池
function slotPool(slot, floor) {
  if (slot.fixed) return [getEnemyDefinition(slot.fixed)];
  return eligiblePool(floor, slot.elite === true);
}

// 模板在指定层的难度可达区间 [minSum, maxSum]：各槽取材池的 min 最小值 /
// max 最大值（钉死位不满足楼层区间、任一池为空 → 模板不可用，返回 null）。
function templateRange(tpl, floor) {
  let min = 0, max = 0;
  for (const slot of tpl.slots) {
    const pool = slotPool(slot, floor);
    if (pool.length === 0 || (slot.fixed && !eligibleAtFloor(pool[0], floor))) return null;
    min += Math.min(...pool.map(x => x.difficulty.min));
    max += Math.max(...pool.map(x => x.difficulty.max));
  }
  return { min, max };
}

/**
 * 生成一层遭遇：返回**可序列化描述符**数组（run.encounter 落此，存档/回放安全）：
 *   { defId, maxHp, attack, difficulty }——maxHp/attack 为按实例难度缩放后的终值。
 * Boss 层恒单 Boss（难度按章）；普通层走模板 + 预算分配。
 */
export function generateEncounter(run) {
  const floor = Math.min(Math.max(1, run.floor), TOTAL_FLOORS);
  const rng = createRng(deriveBattleSeed(run.seed, floor) ^ 0x5EED); // 与旧 encounter 派生错开
  if (isBossFloor(floor)) {
    const chapter = floor / FLOORS_PER_CHAPTER - 1;
    const bossDef = getEnemyDefinition(BOSS_ID);
    const d = Math.min(BOSS_DIFFICULTY[chapter], bossDef.difficulty.max);
    return [descriptorOf(BOSS_ID, d)];
  }

  const D = floorDifficulty(floor);
  // 精英层排期：该层是精英层且本章有精英内容时，只从精英房模板取材
  const eliteDay = isEliteFloor(floor) && eligiblePool(floor, true).length > 0;
  const candidates = TEMPLATES
    .map(tpl => ({ tpl, range: templateRange(tpl, floor) }))
    .filter(x => x.range
      && Boolean(x.tpl.elite) === eliteDay
      && floor >= x.tpl.minFloor && floor <= x.tpl.maxFloor && x.range.min <= D);
  if (candidates.length === 0) throw new Error(`楼层 ${floor} 无可用战斗模板（难度 D=${D}）`);
  const bracket = candidates.filter(x => x.range.max >= D);
  const picked = rng.pick(bracket.length > 0 ? bracket : candidates).tpl;

  // 份额分配（先定份额、再按份额选敌）：各槽难度份额从槽下界起步，余量逐点随机
  // 抬升（槽界 = 钉死位自身区间 / 通配位取当层池面区间）。先分后选保证贴模板时
  // Σ 恒等于 D——先选后分的话，随机抽到弱敌（如双史莱姆）会把可达上限压到 D 以下。
  const bounds = picked.slots.map(slot => (slot.fixed
    ? { ...getEnemyDefinition(slot.fixed).difficulty, fixed: slot.fixed }
    : (() => {
      const poolOfSlot = slotPool(slot, floor);
      return {
        min: Math.min(...poolOfSlot.map(x => x.difficulty.min)),
        max: Math.max(...poolOfSlot.map(x => x.difficulty.max)),
        fixed: null,
      };
    })()));
  const shares = bounds.map(b => b.min);
  let leftover = D - shares.reduce((n, s) => n + s, 0);
  while (leftover > 0) {
    const raisable = bounds
      .map((b, i) => (shares[i] < b.max ? i : -1))
      .filter(i => i >= 0);
    if (raisable.length === 0) break;   // 贴线收场：抬满仍不足（模板上限 < D）
    shares[rng.pick(raisable)] += 1;
    leftover -= 1;
  }

  // 选敌落位：份额落在哪个敌人的难度区间就选谁（区间内均匀随机；池区间有
  // 空隙时兜底取钳位距离最近者，份额钳回其区间）。
  // unique 敌人（如怨灵：虚弱不衰减，成对出现会焊死输出轴）每场至多一只：
  // 已被前面槽位占用的 unique 不再进池。过滤只影响选材不影响份额分配，
  // 极端情况下份额被迫钳回较窄区间、Σd 偏离 D 一两点——落在「接近层总和」容差内。
  const used = new Set();
  const slots = bounds.map((b, i) => {
    if (b.fixed) { used.add(b.fixed); return { defId: b.fixed, d: shares[i] }; }
    const full = slotPool(picked.slots[i], floor);
    const avail = full.filter(x => !(x.unique && used.has(x.id)));
    const poolOfSlot = avail.length > 0 ? avail : full; // 防御：过滤后为空则放宽
    const t = shares[i];
    let cands = poolOfSlot.filter(x => x.difficulty.min <= t && t <= x.difficulty.max);
    if (cands.length === 0) {
      cands = [poolOfSlot.reduce((best, x) => {
        const dist = Math.abs(Math.min(Math.max(t, x.difficulty.min), x.difficulty.max) - t);
        const bestDist = Math.abs(Math.min(Math.max(t, best.difficulty.min), best.difficulty.max) - t);
        return dist < bestDist ? x : best;
      })];
    }
    const def = rng.pick(cands);
    used.add(def.id);
    const d = Math.min(Math.max(t, def.difficulty.min), def.difficulty.max);
    return { defId: def.id, d };
  });
  const out = slots.map(s => descriptorOf(s.defId, s.d));
  // 石茧群（用户 2026-09-11）：同层第二只起**延迟一回合苏醒**且难度更低（苏醒越晚越弱）。
  // 否则多只同拍苏醒＝每回合 20+ 伤，是第 1 章最容易低估的死局。
  const cocoons = out.map((s, i) => (s.defId === 'stoneCocoon' ? i : -1)).filter(i => i >= 0);
  if (cocoons.length > 1) {
    const def = getEnemyDefinition('stoneCocoon');
    for (const i of cocoons.slice(1)) {
      // 难度降一档但不低于该敌人的难度下界（契约：实例难度必须落在 def 的 [min,max] 内）；
      // 下界已到 min 时，削弱体现在「延迟苏醒 + 苏醒时少叠一层力量」上。
      const d = Math.max(def.difficulty.min, out[i].difficulty - 1);
      out[i] = descriptorOf('stoneCocoon', d, { wakeDelay: 2, wakeStrength: 1 });
    }
  }
  return out;
}

/** 描述符 = defId + 实例难度 + 缩放终值（锚点：精英按 base，普通按 2）。extra 供变体参数。 */
function descriptorOf(defId, difficulty, extra = {}) {
  const def = getEnemyDefinition(defId);
  const unit = def.createUnit();
  scaleUnit(unit, difficulty, def.difficulty.elite ? def.difficulty.base : 2);
  return { defId, maxHp: unit.maxHp, attack: unit.attack, difficulty, ...extra };
}

/** 描述符/裸 id → 敌人实例（战斗装配用；裸 id 兼容测试直塞 ['slime'] 的旧写法）。 */
export function spawnEnemy(entry) {
  if (typeof entry === 'string') return getEnemyDefinition(entry).createUnit();
  const unit = getEnemyDefinition(entry.defId).createUnit();
  unit.maxHp = entry.maxHp ?? unit.maxHp;
  unit.hp = unit.maxHp;
  if (entry.attack != null) unit.attack = entry.attack;
  if (entry.wakeDelay != null) unit.wakeDelay = entry.wakeDelay;       // 石茧等：苏醒回合参数
  if (entry.wakeStrength != null) unit.wakeStrength = entry.wakeStrength;
  return unit;
}
