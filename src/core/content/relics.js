import { registerRelic } from '../relics/registry.js';
import { TurnStartInstruction, PlayerTurnEndInstruction, PlayerTurnInstruction } from '../instructions/turn.js';
import {
  DealDamageInstruction, GainShieldInstruction, ApplyHealInstruction, wouldBeLethal,
} from '../instructions/combat.js';
import { GainManaInstruction, GainActionPointsInstruction } from '../instructions/resources.js';
import { DrawCardsInstruction, AddCardInstruction, MoveCardInstruction } from '../instructions/cards.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import AwaitPlayerInputInstruction from '../instructions/input.js';
import { UseSkillInstruction } from '../instructions/skill.js';
import { getSkillDefinition } from '../skills/registry.js';
import { getEffectDefinition } from '../effects/registry.js';
import { gainMaxHp, applyBattleModifier } from '../run/prep.js';
import { isBossFloor } from '../run/runFlow.js';

// 遗物内容（RELICS.md 2026-09-10 第一批：只上「不需要新机制」的那些，见 todos/ 记录）。
//
// 字段口径（用户 2026-09-10 定，以 RELICS.md 为准）：
//   rarity   'C'|'B'|'A'|'S'（抽选权重与定价依据）
//   cost     槽位权重 0..3（Σ ≤ relicSlots=3）；0 槽 = 能装备但不花槽
//   nonSlot  true = **非槽位式遗物**：不进装卸界面、拾起即恒生效（走 activeRelics）
//   requires 灵脉门禁（抽选池过滤用，与卡包同一口径）：{leino,min} 或 {anyLeino}
//   acquisition 来源标签 ['draft','shop','event','gurpas']（缺省 draft+shop）；
//     event = 仅事件获得（如「诸神」恩赐）；gurpas = 仅古尔帕斯之店（SHOP.md §二）
//   onAcquire(run)  拾起时（一次性）；gainMaxHp 同时抬基础值与当前生命
//   runModifiers(p) 或 {字段: 增量}：run 级数值修正——**从 baseStats 重算**，不增量累加
//   battleModifiers(p) 或 {字段: 增量}：**本场战斗**修正（生命周期 = 一场战斗；由 PreBattle
//     折入同一次重算，随 battleState 消失，故不需要任何回滚）。战中会变的修正（海神戟第 4
//     回合撤销）用 prep.applyBattleModifier(ctx, 字段, 增量) 改。
//   onBattleVictory(run, battle)：战斗**胜利**后的 run 层结算（run 级资源只在这里改——
//     战斗内订阅不得直写 run 状态）。
//   onCampRest(run) 营地休整时（非槽位式的常驻钩子）
//   onBattleStart(ctx) / subscriptions(ctx)：战斗内钩子（仅「已激活」遗物挂载）
const COST0 = { cost: 0 };

// ---- 拾起时（均为非槽位式：恒生效，不进装卸界面）----

registerRelic({
  id: 'hardBaguette', name: '超硬法棍', rarity: 'B', nonSlot: true,
  description: '拾起时，获得 5 最大生命。',
  onAcquire: (run) => gainMaxHp(run, 5),
});

registerRelic({
  id: 'northMountainRock', name: '北山岩', rarity: 'C', nonSlot: true,
  description: '拾起时，获得 2 最大生命。',
  onAcquire: (run) => gainMaxHp(run, 2),
});

registerRelic({
  id: 'naan', name: '馕饼', rarity: 'C', nonSlot: true,
  description: '拾起时，获得 3 最大生命。',
  onAcquire: (run) => gainMaxHp(run, 3),
});

registerRelic({
  id: 'steelShard', name: '拟钢碎片', rarity: 'C', nonSlot: true, acquisition: ['gurpas'], // SHOP.md §二：仅在古尔帕斯的店出售
  description: '拾起时，获得 1 最大生命；战斗开始时获得 1 护盾。',
  onAcquire: (run) => gainMaxHp(run, 1),
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new GainShieldInstruction({ target: ctx.player, amount: 1 }));
  },
});

