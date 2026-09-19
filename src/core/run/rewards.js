import { allSkills, getSkillDefinition } from '../skills/registry.js';
import { createSkillRuntime } from '../state/skillRuntime.js';

// 战后奖励（RUN_DESIGN §1 + 2026-09 卡包化）：
//   金币固定入账 → 玩家选一个**卡包**（基础包恒开，其余维度需该维度灵脉等级 ≥1）
//   → 包内技能 3 选 1（或跳过）。
//
// 等阶门禁按**该体系自己的等级**（专精昂贵是设计意图，用户 2026-09 定调）：
//   灵脉包看 leino[维度]，基础包看隐藏的 player.bodyLevel（跳过进阶时 +1）。
// 抽取概率 = **按体系等级的绝对分布表**（PACK_TIER_TABLE，用户 2026-09-14 定）：
//   高等级仍保留低阶概率（升级后奖励继续有提升空间），3 级起小概率直出 S 卡。
// 奖励事件通道（minTier）：Boss/精英战后、老虎机大奖等「纯奖励」场景把分布按等级
//   下限钳制（B → 至少按 2 级分布，A → 至少按 3 级），保证总能开出高阶卡。
// 通用包（汲取/魏启罐/激发/杂技）**不可直接选择**：以 COMMON_INJECT 概率混入任意卡包，
// 并有保底计数（每 pity 次开包必出一次）；「保证其价值」= 池内存在 C 以上卡时剔除 D。
// Z（诅咒）恒不入池；**S 默认随包直出**（2026-09 定：能否 spawn 由卡牌注册表的
// canSpawnAsReward 字段声明——斩链等转化专属卡即用该字段排除自己，开包侧不再持有
// 白名单硬编码）；canSpawnAsReward=false 的衍生牌不入池。
// 另：S 不可经训练场/营地晋升获得（promotion.js 晋升目标排除 S）——S 的稀缺性
// 靠「只出不升」保住，升 S 的特殊事件通道后续再开。
// 木/空灵脉内容待实装：其卡包在池子为空时自动隐藏（见 availablePacks）。

export const REWARDS_PLACEHOLDER = {
  moneyPerBattle: 10,
  skillChoiceCount: 3,
};

export const TIER_RANK = { D: 0, C: 1, B: 2, A: 3, S: 4 };

// ---- 等阶分布表（用户 2026-09-14 定）：按体系等级的绝对概率（%）----
// 取代旧的「相对上限偏移权重」（本阶20/低一阶55/低两阶25、D 吸收余量 → 上限 C 时
// D 占 80%——D 池太薄时玩家反复见到同样的卡，是前中期乏味的数字根源）。
// 高等级保留低阶概率：3 级以上每升一级 A/S 份额继续上涨，卡包奖励始终有提升空间。
// 注：1 级行用户口述 30/40/20（合计 90%），缺额归 D（80→40→20→10→5 的减半节奏自洽）。
export const PACK_TIER_TABLE = Object.freeze([
  Object.freeze({ D: 80, C: 20 }),                       // lv0
  Object.freeze({ D: 40, C: 40, B: 20 }),                // lv1
  Object.freeze({ D: 20, C: 30, B: 30, A: 20 }),         // lv2
  Object.freeze({ D: 10, C: 20, B: 30, A: 30, S: 10 }),  // lv3
  Object.freeze({ D: 5, C: 10, B: 20, A: 45, S: 20 }),   // lv4+（钳制）
]);

// 奖励事件的等阶下限 → 等级下限（minTier 通道）：Boss/精英战后、老虎机大奖把分布
// 钳到至少该等级（B → 2 级表 20/30/30/20；A/S → 3 级表含 10% S）。
export const MIN_TIER_LEVEL = Object.freeze({ C: 0, B: 2, A: 3, S: 3 });

