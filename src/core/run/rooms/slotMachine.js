import { createSkillRuntime } from '../../state/skillRuntime.js';
import {
  availablePacks, packCardPool, commonPool, maxRewardTier, tierWeight, TIER_RANK,
} from '../rewards.js';
import { draftRelic, draftRelics } from '../../relics/draft.js';
import { grantRelic } from '../prep.js';
import { promoteCard, gatedPromotionTargets, canPromoteRuntime } from '../promotion.js';
import { getSkillDefinition } from '../../skills/registry.js';
import { getRelicDefinition } from '../../relics/registry.js';
import { getEffectDefinition } from '../../effects/registry.js';

// 老虎机（SLOT_MACHINE.md）：**资源交换**——花费金币 roll，产出可放弃；吞噬遗物/卡换金币。
//
// 本文件是**引擎**（headless 与前端共用同一份）。前端目前是占位 UI（能用即可，视觉效果后做）。
//
// 已实装（第一批）
//   · 涨价：单价 5 起，每次 roll 后 +6
//   · 保底：小奖 18% 起、每次未中 +7%；大奖 2% 起、每次未中 +2%；中奖后各自重置；
//           小奖+大奖 > 100% 时小奖实际按 (100% − 大奖) 计
//   · 奖项：小奖/大奖两档（档内权重见 MINOR/MAJOR），**产出总是可以放弃**
//   · 吞噬：累积 roll 每满 7 次可粉碎一件遗物或一张卡换金币（价值表按稀有度/等阶）；
//           S 级嚼不动（吐出来）；诅咒卡 → 下次 roll 免费
//   · 故事模式：第 5/11 次小奖必为瑞米的苹果；拿到两个后第 2 次大奖必为金苹果
//
// 未实装（下一批）：**银行机**（存取款/连击利率/超额取款的恶魔 roll）与**恶魔 roll 的 24 个词条**
//   —— 后者需要 `脆弱`/`伤残` 等尚未实装的效果与「下一场战斗」「下三场战斗」的跨战斗计时。

export const SLOT = Object.freeze({
  baseCost: 5,        // 首次单价
  costStep: 6,        // 每次 roll 后涨价
  minorBase: 0.18, minorStep: 0.07,   // 小奖概率（未中即累加，中奖重置）
  majorBase: 0.02, majorStep: 0.02,   // 大奖概率
  devourEvery: 7,     // 每累积这么多次 roll 可吞噬一次
  // 档内权重（文档只给了档概率，档内分配是调参位）
  minorWeights: {
    moneySmall: 20, heal: 16, pack: 16, highCard: 10,
    commonCard: 8, upgradeCopy: 8, relicCB: 12, special: 10,
  },
  majorWeights: {
    moneyBig: 16, fullRestore: 10, packAbove: 14, packSix: 10,
    commonPack: 8, freeUpgrade: 10, randomUpgrades: 8,
    relicA: 12, relicS: 4, special: 8,
  },
  // 吞噬价值表（gold 区间，rng 定值）
  devourValue: {
    relic: { C: [20, 30], B: [40, 50], A: [60, 70] },   // S 嚼不动
    card: { D: [0, 5], C: [3, 10], B: [10, 20], A: [20, 30] },
  },
  moneySmall: [10, 30],
  moneyBig: [200, 400],
  healPct: 0.12,
});

const intIn = (range, rng) => range[0] + Math.floor(rng.next() * (range[1] - range[0] + 1));
const rarOf = (def) => (['C', 'B', 'A', 'S'].includes(def?.rarity) ? def.rarity : 'C');

// ---- 机器状态 ----

/** 本次遇到的老虎机瞬态（进房时初始化；离房丢弃）。 */
function slotState(run) {
  if (!run.slot || run.slot.floor !== run.floor) {
    run.slot = { floor: run.floor, rolls: 0, sinceMinor: 0, sinceMajor: 0 };
  }
  return run.slot;
}

