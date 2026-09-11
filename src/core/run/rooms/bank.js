import { getSkillDefinition, allSkills } from '../../skills/registry.js';
import { promoteCard } from '../promotion.js';

// 银行机（SLOT_MACHINE.md §银行机）：与老虎机成对出现，关键词是**资源的时间价值**。
//
// 规则口径（文档逐条对应）：
//   · 存款后每过一层，连击数 +1；利率每层结算，与连击数有关（见 BANK.rates）；
//   · 任何取款打断连击（归零）；任何存款让连击下跌到至多 2；
//   · 死亡导致存款清空（run 终局时清）；
//   · **超额取款**：立刻拿到金币，代价是接受一次恶魔 roll——按档给出三个不同词条，
//     必须选一个；选中的词条按自身节奏生效（立即 / 下一场战斗 / 下三场战斗 / 永久）。
//   · 通过一次黑色级恶魔 roll 且没死 → 该词条移出本场游戏，且**再次见到银行机时不允许
//     超额取款**（至少下一次见面才恢复，用 lockout 计数表达）。
//
// 跨战斗计时：`run.pendingDebuffs = [{ id, battlesLeft }]`——PreBattle 折入本场
// （battleState.debuffs 标量 + 战斗开始类效果），战后每场 -1、归零移除。
// 未实装：故事模式的跨轮回剧情（存满 900 金佣金 / 银行机跑路 / 对话）——那属于故事模式大项。

export const BANK = Object.freeze({
  // 每层利率（连击档 → 每 X 金产出 Y 金）：文档原表
  rates: [
    { minCombo: 5, per: 7, yield: 2 },
    { minCombo: 4, per: 4, yield: 1 },   // 4 连击
    { minCombo: 3, per: 9, yield: 2 },   // 3 连击
    { minCombo: 0, per: 5, yield: 1 },   // 2 连击或以下
  ],
  // 超额取款的档位（拿到的金币 = 该档所承受词条的等级）
  tiers: [
    { id: 'yellow', gold: 15, name: '黄色级', rolls: 3 },
    { id: 'red', gold: 40, name: '红色级', rolls: 3 },
    { id: 'black', gold: 90, name: '黑色级', rolls: 3 },
  ],
  lockoutVisits: 1,   // 通过黑色级后，接下来这么多次「见到银行机」不允许超额取款
  depositComboCap: 2, // 存款后连击至多降到这个数
});

const TIER_ORDER = ['yellow', 'red', 'black'];

// ---- 恶魔词条表（SLOT_MACHINE.md §恶魔roll；24+1 条逐条对应）----
// 字段：tier / name / desc / immediate(立即) / permanent(永久数值) / battle(跨战斗) / offer(可选操作)
const loser = (run, pct) => {
  const p = run.player;
  p.hp = Math.max(1, p.hp - Math.floor(p.hp * pct));
};
const heal = (run, n) => { run.player.hp = Math.min(run.player.maxHp, run.player.hp + n); };

/** 随机焚毁牌库中的卡（S 级豁免）；返回被焚的卡名。 */
export function burnRandomDeckCards(run, count, { rng = run.rng } = {}) {
  const burned = [];
  for (let i = 0; i < count; i++) {
    const pool = run.player.deck.filter(rt => getSkillDefinition(rt.defId)?.tier !== 'S');
    if (!pool.length) break;
    const pick = pool[Math.floor(rng.next() * pool.length)];
    const idx = run.player.deck.findIndex(rt => rt.uniqueID === pick.uniqueID);
    if (idx < 0) break;
    run.player.deck.splice(idx, 1);
    burned.push(getSkillDefinition(pick.defId)?.name ?? pick.defId);
  }
  return burned;
}

/** 随机降级牌库中的一张卡（按 promotesTo 反查上一阶）；返回 [原名, 降级后名]。 */
export function downgradeRandomDeckCards(run, count, { rng = run.rng } = {}) {
  const done = [];
  const downgradeTo = (defId) => {
    for (const def of allSkills()) {
      if (def.promotesTo === defId) return def.id;
    }
    return null;
  };
  for (let i = 0; i < count; i++) {
    const pool = run.player.deck.filter(rt => downgradeTo(rt.defId));
    if (!pool.length) break;
    const pick = pool[Math.floor(rng.next() * pool.length)];
    const from = getSkillDefinition(pick.defId)?.name ?? pick.defId;
    const prevId = downgradeTo(pick.defId);
    pick.defId = prevId;
    pick.uniqueID = pick.uniqueID; // 实例身份不变（只换定义）
    done.push([from, getSkillDefinition(prevId)?.name ?? prevId]);
  }
  return done;
}

