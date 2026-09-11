// 遗物抽选 SDK（core 纯逻辑，供所有"发遗物"的地方复用）：
//   老虎机奖项 / 商店货架 / 事件奖励 / Boss 掉落 —— 全部走这里，规则才不会各处漂。
//
// 规则集中四条（用户 2026-09-10 定）：
//   ① **稀有度权重**：越稀有越难出；权重是调参位，一处可改。
//   ② **灵脉门禁**：`requires.leino` 未达标不进池（与卡包/抓牌同一口径）。
//   ③ **已拥有排除**：一局内遗物唯一——背包里有的不会再被抽到（驱重）。
//   ④ **池空兜底**：若玩家已拥有全部可抽遗物，改发兜底遗物；它是**唯一可重复获得**的遗物。
//
// 确定性：一律用调用方传入的 rng（缺省 run.rng），同一 rng 状态 + 同一池必得同一结果，
// 因此存档/回放/headless replay 天然一致。

import { allRelics, getRelicDefinition, hasRelic } from './registry.js';

export const RARITIES = Object.freeze(['C', 'B', 'A', 'S']);

// 默认抽取权重（越稀有越低）。数值是**唯一调参位**——老虎机/商店/事件共用同一套，
// 需要按来源微调时由调用方覆写。
export const DEFAULT_DRAFT_WEIGHTS = Object.freeze({ C: 62, B: 27, A: 9, S: 2 });

// 池空兜底（边界情况）：全部可抽遗物都在手里时发这一件，只有它能被多次获得。
// 见下方 FILLER 的说明——名字与效果是占位，等用户补设计。
export const FILLER_RELIC_ID = 'towerGift';

/** 遗物定义的稀有度（无字段按 C 计，保证老定义不炸）。 */
export const rarityOf = (def) => (RARITIES.includes(def?.rarity) ? def.rarity : 'C');

/** 该遗物的来源标签（缺省：任意抽取 + 售货机可售）。
 *  'draft' 任意抽取（老虎机/事件/掉落）｜'vending' 瑞米售货机｜'gurpas' 古尔帕斯之店（仅此店）｜'event' 仅事件 */
export const sourcesOf = (def) => def?.acquisition ?? ['draft', 'vending'];

/**
 * 灵脉门禁是否达标。requires 可为单个或数组；每个条目支持两种形态：
 *   { leino: 'fire', min: 1 } → 该维度等级 ≥ min
 *   { anyLeino: 1 }          → **任意**维度等级 ≥ 该值（「需玩家任意灵脉等级>0」）
 * 缺省无门禁。
 */
export function meetsRequires(def, run) {
  const reqs = def?.requires ? (Array.isArray(def.requires) ? def.requires : [def.requires]) : [];
  const leino = run?.player?.leino ?? {};
  return reqs.every((r) => {
    if (r.anyLeino != null) return RARITY_DIMS.some(d => (leino[d] ?? 0) >= r.anyLeino);
    return (leino[r.leino] ?? 0) >= (r.min ?? 1);
  });
}

// 灵脉维度（门禁判定用；内容侧维度表在 ascension.js，这里只取"有哪些维度"这一事实）
export const RARITY_DIMS = Object.freeze(['fire', 'wood', 'air']);

/**
 * 该遗物此刻是否**可被抽到**：来源匹配 + 门禁达标 + 剧情限定 + 未被拥有 + 非兜底件。
 * @param {object} def 遗物定义
 * @param {object} run runState
 * @param {object} opts sources: 允许的来源标签（缺省 ['draft']）
 */
export function isDraftable(def, run, { sources = ['draft'] } = {}) {
  if (!def || def.id === FILLER_RELIC_ID) return false;
  if (!sourcesOf(def).some(s => sources.includes(s))) return false;
  if (def.storyOnly && !run?.storyMode) return false;
  if (!meetsRequires(def, run)) return false;
  if ((run?.player?.relics ?? []).includes(def.id)) return false; // 已拥有 → 驱重
  return true;
}

/**
 * 候选池（已过全部规则）。顺序 = 注册顺序（稳定，便于测试与调试）。
 * @param {object} opts rarity: 限定稀有度（字符串或数组）；sources；exclude: 额外排除的 id
 */
export function relicPool(run, { rarity = null, sources = ['draft'], exclude = [] } = {}) {
  const want = rarity == null ? null : (Array.isArray(rarity) ? rarity : [rarity]);
  return allRelics().filter(def => (
    isDraftable(def, run, { sources })
    && !exclude.includes(def.id)
    && (!want || want.includes(rarityOf(def)))
  ));
}

/** 池空时是否给兜底件（兜底件本身也必须未拥有？——不，它是唯一可重复的，永远可发）。 */
export const fillerAvailable = (run) => hasRelic(FILLER_RELIC_ID);

function pickRarity(pool, weights, rng) {
  // 只在实际有货的稀有度之间按权重归一（避免"抽到空档位"再重抽）
  const present = RARITIES.filter(r => pool.some(d => rarityOf(d) === r));
  const total = present.reduce((s, r) => s + (weights?.[r] ?? DEFAULT_DRAFT_WEIGHTS[r] ?? 0), 0);
  if (total <= 0) return present[0] ?? null;
  let roll = rng() * total;
  for (const r of present) {
    roll -= (weights?.[r] ?? DEFAULT_DRAFT_WEIGHTS[r] ?? 0);
    if (roll < 0) return r;
  }
  return present[present.length - 1];
}

/**
 * 抽 1 件遗物 id（池空 → 兜底件；连兜底件都没注册 → null）。
 * 先按权重定稀有度、再在该稀有度内等概率取一件——这样"抽到 A 的概率"由权重决定，
 * 不被各稀有度池子大小左右（与卡牌侧的等阶加权同一口径）。
 * @param {object} opts rarity / weights / sources / exclude / rng（缺省 run.rng.next）
 */
export function draftRelic(run, { rarity = null, weights = null, sources = ['draft'], exclude = [], rng = null } = {}) {
  const next = rng ?? (() => run.rng.next());
  const pool = relicPool(run, { rarity, sources, exclude });
  if (!pool.length) return fillerAvailable(run) ? FILLER_RELIC_ID : null;
  if (rarity != null) { // 已限定稀有度：池内等概率
    return pool[Math.floor(next() * pool.length)].id;
  }
  const r = pickRarity(pool, weights, next);
  const inRarity = pool.filter(d => rarityOf(d) === r);
  return inRarity[Math.floor(next() * inRarity.length)].id;
}

/** 抽 count 件（互不重复：逐次把已抽中的排出池外）。 */
export function draftRelics(run, count = 1, opts = {}) {
  const out = [];
  const exclude = [...(opts.exclude ?? [])];
  for (let i = 0; i < count; i++) {
    const id = draftRelic(run, { ...opts, exclude });
    if (!id) break;
    out.push(id);
    if (id !== FILLER_RELIC_ID) exclude.push(id); // 兜底件允许重复（池空场景）
  }
  return out;
}

/** 稀有度 → 展示色（UI 用；与卡牌等阶色同一套语言由调用方决定，这里只给中性默认）。 */
export function relicDef(id) { return hasRelic(id) ? getRelicDefinition(id) : null; }
