// 瑞米维护的自动售货机（SHOP.md §一）：常规补给。
//
// 定位：给金币一个稳定的日常出口，用确定性平衡卡包三选一的随机性——想买什么，这里能直接买到。
// 出没：固定 4/8、15/19、25/29、36/40 层的休息阶段，**不占奖励房名额**（与老虎机/营地/事件并存，
// 是休息阶段的一个常驻货架）。每次遇到刷新货架，买光不补。
//
// 与瑞米的联动**仅故事模式**（肉鸽模式：货架恒定满、无折扣、无对话、遗物随机刷新）：
//   · 瑞米被打跑 → 下次遇到时货架不完整（少一件）+ 一句道歉
//   · 瑞米等级越高 → 货架位更多、偶有折扣
//
// 古尔帕斯之店（第 35 层，SHOP.md §二）是**另一条渠道**，不在本文件：它要改造战斗层、卖 S 遗物、
// 回收遗物与删卡服务，留待下一批。

import { draftRelic } from '../../relics/draft.js';
import { grantRelic } from '../prep.js';
import { allRelics, getRelicDefinition } from '../../relics/registry.js';
import { availablePacks, PACKS, rollSkillChoices, maxRewardTier, TIER_RANK } from '../rewards.js';
import { createSkillRuntime } from '../../state/skillRuntime.js';

// 出没楼层（每章两次；已避开训练层 4N-2、Boss 层 11N 与 Boss 前营地层）
export const SHOP_FLOORS = Object.freeze([4, 8, 15, 19, 25, 29, 36, 40]);
export const isShopFloor = (floor) => SHOP_FLOORS.includes(floor);

// 价格（SHOP.md 表；区间内由 rng 定值 → 同种子同价格）
export const SHOP_PRICE = Object.freeze({
  potion: 20,
  apple: 199,
  relicC: [25, 35],
  relicB: [45, 60],
  packBase: 20,
});

const RELIC_TIER_RANK = Object.freeze({ C: 0, B: 1, A: 2, S: 3 });

/** 瑞米等级（故事模式）：局内累积的果实数即等级口径（4 果 = 4 级）。 */
export const remiLevel = (run) => run.remi?.fruits ?? 0;

/** 货架件数：肉鸽恒定 3；故事模式随瑞米等级 3→5。 */
export function shelfSize(run) {
  if (!run.storyMode) return 3;
  const lv = remiLevel(run);
  return 3 + (lv >= 2 ? 1 : 0) + (lv >= 4 ? 1 : 0);
}

/** 折扣：故事模式且瑞米等级 ≥3 时偶发 8 折（肉鸽模式无折扣）。 */
function rollDiscount(run) {
  if (!run.storyMode) return 1;
  if (remiLevel(run) < 3) return 1;
  return run.rng.next() < 0.25 ? 0.8 : 1;
}

const priceIn = (range, rng) => range[0] + Math.floor(rng.next() * (range[1] - range[0] + 1));

/** 卡包价格随门禁上浮（20–35）：解锁到 B +5、到 A +10，再加 0–5 随机。 */
function packPrice(run, packId, rng) {
  const rank = TIER_RANK[maxRewardTier(run, packId)] ?? 0;
  return SHOP_PRICE.packBase + Math.min(10, rank * 5) + Math.floor(rng.next() * 6);
}

/** 造一件货（价格已按折扣折过）。 */
function makeItem(kind, payload) {
  return { kind, sold: false, ...payload };
}

/**
 * 掷当层货架（内部用；外部走 ensureShopStock）。
 * 构成：恢复药剂恒有且仅有一件；其余按权重在「卡包 / C 遗物 / B 遗物 / 苹果」里取，
 * 取到重复类型时不重复放同名货（卡包与遗物各自去重，遗物已拥有的由抽选 SDK 排除）。
 */