export const DEMON_DEBUFFS = Object.freeze({
  // ---- 黑色级（90 金）----
  grievousWound: {
    tier: 'black', name: '重伤', desc: '损失 65% 当前生命值，但生命上限永远 +3。',
    immediate: (run) => loser(run, 0.65), permanent: { maxHp: 3 },
  },
  oblivion: {
    tier: 'black', name: '忘却', desc: '随机焚毁你牌库中 2 张卡牌（不会焚 S 级卡），然后你可选一张卡焚毁。',
    immediate: (run) => burnRandomDeckCards(run, 2), offer: 'burn',
  },
  daze: {
    tier: 'black', name: '浑浑噩噩',
    desc: '下一场战斗中，初始抽牌数 -1、回合开始时抽牌数 -1，但你可立马选一张卡升级。',
    battle: { battles: 1, initialDrawPenalty: 1, drawPenaltyTurns: 99 }, offer: 'upgrade',
  },
  fragileFive: {
    tier: 'black', name: '脆弱', desc: '下一场战斗中，战斗开始时脆弱 5，但你立刻恢复 5 生命。',
    battle: { battles: 1, startEffects: [['fragile', 5]] }, immediate: (run) => heal(run, 5),
  },
  weakSeven: {
    tier: 'black', name: '无力', desc: '下一场战斗中，战斗开始时虚弱 7，但你攻击永远 +1。',
    battle: { battles: 1, startEffects: [['weaken', 7]] }, permanent: { attack: 1 },
  },
  despair: {
    tier: 'black', name: '绝望', desc: '下一场战斗中，你于第 4 回合结束时死亡，下次遇到老虎机会送你一次免费 roll。',
    battle: { battles: 1, deathAtTurnEnd: 4 }, immediate: (run) => { run.slotFreeRolls += 1; },
  },
  blindness: {
    tier: 'black', name: '失明', desc: '下一场战斗中，你无法看见敌人意图。',
    battle: { battles: 1, blind: true },
  },
  maimed: {
    tier: 'black', name: '残废', desc: '下一场战斗中，战斗开始时伤残 5，但你防御永远 +1。',
    battle: { battles: 1, startEffects: [['maim', 5]] }, permanent: { defense: 1 },
  },
  dreamless: {
    tier: 'black', name: '无梦', desc: '下一场战斗中，魏启不再自动回复，但你魏启上限永远 +1。',
    battle: { battles: 1, noManaRegenTurns: 99 }, permanent: { maxMana: 1 },
  },
  // ---- 红色级（40 金）----
  wound: { tier: 'red', name: '受伤', desc: '损失 20% 当前生命值。', immediate: (run) => loser(run, 0.2) },
  forget: {
    tier: 'red', name: '忘记', desc: '随机焚毁你牌库中 1 张卡牌（不会焚 S 级卡）。',
    immediate: (run) => burnRandomDeckCards(run, 1),
  },
  muddle: {
    tier: 'red', name: '昏头', desc: '下三张战斗中，前 2 回合开始时抽牌数 -1。',
    battle: { battles: 3, drawPenaltyTurns: 2 },
  },
  brittleness: {
    tier: 'red', name: '脆性', desc: '下三场战斗中，战斗开始时脆弱 1。',
    battle: { battles: 3, startEffects: [['fragile', 1]] },
  },
  fatigue: {
    tier: 'red', name: '乏力', desc: '下三场战斗中，战斗开始时虚弱 1。',
    battle: { battles: 3, startEffects: [['weaken', 1]] },
  },
  destitute: {
    tier: 'red', name: '落魄', desc: '下三场战斗中，从第 4 回合开始，每回合结束时受到 7 伤害。',
    battle: { battles: 3, dotFromTurn: { turn: 4, amount: 7 } },
  },
  crippled: {
    tier: 'red', name: '残疾', desc: '下三场战斗中，战斗开始时伤残 1。',
    battle: { battles: 3, startEffects: [['maim', 1]] },
  },
  nightmare: {
    tier: 'red', name: '噩梦', desc: '下三场战斗中，前 2 回合，魏启不会自动回复。',
    battle: { battles: 3, noManaRegenTurns: 2 },
  },
  // ---- 黄色级（15 金）----
  scratch: { tier: 'yellow', name: '擦伤', desc: '损失 10% 当前生命值。', immediate: (run) => loser(run, 0.1) },
  drowsy: {
    tier: 'yellow', name: '犯困', desc: '随机降级你牌库中 1 张卡牌。',
    immediate: (run) => downgradeRandomDeckCards(run, 1),
  },
  dizzy: {
    tier: 'yellow', name: '晕乏', desc: '下一张战斗中，前 2 回合开始时抽牌数 -1。',
    battle: { battles: 1, drawPenaltyTurns: 2 },
  },
  soften: {
    tier: 'yellow', name: '软化', desc: '下一场战斗中，战斗开始时脆弱 1。',
    battle: { battles: 1, startEffects: [['fragile', 1]] },
  },
  wearied: {
    tier: 'yellow', name: '劳累', desc: '下一场战斗中，战斗开始时虚弱 1。',
    battle: { battles: 1, startEffects: [['weaken', 1]] },
  },
  disappointment: {
    tier: 'yellow', name: '失望', desc: '下一场战斗中，从第 4 回合开始，每回合结束时受到 7 伤害。',
    battle: { battles: 1, dotFromTurn: { turn: 4, amount: 7 } },
  },
  bleeding: {
    tier: 'yellow', name: '出血', desc: '下一场战斗中，战斗开始时伤残 1。',
    battle: { battles: 1, startEffects: [['maim', 1]] },
  },
  insomnia: {
    tier: 'yellow', name: '失眠', desc: '下一场战斗中，前 2 回合，魏启不会自动回复。',
    battle: { battles: 1, noManaRegenTurns: 2 },
  },
});