/** 当前单价：5 起，每次 roll 后 +6（免费 roll 不涨价）。纯读——不初始化机器状态。 */
export const spinCost = (run) => SLOT.baseCost
  + SLOT.costStep * (run.slot?.floor === run.floor ? run.slot.rolls : 0);

/** 吞噬进度（**跨遇到累积**，用掉即清零）。 */
export const devourProgress = (run) => run.slotDevour ?? 0;
export const devourReady = (run) => devourProgress(run) >= SLOT.devourEvery;

/** 待结算的产出（roll 出来的东西挂在这里，等玩家领取或放弃）。 */
export const slotPending = (run) => run.slotPending ?? null;

/** 当前机器概览（UI/CLI 用；纯读）。 */
export function slotView(run) {
  const st = slotState(run);
  const cost = spinCost(run);
  return {
    cost,
    rolls: st.rolls,
    freeRolls: run.slotFreeRolls ?? 0,
    canSpin: (run.slotFreeRolls ?? 0) > 0 || run.player.money >= cost,
    majorChance: Math.min(1, SLOT.majorBase + SLOT.majorStep * st.sinceMajor),
    minorChance: (() => {
      const major = Math.min(1, SLOT.majorBase + SLOT.majorStep * st.sinceMajor);
      const minor = Math.min(1, SLOT.minorBase + SLOT.minorStep * st.sinceMinor);
      return minor + major > 1 ? Math.max(0, 1 - major) : minor;
    })(),
    devourProgress: devourProgress(run),
    devourEvery: SLOT.devourEvery,
    devourReady: devourReady(run),
  };
}

// ---- 奖项构造 ----

/** 从池里按等阶加权取 count 张互不重复的卡（capTier 决定各档权重）。 */
function pickCards(run, pool, count, capTier) {
  const out = [];
  const left = [...pool];
  while (out.length < count && left.length) {
    const weights = left.map(d => Math.max(1, Math.round(tierWeight(d, capTier) * 100)));
    const total = weights.reduce((s, w) => s + w, 0);
    let roll = run.rng.next() * total;
    let idx = 0;
    for (let i = 0; i < left.length; i++) { roll -= weights[i]; if (roll < 0) { idx = i; break; } }
    out.push(left.splice(idx, 1)[0]);
  }
  return out;
}

const choiceOf = (defs) => ({
  choices: defs.map(d => ({ id: d.id, name: d.name ?? d.id })),
});

/** 随机一张「可升级卡」的升级后复制品（可选加入牌库，**不替换原有卡**）。 */
function rollUpgradeCopy(run) {
  const upgradable = run.player.deck.filter((rt) => {
    const def = getSkillDefinition(rt.defId);
    return gatedPromotionTargets(run, def).length > 0;
  });
  if (!upgradable.length) return null;
  const rt = upgradable[Math.floor(run.rng.next() * upgradable.length)];
  const target = gatedPromotionTargets(run, getSkillDefinition(rt.defId))[0];
  return target ?? null;
}

