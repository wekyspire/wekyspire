// 休息阶段面板状态投影：run → 可序列化快照（本次 UI 迁移的**唯一数据下行通道**）。
//
// 为什么是 core 纯函数而不是写在 Shell 的 runController 里：
//   ① 红线——Stage 层不得自行拉取 run 状态；快照由编排器推入（MapStage.setPanel），
//      Stage 只消费纯数据；
//   ② 观战中继（tools/broadcast.mjs）经 tools/playSession.mjs 的 freshState 直驱 Core、
//      **不经过 Shell 的 runController**——投影放 Shell 则中继永远拿不到，只能自行
//      重抄一遍推导，产生第二事实源。放 core 则中继可同源复用。
//
// 本文件不含任何表现字段：播放进度等纯演出状态（老虎机 spin 速度/位置）留在 Stage，
// 只有「影响决策与游戏逻辑流程」的东西才进快照（用户 2026-09 定）。
//
// 增量约定：面板逐个迁移，每迁一个在此加一个分支；未迁移的 stage 返回 null，
// 宿主据此**不装配** Three 面板（对应 Vue 面板仍在渲染）。

import { getEnemyDefinition } from '../enemies/registry.js';
import { getRelicDefinition } from '../relics/registry.js';
import { getSkillDefinition } from '../skills/registry.js';
import { cardViewFromDef } from '../skills/cardView.js';
import { isBossFloor, FLOORS_PER_CHAPTER } from './runFlow.js';
import { PACKS } from './rewards.js';
import {
  LEINO_DIMENSIONS, SEED_OFFERING, ASCENSION_PLACEHOLDER, FIRST_ASCENSION_GRANT,
} from './ascension.js';
import { getAbilityDefinition } from '../abilities/registry.js';
import { trainingMode } from './rooms/training.js';
import { campOptions } from './rooms/camp.js';
import { slotView, devourableRelics, devourableCards } from './rooms/slotMachine.js';
import { canBuy, isShopFloor } from './rooms/shop.js';
import { bankView, pendingDebuffViews } from './rooms/bank.js';
import { gurpasView } from './rooms/gurpas.js';
import { canPromoteRuntime, gatedPromotionTargets } from './promotion.js';
import { usedSlots } from './prep.js';

/**
 * 当前阶段的面板快照；无可呈现面板时返回 null。
 * @param {object} run runState
 * @param {object} extra 舞台侧瞬态（不属于 run 的表现态），见 roomSnapshot
 * @returns {null | {kind: string, ...}}
 */
export function panelSnapshot(run, extra = {}) {
  if (!run) return null;
  switch (run.gameStage) {
    case 'prep': return prepSnapshot(run);
    case 'reward': return rewardSnapshot(run);
    case 'ascension': return ascensionSnapshot(run);
    case 'room': return roomSnapshot(run, extra);
    default: return null;
  }
}

/** 战前准备（塔楼层）：层数/敌人预告/遗物装卸/进入战斗。 */
export function prepSnapshot(run) {
  const p = run.player;
  const nextBoss = Math.ceil(run.floor / FLOORS_PER_CHAPTER) * FLOORS_PER_CHAPTER;
  const equipped = new Set(p.equippedRelics);
  return {
    kind: 'prep',
    title: '战前准备',
    floor: run.floor,
    totalFloors: run.totalFloors,
    cardRemoval: cardRemovalSnapshot(run),
    toBoss: nextBoss - run.floor,
    atBossFloor: isBossFloor(run.floor),
    // 名字在此解析（注册表反查是 core 纯读），Stage 拿到的直接是可绘文本
    encounter: (run.encounter ?? []).map((e) => {
      const id = e?.defId ?? e;
      return { defId: id, name: getEnemyDefinition(id)?.name ?? id };
    }),
    // 槽位是**权重和**口径（Σcost ≤ relicSlots）：0 槽可白装；非槽位式不进装卸界面
    relicSlots: { used: usedSlots(run), total: p.relicSlots },
    relics: p.relics.map((id) => {
      const def = getRelicDefinition(id);
      const isEquipped = equipped.has(id);
      const usesLeft = def?.uses != null ? (run.relicUses?.[id] ?? 0) : null;
      const cost = def?.nonSlot ? 0 : (def?.cost ?? 1);
      const nonSlot = !!def?.nonSlot;
      return {
        id,
        name: def?.name ?? id,
        rarity: def?.rarity ?? null,
        cost,
        nonSlot,
        equipped: isEquipped,
        // 主动遗物的可用性在此判定（Stage 不判断"能不能用"）
        canUse: !!def?.prepUse && isEquipped && (usesLeft == null || usesLeft > 0),
        usesLeft,
        // 非槽位式恒生效、不可装备；其余按"Σcost 是否放得下"判定
        canEquip: !nonSlot && !isEquipped
          && usedSlots(run) + cost <= p.relicSlots,
      };
    }),
    canStartBattle: true,
  };
}