export const demonDebuffPool = (tier) =>
  Object.entries(DEMON_DEBUFFS).filter(([, d]) => d.tier === tier).map(([id]) => id);

// ---- 机器状态 ----

/** 银行机状态（跨遇到常驻；首次访问时初始化）。 */
export function bankState(run) {
  if (!run.bank) {
    run.bank = {
      deposit: 0,          // 存款本金（含已滚入的利息）
      combo: 0,            // 连击数（连续持有层数）
      visits: 0,           // 见到银行机的次数
      lockout: 0,          // 剩余"不允许超额取款"的见面次数（通过黑色级后置 1）
      blackCleared: [],    // 已通过（并未死）的黑色词条（移出本场游戏）
      pendingRoll: null,   // 待选词条 { tier, gold, options }
      offers: [],          // 待处理的可选操作（'upgrade' | 'burn'，来自词条）
    };
  }
  return run.bank;
}

/** 当前利率档（按连击数）。 */
export const rateOf = (combo) =>
  BANK.rates.find(r => combo >= r.minCombo) ?? BANK.rates[BANK.rates.length - 1];

/** 本层利息（存款 × 档位）：按「每 per 金产 yield 金」整倍计算。 */
export function interestOf(deposit, combo) {
  const rate = rateOf(combo);
  return Math.floor(deposit / rate.per) * rate.yield;
}

/** 面板/headless 共用的只读视图。 */
export function bankView(run) {
  const b = bankState(run);
  const rate = rateOf(b.combo);
  return {
    money: run.player.money,
    deposit: b.deposit,
    combo: b.combo,
    ratePer: rate.per,
    rateYield: rate.yield,
    nextInterest: interestOf(b.deposit, b.combo + 1), // 过一层后的利息
    visits: b.visits,
    lockout: b.lockout,
    canOverdraft: b.lockout <= 0 && !b.pendingRoll,
    tiers: BANK.tiers.map(t => ({ ...t, cleared: t.id === 'black' ? b.blackCleared.length : 0 })),
    pendingRoll: b.pendingRoll
      ? { ...b.pendingRoll, options: b.pendingRoll.options.map(id => ({ id, ...DEMON_DEBUFFS[id] })) }
      : null,
    offers: [...b.offers],
  };
}

// ---- 存取款 ----

/** 进入银行机（记号访问次数、递减黑名单）。离房时不需要额外清理（状态跨遇到常驻）。 */
export function bankOnVisit(run) {
  const b = bankState(run);
  b.visits += 1;
  if (b.lockout > 0) b.lockout -= 1;
  return bankView(run);
}