// 等级 → 可见等阶上限（池过滤用）：3 级起 S 可见。
export function tierCapOfLevel(lv) {
  if (lv >= 3) return 'S';
  if (lv >= 2) return 'A';
  if (lv >= 1) return 'B';
  return 'C';
}

// 等级 → 分布表行（4 级以上钳制在末档）
export function packTierTable(lv) {
  return PACK_TIER_TABLE[Math.max(0, Math.min(lv, PACK_TIER_TABLE.length - 1))];
}

// 某等阶在某等级下的概率份额（%）；池内不存在该等阶时调用方自行归一
export function tierShare(tier, lv) {
  return packTierTable(lv)[tier] ?? 0;
}

// 奖励通道的有效等级：体系等级与 minTier 下限取高
export function effectivePackLevel(run, packId, minTier = null) {
  return Math.max(packLevel(run, packId), MIN_TIER_LEVEL[minTier] ?? 0);
}

// ---- 卡包（维度）定义：id 与 player.leino 的键同名 ----
export const PACKS = Object.freeze({
  body: Object.freeze({ id: 'body', name: '基础', desc: '体修卡与通用卡的混合池（通用浓度高），恒可用' }),
  fire: Object.freeze({ id: 'fire', name: '火灵脉', desc: '爆发与燃烧' }),
  wood: Object.freeze({ id: 'wood', name: '木灵脉', desc: '恢复与中毒' }),
  air: Object.freeze({ id: 'air', name: '空灵脉', desc: '闪避与咏唱' }),
  common: Object.freeze({ id: 'common', name: '通用', desc: '跨体系资源与功能卡（随机混入各卡包）' }),
});

// 通用卡注入：概率 + 保底计数（run.commonPity 累计未注入次数，达 pity 必注入）
// 2026-09-13 用户定 30%→45%：R9 三连「新内容 0 观测」的曝光率加码（门禁过深，
// 通用件是跨体系构筑的胶水，先让玩家看得见）。
export const COMMON_INJECT = Object.freeze({ chance: 0.45, pity: 4 });
// 基础包专用注入浓度（2026-09-14 用户定「大幅提升」，体修包更名基础卡包的另一半）：
// 主注入 90%、保底 2 次开包，命中后独立掷 secondChance 再换第二张（不同位、不重复）。
// 期望每包 ≈1.35 张通用卡（浓度 ~45%）——通用卡是强力单卡但不能成体系（C 位）：
// 灵脉玩家开基础包收益升，体修玩家的体修候选被稀释到平均 1.65 张/包，前期成型
// 压力增加（蓝量/恢复/获取途径三刀的第三刀）。
export const BODY_PACK_INJECT = Object.freeze({ chance: 0.9, pity: 2, secondChance: 0.5 });

// 卡定义归属的卡包：显式 pack 字段优先（通用灰卡标 'common'），否则按 type 归维度
export function packOf(def) {
  if (def?.pack) return def.pack;
  if (def?.type === 'fire') return 'fire';
  if (def?.type === 'wood') return 'wood';
  if (def?.type === 'air') return 'air';
  return 'body';
}

// 卡包等级：体修看隐藏的 player.bodyLevel（跳过进阶 +1），灵脉看 leino[维度]
export function packLevel(run, packId) {
  if (packId === 'body') {
    // 体修门禁 = max(体修等阶, 最高灵脉等级)（2026-09-13 第 10 轮裁决定调）：
    // 此前只看隐藏的 bodyLevel——不跳进阶的玩家永远 0 级，太极/相刀等体修 B/A
    // 对灵脉路线**永久不可见**（R9 三连 0 观测 + R10 六组再 0 观测的实锤病灶）。
    // 灵脉修为反哺体术：跳进阶仍是体修内容的快车道（+3 血/删卡机会不稀释），
    // 但灵脉大成者不该被体修高阶卡硬锁在门外。
    const bestLeino = Math.max(0, ...Object.values(run?.player?.leino ?? {}));
    return Math.max(run?.player?.bodyLevel ?? 0, bestLeino);
  }
  return run?.player?.leino?.[packId] ?? 0;
}