/** 小奖：返回 payload（null = 该奖项当前无货，换一个再掷）。 */
function makeMinor(run, kind) {
  switch (kind) {
    case 'moneySmall': return { money: intIn(SLOT.moneySmall, run.rng) };
    case 'heal': return { healPct: SLOT.healPct };
    case 'pack': {
      const packs = availablePacks(run).map(p => p.id);
      if (!packs.length) return null;
      const packId = packs[Math.floor(run.rng.next() * packs.length)];
      const defs = pickCards(run, packCardPool(run, packId, maxRewardTier(run, packId)), 3, maxRewardTier(run, packId));
      return defs.length ? { packId, ...choiceOf(defs) } : null;
    }
    case 'highCard': {
      // 「任意一张高级卡」：给当前解锁最高等阶的三选一（适配灵脉等级）
      const packs = availablePacks(run).map(p => p.id);
      const pool = packs.flatMap(p => packCardPool(run, p, maxRewardTier(run, p)));
      const cap = Math.max(...packs.map(p => TIER_RANK[maxRewardTier(run, p)] ?? 0));
      const top = pool.filter(d => (TIER_RANK[d.tier] ?? 0) === cap);
      if (!top.length) return null;
      return choiceOf(pickCards(run, top, 3, maxRewardTier(run, packs[0])));
    }
    case 'commonCard': {
      // 「低于目前等级的低级灰卡」：通用池里取低于当前上限的
      const capTier = maxRewardTier(run, 'body');
      const pool = commonPool(run, capTier).filter(d => (TIER_RANK[d.tier] ?? 0) < (TIER_RANK[capTier] ?? 0));
      const use = pool.length ? pool : commonPool(run, capTier);
      return use.length ? choiceOf(pickCards(run, use, 3, capTier)) : null;
    }
    case 'upgradeCopy': {
      const target = rollUpgradeCopy(run);
      return target ? { upgradeCopyId: target } : null;
    }
    case 'relicCB': {
      const id = draftRelic(run, { rarity: ['C', 'B'], sources: ['draft'] });
      return id ? { relicId: id } : null;
    }
    case 'special': {
      // 文档里的「特殊物品等」尚未定义 → 占位为已有的两种小资源（果实/训练次数）
      return { special: run.rng.next() < 0.5 ? 'fruit' : 'training' };
    }
    default: return null;
  }
}

/** 大奖：返回 payload。 */
function makeMajor(run, kind) {
  switch (kind) {
    case 'moneyBig': return { money: intIn(SLOT.moneyBig, run.rng) };
    case 'fullRestore': return { fullRestore: true };
    case 'packAbove': {
      // 「齐平甚至超越灵脉等级」：把上限抬一阶
      const packs = availablePacks(run).map(p => p.id);
      const packId = packs[Math.floor(run.rng.next() * packs.length)];
      const cap = TIER_RANK[maxRewardTier(run, packId)] ?? 0;
      const raised = ['D', 'C', 'B', 'A'][Math.min(3, cap + 1)];
      const pool = packCardPool(run, packId, raised);
      return pool.length ? { packId, raised, ...choiceOf(pickCards(run, pool, 3, raised)) } : null;
    }
    case 'packSix': {
      // 「平时无法获取的 6 选 1 任意系高级卡包」：跨全部已解锁卡包取高阶，六选一
      const packs = availablePacks(run).map(p => p.id);
      const cap = packs.reduce((m, p) => Math.max(m, TIER_RANK[maxRewardTier(run, p)] ?? 0), 0);
      const top = ['D', 'C', 'B', 'A'][Math.min(3, cap)];
      const pool = packs.flatMap(p => packCardPool(run, p, top)).filter(d => (TIER_RANK[d.tier] ?? 0) === cap);
      const use = pool.length ? pool : packs.flatMap(p => packCardPool(run, p, top));
      return use.length ? { six: true, ...choiceOf(pickCards(run, use, 6, top)) } : null;
    }
    case 'commonPack': {
      const cap = maxRewardTier(run, 'body');
      const pool = commonPool(run, cap);
      return pool.length ? { common: true, ...choiceOf(pickCards(run, pool, 3, cap)) } : null;
    }
    case 'freeUpgrade': {
      // 没有可升级的卡就不发这个奖（否则会挂起一个无法收尾的选卡请求 = 卡死）
      const any = run.player.deck.some(rt => canPromoteRuntime(rt, run));
      return any ? { upgrade: { kind: 'free' } } : null;
    }
    case 'randomUpgrades': return { upgrade: { kind: 'random', count: 2 } };
    case 'relicA': {
      const ids = draftRelics(run, 3, { rarity: 'A', sources: ['draft'] });
      return ids.length ? { relicChoices: ids.map(id => ({ id, name: getRelicDefinition(id)?.name ?? id })) } : null;
    }
    case 'relicS': {
      const ids = draftRelics(run, 1, { rarity: 'S', sources: ['draft'] });
      return ids.length ? { relicId: ids[0] } : null;
    }
    case 'special': return { special: run.rng.next() < 0.5 ? 'fruit' : 'training' };
    default: return null;
  }
}

