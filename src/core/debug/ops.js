// 调试原语（run 级）：**只有调试模式会调**（唯一调用方 = src/shell/runDebug.js；
// 造档工具 tools/saveForge.mjs 也复用这里的护栏）。
//
// 纪律：
//   · 只碰 core 状态，不碰舞台/演出——「改完之后前端怎么刷新」是 Shell 门面的事；
//   · 上限类字段（maxHp / maxMana / maxActionPoints / maxHandSize）一律写 `baseStats`
//     再 `refreshRunModifiers` 重算——直接写 p.maxHp 会被下一次重算抹掉（并逐战叠加）；
//   · 一律走既有 core 守卫（遗物唯一 / 槽位权重 / 等阶门禁 / 晋升目标），非法输入抛错，
//     由调用方把原因展示给玩家（静默失败在调试工具里最费时间）；
//   · 返回值 = 一句人话（给日志/toast 用），不返回内部对象。

import { createSkillRuntime } from '../state/skillRuntime.js';
import { getSkillDefinition } from '../skills/registry.js';
import { getEffectDefinition } from '../effects/registry.js';
import { getRelicDefinition } from '../relics/registry.js';
import { draftRelic } from '../relics/draft.js';
import { BODY_STARTER_DECK } from '../content/bodySkills.js';
import { refreshRunModifiers, grantRelic, equipRelic, unequipRelic } from '../run/prep.js';
import { promoteCard, gatedPromotionTargets } from '../run/promotion.js';
import { LEINO_DIMENSIONS } from '../run/ascension.js';
import { generateEncounter } from '../run/runFlow.js';
import { spawnRewards, chooseRewardPack, availablePacks } from '../run/rewards.js';
import { ensureShopStock } from '../run/rooms/shop.js';
import { ensureGurpasStock } from '../run/rooms/gurpas.js';
import { bankOnVisit } from '../run/rooms/bank.js';

// 走 baseStats + 重算的「上限类」字段 → 该字段在 baseStats 里的键名
const BASE_STAT_FIELDS = Object.freeze({
  maxHp: 'maxHp',
  maxMana: 'maxMana',
  maxActionPoints: 'maxActionPoints',
  maxHandSize: 'maxHandSize',
});

// 直接写 player 的普通字段（不参与 baseStats 重算）：hp/mana 会后置夹到合法区间
const PLAIN_FIELDS = Object.freeze([
  'hp', 'mana', 'actionPoints', 'money', 'trainingCount', 'ascensionCount', 'bodyLevel', 'relicSlots',
]);

const asCount = (value, label) => {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0) throw new Error(`调试：${label} 需要 ≥0 的整数（收到 ${value}）`);
  return n;
};

/** 改一个玩家数值字段。上限类字段写 baseStats 后重算（遗物修正不被抹掉）；非法字段抛错。 */
export function setPlayerField(run, field, value) {
  const p = run.player;
  const n = asCount(value, field);
  // maxHp 特殊：**不在 refreshRunModifiers 的重算集合里**（没有遗物改生命上限；
  // 成长一律走 prep.gainMaxHp），所以这里照 gainMaxHp 的记账口径直接写两份
  if (field === 'maxHp') {
    p.baseStats.maxHp = n;
    p.maxHp = n;
    p.hp = Math.min(p.hp, p.maxHp);
    return `maxHp = ${n}`;
  }
  if (BASE_STAT_FIELDS[field]) {
    p.baseStats[BASE_STAT_FIELDS[field]] = n;
    refreshRunModifiers(run);
    return `${field} = ${p[field]}`;
  }
  if (!PLAIN_FIELDS.includes(field)) throw new Error(`调试：未知字段 ${field}`);
  p[field] = n;
  if (field === 'hp') p.hp = Math.min(p.hp, p.maxHp);
  if (field === 'mana') p.mana = Math.min(p.mana, p.maxMana);
  return `${field} = ${p[field]}`;
}