// 池空兜底件（唯一可重复获得的遗物；抽选 SDK 在「全部可抽遗物都已拥有」时发它）
registerRelic({
  id: 'towerGift', name: '塔的馈赠', rarity: 'C', nonSlot: true,
  description: '拾起时，获得 1 最大生命。',
  onAcquire: (run) => gainMaxHp(run, 1),
});

// ---- 非槽位式的常驻钩子 ----

registerRelic({
  id: 'springFlask', name: '山泉壶', rarity: 'C', nonSlot: true,
  description: '休息处休息时，额外恢复 5 点生命。',
  onCampRest(run) {
    const p = run.player;
    p.hp = Math.min(p.maxHp, p.hp + 5);
  },
});

// ---- 战斗开始时（资源 / 状态）----

registerRelic({
  id: 'dragonHeartTissue', name: '龙心组织', rarity: 'A', cost: 1,
  description: '战斗开始时，获得 2 行动力。',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new GainActionPointsInstruction({ amount: 2 }));
  },
});

registerRelic({
  id: 'seaCrystal', name: '海晶石', rarity: 'B', cost: 1,
  description: '战斗开始时，获得 1 魏启。',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new GainManaInstruction({ amount: 1 }));
  },
});

registerRelic({
  id: 'kadasFang', name: '卡达斯的獠牙', rarity: 'A', cost: 2,
  description: '战斗开始时，获得 3 魏启。',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new GainManaInstruction({ amount: 3 }));
  },
});

registerRelic({
  id: 'blackMountainRock', name: '黑山岩', rarity: 'C', cost: 1,
  description: '战斗开始时，获得 4 护盾。',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new GainShieldInstruction({ target: ctx.player, amount: 4 }));
  },
});

registerRelic({
  id: 'evanStone', name: '埃文石', rarity: 'A', cost: 1,
  description: '战斗开始时，赋予所有敌人虚弱 1。',
  onBattleStart(ctx) {
    for (const e of ctx.battleState.enemies) {
      ctx.kernel.submitInstruction(new AddEffectInstruction({ target: e, effectId: 'weaken', stacks: 1 }));
    }
  },
});

// 火灵脉专属（门禁与卡包同一口径）
registerRelic({
  id: 'sunStone', name: '太阳石', rarity: 'A', ...COST0, requires: { leino: 'fire', min: 1 },
  description: '战斗开始时，获得烈焰亲和 2。',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new AddEffectInstruction({
      target: ctx.player, effectId: 'flameAffinity', stacks: 2,
    }));
  },
});

registerRelic({
  id: 'kadasClaw', name: '卡达斯之爪', rarity: 'A', cost: 1, requires: { leino: 'fire', min: 1 },
  description: '战斗开始时，获得炎魔 1。',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new AddEffectInstruction({
      target: ctx.player, effectId: 'flameDemon', stacks: 1,
    }));
  },
});

registerRelic({
  id: 'whiteFireStone', name: '白火石', rarity: 'B', cost: 2, requires: { leino: 'fire', min: 1 },
  description: '战斗第一回合开始时，赋予所有单位燃烧 2。',
  subscriptions: () => [{
    when: TurnStartInstruction,
    phase: 'post',
    filter: (instr, c) => instr.side === 'player' && c.battleState.turn.count === 1,
    react: (instr, c) => {
      const all = [c.player, ...c.battleState.allies, ...c.battleState.enemies];
      for (const u of all) {
        if (u.isDead()) continue;
        c.kernel.submitInstruction(new AddEffectInstruction({ target: u, effectId: 'burn', stacks: 2 }), instr);
      }
    },
  }],
});

// ---- 回合节奏 ----

registerRelic({
  id: 'endlessManaJar', name: '无限魏启罐', rarity: 'A', cost: 1,
  description: '每 3 回合，回合开始时回复 1 魏启。',
  subscriptions: () => [{
    when: TurnStartInstruction,
    phase: 'post',
    filter: (instr, c) => instr.side === 'player' && c.battleState.turn.count % 3 === 0,
    react: (instr, c) => c.kernel.submitInstruction(new GainManaInstruction({ amount: 1 }), instr),
  }],
});