/**
 * 战后奖励（房间层·模态面板）：金币入账 + 卡包选择 + 包内三选一。
 * 卡面视图在 core 侧解析（`describe` 的 ctx 传当前 player，应用前口径），
 * 使快照保持纯数据——Stage 只负责烘焙与摆位。
 * 卡包已自动开好（单包时 spawnRewards 直接开包）→ packId 非空、skillChoices 已填。
 */
export function rewardSnapshot(run) {
  const rw = run.rewards;
  if (!rw) return null;
  const packMeta = (id) => {
    const p = PACKS[id] ?? { id, name: id, desc: '' };
    return { id, name: p.name ?? id, desc: p.desc ?? '' };
  };
  return {
    kind: 'reward',
    title: '战后奖励',
    cardRemoval: cardRemovalSnapshot(run),
    money: rw.money ?? 0,
    packs: (rw.packs ?? []).map(packMeta),
    packId: rw.packId ?? null,
    packName: rw.packId ? packMeta(rw.packId).name : null,
    skillChoices: (rw.skillChoices ?? []).map(id => ({
      defId: id,
      view: cardViewFromDef(getSkillDefinition(id), { player: run.player }),
    })),
  };
}

/**
 * 进阶事件（房间层·模态面板）：两条路径。
 *   ① 常规：选一条主维度突破（维度顺序与等级取自 core）。
 *   ② 种子包（该维度首次 0→1）：九选三 + 一次刷新。
 * 卡面视图在此解析；**勾选缓冲不进快照**——它被确认前是纯 UI 交互态（在 Stage 侧），
 * 确认时作为 intent 载荷上报（见 THREE_UI_MIGRATION §6.3 裁决）。
 */
export function ascensionSnapshot(run) {
  const offering = run.cardOffering;
  const p = run.player;
  const base = {
    kind: 'ascension',
    title: '进阶事件',
    dims: LEINO_DIMENSIONS.map(id => ({ id, level: p.leino?.[id] ?? 0 })),
    ascensionCount: p.ascensionCount ?? 0,
    maxAscensions: ASCENSION_PLACEHOLDER.maxAscensions,
    healAmount: ASCENSION_PLACEHOLDER.healAmount,
    manaGain: ASCENSION_PLACEHOLDER.manaGain,
    offering: null,
    grant: null,
  };
  if (!offering) return base;

  // 首次点亮的体系赠礼（基石卡直入牌组 + 体系能力）：仅该维度恰好 1 级时展示
  const g = FIRST_ASCENSION_GRANT[offering.dimension];
  const ability = g?.ability ? getAbilityDefinition(g.ability) : null;
  const grant = (g && p.leino?.[offering.dimension] === 1) ? {
    cardNames: (g.cards ?? []).map(id => getSkillDefinition(id)?.name ?? id),
    abilityName: ability?.name ?? null,
    abilityDesc: ability?.description ?? '',
  } : null;

  return {
    ...base,
    offering: {
      dimension: offering.dimension,
      cards: (offering.cards ?? []).map(id => ({
        defId: id,
        view: cardViewFromDef(getSkillDefinition(id), { player: p }),
      })),
      picks: SEED_OFFERING.picks,
      rerollsLeft: offering.rerollsLeft ?? 0,
    },
    grant,
  };
}