/** 存款：连击下跌到至多 2（文档口径）。 */
export function bankDeposit(run, amount) {
  const b = bankState(run);
  if (b.pendingRoll) throw new Error('先处理这次恶魔 roll（选一个词条）');
  const n = amount == null ? run.player.money : Math.floor(amount);
  if (!Number.isFinite(n) || n <= 0) throw new Error('存款数量不合法');
  if (n > run.player.money) throw new Error(`金币不足（持有 ${run.player.money}）`);
  run.player.money -= n;
  b.deposit += n;
  b.combo = Math.min(b.combo, BANK.depositComboCap);
  return bankView(run);
}

/** 取款：一次性取出全部本金+利息，连击打断归零。 */
export function bankWithdraw(run) {
  const b = bankState(run);
  if (b.pendingRoll) throw new Error('先处理这次恶魔 roll（选一个词条）');
  if (b.deposit <= 0) throw new Error('银行机里没有存款');
  const got = b.deposit;
  run.player.money += got;
  b.deposit = 0;
  b.combo = 0;
  return { gold: got, view: bankView(run) };
}

/** 每过一层：连击 +1，存款按新连击档结算利息。 */
export function accrueBankInterest(run) {
  const b = bankState(run);
  if (b.deposit <= 0) return 0;
  b.combo += 1;
  const gain = interestOf(b.deposit, b.combo);
  b.deposit += gain;
  return gain;
}

/** 死亡（run 终局）：存款清空。 */
export function bankOnDeath(run) {
  const b = bankState(run);
  b.deposit = 0;
  b.combo = 0;
  b.pendingRoll = null;
  return b;
}

// ---- 超额取款 / 恶魔 roll ----

/**
 * 超额取款：立刻拿到该档金币，进入恶魔 roll（随机三个**不同**词条，必须选一个）。
 * 黑色级已通过过的词条移出本场游戏（不再出现在 roll 结果里）。
 */