registerRelic({
  id: 'smoothBuckler', name: '光滑小圆盾', rarity: 'B', cost: 1,
  description: '第二回合开始时，获得 12 护盾。',
  subscriptions: () => [{
    when: TurnStartInstruction,
    phase: 'post',
    // priority -100：回合开始的「出现类」效果必须排在护盾重置（-50）**之后**，
    // 否则刚发的 12 点盾会被同一拍的清盾立刻抹掉（见 battleRoot 的护盾重置注释）
    priority: -100,
    filter: (instr, c) => instr.side === 'player' && c.battleState.turn.count === 2,
    react: (instr, c) => c.kernel.submitInstruction(
      new GainShieldInstruction({ target: c.player, amount: 12 }), instr),
  }],
});

registerRelic({
  id: 'lubricant', name: '润滑油', rarity: 'C', cost: 1,
  description: '第二回合开始时，抽 1 牌。',
  subscriptions: () => [{
    when: TurnStartInstruction,
    phase: 'post',
    filter: (instr, c) => instr.side === 'player' && c.battleState.turn.count === 2,
    react: (instr, c) => c.kernel.submitInstruction(
      new DrawCardsInstruction({ count: 1, reason: 'relic' }), instr),
  }],
});

registerRelic({
  id: 'seed', name: '种子', rarity: 'A', cost: 1,
  description: '第三回合到第五回合，每回合开始时恢复 1 生命。',
  subscriptions: () => [{
    when: TurnStartInstruction,
    phase: 'post',
    filter: (instr, c) => {
      if (instr.side !== 'player') return false;
      const t = c.battleState.turn.count;
      return t >= 3 && t <= 5;
    },
    react: (instr, c) => c.kernel.submitInstruction(
      new ApplyHealInstruction({ target: c.player, amount: 1 }), instr),
  }],
});

registerRelic({
  id: 'remiCharm', name: '瑞米挂饰', rarity: 'B', cost: 2,
  description: '第 5 回合开始时，获得闪避 1。',
  subscriptions: () => [{
    when: TurnStartInstruction,
    phase: 'post',
    filter: (instr, c) => instr.side === 'player' && c.battleState.turn.count === 5,
    react: (instr, c) => c.kernel.submitInstruction(
      new AddEffectInstruction({ target: c.player, effectId: 'dodge', stacks: 1 }), instr),
  }],
});

registerRelic({
  id: 'warHornItem', name: '号角', rarity: 'C', cost: 1,
  description: '第一回合开始时获得力量 2；该回合结束时失去力量 2。',
  subscriptions: () => [
    {
      when: TurnStartInstruction,
      phase: 'post',
      filter: (instr, c) => instr.side === 'player' && c.battleState.turn.count === 1,
      react: (instr, c) => c.kernel.submitInstruction(
        new AddEffectInstruction({ target: c.player, effectId: 'strength', stacks: 2 }), instr),
    },
    {
      when: PlayerTurnEndInstruction,
      phase: 'post',
      filter: (instr, c) => c.battleState.turn.count === 1,
      react: (instr, c) => c.kernel.submitInstruction(
        new AddEffectInstruction({ target: c.player, effectId: 'strength', stacks: -2 }), instr),
    },
  ],
});

// 飞镖 / 迷你飞镖 共用：第一回合结束的群伤
function dartVolley() {
  return {
    when: PlayerTurnEndInstruction,
    phase: 'post',
    filter: (instr, c) => c.battleState.turn.count === 1,
    react: (instr, c) => {
      for (const e of c.battleState.enemies) {
        if (e.isDead()) continue;
        c.kernel.submitInstruction(new DealDamageInstruction({
          source: c.player, target: e, amount: 2, tags: ['aoe'],
        }), instr);
      }
    },
  };
}

registerRelic({
  id: 'dart', name: '飞镖', rarity: 'C', cost: 1,
  description: '第一回合结束时，对所有敌人造成 2 伤害。',
  subscriptions: () => [dartVolley()],
});

registerRelic({
  id: 'miniDart', name: '迷你飞镖', rarity: 'A', ...COST0,
  description: '第一回合结束时，对所有敌人造成 2 伤害。',
  subscriptions: () => [dartVolley()],
});