// 某卡包当前可见的最高等阶（按该体系自己的等级；S 默认入池，canSpawnAsReward 声明例外）
export function maxRewardTier(run, packId = 'body') {
  return tierCapOfLevel(packLevel(run, packId));
}

// 深入卡门禁（设计稿：精英能力解锁子体系卡池，**深入卡仅在该子体系精英能力到手后**
// 进入奖励池）。卡 def 以 `deep: '<子体系>'` 标注；大师能力不开门禁（门禁只看精英）。
export const DEEP_GATES = Object.freeze({
  burst: Object.freeze(['pyroBlast', 'fireWard']), // 爆炎深入：回响烈焰/背水一战/放手一搏
  fist: Object.freeze(['boxer']),                  // 拳深入：万变拳/假动作/拳压…
  blade: Object.freeze(['bladeMaster']),           // 刀深入：练刀/开刃/斩灭…
  renew: Object.freeze(['renew']),                 // 生息深入：世界树之心
  blight: Object.freeze(['blightLord']),           // 瘴毒深入：瘟神附体
  gale: Object.freeze(['galeFury']),               // 御风深入：天闪
  wander: Object.freeze(['wanderClouds']),         // 逍遥深入：风行者
});
export function deepGateOpen(run, def) {
  if (!def?.deep) return true;
  return (DEEP_GATES[def.deep] ?? []).some(id => run?.player?.abilities?.includes(id));
}

// 单包卡池：包归属 + 该体系等阶门禁 + 排除 Z 与 canSpawnAsReward=false + 深入卡门禁。
// S 与普通卡同判：默认可直出，例外由注册表 canSpawnAsReward 声明（不再有白名单）。
// capTier 可覆写门禁（通用注入跟随所开卡包的上限）。
export function packCardPool(run, packId = 'body', capTier = null) {
  const cap = TIER_RANK[capTier ?? maxRewardTier(run, packId)];
  return allSkills().filter(def =>
    packOf(def) === packId
    && def.canSpawnAsReward !== false && def.tier !== 'Z'
    && (TIER_RANK[def.tier] ?? Infinity) <= cap
    && deepGateOpen(run, def));
}

// 通用注入池：跟随所开卡包门禁。门禁达 B 以上时剔除 D 级通用卡（后期 D 卡是废牌，
// 「出现即有价值」）；门禁仍为 C 时保留 D（纯化/魏启罐在前期是好牌）。
export function commonPool(run, capTier) {
  const cap = capTier ?? 'C';
  const pool = packCardPool(run, 'common', cap);
  if (TIER_RANK[cap] >= TIER_RANK.B) {
    const valued = pool.filter(def => TIER_RANK[def.tier] >= TIER_RANK.C);
    return valued.length ? valued : pool;
  }
  return pool;
}

// ---- 等阶分布抽取：先按 PACK_TIER_TABLE 掷等阶档，再档内选卡 ----
// 档间比例恒等于分布表（在**池内实际存在**的等阶上归一——某等阶池空/被抽空时，
// 其份额自然摊给其余档）；档内缺省均匀，affinityOf 可选给档内选卡加权（子体系亲和）。
// 走 run rng，确定性。供战后开包与老虎机卡包奖项共用。
export function rollTiered(run, pool, count, lv, affinityOf = null) {
  const byTier = new Map(); // tier -> 剩余卡
  for (const def of pool) {
    if (!byTier.has(def.tier)) byTier.set(def.tier, []);
    byTier.get(def.tier).push(def);
  }
  const picks = [];
  while (picks.length < count && byTier.size) {
    const table = packTierTable(lv);
    const entries = [...byTier.entries()]
      .filter(([tier, defs]) => defs.length > 0 && (table[tier] ?? 0) > 0);
    if (!entries.length) break; // 剩余等阶在表中均无权重（防御性兜底）
    let total = 0;
    for (const [tier] of entries) total += table[tier];
    let r = run.rng.next() * total;
    let tier = entries[entries.length - 1][0];
    for (const [t] of entries) { r -= table[t]; if (r <= 0) { tier = t; break; } }
    const group = byTier.get(tier);
    let i;
    if (affinityOf) { // 档内亲和加权取一张
      let sum = 0;
      const ws = group.map(d => { const aw = Math.max(0, affinityOf(d)); sum += aw; return aw; });
      let rr = run.rng.next() * sum;
      i = ws.findIndex(aw => { rr -= aw; return rr <= 0; });
      if (i < 0) i = group.length - 1;
    } else {
      i = run.rng.int(0, group.length - 1); // 档内均匀取一张
    }
    picks.push(group.splice(i, 1)[0]);
    if (!group.length) byTier.delete(tier); // 档抽空 → 整档移出，后续按剩余档归一
  }
  return picks;
}

