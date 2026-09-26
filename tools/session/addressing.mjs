// 参数寻址（子代理防呆）：手牌/候选一律「编号+卡名」双重确认，编号定位、卡名校验，
// 不匹配时报错并提示实际卡名；另有「只给卡名」（卡名唯一时自动定位）与「卡名#序号」两种简写。
//
// 为什么要卡名：**出牌（尤其带抽牌）后手牌编号会整体前移**，一次批处理里连用编号几乎必然错位。
// 卡名是不漂移的意图；编号只在单次调用时可靠。
//
// 卡名匹配是**精确匹配**（2026-09-26 三轮试玩定调）：旧版 actual.startsWith(given) 的前缀
// 容错会把「盾」静默打到「盾墙」上——不同的卡被无声打出去比报错危险得多。找不到时的报错
// 尽量把路铺好：相近名建议、等阶后缀（火球C/拆招B）、升级改名提示（点火→烈焰）。
//
// 约定：不用 uniqueID（其含随机后缀）。
import { defOf } from './format.mjs';
import { allSkills, getSkillDefinition } from '../../src/core/skills/registry.js';

export const num = (s) => Number.parseInt(s, 10);

export const idxOk = (n, len, what) => {
  if (!Number.isInteger(n) || n < 1 || n > len) throw new Error(`${what}编号越界：${n}（1..${len}）`);
  return n - 1;
};

export const isIdxArg = (v) => /^[0-9]+$/.test(String(v ?? ''));

const stripChantTag = (s) => String(s ?? '').replace(/^咏唱[0-9]+·/, '');

export function nameMatches(given, actual) {
  const g = stripChantTag(given);
  // 前缀容错保留（2026-09-26 全量会话回放实测：前缀简写是玩家高频习惯——防住→防住！、
  // 控火术→控火术：燃；收紧成精确匹配会炸掉成批历史会话与肌肉记忆）。安全性靠两条兜住：
  // ①唯一命中才自动采用（多义必报错列候选）；②回执点名实际打出的卡名。
  return g === actual || actual.startsWith(g);
}

// 名字找不到时的补救提示（报错里直接给路，别让玩家盲猜）：
//  ①相近名：手牌里互为前缀的卡（「点火」→「点火术」这类）；②升级链：玩家报的是旧名、
//  手里已是升级后继（三轮实报：点火→烈焰 后 play 点火 静默失败连丢两发没察觉）。
function notFoundHint(list, want, nameOf, idOf) {
  const parts = [];
  const near = list.map((c, i) => ({ i, n: nameOf(c) })).filter(h => h.n.startsWith(want) || want.startsWith(h.n));
  if (near.length) parts.push(`相近：「${near.map(h => `${h.n}（第${h.i + 1}张）`).join('、')}」——请用完整卡名`);
  const wantDef = allSkills().find(d => d.name === want);
  for (let d = wantDef, hops = 0; d && hops < 8; d = d.promotesTo ? getSkillDefinition(d.promotesTo) : null, hops++) {
    const i = list.findIndex(c => idOf(c) === d.id);
    if (i >= 0) { parts.push(`「${want}」可能已升级为「${d.name}」（手牌第 ${i + 1} 张）`); break; }
  }
  return parts.length ? `。${parts.join('；')}` : '';
}

// 等阶后缀拆解：「火球C」「拆招B」是玩家对着设计稿的自然写法（三轮实报高频）。
// 卡名全中文（HeLiCoPtEr 之类不含尾缀字母 C/B/A/S），尾缀拉丁字母必为等阶意图。
const TIER_CHARS = new Set(['C', 'B', 'A', 'S']);
function splitTierSuffix(want) {
  const m = /^(.+)([CBAS])$/.exec(want);
  return m && m[1] ? { base: m[1], tier: m[2] } : null;
}

// 手牌定位（两种写法）：**「编号 + 卡名」双重确认**（推荐），或**只给卡名**（精确名唯一时自动定位；
// 同名多张：同 defId 同态等价取第一张；否则按 #序号 / 等阶后缀 消歧）。
export function resolveHandArg(list, idxOrName, nameArg, what = '手牌') {
  if (isIdxArg(idxOrName)) return resolveHandStrict(list, idxOrName, nameArg, what);
  if (idxOrName == null) {
    throw new Error(`缺少卡名：${what}支持「编号+卡名」或「卡名」（卡名唯一时自动定位）`);
  }
  const raw = String(idxOrName);
  // 「卡名#序号」：显式指定第几张同名卡（如 拳#2）
  const ordinal = /^(.+)#([0-9]+)$/.exec(raw);
  const want = stripChantTag(ordinal ? ordinal[1] : raw);
  const nameOf = (c) => defOf(c).name;
  const tierOf = (c) => defOf(c).tier;
  let hits = list.map((c, i) => ({ i, name: nameOf(c), tier: tierOf(c) }))
    .filter(h => h.name === want || h.name.startsWith(want));
  // 等阶后缀：精确名没中且尾缀是等阶字母 → 按基础名+等阶过滤
  let tierNote = '';
  if (!hits.length) {
    const ts = splitTierSuffix(want);
    if (ts) {
      const baseHits = list.map((c, i) => ({ i, name: nameOf(c), tier: tierOf(c) })).filter(h => h.name === ts.base);
      const tierHits = baseHits.filter(h => h.tier === ts.tier);
      if (tierHits.length) { hits = tierHits; tierNote = `${ts.tier}阶`; }
      else if (baseHits.length) {
        throw new Error(`${what}里没有 ${ts.tier} 阶的「${ts.base}」（现有：`
          + `${baseHits.map(h => `第${h.i + 1}张=${h.tier}阶`).join('、')}）`);
      }
    }
  }
  if (!hits.length) {
    throw new Error(`${what}里没有「${want}」。当前：${list.map(nameOf).join(' / ') || '（空）'}`
      + notFoundHint(list, want, nameOf, (c) => c.defId));
  }
  if (ordinal) {
    const k = Number.parseInt(ordinal[2], 10);
    if (k < 1 || k > hits.length) {
      throw new Error(`${what}里只有 ${hits.length} 张「${want}」（要的是第 ${k} 张，编号 ${hits.map(h => h.i + 1).join('/')}）`);
    }
    return hits[k - 1].i;
  }
  if (hits.length > 1) {
    // **同名同态 = 等价**（打哪张都一样）→ 直接取第一张，不逼玩家回到会漂移的编号。
    // 状态不同（如一张已激活的咏唱与一张未激活的、或同名不同阶）才要求显式指定。
    const first = list[hits[0].i];
    const interchangeable = hits.every(h => list[h.i].defId === first.defId
      && !!list[h.i].isActivated === !!first.isActivated);
    if (interchangeable) return hits[0].i;
    const detail = hits.map(h => `第${h.i + 1}张=${h.name}${h.tier}阶${list[h.i].isActivated ? '（激活中）' : ''}`).join('、');
    const sameName = hits.every(h => h.name === hits[0].name);
    throw new Error(`${what}里有 ${hits.length} 张「${want}」且不等价（${detail}）`
      + `——请用完整卡名${sameName ? `（或等阶后缀「${hits[0].name}${hits[0].tier}」）` : ''}、「编号+卡名」或「${want}#序号」指定`);
  }
  return hits[0].i;
}