// ---- 受击 / 出牌 反应 ----

registerRelic({
  id: 'sledgehammer', name: '大锤', rarity: 'C', cost: 1,
  description: '每次受伤后，获得 1 护盾。',
  subscriptions: () => [{
    when: DealDamageInstruction,
    phase: 'post',
    filter: (instr, c) => instr.target === c.player && (instr.result?.dealt ?? 0) > 0,
    react: (instr, c) => c.kernel.submitInstruction(
      new GainShieldInstruction({ target: c.player, amount: 1 }), instr),
  }],
});

registerRelic({
  id: 'adrenalineSyringe', name: '肾上腺素注射器', rarity: 'C', cost: 1,
  description: '每场战斗中，第一次单次造成超过 15 点伤害后，抽 2 牌。',
  subscriptions: () => {
    let fired = false; // 每场战斗一次（subscriptions 工厂每场战斗调用一次）
    return [{
      when: DealDamageInstruction,
      phase: 'post',
      filter: (instr, c) => !fired && instr.source === c.player && (instr.result?.dealt ?? 0) > 15,
      react: (instr, c) => {
        fired = true;
        c.kernel.submitInstruction(new DrawCardsInstruction({ count: 2, reason: 'relic' }), instr);
      },
    }];
  },
});

registerRelic({
  id: 'masterInsight', name: '宗师的心得', rarity: 'C', cost: 1,
  description: '每场战斗打出的第三张牌，打出后回复其行动力消耗。',
  subscriptions: () => {
    let plays = 0;
    return [{
      when: UseSkillInstruction,
      phase: 'post',
      filter: (instr) => instr.skill?.defId != null,
      react: (instr, c) => {
        plays += 1;
        if (plays !== 3) return;
        const ap = getSkillDefinition(instr.skill.defId)?.cost?.actionPoint ?? 0;
        if (ap > 0) c.kernel.submitInstruction(new GainActionPointsInstruction({ amount: ap }), instr);
      },
    }];
  },
});

// S 级「诸神」恩赐：仅事件获得（acquisition: ['event']，故不进抽取/商店池）
registerRelic({
  id: 'aovibonyBlessing', name: '奥薇邦妮之恩赐', rarity: 'S', cost: 1, acquisition: ['event'],
  description: '你每次打空手牌时，恢复 2 魏启。',
  subscriptions: () => [{
    when: UseSkillInstruction,
    phase: 'post',
    filter: (instr, c) => (c.battleState.zones.hand?.length ?? 0) === 0,
    react: (instr, c) => c.kernel.submitInstruction(new GainManaInstruction({ amount: 2 }), instr),
  }],
});

registerRelic({
  id: 'ranqingBlessing', name: '冉青之恩赐', rarity: 'S', cost: 2, acquisition: ['event'],
  description: '每赋予一层燃烧，获得一层护盾。',
  // 口径：**给他人**上燃烧才回盾（自己身上结算燃烧不回——否则自我燃烧会变成白盾机器）
  subscriptions: () => [{
    when: AddEffectInstruction,
    phase: 'post',
    filter: (instr, c) => instr.effectId === 'burn' && instr.target !== c.player
      && (instr.payload?.stacks ?? 0) > 0,
    react: (instr, c) => c.kernel.submitInstruction(
      new GainShieldInstruction({ target: c.player, amount: instr.payload.stacks }), instr),
  }],
});

// ---- run 级数值修正（从 baseStats 重算，见 prep.refreshRunModifiers）----

registerRelic({
  id: 'dragonScale', name: '龙鳞', rarity: 'A', cost: 3,
  description: '战斗开始时，防御 2。',
  runModifiers: { defense: 2 },
});

registerRelic({
  id: 'tianqingStone', name: '天青石', rarity: 'A', cost: 3, requires: { leino: 'air', min: 2 },
  description: '行动力上限 +1。',
  runModifiers: { maxActionPoints: 1 },
});