/**
 * 奖励房（房间层·模态面板）：训练场 / 营地 / 老虎机 / 事件房。
 *
 * `extra` 是**舞台侧瞬态**（不属于 run）：`{ slot: { anim, lastSpin }, eventResult }`。
 * 它们由 Shell 的 runController 持有（老虎机演出播放态 / 事件结算结果），核心拿不到——
 * 但本函数仍是纯函数（只由入参决定输出，无副作用）。四房共用同一快照外壳：
 * `room` 决定形态，`training` / `camp` / `slot` / `event` 各带自己的载荷。
 */
export function roomSnapshot(run, extra = {}) {
  const room = run.currentRoom;
  const p = run.player;
  const snap = { kind: 'room', room, money: p.money, relicUses: undefined };

  // 售货机（与房间并存，不占房间名额）：商店层才给货架；卡包开出的三选一挂起时优先呈现
  if (isShopFloor(run.floor) && run.shop) {
    snap.shop = {
      floor: run.shop.floor,
      discount: run.shop.discount,
      broken: !!run.shop.broken, // 故事模式：瑞米被打跑 → 货架不完整（附道歉文案）
      items: run.shop.items.map((it, index) => ({
        index, kind: it.kind, label: it.label, sub: it.sub ?? '',
        relicId: it.relicId ?? null, // 遗物货：供 hover 效果预览
        price: it.price, sold: !!it.sold, affordable: canBuy(run, index),
      })),
      pending: run.shopPending ? {
        packId: run.shopPending.packId,
        cards: (run.shopPending.choices ?? []).map(id => ({
          defId: id,
          view: cardViewFromDef(getSkillDefinition(id), { player: p }),
        })),
      } : null,
    };
  } else {
    snap.shop = null;
  }
  const upgradeCards = deckUpgradeCards(run);
  snap.cardRemoval = cardRemovalSnapshot(run);

  // 训练部分：'training'（旧单房，兼容保留）与 'campTraining'（营地·训练场合并房）共用
  if (room === 'training' || room === 'campTraining') {
    const choices = run.roomData?.drawChoices ?? null;
    snap.training = {
      mode: trainingMode(run),            // 'upgrade'（免费升一）| 'draw'（退化抓牌）
      forced: !!run.roomData?.forced,     // 升级后的强制尾款 → 不给跳过
      done: !!run.roomData?.trained,      // 本房训练已完成（合并房里两个部分各自一次）
      choices,                            // 候选 defId 列表；null = 还没开局
      choicesCards: (choices ?? []).map(id => ({
        defId: id,
        view: cardViewFromDef(getSkillDefinition(id), { player: p }),
      })),
      upgradeCards,
    };
    if (room === 'training') return snap;
  }

  // 营地部分：'camp'（旧单房，兼容保留）与合并房共用
  if (room === 'camp' || room === 'campTraining') {
    snap.camp = {
      options: campOptions(run),
      upgradeCards,
      used: !!run.roomData?.campUsed,     // 本房营地动作已用过（合并房各自一次）
    };
    return snap;
  }

  if (room === 'gurpas') {
    const v = gurpasView(run);
    snap.gurpas = {
      ...v,
      pendingPackCards: (v.pendingPack?.choices ?? []).map(id => ({
        defId: id,
        view: cardViewFromDef(getSkillDefinition(id), { player: p }),
      })),
      // 删卡服务候选：整副牌组（删卡不限等阶）
      removeCards: run.player.deck.map(rt => ({
        uniqueID: rt.uniqueID, defId: rt.defId,
        view: cardViewFromDef(getSkillDefinition(rt.defId), { player: p }),
      })),
    };
    return snap;
  }

  if (room === 'slot') {
    // 银行机与老虎机成对出现：状态、利率、超额取款档位与待选词条一并下发；
    // 词条附赠的「升级/焚毁一张」走同一份选卡快照（Stage 只认数据，不拉 run 状态）
    snap.bank = {
      ...bankView(run),
      pendingDebuffs: pendingDebuffViews(run),
      upgradeCards: deckUpgradeCards(run).filter(c => c.enabled),
      // 焚毁候选：整副牌组去掉 S 级（词条口径「不会焚 S 级卡」）
      burnCards: deckUpgradeCards(run).filter(c => getSkillDefinition(c.defId)?.tier !== 'S'),
    };
    const anim = extra.slot?.anim ?? null;
    const lastSpin = extra.slot?.lastSpin ?? null;
    const view = slotView(run);
    const pending = run.slotPending;
    snap.slot = {
      cost: view.cost,
      money: p.money,
      rolls: view.rolls,
      freeRolls: view.freeRolls,
      canSpin: view.canSpin && !pending,
      majorChance: view.majorChance,
      minorChance: view.minorChance,
      devour: { progress: view.devourProgress, every: view.devourEvery, ready: view.devourReady },
      // 演出进行中：{ id, prize }；Stage 播完动画后回执，才揭示结果（渐进揭示语义）
      spinning: anim ? { id: anim.id, prize: anim.prize?.kind ?? null } : null,
      lastSpin,
      // 待处理产出：原始载荷原样带上，表现文案由 Stage 侧翻译（与战后奖励同一分工）
      pending: pending ? {
        tier: pending.tier, kind: pending.kind,
        money: pending.money ?? null,
        special: pending.special ?? null,
        relicId: pending.relicId ?? null,
        upgradeCopyId: pending.upgradeCopyId ?? null,
        fullRestore: !!pending.fullRestore,
        upgrade: pending.upgrade ?? null,
        choices: (pending.choices ?? []).map(c => ({
          defId: c.id,
          view: cardViewFromDef(getSkillDefinition(c.id), { player: p }),
        })),
        relicChoices: pending.relicChoices ?? null,
      } : null,
      // 大奖「免费指定升级」挂起时：复用全屏选卡界面（与营地/训练场同一套）
      needsCardPick: !!run.slotUpgradePending,
      upgradeCards: run.slotUpgradePending ? upgradeCards : [],
      // 吞噬（进度满了才给清单）
      devourables: view.devourReady ? {
        relics: devourableRelics(run),
        cards: devourableCards(run),
      } : null,
    };
    return snap;
  }

  if (room === 'event') {
    snap.event = { result: extra.eventResult ?? null };
    return snap;
  }

  return snap;
}

