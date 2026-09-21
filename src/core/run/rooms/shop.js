// 瑞米维护的自动售货机（SHOP.md §一）：常规补给。
//
// 定位：给金币一个稳定的日常出口，用确定性平衡卡包三选一的随机性——想买什么，这里能直接买到。
// 出没：固定 4/8、15/19、25/29、36/40 层——这些楼层**整层就是商店房**（`roomOfFloor` 直接给
// `'shop'`，房间场景是一间比战斗房空旷的货房，售货机摆在固定位置；用户定 2026-09-12）。
// 每次遇到刷新货架，买光不补。
//
// 与瑞米的联动**仅故事模式**（肉鸽模式：货架恒定满、无折扣、无对话、遗物随机刷新）：
//   · 瑞米被打跑 → 下次遇到时货架不完整（少一件）+ 一句道歉
//   · 瑞米等级越高 → 货架位更多、偶有折扣
//
// 古尔帕斯之店（第 35 层，SHOP.md §二）是**另一条渠道**，不在本文件：它要改造战斗层、卖 S 遗物、
// 回收遗物与删卡服务，留待下一批。

import { draftRelics } from '../../relics/draft.js';
import { grantRelic } from '../prep.js';
import {
  availablePacks, PACKS, rollSkillChoices,
  packCardPool, rewardTierTable, rewardTierCap,
} from '../rewards.js';
import { createSkillRuntime } from '../../state/skillRuntime.js';

// 商店房楼层（每章两次；已避开训练层 4N-2、Boss 层 11N 与 Boss 前营地层）
export const SHOP_FLOORS = Object.freeze([4, 8, 15, 19, 25, 29, 36, 40]);
export const isShopFloor = (floor) => SHOP_FLOORS.includes(floor);