// 通用加权不放回抽取（每卡独立权重 weightOf）：训练房「多包并集」等池内等级不一的
// 场景用——先算每卡份额（等阶表概率 / 该组卡数）再走加权。走 run rng，确定性。
function rollWeighted(run, defs, weightOf, count, affinityOf = null) {
  const classes = new Map(); // 档位权重 -> 该档剩余卡
  for (const def of defs) {
    const w = weightOf(def);
    if (w <= 0) continue;
    if (!classes.has(w)) classes.set(w, []);
    classes.get(w).push(def);
  }
  const picks = [];
  while (picks.length < count && classes.size) {
    let total = 0;
    for (const w of classes.keys()) total += w;
    let r = run.rng.next() * total;
    let chosenW = null;
    for (const w of classes.keys()) {
      r -= w;
      if (r <= 0) { chosenW = w; break; }
    }
    if (chosenW == null) chosenW = [...classes.keys()].at(-1);
    const group = classes.get(chosenW);
    let i;
    if (affinityOf) { // 档内亲和加权取一张
      let sum = 0;
      const ws = group.map(d => { const aw = Math.max(0, affinityOf(d)); sum += aw; return aw; });
      let rr = run.rng.next() * sum;
      i = ws.findIndex(aw => { rr -= aw; return rr <= 0; });
      if (i < 0) i = group.length - 1;
    } else {
      i = run.rng.int(0, group.length - 1); // 档内均匀取一张
    }
    picks.push(group.splice(i, 1)[0]);
    if (!group.length) classes.delete(chosenW); // 档抽空 → 整档移出，后续按剩余档归一
  }
  return picks;
}

// ---- 子体系亲和加权（2026-09-13 用户定，「中期子体系大成」定向探索）----
// 开包/训练抽卡时，与玩家牌组**同 series** 的卡出率提升：每张同 series 持卡 +35%，
// 至多计 4 张（峰值 ×2.4——档内 5 卡时目标卡从 20% 提到约 37%，定向但不碾压多样性）。
// 只作用于体系包抽取的档内选卡；**通用注入不受影响**（injectCommon 不走 rollWeighted）；
// 无 series 的卡恒 ×1。确定性：亲和计数只读牌组，抽取仍走 run.rng。
export const SERIES_AFFINITY = Object.freeze({ perCard: 0.35, maxCount: 4 });