registerRelic({
  id: 'implantJar', name: '植入式魏启罐', rarity: 'C', cost: 1, requires: { anyLeino: 1 },
  description: '战斗开始时，获得 1 魏启上限（但不恢复魏启）。',
  runModifiers: { maxMana: 1 },
});

// ---- 塞西莉亚之恩赐（S·事件专属）：致命一击延迟一回合 ----
// 实现＝「致命拦截 + 奇迹1」；拦截点是伤害指令的 PRE（PRE 在 execute 之前跑，
// 是唯一能改变本次结算结果的时机）。语义见 effects.js 的 miracle。
registerRelic({
  id: 'ceciliaBlessing', name: '塞西莉亚之恩赐', rarity: 'S', cost: 1, acquisition: ['event'],
  description: '每场战斗一次：你将死亡时，改为保留 1 点生命并获得奇迹 1（自己回合结束时奇迹 -1，归零即死亡）。',
  subscriptions: () => {
    let used = false; // 每场战斗重置：subscriptions 在战前装配时调用一次
    return [{
      when: DealDamageInstruction,
      phase: 'pre',
      // 致命判定写在 react 而不是 filter：内核 _collect 先对所有订阅跑 filter、再按
      // priority 排序跑 react，故 filter 里读到的是**所有伤害修饰之前**的 payload。
      // priority -100 让本 react 排到所有修饰 react（priority 0）之后。
      priority: -100,
      filter: (instr, c) => !used
        && instr.target === c.player
        && !instr.tags?.includes('miracle')
        && c.player.getEffectStacks('miracle') <= 0,
      react: (instr, c) => {
        if (!wouldBeLethal(instr, c.player)) return;
        used = true;
        const p = c.player;
        c.kernel.veto(instr, 'cecilia', [
          new DealDamageInstruction({
            source: instr.source, target: p,
            amount: Math.max(p.hp - 1, 0) + p.shield, fixed: true, tags: ['ceciliaGuard'],
          }),
          new AddEffectInstruction({ target: p, effectId: 'miracle', stacks: 1 }),
        ]);
      },
    }];
  },
});

// ====================================================================
// 第二批（RELICS.md 2026-09-11）：需要「新机制」的那些。
// 数值修正统一走「修正 + 运行时重算」：run 级 = runModifiers，本场 = battleModifiers /
// applyBattleModifier。两者都随生命周期自然消失，故本批**没有一处回滚代码**。
// ====================================================================

// ---- 本场资源 / 上限 ----

registerRelic({
  id: 'microAwfd', name: '微型AWFD', rarity: 'A', cost: 1, acquisition: ['gurpas'], // SHOP.md §二：仅在古尔帕斯的店出售
  description: '战斗开始时，获得 1 魏启；本场战斗魏启上限 +1。',
  battleModifiers: { maxMana: 1 },
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new GainManaInstruction({ amount: 1 }));
  },
});

registerRelic({
  id: 'ancientTome', name: '古书序章', rarity: 'B', cost: 3, acquisition: ['gurpas'], // SHOP.md §二：仅在古尔帕斯的店出售
  description: '战斗开始时，抽 1 张牌；本场战斗手牌上限 +1。',
  battleModifiers: { maxHandSize: 1 },
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new DrawCardsInstruction({ count: 1, reason: 'relic' }));
  },
});

registerRelic({
  id: 'seaGodTrident', name: '海神戟', rarity: 'A', cost: 2, acquisition: ['gurpas'], // SHOP.md §二：仅在古尔帕斯的店出售
  description: '战斗的前 3 个回合，你的手牌上限 -1；第 4 回合开始时，获得力量 5。',
  onBattleStart(ctx) {
    applyBattleModifier(ctx, 'maxHandSize', -1);
  },
  subscriptions: () => [{
    when: TurnStartInstruction,
    phase: 'post',
    filter: (instr, c) => instr.side === 'player' && c.battleState.turn.count === 4,
    react: (instr, c) => {
      applyBattleModifier(c, 'maxHandSize', 1); // 撤销 -1：第 4 回合起手牌上限回归
      c.kernel.submitInstruction(
        new AddEffectInstruction({ target: c.player, effectId: 'strength', stacks: 5 }), instr);
    },
  }],
});