/** 灵脉等级直写（跳过进阶事件的全部流程；测「进阶后的世界」用）。体修不在灵脉维度里（走 bodyLevel）。 */
export function setLeinoLevel(run, dim, level) {
  if (!LEINO_DIMENSIONS.includes(dim)) {
    throw new Error(`调试：未知灵脉维度 ${dim}（可用：${LEINO_DIMENSIONS.join('/')}；体修请改 bodyLevel）`);
  }
  const n = asCount(level, `灵脉 ${dim}`);
  run.player.leino[dim] = n;
  return `${dim} 灵脉 = ${n}`;
}

/** 加一张卡入牌组（validation 走注册表；战斗中的牌组改动对本场无效——那走 battleOps）。 */
export function grantCard(run, defId) {
  const def = getSkillDefinition(defId); // 未注册直接抛错
  run.player.deck.push(createSkillRuntime(defId));
  return `获得卡牌「${def.name}」`;
}

/** 从牌组删一张卡（按运行时 uniqueID）。 */
export function removeCard(run, uniqueID) {
  const deck = run.player.deck;
  const i = deck.findIndex(rt => rt.uniqueID === uniqueID);
  if (i < 0) throw new Error(`调试：牌组中没有这张卡（${uniqueID}）`);
  const [rt] = deck.splice(i, 1);
  return `移除卡牌「${getSkillDefinition(rt.defId)?.name ?? rt.defId}」`;
}

/** 升级一张卡（走正式晋升：等阶门禁 + 分叉目标，与营地/训练同一函数）。 */
export function promoteCardAt(run, uniqueID, targetId = null) {
  const before = run.player.deck.find(rt => rt.uniqueID === uniqueID);
  if (!before) throw new Error(`调试：牌组中没有这张卡（${uniqueID}）`);
  const fromName = getSkillDefinition(before.defId)?.name ?? before.defId;
  const target = targetId ?? gatedPromotionTargets(run, getSkillDefinition(before.defId))[0] ?? null;
  const out = promoteCard(run, uniqueID, target);
  if (!out) throw new Error(`「${fromName}」暂无可用晋升目标`);
  return `升级：${fromName} → ${getSkillDefinition(out.defId)?.name ?? out.defId}`;
}

/** 牌组重置为初始卡组（默认起始卡组 = 体修基础包）。 */
export function resetDeck(run) {
  run.player.deck = BODY_STARTER_DECK.map(id => createSkillRuntime(id));
  return `牌组已重置为初始卡组（${run.player.deck.length} 张）`;
}

/** 加一件遗物（走 grantRelic：唯一性 + onAcquire + 修正重算）。 */
export function grantRelicById(run, relicId) {
  grantRelic(run, relicId);
  return `获得遗物「${relicId}」`;
}

/** 移除一件遗物（背包 + 装备表 + 次数表全清，随后重算修正）。 */
export function removeRelicById(run, relicId) {
  const p = run.player;
  if (!p.relics.includes(relicId)) throw new Error(`调试：背包中没有遗物 ${relicId}`);
  p.relics = p.relics.filter(id => id !== relicId);
  p.equippedRelics = p.equippedRelics.filter(id => id !== relicId);
  delete run.relicUses[relicId];
  refreshRunModifiers(run);
  return `移除遗物「${relicId}」`;
}

/** 装备/卸下（复用正式守卫：槽位权重、非槽位式不可装备）。 */
export function equipRelicById(run, relicId) {
  equipRelic(run, relicId);
  return `装备「${relicId}」`;
}
export function unequipRelicById(run, relicId) {
  unequipRelic(run, relicId);
  return `卸下「${relicId}」`;
}

/**
 * 无敌开关：复用既有 `invulnerable` 效果（生命不降到 1 以下，与伤害管线同源）。
 * 该效果无自动递减，故开关 = 加/去一层。⚠ 玩家效果不进存档快照 —— 读档后需重开。
 */
export function setInvulnerable(run, on) {
  const p = run.player;
  if (on) { p.addEffect('invulnerable', 1); return '无敌：开（生命不降到 1 以下）'; }
  p.removeEffect('invulnerable');
  return '无敌：关';
}