/** 牌组的 series 分布（亲和计数器，一次开包算一份共用）。 */
function seriesCounts(run) {
  const counts = new Map();
  for (const rt of run?.player?.deck ?? []) {
    const s = getSkillDefinition(rt.defId)?.series;
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return counts;
}

/** 单卡亲和权重：1 + perCard × min(同 series 持卡数, maxCount)。 */
export function seriesAffinityWeight(run, def, counts = null) {
  const series = def?.series;
  if (!series) return 1;
  const c = counts ?? seriesCounts(run);
  return 1 + SERIES_AFFINITY.perCard * Math.min(c.get(series) ?? 0, SERIES_AFFINITY.maxCount);
}

// 可开卡包：基础包恒开；灵脉需 leino ≥ 1 且已有可出内容（木/空待实装自动隐藏）。
// 通用包不在列表中——它只以注入形式出现。
export function availablePacks(run) {
  const out = [PACKS.body];
  for (const id of ['fire', 'wood', 'air']) {
    if ((run?.player?.leino?.[id] ?? 0) >= 1 && packCardPool(run, id).length > 0) out.push(PACKS[id]);
  }
  return out;
}

// 全量可出卡池（所有可开卡包并集；兼容旧调用与「整池」类断言）
export function spawnableCardPool(run = null) {
  const seen = new Set();
  const out = [];
  for (const pack of availablePacks(run)) {
    for (const def of packCardPool(run, pack.id)) {
      if (seen.has(def.id)) continue;
      seen.add(def.id);
      out.push(def);
    }
  }
  return out;
}

// 包内抽 3 选 1 候选（走 run rng，确定性；不重复；等阶分布见 PACK_TIER_TABLE；
// 档内按子体系亲和加权，见 SERIES_AFFINITY）。opts.minTier = 奖励事件通道
// （Boss/精英战后把分布钳到至少对应等级，纯奖励事件总能开出高阶卡）。
export function rollSkillChoices(run, packId = 'body', count = REWARDS_PLACEHOLDER.skillChoiceCount, { minTier = null } = {}) {
  const lv = effectivePackLevel(run, packId, minTier);
  const counts = seriesCounts(run);
  return rollTiered(run, packCardPool(run, packId, tierCapOfLevel(lv)), count, lv,
    def => seriesAffinityWeight(run, def, counts))
    .map(def => def.id);
}

// 进入 reward 阶段：金币自动入账 + 列出可选卡包；只有一个包时自动开包（少一步点击）。
// opts.minTier：奖励事件等级下限（Boss → 'A'、精英 → 'B'，由 runFlow 按遭遇判定）。
export function spawnRewards(run, { minTier = null } = {}) {
  run.player.money += REWARDS_PLACEHOLDER.moneyPerBattle;
  const packs = availablePacks(run).map(p => p.id);
  run.rewards = {
    money: REWARDS_PLACEHOLDER.moneyPerBattle,
    packs,                 // 可选卡包 id 列表
    packId: null,          // 已选卡包（选后不可改）
    minTier,               // 奖励事件等级下限（开包时生效；null = 常规分布）
    skillChoices: [],      // 开包后的 3 选 1 候选
    chosenSkill: undefined, // undefined = 未抉择；null = 跳过；defId = 已领取
  };
  if (packs.length === 1) chooseRewardPack(run, packs[0]);
  return run;
}

// 通用注入（三选一共享）：按概率/保底把候选替换为通用卡，返回 { injected, slot }。
// capTier = 本次抽取所用的等阶门禁（跟随所开卡包/最高已解锁卡包）。
// packId = 所开卡包：'body'（基础包）走 BODY_PACK_INJECT 高浓度参数且命中后可再
// 换第二张（2026-09-14）；其余包/训练抓牌（不传）维持 COMMON_INJECT 单张口径。
export function injectCommon(run, choices, capTier, packId = null) {
  const spec = packId === 'body' ? BODY_PACK_INJECT : COMMON_INJECT;
  const pity = run.commonPity ?? 0;
  const inject = pity + 1 >= spec.pity || run.rng.next() < spec.chance;
  if (!inject) {
    run.commonPity = pity + 1;
    return { injected: false, slot: -1 };
  }
  run.commonPity = 0;
  const usedSlots = [];
  const injectOne = () => {
    const pool = commonPool(run, capTier).filter(def => !choices.includes(def.id));
    if (!pool.length) return -1;
    const free = choices.map((_, i) => i).filter(i => !usedSlots.includes(i));
    if (!free.length) return -1;
    const slot = free[run.rng.int(0, free.length - 1)];
    choices[slot] = pool[run.rng.int(0, pool.length - 1)].id;
    usedSlots.push(slot);
    return slot;
  };
  const slot = injectOne();
  const injected = slot >= 0;
  // 基础包：命中后独立掷第二张（进一步稀释体修候选；通用池不足则静默单张）
  if (injected && spec.secondChance && run.rng.next() < spec.secondChance) injectOne();
  return { injected, slot };
}

// 开包：选定卡包 → 抽出包内 3 选 1 候选（奖励事件通道经 rw.minTier 钳制分布）→
// 按概率/保底混入一张通用卡（通用池上限跟随同一钳制后的等级）。
export function chooseRewardPack(run, packId) {
  const rw = run.rewards;
  if (!rw) throw new Error('奖励不存在');
  if (rw.chosenSkill !== undefined) throw new Error('奖励已领取');
  if (rw.packId) throw new Error(`卡包已选择：${rw.packId}`);
  if (!rw.packs.includes(packId)) throw new Error(`卡包不可选：${packId}`);
  rw.packId = packId;

  const lv = effectivePackLevel(run, packId, rw.minTier ?? null);
  const choices = rollSkillChoices(run, packId, REWARDS_PLACEHOLDER.skillChoiceCount, { minTier: rw.minTier ?? null });
  const { injected, slot } = injectCommon(run, choices, tierCapOfLevel(lv), packId);
  rw.commonInjected = injected;
  rw.commonSlot = slot;
  rw.skillChoices = choices;
  return run;
}

// 训练房抓牌：从**所有已解锁卡包的并集**抽 3（各卡按所属包的等级分布取份额——
// 并集池内各包等级不一，用「等阶表概率 / 该（包×等阶）组卡数」的每卡份额走通用
// 加权，多包共存时档间比例近似各自的表），并同样注入通用卡。
// 训练房抓牌候选 = 战后三选一 +1（2026-09-13 用户定：曝光率加码——训练房是
// 「已解锁卡包并集」的定向窗口，候选多一张让新内容更容易被看见；战后开包不变）。
export function rollTrainingChoices(run, count = REWARDS_PLACEHOLDER.skillChoiceCount + 1) {
  const counts = seriesCounts(run);
  const pool = spawnableCardPool(run);
  // 每（包×等阶）组的卡数：组内均分该等阶的表概率份额
  const groupCount = new Map();
  for (const def of pool) {
    const key = `${packOf(def)}|${def.tier}`;
    groupCount.set(key, (groupCount.get(key) ?? 0) + 1);
  }
  const weightOf = def =>
    tierShare(def.tier, packLevel(run, packOf(def))) / (groupCount.get(`${packOf(def)}|${def.tier}`) || 1);
  const picks = rollWeighted(
    run, pool,
    weightOf,
    count,
    def => seriesAffinityWeight(run, def, counts), // 档内子体系亲和（与开包同口径）
  ).map(def => def.id); // 先取 id：注入会原地替换元素
  const caps = availablePacks(run).map(p => TIER_RANK[maxRewardTier(run, p.id)]);
  const capTier = Object.keys(TIER_RANK).find(t => TIER_RANK[t] === Math.max(...caps)) ?? 'C';
  injectCommon(run, picks, capTier); // 训练抓牌不展示通用角标，注入结果直接生效
  return picks;
}

// 抉择：从候选中领一张（defId）或跳过（null）
export function chooseSkillReward(run, defId = null) {
  const rw = run.rewards;
  if (!rw || rw.chosenSkill !== undefined) throw new Error('奖励不存在或已领取');
  if (defId !== null) {
    if (!rw.skillChoices.includes(defId)) throw new Error(`技能不在奖励候选中：${defId}`);
    run.player.deck.push(createSkillRuntime(defId));
  }
  rw.chosenSkill = defId;
  return run;
}

export function isRewardsClaimed(run) {
  return !run.rewards || run.rewards.chosenSkill !== undefined;
}