// ---- 回合节奏 / 资源钩子 ----

registerRelic({
  id: 'clearCrystal', name: '澈晶石', rarity: 'B', cost: 1, acquisition: ['gurpas'], // SHOP.md §二：仅在古尔帕斯的店出售
  description: '回合开始时，若你的魏启为 0，则获得 1 魏启。',
  // 时间点取 PlayerTurnInstruction 的 PRE：自然恢复（+1）是它的子指令，POST 时魏启已被抬过，
  // 再也看不到 0——要「为 0 则补 1」必须读恢复前的值。
  subscriptions: () => [{
    when: PlayerTurnInstruction,
    phase: 'pre',
    filter: (instr, c) => c.player.mana === 0,
    react: (instr, c) => c.kernel.submitInstruction(new GainManaInstruction({ amount: 1 }), instr),
  }],
});

registerRelic({
  id: 'blackCrystalShard', name: '黑晶剑残片', rarity: 'A', cost: 1, acquisition: ['gurpas'], // SHOP.md §二：仅在古尔帕斯的店出售
  description: '战斗开始时，获得力量 2；每回合开始时，你受 2 伤害。',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(
      new AddEffectInstruction({ target: ctx.player, effectId: 'strength', stacks: 2 }));
  },
  subscriptions: () => [{
    when: TurnStartInstruction,
    phase: 'post',
    filter: (instr) => instr.side === 'player',
    react: (instr, c) => c.kernel.submitInstruction(
      new DealDamageInstruction({ target: c.player, amount: 2, tags: ['relic'] }), instr),
  }],
});

registerRelic({
  id: 'frostBrooch', name: '霜雪胸针', rarity: 'S', cost: 1, acquisition: ['gurpas'], // SHOP.md §二：仅在古尔帕斯的店出售
  description: '每场战斗一次：当你的生命降至一半以下时，获得力量 3 与格挡 3。',
  subscriptions: () => {
    let used = false; // 每场战斗一次（工厂每场调用一次）
    return [{
      when: DealDamageInstruction,
      phase: 'post',
      filter: (instr, c) => !used && instr.target === c.player && c.player.hp > 0
        && c.player.hp * 2 <= c.player.maxHp,
      react: (instr, c) => {
        used = true;
        c.kernel.submitInstruction(
          new AddEffectInstruction({ target: c.player, effectId: 'strength', stacks: 3 }), instr);
        c.kernel.submitInstruction(
          new GainShieldInstruction({ target: c.player, amount: 3 }), instr);
      },
    }];
  },
});

registerRelic({
  id: 'ranCrystal', name: '冉晶石', rarity: 'A', cost: 3, acquisition: ['gurpas'], // SHOP.md §二：仅在古尔帕斯的店出售
  description: '每回合开始时，获得 1 魏启，并对所有单位造成 1 点固定伤害（含你自己）。',
  subscriptions: () => [{
    when: TurnStartInstruction,
    phase: 'post',
    filter: (instr) => instr.side === 'player',
    react: (instr, c) => {
      c.kernel.submitInstruction(new GainManaInstruction({ amount: 1 }), instr);
      const all = [c.player, ...c.battleState.enemies, ...c.battleState.allies];
      for (const u of all) {
        if (u.isDead()) continue;
        c.kernel.submitInstruction(new DealDamageInstruction({
          target: u, amount: 1, fixed: true, tags: ['relic'],
        }), instr);
      }
    },
  }],
});

// ---- 战斗开始：群伤 / 负面 / 免疫 ----

registerRelic({
  id: 'evansCrown', name: '埃文斯冠冕', rarity: 'S', cost: 2, acquisition: ['gurpas'], // SHOP.md §二：仅在古尔帕斯的店出售
  description: '战斗开始时，对所有敌人造成 4 点固定伤害，并赋予虚弱 2。',
  onBattleStart(ctx) {
    for (const e of ctx.battleState.enemies) {
      if (e.isDead()) continue;
      ctx.kernel.submitInstruction(new DealDamageInstruction({
        source: ctx.player, target: e, amount: 4, fixed: true, tags: ['relic'],
      }));
      ctx.kernel.submitInstruction(
        new AddEffectInstruction({ target: e, effectId: 'weaken', stacks: 2 }));
    }
  },
});