export function bankOverdraft(run, tierId) {
  const b = bankState(run);
  if (b.pendingRoll) throw new Error('上一次恶魔 roll 还没选词条');
  if (b.lockout > 0) throw new Error(`银行机暂时不让你超额取款（再过 ${b.lockout} 次见面）`);
  const tier = BANK.tiers.find(t => t.id === tierId);
  if (!tier) throw new Error(`未知档位：${tierId}（${TIER_ORDER.join('/')}）`);
  let pool = demonDebuffPool(tierId);
  if (tierId === 'black') pool = pool.filter(id => !b.blackCleared.includes(id));
  if (pool.length < tier.rolls) throw new Error('该档词条已被清空（黑色级全通过），换一档');
  // 三个不同词条（种子化洗牌取前 N）
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(run.rng.next() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  run.player.money += tier.gold;
  b.pendingRoll = { tier: tierId, gold: tier.gold, options: shuffled.slice(0, tier.rolls) };
  return bankView(run);
}

/**
 * 选一个词条承受：立即/永久部分就地生效，跨战斗部分进 `run.pendingDebuffs` 队列。
 * 黑色级通过 → 记入 blackCleared 并置 lockout。
 */
export function chooseDemonDebuff(run, id) {
  const b = bankState(run);
  const roll = b.pendingRoll;
  if (!roll) throw new Error('当前没有待选的恶魔词条');
  if (!roll.options.includes(id)) throw new Error(`词条不在候选中：${id}`);
  const def = DEMON_DEBUFFS[id];
  const out = { id, name: def.name, tier: def.tier, immediate: null, battle: null };

  def.immediate?.(run);
  if (def.permanent) applyPermanent(run, def.permanent);
  if (def.offer) b.offers.push(def.offer);
  if (def.battle) {
    run.pendingDebuffs ??= [];
    run.pendingDebuffs.push({ id, battlesLeft: def.battle.battles });
    out.battle = { battles: def.battle.battles };
  }
  if (def.tier === 'black') {
    if (!b.blackCleared.includes(id)) b.blackCleared.push(id);
    b.lockout = BANK.lockoutVisits;
  }
  b.pendingRoll = null;
  return { ...out, view: bankView(run) };
}

/** 永久数值（走 baseStats 口径：`refreshRunModifiers` 重算时保留）。 */
function applyPermanent(run, mods) {
  const p = run.player;
  for (const [k, v] of Object.entries(mods)) {
    if (k === 'maxHp') {
      p.baseStats.maxHp += v;
      p.maxHp += v;
      p.hp = Math.min(p.maxHp, p.hp + v);
    } else if (k === 'maxMana') {
      p.baseStats.maxMana += v;   // 上限提升不恢复魏启（与植入式魏启罐同口径）
      p.maxMana += v;
    } else {
      p.baseStats[k] = (p.baseStats[k] ?? 0) + v;
      p[k] = (p[k] ?? 0) + v;
    }
  }
  return run;
}

// ---- 跨战斗词条队列 ----

/**
 * 把 `pendingDebuffs` 折入本场战斗：写 `battleState.debuffs` 标量并返回「战斗开始类效果」
 * （由 PreBattle 提交 AddEffectInstruction）。战后由 `consumePendingDebuffs` 递减。
 */
export function applyPendingDebuffsToBattle(run, battleState) {
  const queue = run.pendingDebuffs ?? [];
  const d = {
    blind: false, drawPenaltyTurns: 0, noManaRegenTurns: 0, deathAtTurnEnd: 0, dotFromTurn: null,
  };
  const startEffects = [];
  let initialDrawPenalty = 0;
  for (const entry of queue) {
    const spec = DEMON_DEBUFFS[entry.id]?.battle;
    if (!spec) continue;
    if (spec.blind) d.blind = true;
    d.drawPenaltyTurns = Math.max(d.drawPenaltyTurns, spec.drawPenaltyTurns ?? 0);
    d.noManaRegenTurns = Math.max(d.noManaRegenTurns, spec.noManaRegenTurns ?? 0);
    d.deathAtTurnEnd = Math.max(d.deathAtTurnEnd, spec.deathAtTurnEnd ?? 0);
    if (spec.dotFromTurn) d.dotFromTurn = { ...spec.dotFromTurn };
    initialDrawPenalty += spec.initialDrawPenalty ?? 0;
    for (const [effectId, stacks] of spec.startEffects ?? []) startEffects.push([effectId, stacks]);
  }
  battleState.debuffs = d;
  if (initialDrawPenalty > 0) {
    battleState.config.initialDraw = Math.max(0, battleState.config.initialDraw - initialDrawPenalty);
  }
  return startEffects;
}

/** 战后递减：每场 -1，归零移除。 */
export function consumePendingDebuffs(run) {
  const queue = run.pendingDebuffs ?? [];
  const kept = [];
  for (const entry of queue) {
    entry.battlesLeft -= 1;
    if (entry.battlesLeft > 0) kept.push(entry);
  }
  run.pendingDebuffs = kept;
  return kept.map(e => e.id);
}

/** 词条队列的可读摘要（面板/headless 显示）。 */
export function pendingDebuffViews(run) {
  return (run.pendingDebuffs ?? []).map(e => ({
    id: e.id, battlesLeft: e.battlesLeft,
    name: DEMON_DEBUFFS[e.id]?.name ?? e.id, desc: DEMON_DEBUFFS[e.id]?.desc ?? '',
  }));
}

/** 待处理可选操作（'upgrade' 立即免费升级一张 / 'burn' 焚毁一张自选）。 */
export function takeBankOffer(run) {
  const b = bankState(run);
  const offer = b.offers.shift() ?? null;
  return offer;
}

/** 词条附赠：立即免费升级一张（浑浑噩噩）。 */
export function bankUpgrade(run, uniqueID) {
  const b = bankState(run);
  if (!b.offers.includes('upgrade')) throw new Error('当前没有待用的升级');
  const rt = run.player.deck.find(c => c.uniqueID === uniqueID);
  if (!rt) throw new Error('牌库里没有这张卡');
  const result = promoteCard(run, uniqueID);
  if (!result) throw new Error('该卡暂无可用晋升目标，无法升级');
  b.offers.splice(b.offers.indexOf('upgrade'), 1);
  return run;
}

/** 词条附赠：自选焚毁牌库中的一张（忘却）。 */
export function bankBurn(run, uniqueID) {
  const b = bankState(run);
  if (!b.offers.includes('burn')) throw new Error('当前没有待用的焚毁');
  const idx = run.player.deck.findIndex(c => c.uniqueID === uniqueID);
  if (idx < 0) throw new Error('牌库里没有这张卡');
  const def = getSkillDefinition(run.player.deck[idx].defId);
  if (def?.tier === 'S') throw new Error('S 级卡不会被焚毁');
  run.player.deck.splice(idx, 1);
  b.offers.splice(b.offers.indexOf('burn'), 1);
  return def?.name ?? uniqueID;
}