export function resolveHandStrict(list, idxArg, nameArg, what = '手牌') {
  const i = idxOk(num(idxArg), list.length, what);
  const actual = defOf(list[i]).name;
  if (nameArg == null) {
    throw new Error(`缺少卡名参数：${what}需「编号+卡名」双重确认，如 ${what === '手牌' ? 'play' : '选'} ${idxArg} ${actual}`);
  }
  if (!nameMatches(nameArg, actual)) {
    throw new Error(`${what}第${idxArg}张是「${actual}」，不是「${nameArg}」——请对照列表编号重试`);
  }
  return i;
}

// play/swap 的手牌定位：优先「编号+卡名」双重确认；**编号与卡名不符（含编号越界）时改按
// 卡名定位**（卡名是不漂移的意图，编号会随抽牌前移——三轮试玩的第一高频摩擦；
// 越界回落 2026-09-26 增：编号彻底过期时卡名仍可救）。
// 返回 { skill, note }；note 用于回执里说明发生过回落。
export function pickHandCard(hand, idxOrName, nameArg, byIndex) {
  if (byIndex && nameArg != null) {
    try {
      return { skill: hand[resolveHandArg(hand, idxOrName, nameArg)], note: '' };
    } catch (err) {
      if (!/不是「|编号越界/.test(err.message)) throw err;   // 找不到卡等其余错误照常抛
      const i = resolveHandArg(hand, nameArg);
      return { skill: hand[i], note: `（编号 ${idxOrName} 与卡名不符，已按卡名定位到第 ${i + 1} 张）` };
    }
  }
  return { skill: hand[resolveHandArg(hand, idxOrName)], note: '' };
}

// 候选列表（元素数组）同款两种写法；只给名字时返回命中的**元素本身**
export function resolveChoiceArg(choices, idxOrName, nameArg, what = '候选', nameOf = (x) => x) {
  if (isIdxArg(idxOrName)) return resolveChoiceStrict(choices, idxOrName, nameArg, what, nameOf);
  const want = stripChantTag(String(idxOrName));
  let hits = choices.map((c, i) => ({ c, i, name: nameOf(c) }))
    .filter(h => h.name === want || h.name.startsWith(want));
  // 等阶后缀（候选是卡时才有 tier——defId 字符串查注册表，对象元素直接读）
  if (!hits.length && splitTierSuffix(want)) {
    const { base, tier } = splitTierSuffix(want);
    const tierOf = (c) => (typeof c === 'string' ? getSkillDefinition(c)?.tier : (c?.tier ?? defOf(c)?.tier));
    const baseHits = choices.map((c, i) => ({ c, i, name: nameOf(c) })).filter(h => h.name === base && tierOf(h.c) === tier);
    if (baseHits.length) hits = baseHits;
  }
  if (!hits.length) {
    throw new Error(`${what}里没有「${idxOrName}」。当前：${choices.map(c => nameOf(c)).join(' / ')}`);
  }
  if (hits.length > 1) {
    const tiers = choices.filter(c => hits.some(h => h.c === c))
      .map(c => (typeof c === 'string' ? getSkillDefinition(c)?.tier : c?.tier)).join('/');
    throw new Error(`${what}里有 ${hits.length} 个「${idxOrName}」${tiers && tiers !== '/' ? `（等阶 ${tiers}）` : ''}`
      + `——请用「编号+名称」或等阶后缀（如 ${idxOrName}B）指定`);
  }
  return hits[0].c;
}

// 候选表（defId 数组）同款双重确认；返回校验通过的 defId
export function resolveChoiceStrict(choices, idxArg, nameArg, what = '候选', nameOf) {
  const i = idxOk(num(idxArg), choices.length, what);
  const actual = nameOf(choices[i]);
  if (nameArg == null) {
    throw new Error(`缺少卡名参数：${what}需「编号+卡名」双重确认，如 take ${idxArg} ${actual}`);
  }
  if (!nameMatches(nameArg, actual)) {
    throw new Error(`${what}第${idxArg}张是「${actual}」，不是「${nameArg}」——请对照候选列表重试`);
  }
  return choices[i];
}