registerRelic({
  id: 'resonanceRound', name: '谐振弹', rarity: 'B', cost: 2, acquisition: ['gurpas'], // SHOP.md §二：仅在古尔帕斯的店出售
  description: '非 Boss 战开始时，随机赋予一名敌人晕眩 1。',
  onBattleStart(ctx) {
    if (isBossFloor(ctx.runState.floor)) return;
    const alive = ctx.battleState.enemies.filter(e => !e.isDead());
    if (!alive.length) return;
    const pick = alive[ctx.battleState.rng.int(0, alive.length - 1)];
    ctx.kernel.submitInstruction(
      new AddEffectInstruction({ target: pick, effectId: 'stun', stacks: 1 }));
  },
});

registerRelic({
  id: 'oldTacticalGoggles', name: '老旧的战术目镜', rarity: 'C', cost: 1,
  // RELICS.md 写的是「易伤 1」，EFFECTS.md 只有「伤残」＝受伤 +层数，按同口径落地
  // （术语待用户定名；若两者应不同机制，再补一条 EFFECTS.md 定义）。
  description: '战斗开始时，随机赋予一名敌人伤残 1（受到的伤害 +1）。',
  onBattleStart(ctx) {
    const alive = ctx.battleState.enemies.filter(e => !e.isDead());
    if (!alive.length) return;
    const pick = alive[ctx.battleState.rng.int(0, alive.length - 1)];
    ctx.kernel.submitInstruction(
      new AddEffectInstruction({ target: pick, effectId: 'maim', stacks: 1 }));
  },
});

registerRelic({
  id: 'realmDust', name: '界尘', rarity: 'A', cost: 1,
  description: '战斗开始后，免疫第一次负面效果赋予。',
  subscriptions: () => {
    let used = false;
    return [{
      when: AddEffectInstruction,
      phase: 'pre',
      // 只拦「赋予」（层数 > 0）：扣减/清除负面效果不该被免疫挡掉
      filter: (instr, c) => !used && instr.target === c.player && instr.stacks > 0
        && getEffectDefinition(instr.effectId)?.type === 'debuff',
      react: (instr, c) => { used = true; c.kernel.veto(instr, 'realmDust'); },
    }];
  },
});

// ---- 战后 run 级结算（走 run 层钩子，见 runFlow.finishBattle）----

registerRelic({
  id: 'royalCrystal', name: '皇晶石', rarity: 'B', nonSlot: true, acquisition: ['gurpas'], // SHOP.md §二：仅在古尔帕斯的店出售
  description: '每场战斗胜利后，额外获得 4 金币。',
  onBattleVictory: (run) => { run.player.money += 4; },
});

// ---- 生成衍生牌（RELICS.md 第二批；四张牌只由遗物生成，不进任何卡包）----

registerRelic({
  id: 'aronaIII', name: '阿罗那 III', rarity: 'C', cost: 1, acquisition: ['gurpas'], // SHOP.md §二：仅在古尔帕斯的店出售
  description: '战斗开始时，将 1 张/card{rapidFire}加入手牌。',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new AddCardInstruction({ defId: 'rapidFire', toZone: 'hand' }));
  },
});

registerRelic({
  id: 'blackFireH3', name: '黑火 H-3', rarity: 'B', cost: 1, acquisition: ['gurpas'], // SHOP.md §二：仅在古尔帕斯的店出售
  description: '战斗开始时，将 1 张/card{pointShot}洗入牌库。',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new AddCardInstruction({ defId: 'pointShot', index: 'random' }));
  },
});

registerRelic({
  id: 'prayerSystem', name: '祈祷制度', rarity: 'B', cost: 1, acquisition: ['gurpas'], // SHOP.md §二：仅在古尔帕斯的店出售
  description: '战斗开始时，将 1 张/card{suppressionFire}洗入牌库。',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new AddCardInstruction({ defId: 'suppressionFire', index: 'random' }));
  },
});

