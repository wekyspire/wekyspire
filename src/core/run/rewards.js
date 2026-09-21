import { allSkills, getSkillDefinition } from '../skills/registry.js';
import { createSkillRuntime } from '../state/skillRuntime.js';

// 战后奖励（RUN_DESIGN §1 + 2026-09 卡包化 + 2026-09-21 大调 D4）：
//   金币固定入账 → 玩家选一个**卡包**（基础包恒开，其余维度需该维度灵脉等级 ≥1）
//   → 包内技能 3 选 1（或跳过）。
//
// 2026-09-21 大调 D4（见 battle_gameplay/REBALANCE_2026_09.md）：
//   · **灵脉等级与卡包概率脱钩**——分布不再按体系等级取行，改按**来源通道**：
//     normal（普通战后/训练抓牌）= C/B 两档；elite（精英/Boss 战后、老虎机大奖）
//     = B/A 两档。A 直出只挂精英/Boss，其余只能靠训练场升（升级门禁仍看体系等级，
//     见 promotion.js——「概率脱钩」只管开包，不管升级）。
//   · **S 永不入包**（只走事件投放）；D 阶已移除（TIER_RANK 无 D）。
//   · 通用包注入池构成与非常规卡同口径（跟随同一通道上限，不再按门禁剔除）。
// Z（诅咒）恒不入池；canSpawnAsReward=false 的衍生牌不入池。
// 木/空灵脉内容待实装：其卡包在池子为空时自动隐藏（见 availablePacks）。

export const REWARDS_PLACEHOLDER = {
  moneyPerBattle: 10,
  skillChoiceCount: 3,
};

export const TIER_RANK = { C: 1, B: 2, A: 3, S: 4 };

// ---- 等阶分布表（2026-09-21 大调 D4，暂定值待实测调参）：按来源通道 ----
// normal：普通战后开包 + 训练房抓牌；elite：精英/Boss 战后 + 老虎机卡包大奖。
export const REWARD_TIER_TABLE = Object.freeze({
  normal: Object.freeze({ C: 65, B: 35 }),
  elite: Object.freeze({ B: 65, A: 35 }),
});
// 通道 → 池子等阶上限（S 永不入包，不列）
export const REWARD_TIER_CAP = Object.freeze({ normal: 'B', elite: 'A' });

// 通道的分布表/上限（非法通道回落 normal）
export function rewardTierTable(channel = 'normal') {
  return REWARD_TIER_TABLE[channel] ?? REWARD_TIER_TABLE.normal;
}
export function rewardTierCap(channel = 'normal') {
  return REWARD_TIER_CAP[channel] ?? REWARD_TIER_CAP.normal;
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
    // 体修门禁 = 隐藏的 player.bodyLevel，**只看它**（2026-09-21 用户定：体修单立等级
    // 后灵脉不再反哺——撤销 2026-09-13 第 10 轮的 max(体修, 最高灵脉) 反哺口径；
    // 灵脉玩家想看体修高阶卡，走「跳过进阶」这条体修快车道）。沿革：反哺当年是为
    // 「不跳进阶的玩家永远 0 级、体修 B/A 对灵脉路线永久不可见」开的口子，同日
    // 曾先修过「反哺至多到 A、S 体修独占」，如今整条撤销、回归单立。
    return run?.player?.bodyLevel ?? 0;
  }
  return run?.player?.leino?.[packId] ?? 0;
}

// 某卡包的**升级门禁**上限（晋升专用，与开包概率无关——D4 脱钩后升级仍看体系等级：
// lv0→C / lv1→B / lv2→A / lv3+→S；S 的晋升排除在 promotion.js 目标侧声明）。
// 注意：开包上限不走这里，走 REWARD_TIER_CAP（来源制）。
export function maxRewardTier(run, packId = 'body') {
  const lv = packLevel(run, packId);
  if (lv >= 3) return 'S';
  if (lv >= 2) return 'A';
  if (lv >= 1) return 'B';
  return 'C';
}

// 深入卡门禁（设计稿：精英能力解锁子体系卡池，**深入卡仅在该子体系精英能力到手后**
// 进入奖励池）。卡 def 以 `deep: '<子体系>'` 标注；大师能力不开门禁（门禁只看精英）。
export const DEEP_GATES = Object.freeze({
  burst: Object.freeze(['pyroBlast', 'fireWard']), // 爆炎深入：回响烈焰/背水一战/放手一搏
  fist: Object.freeze(['boxer']),                  // 拳深入：万变拳/假动作/拳压…
  blade: Object.freeze(['bladeMaster']),           // 刀深入：练刀/开刃/斩灭…
  block: Object.freeze(['warrior']),               // 拆深入：架势（2026-09-21 稿同步补装）
  renew: Object.freeze(['renew']),                 // 生息深入：世界树之心
  blight: Object.freeze(['blightLord']),           // 瘴毒深入：瘟神附体
  gale: Object.freeze(['galeFury']),               // 御风深入：天闪
  wander: Object.freeze(['wanderClouds']),         // 逍遥深入：风行者
});
export function deepGateOpen(run, def) {
  if (!def?.deep) return true;
  return (DEEP_GATES[def.deep] ?? []).some(id => run?.player?.abilities?.includes(id));
}