/** 清掉玩家身上全部负面效果（debuff 类；增益保留）。 */
export function clearDebuffs(run) {
  const p = run.player;
  const before = p.effects.length;
  p.clearEffects(e => getEffectDefinition(e.effectId)?.type === 'debuff');
  return `清除负面效果 ${before - p.effects.length} 项`;
}

/** 加/减某个效果层数（调试用：燃烧、力量、无敌……）。 */
export function addEffectToPlayer(run, effectId, stacks = 1) {
  getEffectDefinition(effectId); // 未注册抛错
  run.player.addEffect(effectId, Number(stacks) || 0);
  return `玩家效果 ${effectId} ${stacks >= 0 ? '+' : ''}${stacks}`;
}

/**
 * 楼层设定（归一为「落到该层 prep」）：清掉当前房间/战斗遗留，按新层重掷遭遇。
 * 舞台侧换台/相机由 Shell 门面负责（core 不认识舞台）。
 */
export function setFloor(run, floor) {
  const n = Math.max(1, Math.min(asCount(floor, '楼层') || 1, run.totalFloors));
  run.floor = n;
  run.currentRoom = null;
  run.roomData = null;
  run.rewards = null;
  run.gameStage = 'prep';
  run.result = null;
  run.encounter = generateEncounter(run);
  return `落到第 ${n} 层（战前准备）`;
}

/**
 * 进入指定奖励房（把 run 摆成"刚进房"）：房型初始化与 completeRewards 同口径
 * （商店层掷货架 / 老虎机层记一次到访 / 古尔帕斯掷货架）。房内演出由 Shell 门面派发。
 */
export function enterRoom(run, roomId) {
  run.currentRoom = roomId;
  run.roomData = null;
  run.gameStage = 'room';
  run.rewards = null;
  ensureShopStock(run);                                   // 售货机与房间并存（商店层）
  if (roomId === 'slot') bankOnVisit(run);                // 见银行机一次（递减超额取款黑名单）
  if (roomId === 'gurpas') ensureGurpasStock(run);
  return `进入房间：${roomId}`;
}

/**
 * 直接开一次战后奖励（测奖励/开包/三选一链路）：钱 + 卡包按常规分布掷出。
 * @returns {string} 人话
 */
export function startReward(run, { packId = null, minTier = null } = {}) {
  run.gameStage = 'reward';
  run.currentRoom = null;
  run.roomData = null;
  spawnRewards(run, { minTier });
  if (packId) chooseRewardPack(run, packId);
  const packs = run.rewards?.packs ?? [];
  return `战后奖励已就位${packId ? `（已开包 ${packId}）` : `（可选卡包：${packs.join('/') || '无'}）`}`;
}

/** 可用卡包列表（面板的下拉用；与奖励阶段同一来源）。 */
export function packIds(run) {
  return availablePacks(run).map(p => p.id);
}

/**
 * 触发一次进阶事件（进 'ascension' 阶段，幕间由 Shell 门面播）。
 * 与 beginTraining 的房内升阶同款：currentRoom 非空时 completeAscension 会切回 'room'，
 * 否则按正式流程推进楼层（chooseAscension → advanceFloor）。
 */
export function startAscensionEvent(run) {
  if (run.gameStage === 'battle') throw new Error('战斗中不能进阶（先结束战斗）');
  if (run.gameStage === 'ascension') throw new Error('进阶事件已经在播了');
  if (run.gameStage === 'end') throw new Error('本局已结束');
  run.gameStage = 'ascension';
  return '进阶事件已挂起（幕间开始播放）';
}

/** 发一件随机遗物（走 draft.js 统一抽取：权重/门禁/驱重/兜底集中一处）。 */
export function grantRandomRelic(run, rarity = null) {
  const id = draftRelic(run, { rarity: rarity || null });
  if (!id) return '随机遗物：池空（无兜底件）';
  grantRelic(run, id);
  const def = getRelicDefinition(id);
  return `获得随机遗物「${def?.name ?? id}」（${def?.rarity ?? '?'}）`;
}