registerRelic({
  id: 'whisperEagleZ', name: '低语苍鹰 Z', rarity: 'A', cost: 1, acquisition: ['gurpas'], // SHOP.md §二：仅在古尔帕斯的店出售
  description: '战斗开始时，将 1 张/card{piercingShot}洗入牌库。',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new AddCardInstruction({ defId: 'piercingShot', index: 'random' }));
  },
});

// ---- 选牌类（2026-09-11：需要「从指定卡牌集里选 M~N 张」的结算期输入）----
// 订阅/onBattleStart 里没有技能分段可用，所以用输入指令子类挂后续动作
// （范式：test/asyncInput.test.js 的 CounterInputInstruction）。

/** 选牌输入 + 应答后落地：then(ctx, selection) 里提交后续指令。 */
class PickCardsInstruction extends AwaitPlayerInputInstruction {
  constructor({ request, then = null }, opts = {}) {
    super({ request }, opts);
    this.then = then;
  }

  execute(ctx) {
    const done = super.execute(ctx);
    if (done === true) this.then?.(ctx, this.result?.selection ?? [], this);
    return done;
  }
}

// 胚胎（S·1槽）：战斗开始时从牌库中寻找 1 张自选入手。
// RELICS.md 标注「仅在古尔帕斯的店购买」——古尔帕斯之店尚未实装，故暂按可抽取处理
// （与其他古尔帕斯货同口径：先让它能被拿到、能被试玩）。
registerRelic({
  id: 'embryo', name: '胚胎', rarity: 'S', cost: 1, acquisition: ['gurpas'], // SHOP.md §二：仅在古尔帕斯的店出售
  description: '战斗开始时，从牌库中寻找 1 张牌，自选加入手牌。',
  onBattleStart(ctx) {
    const pool = ctx.battleState.zones.deck;
    if (!pool.length) return;   // 空集守卫：候选为空时不发起请求（否则界面无合法应答）
    ctx.kernel.submitInstruction(new PickCardsInstruction({
      request: {
        kind: 'selectCards', source: 'deck', min: 1, max: 1, picker: 'overlay',
        reason: '胚胎：寻找一张牌加入手牌',
        candidates: pool.map(c => c.uniqueID),
      },
      then: (c, sel, self) => {
        for (const id of sel) {
          c.kernel.submitInstruction(new MoveCardInstruction({ uniqueID: id, toZone: 'hand' }), self);
        }
      },
    }));
  },
});

// 原初拟态基质（A·3槽）：每场战斗一次，复制手牌中的一张牌。
// 手牌要等初始抽牌之后才满（onBattleStart 早于 initialDraw）→ 挂首次抽牌的 POST。
registerRelic({
  id: 'primordialMatrix', name: '原初拟态基质', rarity: 'A', cost: 3, acquisition: ['gurpas'], // SHOP.md §二：仅在古尔帕斯的店出售
  description: '每场战斗一次：复制你手牌中的一张牌。',
  onBattleStart(ctx) {
    ctx.kernel.addSubscription({
      when: DrawCardsInstruction,
      phase: 'post',
      window: 'once',           // 首次抽牌（初始抽牌）后触发一次
      react: (instr, c) => {
        const pool = c.battleState.zones.hand;
        if (!pool.length) return; // 空集守卫
        c.kernel.submitInstruction(new PickCardsInstruction({
          request: {
            kind: 'selectCards', source: 'hand', min: 1, max: 1, picker: 'overlay',
            reason: '原初拟态基质：复制手牌中的一张牌',
            candidates: pool.map(x => x.uniqueID),
          },
          then: (cc, sel, self) => {
            for (const id of sel) {
              const src = cc.battleState.zones.hand.find(x => x.uniqueID === id);
              if (!src) continue;
              // 复制 = 按同一 defId 新建一张入手（不继承该张的充能/冷却等实例计数——「复制品」语义）
              cc.kernel.submitInstruction(new AddCardInstruction({ defId: src.defId, toZone: 'hand' }), self);
            }
          },
        }), instr);
      },
    });
  },
});
