import { getRelicDefinition, allRelics } from '../../relics/registry.js';
import { grantRelic, activeRelics } from '../prep.js';
import { allSkills } from '../../skills/registry.js';
import { getSkillDefinition } from '../../skills/registry.js';
import { createSkillRuntime } from '../../state/skillRuntime.js';

// 古尔帕斯之店（SHOP.md §二）：本该是一场战斗的 35 层，被古佩·诗菲改造成了店铺。
// 昂贵、稀有、几乎全是旧魏启大陆的东西——**S/A 遗物的唯一稳定渠道**，并提供删卡服务。
//
// 实装范围（第一批）：
//   · 货架：S 级遗物（不再补货、不卖已拥有的）+ 一件她中意的 A/B/C + 非槽位式遗物 + 若干 A 级遗物
//           + A 级卡包（全 A 三选一）+ B 级卡包 + 删卡服务（每次最多两张）
//   · 收购：只收 A/S 级遗物（A 90~120 / S 150~200）
//   · 与瑞米售货机互斥（她店里不设售货机）、价格与机制在肉鸽模式下与故事模式一致且不打折
//   · 同层货架不重掷（买光不补，换层换新货）——与售货机同口径
//
// 未实装（属故事模式大项）：跨轮回回购/捡漏 7 折/「最后一果」苹果与挑战战/初见对话；
// 「携带 S/A 遗物暴毙 → 流入此处」也需要跨轮回存档，一并留待故事模式。

export const GURPAS_FLOOR = 35;

export const GURPAS = Object.freeze({
  prices: {
    relicS: [190, 390],       // S 级遗物（不补货）
    relicCherished: [120, 240], // "一件她中意的 A/B/C 级遗物"
    relicA: [100, 200],       // 总有几件
    relicNonSlot: [100, 200], // 0 槽拾起即生效
    packA: [90, 120],
    packB: [30, 50],
    removeCard: [90, 130],
  },
  sell: { A: [90, 120], S: [150, 200] },  // 只收 A/S
  removeMax: 2,                            // 删卡服务每次最多两张
  aRelicCount: 2,                          // "总有几件" A 级
  packChoices: 3,
});

const intIn = (range, rng) => range[0] + Math.floor(rng.next() * (range[1] - range[0] + 1));

const isGurpasOnly = (def) => (def?.acquisition ?? []).includes('gurpas');
const isEventOnly = (def) => (def?.acquisition ?? []).includes('event');
const owned = (run) => new Set(run.player.relics ?? []);

/** 本层货架（进店时掷好并缓存；同层不重掷 = 买光不补，换层换新货）。 */
export function ensureGurpasStock(run) {
  if (run.gurpas?.floor === run.floor) return run.gurpas;
  const has = owned(run);
  const pool = allRelics();
  const take = (defs, count, priceKey) => {
    const out = [];
    for (const def of defs) {
      if (out.length >= count) break;
      if (has.has(def.id) || out.some(x => x.relicId === def.id)) continue;
      out.push({
        id: `relic:${def.id}`, kind: 'relic', relicId: def.id, rarity: def.rarity,
        label: `${def.rarity} 级遗物 · ${def.name}`,
        sub: def.description ?? '',
        price: intIn(GURPAS.prices[priceKey], run.rng),
        sold: false,
      });
    }
    return out;
  };
  const items = [];
  // S 级：她这儿卖的 S 遗物（古尔帕斯专属，不补货；已拥有不卖）
  items.push(...take(pool.filter(d => d.rarity === 'S' && isGurpasOnly(d)), 1, 'relicS'));
  // 一件她中意的 A/B/C 级（古尔帕斯专属）
  items.push(...take(pool.filter(d => d.rarity !== 'S' && isGurpasOnly(d)), 1, 'relicCherished'));
  // 非槽位式遗物（0 槽，捡到即生效）
  items.push(...take(pool.filter(d => d.nonSlot && !isEventOnly(d) && !isGurpasOnly(d)), 1, 'relicNonSlot'));
  // A 级遗物：总有几件
  items.push(...take(pool.filter(d => d.rarity === 'A' && !isEventOnly(d) && !isGurpasOnly(d)),
    GURPAS.aRelicCount, 'relicA'));
  // A / B 级卡包（开出全 A / 全 B 的三选一）
  for (const [packId, tier, key, label] of [['gurpasA', 'A', 'packA', 'A 级卡包'], ['gurpasB', 'B', 'packB', 'B 级卡包']]) {
    items.push({
      id: packId, kind: 'pack', tier, label, sub: `开出全 ${tier} 级卡的三选一`,
      price: intIn(GURPAS.prices[key], run.rng), sold: false,
    });
  }
  // 删卡服务（可重复购买到上限）
  items.push({
    id: 'removeCard', kind: 'remove', label: '删卡服务',
    sub: `从牌库中彻底抹掉一张牌（本次最多 ${GURPAS.removeMax} 张）`,
    price: intIn(GURPAS.prices.removeCard, run.rng), sold: false, used: 0,
  });
  run.gurpas = { floor: run.floor, items, pendingPack: null, soldToHer: [] };
  return run.gurpas;
}