// 价格（SHOP.md 表；区间内由 rng 定值 → 同种子同价格）
// 遗物货位 2026-09-13 起改「稀有度遗物包」（买到开三选一，用户定：只卖随机一件选择面太窄，
// 玩家选不到真正有用的遗物）——三选一严格优于随机一件，价位较旧单件上浮约 25%。
export const SHOP_PRICE = Object.freeze({
  potion: 20,
  apple: 199,
  relicC: [32, 42],
  relicB: [55, 70],
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

/** 卡包价格（20–25 区间随机）：2026-09-21 大调后开包分布与体系等级脱钩（来源制），
 * 价格不再随门禁上浮。 */
function packPrice(run, packId, rng) {
  return SHOP_PRICE.packBase + Math.floor(rng.next() * 6);
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

  // 恢复药剂：总是有且只有一件
  items.push(makeItem('potion', {
    id: 'potion', name: '恢复药剂', label: '恢复药剂', sub: '恢复 25% 生命上限',
    effect: '恢复 25% 生命上限',
    price: SHOP_PRICE.potion,
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

  while (items.length < slots && kinds.length) {
    const total = kinds.reduce((s, [, w]) => s + w, 0);
    let roll = rng.next() * total;
    let kind = kinds[0][0];
    for (const [k, w] of kinds) { roll -= w; if (roll < 0) { kind = k; break; } }

    if (kind === 'pack') {
      // 一柜只放一个卡包：中过就从候选里摘掉（⚠ 必须是摘除而不是 continue——
      // kinds 只剩 pack 时 continue 就是死循环，货架件数 > 1+非遗包候选数 时必现）
      kinds.splice(kinds.findIndex(([k]) => k === 'pack'), 1);
      const packs = availablePacks(run).map(p => p.id);
      if (!packs.length) continue;            // 无可用卡包：这一档轮空
      const packId = packs[Math.floor(rng.next() * packs.length)];
      const packName = PACKS[packId]?.name ?? packId;
      items.push(makeItem('pack', {
        id: `pack:${packId}`, packId,
        name: `${packName}卡包`, label: `卡包 · ${packName}`,
        sub: '买到即开，包内三选一', effect: '买到即开，包内三选一',
        price: packPrice(run, packId, rng),
      }));
    } else if (kind === 'apple') {
      items.push(makeItem('apple', {
        id: 'apple', name: '瑞米最爱的苹果', label: '瑞米最爱的苹果',
        sub: '喂给瑞米，提升等级与好感', effect: '瑞米果实 +1（等级与好感提升）',
        price: SHOP_PRICE.apple,
      }));
      kinds.splice(kinds.findIndex(([k]) => k === 'apple'), 1); // 只放一件
    } else {
      // 遗物货位 = 「稀有度遗物包」：货架只标档位不标具体件（选择面交给购买后的三选一，
      // 2026-09-13 用户定）；具体三件在购买那一刻才由抽选 SDK 掷出（门禁/驱重/兜底集中）。
      const rarity = kind === 'relicC' ? 'C' : 'B';
      items.push(makeItem('relic', {
        id: `relicPack:${rarity}`, rarity,
        name: `${rarity} 级遗物包`, label: `${rarity} 级遗物包 · 三选一`,
        sub: '买到即开，三件中挑一件（可放弃）', effect: '买到即开，三件中挑一件（可放弃）',
        price: priceIn(rarity === 'C' ? SHOP_PRICE.relicC : SHOP_PRICE.relicB, rng),
      }));
      kinds.splice(kinds.findIndex(([k]) => k === kind), 1); // 同一档一柜只放一个
    }
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

// 等阶显示序（概率分布行用）
const TIER_ORDER = ['C', 'B', 'A', 'S'];

/**
 * 货品的 hover 说明（纯文本 tooltip 载荷 { title, body }）。
 * 恢复药剂/苹果这类没有卡面的东西 **必须**有说明，否则玩家不知道买了会怎样（用户定 2026-09-12）；
 * 卡包则给出「随机 3 张 + 概率分布」——商店卡包走 normal 通道分布（REWARD_TIER_TABLE）
 * 在池内实际存在的等阶上归一，与开包时的真实抽取同源，不写死数字。
 */
export function shopItemTip(run, it) {
  if (!it) return null;
  if (it.kind === 'pack' && it.packId) {
    const pool = packCardPool(run, it.packId, rewardTierCap('normal'));
    const table = rewardTierTable('normal');
    const tiers = TIER_ORDER.filter(t => pool.some(d => d.tier === t) && (table[t] ?? 0) > 0);
    const total = tiers.reduce((s, t) => s + table[t], 0);
    const dist = tiers
      .map(t => `${t} 级 ${Math.round((table[t] / total) * 100)}%`)
      .join(' ｜ ');
    return {
      title: it.name ?? '卡包',
      body: `包含随机 3 张${PACKS[it.packId]?.name ?? it.packId}卡牌`
        + (dist ? `。概率分布：${dist}。` : '。') + '买到即开，可三选一（也可以放弃）。',
    };
  }
  if (it.kind === 'relic' && it.rarity) {
    // 遗物包 hover：告知档位数与「三选一可放弃」——具体三件在买的那一刻才掷（门禁/驱重），
    // 这里只承诺口径不列名单（名单会随你背包里的拥有集变化）。
    return {
      title: it.name ?? `${it.rarity} 级遗物包`,
      body: `买到即开：从全部可获得的 ${it.rarity} 级遗物中随机摆出 3 件，挑 1 件收入囊中`
        + '（都不想要可以放弃，钱不退）。已拥有的遗物不会再出现。',
    };
  }
  return { title: it.name ?? it.label ?? '', body: it.effect ?? it.sub ?? '' };
}

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
  // 待选是**单槽**：连买第二件包会静默覆盖第一件，先买的钱白花（2026-09-19 试玩实报）。
  // 先领完（act shop claim）再买；非包类货品不占槽，不受影响。
  if (run.shopPending && (it.kind === 'pack' || it.kind === 'relic')) {
    throw new Error('先把待选的卡包/遗物包选完，再买下一件');
  }

  run.player.money -= it.price;
  it.sold = true;

  switch (it.kind) {
    case 'potion': {
      const p = run.player;
      p.hp = Math.min(p.maxHp, p.hp + Math.ceil(p.maxHp * 0.25));
      return { kind: 'potion', healed: true };
    }
    case 'apple': {
      run.remi.fruits += 1;              // 果实数即等级口径
      run.shopAppleBought = true;        // 全流程仅一件
      return { kind: 'apple' };
    }
    case 'relic': {
      // 遗物包买到即开：立刻掷三选一（抽选 SDK 统一门禁/驱重/兜底），挂起选择
      //（金币已扣，不能退款；放弃出口在 takeShopRelic(null)）
      const choices = draftRelics(run, 3, { rarity: it.rarity, sources: ['vending'] });
      run.shopPending = { kind: 'relic', rarity: it.rarity, choices };
      return { kind: 'relicPack', rarity: it.rarity, choices };
    }
    case 'pack': {
      // 买到即开：立刻掷包内三选一，挂起选择（金币已扣，不能退款）
      const choices = rollSkillChoices(run, it.packId);
      run.shopPending = { kind: 'pack', packId: it.packId, choices };
      return { kind: 'pack', packId: it.packId, choices };
    }
    default:
      return { kind: it.kind };
  }
}

/**
 * 开包三选一的收尾：把选中的卡加入牌组并清挂起。
 * `defId = null` = **放弃这个卡包**（用户定 2026-09-12：三选一必须可以放弃——开出来的三张
 * 都不想要是玩家的正当选择；钱已经花了，放弃只是不要牌，不退款）。
 */
export function takeShopCard(run, defId = null) {
  const pending = run.shopPending;
  if (!pending || pending.kind === 'relic') throw new Error('当前没有待选择的卡包');
  if (defId != null && !pending.choices.includes(defId)) throw new Error(`卡不在候选里：${defId}`);
  if (defId != null) run.player.deck.push(createSkillRuntime(defId));
  run.shopPending = null;
  return run;
}

/**
 * 遗物包三选一的收尾（2026-09-13 用户定的「稀有度遗物包」）：
 * 选中的遗物入包（grantRelic：一局内唯一，重复抛错——候选由抽选 SDK 驱重，正常不会撞）；
 * `relicId = null` = 放弃这个遗物包（与卡包同口径：钱已花，选择权在玩家）。
 */
export function takeShopRelic(run, relicId = null) {
  const pending = run.shopPending;
  if (!pending || pending.kind !== 'relic') throw new Error('当前没有待选择的遗物包');
  if (relicId != null && !pending.choices.includes(relicId)) throw new Error(`遗物不在候选里：${relicId}`);
  if (relicId != null) grantRelic(run, relicId);
  run.shopPending = null;
  return run;
}
