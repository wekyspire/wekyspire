// 参数寻址（子代理防呆）：手牌/候选一律「编号+卡名」双重确认，编号定位、卡名校验，
// 不匹配时报错并提示实际卡名；另有「只给卡名」（卡名唯一时自动定位）与「卡名#序号」两种简写。
//
// 为什么要卡名：**出牌（尤其带抽牌）后手牌编号会整体前移**，一次批处理里连用编号几乎必然错位。
// 卡名是不漂移的意图；编号只在单次调用时可靠。
//
// 约定：不用 uniqueID（其含随机后缀）。
import { defOf } from './format.mjs';

export const num = (s) => Number.parseInt(s, 10);

export const idxOk = (n, len, what) => {
  if (!Number.isInteger(n) || n < 1 || n > len) throw new Error(`${what}编号越界：${n}（1..${len}）`);
  return n - 1;
};

export const isIdxArg = (v) => /^[0-9]+$/.test(String(v ?? ''));

const stripChantTag = (s) => String(s ?? '').replace(/^咏唱[0-9]+·/, '');

export function nameMatches(given, actual) {
  const g = stripChantTag(given);
  return g === actual || actual.startsWith(g);
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

// 手牌定位（两种写法）：**「编号 + 卡名」双重确认**（推荐），或**只给卡名**（卡名唯一时自动定位）。
// 后者是为修「打出带抽牌的卡后手牌编号瞬移」这一高频摩擦（report-r1-A 缺陷#2）：
// 一次批处理里连打抽牌卡时编号会变，靠卡名定位就不会错位。
export function resolveHandArg(list, idxOrName, nameArg, what = '手牌') {
  if (isIdxArg(idxOrName)) return resolveHandStrict(list, idxOrName, nameArg, what);
  if (idxOrName == null) {
    throw new Error(`缺少卡名：${what}支持「编号+卡名」或「卡名」（卡名唯一时自动定位）`);
  }
  // 「卡名#序号」：显式指定第几张同名卡（如 拳#2）
  const ordinal = /^(.+)#([0-9]+)$/.exec(String(idxOrName));
  const want = ordinal ? ordinal[1] : idxOrName;
  const hits = list.map((c, i) => ({ i, name: defOf(c).name })).filter(h => nameMatches(want, h.name));
  if (!hits.length) {
    throw new Error(`${what}里没有「${want}」。当前：${list.map(c => defOf(c).name).join(' / ') || '（空）'}`);
  }
  if (ordinal) {
    const k = Number.parseInt(ordinal[2], 10);
    if (k < 1 || k > hits.length) {
      throw new Error(`${what}里只有 ${hits.length} 张「${want}」（要的是第 ${k} 张，编号 ${hits.map(h => h.i + 1).join('/')}）`);
    }
    return hits[k - 1].i;
  }
  if (hits.length > 1) {
    // **同名同态 = 等价**（打哪张都一样）→ 直接取第一张，不再逼玩家回到会漂移的编号。
    // 状态不同（如一张已激活的咏唱与一张未激活的）才要求显式指定。
    const first = list[hits[0].i];
    const interchangeable = hits.every(h => list[h.i].defId === first.defId
      && !!list[h.i].isActivated === !!first.isActivated);
    if (interchangeable) return hits[0].i;
    throw new Error(`${what}里有 ${hits.length} 张「${want}」且状态不同（编号 ${hits.map(h => h.i + 1).join('/')}）`
      + `——请用「编号+卡名」或「${want}#序号」指定，如 play ${hits[0].i + 1} ${want}`);
  }
  return hits[0].i;
}

// play/swap 的手牌定位：优先「编号+卡名」双重确认；**编号与卡名不符时改按卡名定位**
// （卡名是不漂移的意图，编号会随抽牌前移——三轮试玩的第一高频摩擦）。
// 返回 { skill, note }；note 用于回执里说明发生过回落。
export function pickHandCard(hand, idxOrName, nameArg, byIndex) {
  if (byIndex && nameArg != null) {
    try {
      return { skill: hand[resolveHandArg(hand, idxOrName, nameArg)], note: '' };
    } catch (err) {
      if (!/不是「/.test(err.message)) throw err;   // 越界/找不到卡等错误照常抛
      const i = resolveHandArg(hand, nameArg);
      return { skill: hand[i], note: `（编号 ${idxOrName} 与卡名不符，已按卡名定位到第 ${i + 1} 张）` };
    }
  }
  return { skill: hand[resolveHandArg(hand, idxOrName)], note: '' };
}

// 候选列表（元素数组）同款两种写法；只给名字时返回命中的**元素本身**
export function resolveChoiceArg(choices, idxOrName, nameArg, what = '候选', nameOf = (x) => x) {
  if (isIdxArg(idxOrName)) return resolveChoiceStrict(choices, idxOrName, nameArg, what, nameOf);
  const hits = choices.map((c, i) => ({ c, name: nameOf(c) })).filter(h => nameMatches(idxOrName, h.name));
  if (!hits.length) {
    throw new Error(`${what}里没有「${idxOrName}」。当前：${choices.map(c => nameOf(c)).join(' / ')}`);
  }
  if (hits.length > 1) {
    throw new Error(`${what}里有 ${hits.length} 个「${idxOrName}」——请用「编号+名称」指定`);
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