/**
 * 「牌组全部卡 + 各自升级目标」：全屏选卡界面用（营地/训练场升级、老虎机大奖的免费指定升级）。
 * 不可升级的 enabled=false（界面置灰不可选）；tipDefId = 升级后的卡 id（hover 预览用它）。
 * 注意：gatedPromotionTargets 返回的是**目标 defId 字符串**，不是定义对象。
 */
/**
 * Boss 奖励的删卡机会（§2.1）：原先只有计数器、没有落地流程；现在与古尔帕斯的删卡服务
 * 共用同一套选卡界面（候选 = 整副牌组，不限等阶）。三个面板（prep/reward/room）共用。
 */
export function cardRemovalSnapshot(run) {
  if (!(run.pendingCardRemoval > 0)) return null;
  const p = run.player;
  return {
    count: run.pendingCardRemoval,
    removeCards: run.player.deck.map(rt => ({
      uniqueID: rt.uniqueID, defId: rt.defId,
      view: cardViewFromDef(getSkillDefinition(rt.defId), { player: p }),
    })),
  };
}

export function deckUpgradeCards(run) {
  const p = run.player;
  return p.deck.map((rt) => {
    const def = getSkillDefinition(rt.defId);
    const targetId = canPromoteRuntime(rt, run) ? (gatedPromotionTargets(run, def)[0] ?? null) : null;
    const targetDef = targetId ? getSkillDefinition(targetId) : null;
    return {
      uniqueID: rt.uniqueID,
      defId: rt.defId,
      view: cardViewFromDef(def, { player: p }),
      enabled: !!targetId,
      tipDefId: targetId ?? rt.defId,
      toName: targetDef?.name ?? null,
      toView: targetDef ? cardViewFromDef(targetDef, { player: p }) : null,
    };
  });
}