function pickWeighted(weights, rng) {
  const keys = Object.keys(weights);
  const total = keys.reduce((s, k) => s + weights[k], 0);
  let roll = rng.next() * total;
  for (const k of keys) { roll -= weights[k]; if (roll < 0) return k; }
  return keys[keys.length - 1];
}

/** 带重掷地造一个奖项（该奖项当前无货时换同档另一个再掷，最多 8 次）。 */
function makePrize(run, tier) {
  const weights = tier === 'major' ? SLOT.majorWeights : SLOT.minorWeights;
  const make = tier === 'major' ? makeMajor : makeMinor;
  for (let i = 0; i < 8; i++) {
    const kind = pickWeighted(weights, run.rng);
    const payload = make(run, kind);
    if (payload) return { tier, kind, ...payload };
  }
  return { tier, kind: 'moneySmall', money: intIn(SLOT.moneySmall, run.rng) }; // 兜底：总得给点什么
}

// ---- roll ----

/**
 * 拉一次杆：扣费（或消耗免费 roll）→ 保底推进 → 定档定奖 → 产出挂起（等领取/放弃）。
 * 产出不允许被下一次 roll 顶掉：还有未结算的产出时直接抛错。
 */
export function spinSlot(run) {
  if (run.currentRoom !== 'slot') throw new Error('当前不在老虎机房');
  if (run.slotPending) throw new Error('上一次的产出还没处理（领取或放弃）');

  const free = (run.slotFreeRolls ?? 0) > 0;
  const cost = spinCost(run);
  // 校验全部通过后才落状态：失败的 roll 不改动任何东西（含机器瞬态初始化）
  if (!free && run.player.money < cost) throw new Error(`金币不足（本次 ${cost}）`);
  const st = slotState(run);
  if (free) run.slotFreeRolls -= 1;
  else run.player.money -= cost;

  // 保底推进（roll 数在所有分支都 +1；免费 roll 不涨价，但仍推进保底与吞噬进度）
  if (!free) st.rolls += 1;
  run.slotDevour = Math.min(SLOT.devourEvery, devourProgress(run) + 1); // 封顶（满即可用，不再无限累加）

  const majorP = Math.min(1, SLOT.majorBase + SLOT.majorStep * st.sinceMajor);
  const minorRaw = Math.min(1, SLOT.minorBase + SLOT.minorStep * st.sinceMinor);
  const minorP = minorRaw + majorP > 1 ? Math.max(0, 1 - majorP) : minorRaw;

  const r = run.rng.next();
  let tier = null;
  if (r < majorP) tier = 'major';
  else if (r < majorP + minorP) tier = 'minor';

  if (!tier) {
    st.sinceMinor += 1;
    st.sinceMajor += 1;
    // 未中奖不是"产出"：不挂 pending，玩家可以立刻再拉杆（headless 试玩 report-r1-A 缺陷#5）
    return { tier: 'none', kind: 'nothing', cost };
  }
  if (tier === 'major') { st.sinceMajor = 0; st.sinceMinor += 1; }
  else { st.sinceMinor = 0; st.sinceMajor += 1; }

  let prize = makePrize(run, tier);

  // 故事模式的苹果节拍（SLOT_MACHINE.md）：第 5/11 次小奖必为苹果；**拿到这两个苹果之后**的第 2 次
  // 大奖必为金苹果。注意"之后"——大奖计数从拿到第二个苹果那一刻重新起算（此前中过的大奖不算）。
  if (run.storyMode && tier === 'minor') {
    st.minorHits = (st.minorHits ?? 0) + 1;
    if (st.minorHits === 5 || st.minorHits === 11) {
      prize = { tier, kind: 'special', special: 'apple', cost: prize.cost }; // 整条替换，不带原奖项载荷
    }
  }
  if (run.storyMode && tier === 'major' && (run.slotApples ?? 0) >= 2) {
    st.majorsSinceApples = (st.majorsSinceApples ?? 0) + 1;
    if (st.majorsSinceApples === 2) {
      prize = { tier, kind: 'special', special: 'goldApple', cost: prize.cost };
    }
  }

  prize.cost = cost;
  run.slotPending = prize;
  return prize;
}