export function gurpasView(run) {
  const g = ensureGurpasStock(run);
  return {
    money: run.player.money,
    items: g.items.map(it => ({ ...it })),
    pendingPack: g.pendingPack
      ? { packId: g.pendingPack.packId, choices: [...g.pendingPack.choices] }
      : null,
    // 收购：只收 A/S（可卖 = 拥有的 A/S 且未装备？文档未禁止卖装备中的，故都列出）
    sellable: (run.player.relics ?? [])
      .map(id => getRelicDefinition(id))
      .filter(def => def && ['A', 'S'].includes(def.rarity))
      .map(def => ({
        relicId: def.id, name: def.name, rarity: def.rarity,
        price: sellPrice(run, def), equipped: activeRelics(run).includes(def.id),
      })),
  };
}

/** 收购价（文档 A 90~120 / S 150~200；当次掷定，进快照供 UI 显示）。 */
export function sellPrice(run, def) {
  if (!def) return 0;
  const range = GURPAS.sell[def.rarity];
  if (!range) throw new Error('她只收 A 级与 S 级遗物');
  return intIn(range, run.rng);
}

/** 货架价（只读，不掷）。 */
export const gurpasPriceOf = (run, index) => ensureGurpasStock(run).items[index]?.price ?? 0;

/**
 * 购买一件货架商品：遗物直接入包；卡包挂 `pendingPack` 等三选一（买到即开）；
 * 删卡服务扣费并记一次额度（牌由 removeCardAtGurpas 落地）。
 */
export function buyGurpas(run, index) {
  const g = ensureGurpasStock(run);
  const it = g.items[index];
  if (!it) throw new Error(`货架上没有这一件：${index}`);
  if (it.sold) throw new Error('这件已经卖掉了（她这里买光不补）');
  if (it.kind === 'remove' && it.used >= GURPAS.removeMax) {
    throw new Error(`本次的删卡服务已用完（最多 ${GURPAS.removeMax} 张）`);
  }
  if (run.player.money < it.price) throw new Error(`金币不足（需要 ${it.price}，持有 ${run.player.money}）`);
  run.player.money -= it.price;

  if (it.kind === 'remove') {
    it.used += 1;
    return { kind: 'remove', price: it.price, remaining: GURPAS.removeMax - it.used };
  }
  if (it.kind === 'pack') {
    const choices = rollTierChoices(run, it.tier);
    if (!choices.length) throw new Error('这个等阶暂时没有可开的卡');
    it.sold = true;
    g.pendingPack = { packId: it.id, choices };
    return { kind: 'pack', packId: it.id, choices };
  }
  if (it.kind === 'relic') {
    grantRelic(run, it.relicId);
    it.sold = true;   // S 级不补货；其余卖光也不补（同层货架）
    return { kind: 'relic', relicId: it.relicId };
  }
  // 兜底：未知商品类型
  it.sold = true;
  return { kind: it.kind };
}

/** 卡包收尾：三选一挑一张入组。 */
export function takeGurpasCard(run, defId) {
  const g = ensureGurpasStock(run);
  const p = g.pendingPack;
  if (!p) throw new Error('当前没有待选择的卡包');
  if (!p.choices.includes(defId)) throw new Error(`卡不在候选里：${defId}`);
  run.player.deck.push(createSkillRuntime(defId));
  g.pendingPack = null;
  return run;
}

/** 删卡服务落地：把一张牌从牌库彻底抹掉。 */
export function removeCardAtGurpas(run, uniqueID) {
  const idx = run.player.deck.findIndex(c => c.uniqueID === uniqueID);
  if (idx < 0) throw new Error('牌库里没有这张卡');
  const def = getSkillDefinition(run.player.deck[idx].defId);
  run.player.deck.splice(idx, 1);
  return def?.name ?? uniqueID;
}

/** 收购遗物（只收 A/S）：她拿走，你拿钱。 */
export function sellGurpasRelic(run, relicId) {
  const def = getRelicDefinition(relicId);
  if (!def) throw new Error(`没有这个遗物：${relicId}`);
  if (!['A', 'S'].includes(def.rarity)) throw new Error('她只收 A 级与 S 级遗物');
  if (!(run.player.relics ?? []).includes(relicId)) throw new Error('你没有这件遗物');
  const price = sellPrice(run, def);
  run.player.relics = run.player.relics.filter(id => id !== relicId);
  run.player.equippedRelics = (run.player.equippedRelics ?? []).filter(id => id !== relicId);
  run.player.money += price;
  ensureGurpasStock(run).soldToHer.push(relicId);
  return { price, name: def.name };
}

/**
 * 按等阶掷三选一候选（全 A / 全 B；种子化、互不重复）。
 * **不走灵脉门禁**：古尔帕斯的货是旧大陆的真货，她不管你的灵脉等级——
 * 这正是「直接能开出全 A 级卡的三选一卡包」的意义（普通奖励包受门禁限制）。
 * 衍生牌（canSpawnAsReward: false，如斩的碎铁/枪械弹种）不入候选。
 */
export function rollTierChoices(run, tier, count = GURPAS.packChoices) {
  const pool = allSkills().filter(d => d.tier === tier && d.canSpawnAsReward !== false);
  if (!pool.length) return [];
  const left = [...pool];
  const out = [];
  while (out.length < count && left.length) {
    const idx = Math.floor(run.rng.next() * left.length);
    out.push(left.splice(idx, 1)[0].id);
  }
  return out;
}
