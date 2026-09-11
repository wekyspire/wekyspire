import { createRng } from './rng.js';

// battleState：单场战斗寿命，进战斗装配、战斗结束销毁。
// zones 为有序数组（牌序玩法依赖顺序）；牌的 zone 不显式存储在 runtime 上，
// 由 zoneOf 反查派生，防双写失同步。
// 牌库 = 唯一循环区（FIFO：顶抽底还，无弃牌堆、无重洗）；打出/弃置/换牌/解除咏唱
// 等原因离手的非消耗卡一律落牌库底（数组尾），牌库抽空抽牌即落空。
// pending = 结算区（结算中的卡——主语或宾语）：跨节拍持有卡牌的指令先入 pending、
// 末段 zoneOf 校验后落位（惯例见 AGENTS.md）；单节拍原子指令（弃/焚/移）不经 pending。
// 与 battleState.pendingInput（输入仲裁）、sequencer 的 'pending'（演出状态）仅词根相同，互不相干。
// 咏唱无槽位、无激活数上限：咏唱卡与普通卡同住四区，激活态存 skillRuntime.isActivated
// （仅手牌中可为真，任何离手路径由指令层统一熄灭）；其压力走手牌上限的加权口径
// （激活咏唱按咏唱值计多张手牌，见 skills/helpers.js 的 effectiveHandCount）。
export const ZONES = ['hand', 'deck', 'burnt', 'pending'];

export function createBattleState({ enemies = [], allies = [], seed = 1 } = {}) {
  for (const e of enemies) e.side = 'enemy';
  for (const a of allies) a.side = 'player';
  return {
    enemies,        // 敌方单位（有序 = 行动顺序；死亡单位留在数组中，靠 isDead() 过滤）
    allies,         // 我方 AI 队友（如瑞米；有序 = 行动顺序，玩家回合先于玩家行动）
    zones: {
      hand: [],       // 手牌（有序，位置有语义：两侧/最右等；激活的咏唱卡也住这里）
      deck: [],       // 牌库（有序 FIFO：顶 = index 0 = 下次抽的卡；离手卡回尾 = 牌库底）
      burnt: [],      // 焚毁区（消耗卡去处，本场不回流）
      pending: [],    // 结算区（正在发动/被跨节拍结算搬运的卡；正常时序在结算树内清空，终局由 PostBattle 兜底）
    },
    turn: { count: 0, side: 'player' },             // side: 'player' | 'enemy'
    lastPlayerTarget: null, // 主角最后攻击过的敌人 uniqueID（瑞米索敌口径；null = 本场尚未攻击过）
    // 本场战斗级数值修正（内容侧只经 prep.applyBattleModifier 写入；随本对象一起消失，
    // 故「本场 +1 上限」类效果不需要任何战后回滚）。
    modifiers: { maxMana: 0, maxActionPoints: 0, attack: 0, defense: 0, maxHandSize: 0 },
    // 本场战斗的恶魔词条标量（银行机超额取款；PreBattle 从 run.pendingDebuffs 折入）：
    // { blind, drawPenaltyTurns, noManaRegenTurns, deathAtTurnEnd, dotFromTurn }
    debuffs: { blind: false, drawPenaltyTurns: 0, noManaRegenTurns: 0, deathAtTurnEnd: 0, dotFromTurn: null },
    swapCount: 0,       // 本场换牌次数（换牌费用 = swapBaseCost + swapCount，刀客/刀圣用 cap 封顶）
    swapCostCap: null,  // 换牌费用上限（能力在 onBattleStart 设置；null = 无上限）
    history: freshHistory(),
    rng: createRng(seed),
  };
}

// 换牌费用：base + 次数，cap 封顶（旧仓库语义：首次 0，每次 +1）
export function swapCostOf(battleState) {
  const base = (battleState.config?.swapBaseCost ?? 0) + battleState.swapCount;
  return Math.min(base, battleState.swapCostCap ?? Infinity);
}

export function freshHistory() {
  const counters = () => ({
    played: 0, drawn: 0, discarded: 0, burnt: 0,
    damageDealt: 0, damageTaken: 0, healing: 0,
  });
  return { turn: counters(), battle: counters() };
}

export function resetTurnHistory(battleState) {
  const counters = freshHistory().turn;
  battleState.history.turn = counters;
}

// 反查卡牌所在 zone：'hand' | 'deck' | 'burnt' | 'pending' | null
export function zoneOf(battleState, uniqueID) {
  for (const name of ZONES) {
    if (battleState.zones[name].some(c => c.uniqueID === uniqueID)) return name;
  }
  return null;
}

// 在 zone 内/间移动卡牌（保持数组为唯一事实源）
export function moveCard(battleState, uniqueID, toZone, { index = null } = {}) {
  const from = zoneOf(battleState, uniqueID);
  if (!from) throw new Error(`卡牌 ${uniqueID} 不在任何 zone`);
  const fromArr = battleState.zones[from];
  const i = fromArr.findIndex(c => c.uniqueID === uniqueID);
  const [card] = fromArr.splice(i, 1);
  const toArr = battleState.zones[toZone];
  if (index === null) toArr.push(card);
  else toArr.splice(index, 0, card);
  return card;
}

// 手牌位置查询（两侧/索引，供"飞刀弃两侧"类机制）
export function handNeighbors(battleState, uniqueID) {
  const hand = battleState.zones.hand;
  const i = hand.findIndex(c => c.uniqueID === uniqueID);
  if (i < 0) return { left: null, right: null };
  return { left: hand[i - 1] ?? null, right: hand[i + 1] ?? null };
}

// ---- 单位选择器（主语/宾语解析用） ----

export function aliveEnemies(battleState) {
  return battleState.enemies.filter(e => !e.isDead());
}

export function aliveAllies(battleState) {
  return battleState.allies.filter(a => !a.isDead());
}

// 默认攻击目标：第一个存活敌人
export function firstAliveEnemy(battleState) {
  return aliveEnemies(battleState)[0] ?? null;
}

// 某阵营的全部存活单位（含/不含玩家本体）
export function unitsOfSide(battleState, player, side, { includePlayer = true } = {}) {
  if (side === 'enemy') return aliveEnemies(battleState);
  const units = [...aliveAllies(battleState)];
  if (includePlayer && !player.isDead()) units.unshift(player);
  return units;
}

// 全场存活单位
export function allAliveUnits(battleState, player) {
  return [...unitsOfSide(battleState, player, 'player'), ...aliveEnemies(battleState)];
}