/**
 * 领取产出。choice 只对"多选一"类奖项有意义（卡的 defId / 遗物的 relicId）。
 * freeUpgrade（大奖）不在这里收尾——它只挂起选卡请求，由 slotUpgrade 落地。
 */
export function takeSlotPrize(run, choice = null) {
  const p = run.slotPending;
  if (!p) throw new Error('当前没有待领取的产出');
  const out = { kind: p.kind, tier: p.tier };

  if (p.money != null) { run.player.money += p.money; out.money = p.money; }
  if (p.healPct != null) {
    const pl = run.player;
    pl.hp = Math.min(pl.maxHp, pl.hp + Math.ceil(pl.maxHp * p.healPct));
    out.healed = true;
  }
  if (p.fullRestore) {
    const pl = run.player;
    pl.hp = pl.maxHp;
    pl.mana = pl.maxMana;
    pl.clearEffects(e => isDebuff(e.effectId)); // 负面效果清除，正面保留
    out.fullRestore = true;
  }
  if (p.special) {
    if (p.special === 'fruit' || p.special === 'goldApple') run.remi.fruits += 1;
    if (p.special === 'training') run.player.trainingCount += 1;
    if (p.special === 'apple') {
      run.remi.fruits += 1;
      run.slotApples = (run.slotApples ?? 0) + 1;
      if (run.slotApples === 2 && run.slot) run.slot.majorsSinceApples = 0; // 金苹果节拍从这一刻起算
    }
    out.special = p.special;
  }
  if (p.upgradeCopyId) { run.player.deck.push(createSkillRuntime(p.upgradeCopyId)); out.defId = p.upgradeCopyId; }
  if (p.relicId) { grantRelic(run, p.relicId); out.relicId = p.relicId; }
  if (p.relicChoices) {
    if (!choice) throw new Error('这份产出需要在多个遗物中选一个');
    if (!p.relicChoices.some(r => r.id === choice)) throw new Error(`遗物不在候选里：${choice}`);
    grantRelic(run, choice);
    out.relicId = choice;
  }
  if (p.choices) {
    if (!choice) throw new Error('这份产出需要选一张卡');
    if (!p.choices.some(c => c.id === choice)) throw new Error(`卡不在候选里：${choice}`);
    run.player.deck.push(createSkillRuntime(choice));
    out.defId = choice;
  }
  if (p.upgrade) {
    if (p.upgrade.kind === 'random') {
      const done = randomUpgrade(run, p.upgrade.count);
      out.upgraded = done;
      if (!done.length) return declineSlotPrize(run, out); // 没有可升级的卡 → 视为空产出
    } else {
      // 指定升级：挂起选卡请求（前端复用全屏选卡界面；headless 走 slotUpgrade）
      run.slotUpgradePending = true;
      out.needsCardPick = true;
      return out; // 保留 pending，等 slotUpgrade 收尾
    }
  }
  run.slotPending = null;
  return out;
}

/** 放弃产出（文档：这些产出总是可以放弃不要的）。 */
export function declineSlotPrize(run, out = {}) {
  if (!run.slotPending) throw new Error('当前没有待处理的产出');
  run.slotPending = null;
  return { ...out, declined: true };
}

/** 免费指定升级的落地点（前端选卡界面 / headless 直接调）。 */
export function slotUpgrade(run, uniqueID) {
  if (!run.slotUpgradePending) throw new Error('当前没有待指定的免费升级');
  const r = promoteCard(run, uniqueID);
  if (!r) throw new Error('该卡没有可用的升级目标');
  run.slotUpgradePending = false;
  run.slotPending = null;
  return { kind: 'freeUpgrade', uniqueID, defId: r.defId };
}