function rollStock(run) {
  const rng = run.rng;
  const items = [];
  const usedRelics = [];

  // 恢复药剂：总是有且只有一件
  items.push(makeItem('potion', {
    id: 'potion', label: '恢复药剂', sub: '恢复 15% 生命上限', price: SHOP_PRICE.potion,
  }));

  // 故事模式：瑞米被打跑则货架不完整（少一件）+ 道歉文案
  const story = !!run.storyMode;
  const broken = story && !!run.remi?.drivenOff;
  let slots = shelfSize(run) - (broken ? 1 : 0);

  const wantApple = story && !run.shopAppleBought && rng.next() < 0.35; // 偶尔能见到
  const kinds = [
    ['pack', 34],
    ['relicC', 32],
    ['relicB', 14],
    ...(wantApple ? [['apple', 8]] : []),
  ];
  let packPicked = false;

  while (items.length < slots) {
    const total = kinds.reduce((s, [, w]) => s + w, 0);
    let roll = rng.next() * total;
    let kind = kinds[0][0];
    for (const [k, w] of kinds) { roll -= w; if (roll < 0) { kind = k; break; } }

    if (kind === 'pack') {
      if (packPicked) continue;             // 一柜只放一个卡包
      const packs = availablePacks(run).map(p => p.id);
      const packId = packs[Math.floor(rng.next() * packs.length)];
      items.push(makeItem('pack', {
        id: `pack:${packId}`, packId,
        label: `卡包 · ${PACKS[packId]?.name ?? packId}`,
        sub: '买到即开，包内三选一',
        price: packPrice(run, packId, rng),
      }));
      packPicked = true;
    } else if (kind === 'apple') {
      items.push(makeItem('apple', {
        id: 'apple', label: '瑞米最爱的苹果', sub: '喂给瑞米，提升等级与好感',
        price: SHOP_PRICE.apple,
      }));
      kinds.splice(kinds.findIndex(([k]) => k === 'apple'), 1); // 只放一件
    } else {
      const rarity = kind === 'relicC' ? 'C' : 'B';
      const relicId = draftRelic(run, { rarity, sources: ['vending'], exclude: usedRelics });
      if (!relicId) continue;               // 该档没货了 → 换别的东西再掷
      usedRelics.push(relicId);
      items.push(makeItem('relic', {
        id: `relic:${relicId}`, relicId, rarity,
        label: `${rarity} 级遗物 · ${getRelicDefinition(relicId)?.name ?? relicId}`,
        sub: getRelicDefinition(relicId)?.description ?? '',
        price: priceIn(rarity === 'C' ? SHOP_PRICE.relicC : SHOP_PRICE.relicB, rng),
      }));
    }
    if (usedRelics.length > 6) break;       // 兜底防死循环（遗物池被抽干的极端情况）
  }

  const discount = rollDiscount(run);
  if (discount !== 1) for (const it of items) it.price = Math.max(1, Math.round(it.price * discount));

  return { floor: run.floor, discount, items, broken };
}

/**
 * 进入休息阶段时确保当层货架已掷好（**按楼层缓存**：同一次遇到不重掷，下次遇到换新货）。
 * 非商店层 → 清空（货架只在商店层存在）。
 */
export function ensureShopStock(run) {
  if (!isShopFloor(run.floor)) { run.shop = null; return run; }
  if (run.shop?.floor === run.floor) return run; // 同层已掷：不重掷（买光不补）
  run.shop = rollStock(run);
  return run;
}

/** 该件是否买得起（已售出的不能再买）。 */
export const canBuy = (run, index) => {
  const it = run.shop?.items?.[index];
  return !!it && !it.sold && run.player.money >= it.price;
};

/**
 * 购买（SHOP.md：买到即开/即得）。扣费与发货同步完成，失败不改状态。
 * 卡包不直接给卡——挂起 `run.shopPending`（包内三选一），由 takeShopCard 收尾。
 */
export function buyShopItem(run, index) {
  const it = run.shop?.items?.[index];
  if (!it) throw new Error(`货架上没有这一件：${index}`);
  if (it.sold) throw new Error('这件已经卖掉了');
  if (run.player.money < it.price) throw new Error(`金币不足（需要 ${it.price}）`);
  if (it.kind === 'apple' && !run.storyMode) throw new Error('这个货架在肉鸽模式里没有苹果');

  run.player.money -= it.price;
  it.sold = true;

  switch (it.kind) {
    case 'potion': {
      const p = run.player;
      p.hp = Math.min(p.maxHp, p.hp + Math.ceil(p.maxHp * 0.15));
      return { kind: 'potion', healed: true };
    }
    case 'apple': {
      run.remi.fruits += 1;              // 果实数即等级口径
      run.shopAppleBought = true;        // 全流程仅一件
      return { kind: 'apple' };
    }
    case 'relic': {
      grantRelic(run, it.relicId);
      return { kind: 'relic', relicId: it.relicId };
    }
    case 'pack': {
      // 买到即开：立刻掷包内三选一，挂起选择（金币已扣，不能退款）
      const choices = rollSkillChoices(run, it.packId);
      run.shopPending = { packId: it.packId, choices };
      return { kind: 'pack', packId: it.packId, choices };
    }
    default:
      return { kind: it.kind };
  }
}

/** 开包三选一的收尾：把选中的卡加入牌组并清挂起。 */
export function takeShopCard(run, defId) {
  const pending = run.shopPending;
  if (!pending) throw new Error('当前没有待选择的卡包');
  if (!pending.choices.includes(defId)) throw new Error(`卡不在候选里：${defId}`);
  run.player.deck.push(createSkillRuntime(defId));
  run.shopPending = null;
  return run;
}