// ---- 牌组门槛与定向亲和（2026-09-20 用户稿：体修肘击小体系「持有肘击才进卡包、
// 肘击越多权重越高」的通用落地；def 声明、rewards 解释，内容侧不侵入本文件）----
//   def.requiresAnyOf = [卡id…]：牌组中不持有其中任一张 → 不入奖励池（牢大/牢大归来/坠机）。
//   def.affinityCards = [卡id…]：牌组中每持有 1 张，档内权重 +35%（至多计 4 张，
//   与体系亲和 SERIES_AFFINITY 同参数——同源杠杆，不另立数值）。
export function deckGateOpen(run, def) {
  const ids = def?.requiresAnyOf;
  if (!ids?.length) return true;
  const owned = new Set((run?.player?.deck ?? []).map(rt => rt.defId));
  return ids.some(id => owned.has(id));
}

/** 持卡亲和乘数：1 + perCard × min(牌组中 affinityCards 卡的张数, maxCount)。 */
export function deckAffinityWeight(run, def) {
  const ids = def?.affinityCards;
  if (!ids?.length) return 1;
  const want = new Set(ids);
  const n = (run?.player?.deck ?? []).reduce((s, rt) => s + (want.has(rt.defId) ? 1 : 0), 0);
  return 1 + SERIES_AFFINITY.perCard * Math.min(n, SERIES_AFFINITY.maxCount);
}

// 单包卡池：包归属 + 排除 Z/S 与 canSpawnAsReward=false + 深入卡门禁 + 牌组门槛。
// S 永不入包（2026-09-21 D4-c：S 只走事件投放）；capTier 由通道上限给出（来源制，
// 与体系等级脱钩）。
export function packCardPool(run, packId = 'body', capTier = null) {
  const cap = TIER_RANK[capTier ?? rewardTierCap()];
  return allSkills().filter(def =>
    packOf(def) === packId
    && def.canSpawnAsReward !== false && def.tier !== 'Z' && def.tier !== 'S'
    && (TIER_RANK[def.tier] ?? Infinity) <= cap
    && deepGateOpen(run, def)
    && deckGateOpen(run, def));
}

// 通用注入池：构成与非常规卡同口径（2026-09-21 缺漏扫描 #2——同一通道上限，
// 原按门禁剔除低阶的规则废除）。
export function commonPool(run, capTier) {
  return packCardPool(run, 'common', capTier ?? rewardTierCap());
}