/** 随机升级 n 张可升级卡（返回实际升级的卡）。 */
function randomUpgrade(run, n) {
  const done = [];
  for (let i = 0; i < n; i++) {
    const pool = run.player.deck.filter((rt) => {
      if (gatedPromotionTargets(run, getSkillDefinition(rt.defId)).length === 0) return false;
      return true;
    });
    if (!pool.length) break;
    const rt = pool[Math.floor(run.rng.next() * pool.length)];
    const next = promoteCard(run, rt.uniqueID);
    if (next) done.push(next.defId);
  }
  return done;
}

// ---- 吞噬（粉碎换金币）----

/** 可吞噬的遗物（S 嚼不动；已装备的也能吃——玩家自己的选择）。 */
export function devourableRelics(run) {
  return (run.player.relics ?? []).filter((id) => {
    const def = getRelicDefinition(id);
    return def && rarOf(def) !== 'S' && SLOT.devourValue.relic[rarOf(def)];
  }).map(id => ({
    id,
    name: getRelicDefinition(id)?.name ?? id,
    rarity: rarOf(getRelicDefinition(id)),
  }));
}

/** 可吞噬的卡（按等阶计价；诅咒卡另有奖励）。 */
export function devourableCards(run) {
  return (run.player.deck ?? []).map((rt, index) => {
    const def = getSkillDefinition(rt.defId);
    return { index, uniqueID: rt.uniqueID, defId: rt.defId, name: def?.name ?? rt.defId, tier: def?.tier ?? 'D' };
  }).filter(c => SLOT.devourValue.card[c.tier]);
}

/**
 * 吞噬一件遗物或一张卡 → 按价值表换金币。累积满 SLOT.devourEvery 次 roll 才可用，用掉即清零。
 * S 级遗物嚼不动（抛错）；诅咒卡（curse 标记）额外获得「下次 roll 免费」。
 */
export function devourSlot(run, { kind, relicId = null, uniqueID = null } = {}) {
  if (run.currentRoom !== 'slot') throw new Error('当前不在老虎机房');
  if (!devourReady(run)) throw new Error(`吞噬进度不足（${devourProgress(run)}/${SLOT.devourEvery}）`);
  const roll = (range) => intIn(range, run.rng);
  let gold = 0;
  let freeRoll = false;

  if (kind === 'relic') {
    const def = getRelicDefinition(relicId);
    if (!def) throw new Error(`没有这件遗物：${relicId}`);
    if (rarOf(def) === 'S') throw new Error('S 级遗物嚼不动——它嚼一嚼又吐了出来');
    const i = run.player.relics.indexOf(relicId);
    if (i < 0) throw new Error(`背包里没有这件遗物：${relicId}`);
    gold = roll(SLOT.devourValue.relic[rarOf(def)]);
    run.player.relics.splice(i, 1);
    run.player.equippedRelics = run.player.equippedRelics.filter(id => id !== relicId);
    delete run.relicUses?.[relicId];
  } else if (kind === 'card') {
    const idx = run.player.deck.findIndex(rt => rt.uniqueID === uniqueID);
    if (idx < 0) throw new Error(`牌库里没有这张卡：${uniqueID}`);
    const def = getSkillDefinition(run.player.deck[idx].defId);
    gold = roll(SLOT.devourValue.card[def?.tier ?? 'D']);
    if (def?.curse) { freeRoll = true; } // 诅咒卡：老虎机吃得满意
    run.player.deck.splice(idx, 1);
  } else {
    throw new Error('吞噬目标必须是遗物或卡牌');
  }

  run.player.money += gold;
  if (freeRoll) run.slotFreeRolls = (run.slotFreeRolls ?? 0) + 1;
  run.slotDevour = 0; // 用掉即清零
  return { kind, gold, freeRoll };
}

// 效果是否负面（全状态恢复时清除负面、保留正面）
function isDebuff(effectId) {
  return getEffectDefinition(effectId)?.type === 'debuff';
}