// ---- 等阶分布抽取：先按通道分布表掷等阶档，再档内选卡 ----
// 档间比例恒等于分布表（在**池内实际存在**的等阶上归一——某等阶池空/被抽空时，
// 其份额自然摊给其余档）；档内缺省均匀，affinityOf 可选给档内选卡加权（子体系亲和）。
// 走 run rng，确定性。供战后开包与老虎机卡包奖项共用。
// table = 通道分布表（REWARD_TIER_TABLE[channel]，见 rewardTierTable）。
export function rollTiered(run, pool, count, table = REWARD_TIER_TABLE.normal, affinityOf = null) {
  const byTier = new Map(); // tier -> 剩余卡
  for (const def of pool) {
    if (!byTier.has(def.tier)) byTier.set(def.tier, []);
    byTier.get(def.tier).push(def);
  }
  const picks = [];
  while (picks.length < count && byTier.size) {
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

// 包内抽 3 选 1 候选（走 run rng，确定性；不重复；等阶分布按来源通道
// REWARD_TIER_TABLE，与体系等级脱钩；档内按子体系亲和加权，见 SERIES_AFFINITY）。
// opts.channel = 'normal'（普通战后/默认）| 'elite'（精英/Boss 战后、老虎机大奖——
// 该通道才有 A 直出）。
export function rollSkillChoices(run, packId = 'body', count = REWARDS_PLACEHOLDER.skillChoiceCount, { channel = 'normal' } = {}) {
  const counts = seriesCounts(run);
  return rollTiered(run, packCardPool(run, packId, rewardTierCap(channel)), count, rewardTierTable(channel),
    def => seriesAffinityWeight(run, def, counts) * deckAffinityWeight(run, def))
    .map(def => def.id);
}

// 进入 reward 阶段：金币自动入账 + 列出可选卡包；只有一个包时自动开包（少一步点击）。
// opts.channel：来源通道（'elite' = 精英/Boss 战后，由 runFlow 按遭遇判定；缺省 normal）。
export function spawnRewards(run, { channel = 'normal' } = {}) {
  run.player.money += REWARDS_PLACEHOLDER.moneyPerBattle;
  const packs = availablePacks(run).map(p => p.id);
  run.rewards = {
    money: REWARDS_PLACEHOLDER.moneyPerBattle,
    packs,                 // 可选卡包 id 列表
    packId: null,          // 已选卡包（选后不可改）
    channel,               // 来源通道（开包时生效；normal = 常规分布，elite = B/A 档）
    skillChoices: [],      // 开包后的 3 选 1 候选
    chosenSkill: undefined, // undefined = 未抉择；null = 跳过；defId = 已领取
  };
  if (packs.length === 1) chooseRewardPack(run, packs[0]);
  return run;
}

// 通用注入（三选一共享）：按概率/保底把候选替换为通用卡，返回 { injected, slot }。
// channel = 本次抽取的来源通道——注入卡与主池同口径：先按通道分布表掷等阶、再档内取
//（2026-09-21 缺漏扫描 #2「同一等阶分布口径」；旧实现是池内均匀， elite 通道会注入 C）。
// packId = 所开卡包：'body'（基础包）走 BODY_PACK_INJECT 高浓度参数且命中后可再
// 换第二张（2026-09-14）；其余包/训练抓牌（不传）维持 COMMON_INJECT 单张口径。
export function injectCommon(run, choices, channel = 'normal', packId = null) {
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
    const pool = commonPool(run, rewardTierCap(channel)).filter(def => !choices.includes(def.id));
    if (!pool.length) return -1;
    const free = choices.map((_, i) => i).filter(i => !usedSlots.includes(i));
    if (!free.length) return -1;
    const slot = free[run.rng.int(0, free.length - 1)];
    choices[slot] = rollTiered(run, pool, 1, rewardTierTable(channel))[0].id;
    usedSlots.push(slot);
    return slot;
  };
  const slot = injectOne();
  const injected = slot >= 0;
  // 基础包：命中后独立掷第二张（进一步稀释体修候选；通用池不足则静默单张）
  if (injected && spec.secondChance && run.rng.next() < spec.secondChance) injectOne();
  return { injected, slot };
}

// 开包：选定卡包 → 抽出包内 3 选 1 候选（等阶分布按 rewards.channel 的来源通道）→
// 按概率/保底混入一张通用卡（通用池上限跟随同一通道）。
export function chooseRewardPack(run, packId) {
  const rw = run.rewards;
  if (!rw) throw new Error('奖励不存在');
  if (rw.chosenSkill !== undefined) throw new Error('奖励已领取');
  if (rw.packId) throw new Error(`卡包已选择：${rw.packId}`);
  if (!rw.packs.includes(packId)) throw new Error(`卡包不可选：${packId}`);
  rw.packId = packId;

  const channel = rw.channel ?? 'normal';
  const choices = rollSkillChoices(run, packId, REWARDS_PLACEHOLDER.skillChoiceCount, { channel });
  const { injected, slot } = injectCommon(run, choices, channel, packId);
  rw.commonInjected = injected;
  rw.commonSlot = slot;
  rw.skillChoices = choices;
  return run;
}

// 训练房抓牌：从**所有已解锁卡包的并集**抽 4（各卡等阶份额一律取 normal 通道表——
// 训练属 normal 来源（A 直出只挂精英/Boss）；并集池内各包卡数不一，用「表概率 /
// 该（包×等阶）组卡数」的每卡份额走通用加权，多包共存时档间比例近似分布表），
// 并同样注入通用卡。
// 训练房抓牌候选 = 战后三选一 +1（2026-09-13 用户定：曝光率加码——训练房是
// 「已解锁卡包并集」的定向窗口，候选多一张让新内容更容易被看见；战后开包不变）。
export function rollTrainingChoices(run, count = REWARDS_PLACEHOLDER.skillChoiceCount + 1) {
  const counts = seriesCounts(run);
  const pool = spawnableCardPool(run);
  const table = rewardTierTable('normal');
  // 每（包×等阶）组的卡数：组内均分该等阶的表概率份额
  const groupCount = new Map();
  for (const def of pool) {
    const key = `${packOf(def)}|${def.tier}`;
    groupCount.set(key, (groupCount.get(key) ?? 0) + 1);
  }
  const weightOf = def =>
    (table[def.tier] ?? 0) / (groupCount.get(`${packOf(def)}|${def.tier}`) || 1);
  const picks = rollWeighted(
    run, pool,
    weightOf,
    count,
    def => seriesAffinityWeight(run, def, counts) * deckAffinityWeight(run, def), // 档内亲和（体系 + 持卡，同口径）
  ).map(def => def.id); // 先取 id：注入会原地替换元素
  injectCommon(run, picks, 'normal'); // 训练抓牌不展示通用角标，注入结果直接生效
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
