import { registerRelic } from '../relics/registry.js';
import { TurnStartInstruction, PlayerTurnEndInstruction, PlayerTurnInstruction } from '../instructions/turn.js';
import {
  DealDamageInstruction, GainShieldInstruction, ApplyHealInstruction, wouldBeLethal,
} from '../instructions/combat.js';
import { GainManaInstruction, GainActionPointsInstruction } from '../instructions/resources.js';
import { DrawCardsInstruction, AddCardInstruction, MoveCardInstruction, DumpCardsInstruction, DiscardOverflowInstruction } from '../instructions/cards.js';
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
  flavor: '不用刀叉，吃了它，你就能变强',
  onAcquire: (run) => gainMaxHp(run, 5),
});

registerRelic({
  id: 'northMountainRock', name: '北山岩', rarity: 'C', nonSlot: true,
  description: '拾起时，获得 2 最大生命。',
  flavor: '一块大陆北方的石头，让你回想起那个年代',
  onAcquire: (run) => gainMaxHp(run, 2),
});

registerRelic({
  id: 'naan', name: '馕饼', rarity: 'C', nonSlot: true,
  description: '拾起时，获得 3 最大生命。',
  flavor: '能把人的牙崩掉',
  onAcquire: (run) => gainMaxHp(run, 3),
});

registerRelic({
  id: 'steelShard', name: '拟钢碎片', rarity: 'C', nonSlot: true, acquisition: ['gurpas'], // SHOP.md §二：仅在古尔帕斯的店出售
  description: '拾起时，获得 1 最大生命；战斗开始时获得 1 护盾。',
  flavor: '现在它也能被称为遗物了',
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
  flavor: '这是一个壶，你可以用它装水喝。不一定非得是山泉水',
  onCampRest(run) {
    const p = run.player;
    p.hp = Math.min(p.maxHp, p.hp + 5);
  },
});

// ---- 战斗开始时（资源 / 状态）----

registerRelic({
  id: 'dragonHeartTissue', name: '龙心组织', rarity: 'A', cost: 1,
  description: '战斗开始时，获得 2 行动力。',
  flavor: '本来就没有生命的东西，却会不住地跳动',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new GainActionPointsInstruction({ amount: 2 }));
  },
});

registerRelic({
  id: 'seaCrystal', name: '海晶石', rarity: 'B', cost: 1,
  description: '战斗开始时，获得 1 魏启。',
  flavor: '一块宝石，它的外貌和魏启的图标很像',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new GainManaInstruction({ amount: 1 }));
  },
});

registerRelic({
  id: 'kadasFang', name: '卡达斯的獠牙', rarity: 'A', cost: 2,
  description: '战斗开始时，获得 3 魏启。',
  flavor: '卡达斯的獠牙之一，内部是纯粹且暴躁的魏启',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new GainManaInstruction({ amount: 3 }));
  },
});

registerRelic({
  id: 'blackMountainRock', name: '黑山岩', rarity: 'C', cost: 1,
  description: '战斗开始时，获得 4 护盾。',
  flavor: '朴素的使用方式——揣在胸前以防护攻击',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new GainShieldInstruction({ target: ctx.player, amount: 4 }));
  },
});

registerRelic({
  id: 'evanStone', name: '埃文石', rarity: 'A', cost: 1,
  description: '战斗开始时，赋予所有敌人虚弱 1。',
  flavor: '蔑视',
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
  flavor: '它能让你变得如同太阳一般耀眼——同时避免你被灼伤',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new AddEffectInstruction({
      target: ctx.player, effectId: 'flameAffinity', stacks: 2,
    }));
  },
});

registerRelic({
  id: 'kadasClaw', name: '卡达斯之爪', rarity: 'A', cost: 1, requires: { leino: 'fire', min: 1 },
  description: '战斗开始时，获得炎魔 1。',
  flavor: '卡达斯之爪，尚有余温',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new AddEffectInstruction({
      target: ctx.player, effectId: 'flameDemon', stacks: 1,
    }));
  },
});

registerRelic({
  id: 'whiteFireStone', name: '白火石', rarity: 'B', cost: 2, requires: { leino: 'fire', min: 1 },
  description: '战斗第一回合开始时，赋予所有单位燃烧 2。',
  flavor: '这块宝石实际上只是白晶石的一种罢了，只是格外的热',
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
  flavor: '它曾是一个普通的魏启罐，直到有一天一位冉姓公主亲吻了它',
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
  flavor: '它很光滑，导致你第二回合才能抓紧它',
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
  flavor: '请正确、正当地使用此物品',
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
  flavor: '小小的种子，种下之后，收获小小的治愈',
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
  flavor: '有命买，没命花',
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
  flavor: '冲锋！',
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
  flavor: '唯快不破',
  subscriptions: () => [dartVolley()],
});

registerRelic({
  id: 'miniDart', name: '迷你飞镖', rarity: 'A', ...COST0,
  description: '第一回合结束时，对所有敌人造成 2 伤害。',
  flavor: '唯快不破',
  subscriptions: () => [dartVolley()],
});

// ---- 受击 / 出牌 反应 ----

registerRelic({
  id: 'sledgehammer', name: '大锤', rarity: 'C', cost: 1,
  description: '每次受伤后，获得 1 护盾。',
  flavor: '为什么大锤有这个效果？',
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
  flavor: '其中装填的的的确确是肾上腺素，不要怀疑',
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
  // 铭刻（flavor：tooltip 效果描述后另起一段展示；RELICS.md 原文——叠炎体系
  // 「与燃烧博弈」的设计哲学注脚：收益与风险并存）
  flavor: '不要玩火，不要玩火，玩火必自焚。',
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
  flavor: '风一般轻盈',
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
  flavor: '火焰会护佑你',
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
  id: 'dragonScale', name: '龙鳞碎片', rarity: 'A', cost: 3,
  description: '战斗开始时，防御 2。',
  flavor: '在很久以前，它是魏启大陆上灵御们传说中的令物，不过现在它只是一块特硬的铁片罢了',
  runModifiers: { defense: 2 },
});

registerRelic({
  id: 'tianqingStone', name: '天青石', rarity: 'A', cost: 3, requires: { leino: 'air', min: 2 },
  description: '行动力上限 +1。',
  flavor: '每个空系灵御的梦中宝石',
  runModifiers: { maxActionPoints: 1 },
});

registerRelic({
  id: 'implantJar', name: '植入式魏启罐', rarity: 'C', cost: 1, requires: { anyLeino: 1 },
  description: '战斗开始时，获得 1 魏启上限（但不恢复魏启）。',
  flavor: '禁忌的人体实验，而且还没开发完全',
  runModifiers: { maxMana: 1 },
});

// ---- 塞西莉亚之恩赐（S·事件专属）：致命一击延迟一回合 ----
// 实现＝「致命拦截 + 奇迹1」；拦截点是伤害指令的 PRE（PRE 在 execute 之前跑，
// 是唯一能改变本次结算结果的时机）。语义见 effects.js 的 miracle。
registerRelic({
  id: 'ceciliaBlessing', name: '塞西莉亚之恩赐', rarity: 'S', cost: 1, acquisition: ['event'],
  description: '每场战斗一次：你将死亡时，改为保留 1 点生命并获得奇迹 1（自己回合结束时奇迹 -1，归零即死亡）。',
  flavor: '生命之倔强',
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
  flavor: '有点太小了',
  battleModifiers: { maxMana: 1 },
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new GainManaInstruction({ amount: 1 }));
  },
});

registerRelic({
  id: 'ancientTome', name: '古书序章', rarity: 'B', cost: 3, acquisition: ['gurpas'], // SHOP.md §二：仅在古尔帕斯的店出售
  description: '战斗开始时，抽 1 张牌；本场战斗手牌上限 +1。',
  flavor: '很少有人在意这本书的内容了',
  battleModifiers: { maxHandSize: 1 },
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new DrawCardsInstruction({ count: 1, reason: 'relic' }));
  },
});

registerRelic({
  id: 'seaGodTrident', name: '海神戟', rarity: 'A', cost: 2, acquisition: ['gurpas'], // SHOP.md §二：仅在古尔帕斯的店出售
  description: '战斗的前 3 个回合，你的手牌上限 -1；第 4 回合开始时，获得力量 5。',
  flavor: '没人抡得动它',
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
  flavor: '辐射...有时候还是个好东西',
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
  flavor: '值得吗？',
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
  flavor: '特殊的胸针。到底有多特殊？',
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
  flavor: '辐射！',
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
  flavor: '这玩意被挖出来以后主要用来人工降雨',
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
  flavor: '对机械特攻',
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
  flavor: 'cosplay',
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
  flavor: '罕见的宝贝，抑制超现实力量的武器，曾经被灵御们竞相争夺',
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
  flavor: '我很富裕，相信我',
  onBattleVictory: (run) => { run.player.money += 4; },
});

// ---- 生成衍生牌（RELICS.md 第二批；四张牌只由遗物生成，不进任何卡包）----

registerRelic({
  id: 'aronaIII', name: '阿罗那 III', rarity: 'C', cost: 1, acquisition: ['gurpas'], // SHOP.md §二：仅在古尔帕斯的店出售
  description: '战斗开始时，将 1 张/card{rapidFire}加入手牌。',
  flavor: '包装盒上还有广告“军警两用枪械，值得信赖”',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new AddCardInstruction({ defId: 'rapidFire', toZone: 'hand' }));
  },
});

registerRelic({
  id: 'blackFireH3', name: '黑火 H-3', rarity: 'B', cost: 1, acquisition: ['gurpas'], // SHOP.md §二：仅在古尔帕斯的店出售
  description: '战斗开始时，将 1 张/card{pointShot}洗入牌库。',
  flavor: '她的配枪',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new AddCardInstruction({ defId: 'pointShot', index: 'random' }));
  },
});

registerRelic({
  id: 'prayerSystem', name: '祈祷制度', rarity: 'B', cost: 1, acquisition: ['gurpas'], // SHOP.md §二：仅在古尔帕斯的店出售
  description: '战斗开始时，将 1 张/card{suppressionFire}洗入牌库。',
  flavor: '另一人的配枪，不过她不在塔内，她撑不了这么久',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new AddCardInstruction({ defId: 'suppressionFire', index: 'random' }));
  },
});

registerRelic({
  id: 'whisperEagleZ', name: '低语苍鹰 Z', rarity: 'A', cost: 1, acquisition: ['gurpas'], // SHOP.md §二：仅在古尔帕斯的店出售
  description: '战斗开始时，将 1 张/card{piercingShot}洗入牌库。',
  flavor: '名字很不错，威力很可观',
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
  flavor: '一个空壳罢了',
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
  flavor: '阿瓦凡的低劣仿造品',
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

// ============ 2026-09-13 新体系遗物第一波（总策划批次，设计稿 tmp/design-relics-wave1.mjs）============
// 轴心：给两级手牌/弃牌/咏唱/超载/自燃博弈这些第 6 轮验证过的新机制各配一件构筑杠杆。
// 分布：C·1槽×3 / B·1槽×2 / B·2槽×1 / A·2槽×1 / A·非槽×1。

// 拾荒者的口袋（C·1槽）——弃牌轴：每回合你第一次弃牌时，抽 1 张牌。
// 软补 dump 不补牌的痛点；限每回合 1 次，不破坏「弃牌=止损」的定位。
registerRelic({
  id: 'scavengerPouch', name: '拾荒者的口袋', rarity: 'C', cost: 1,
  description: '每回合你第一次弃牌时，抽 1 张牌。',
  flavor: '破铜烂铁也是钱',
  subscriptions: () => {
    let lastTurn = -1;
    return [{
      when: DumpCardsInstruction,
      phase: 'post',
      filter: (instr, c) => c.battleState.turn.count !== lastTurn,
      react: (instr, c) => {
        lastTurn = c.battleState.turn.count;
        c.kernel.submitInstruction(new DrawCardsInstruction({ count: 1, reason: 'scavengerPouch' }), instr);
      },
    }];
  },
});

// 架势镜（B·2槽）——完美轴：你的完美卡伤害 +8。
// 完美是战术挑战（条件不动），这件给 payoff 再加一根杠杆。完美卡的伤害指令带
// tags:['perfect']（blockSkills.js 六个出牌点统一打标）。
registerRelic({
  id: 'stanceMirror', name: '架势镜', rarity: 'B', cost: 2,
  description: '你的完美卡伤害 +8。',
  flavor: '照出你架势里的每一处破绽',
  subscriptions: () => [{
    when: DealDamageInstruction,
    phase: 'pre',
    filter: (instr) => instr.source?.side === 'player' && instr.tags?.includes('perfect'),
    react: (instr) => instr.setPayload('damage', instr.payload.damage + 8),
  }],
});

// 胀满的背包（C·1槽）——超载轴：超载上限 +2（回合内抽牌爆发空间 5→7）。
registerRelic({
  id: 'bulgingPack', name: '胀满的背包', rarity: 'C', cost: 1,
  description: '超载上限 +2。',
  flavor: '塞得下，就都是你的',
  onBattleStart(ctx) {
    ctx.battleState.overloadBonus = (ctx.battleState.overloadBonus ?? 0) + 2;
  },
});

// 守夜灯（B·1槽）——尾弃轴：每回合尾弃时，每弃 1 张牌获得 2 护盾。
// 尾弃从纯损失变对冲收入——与容量博弈的新玩具。
registerRelic({
  id: 'nightLantern', name: '守夜灯', rarity: 'B', cost: 1,
  description: '每回合尾弃时，每弃 1 张牌获得 2 护盾。',
  flavor: '丢掉的，替你守夜',
  subscriptions: () => [{
    when: DiscardOverflowInstruction,
    phase: 'post',
    filter: (instr) => (instr.result?.discarded ?? 0) > 0,
    react: (instr, c) => c.kernel.submitInstruction(
      new GainShieldInstruction({ target: c.player, amount: 2 * instr.result.discarded }), instr),
  }],
});

// 火中取栗（B·1槽）——自燃博弈轴：每当你获得燃烧时，获得等量一半（向下取整）的护盾。
// 「与燃烧博弈，收益与风险并存」的新玩具——自燃变盾，和亲和/防火形成三角。
registerRelic({
  id: 'chestnutFromFire', name: '火中取栗', rarity: 'B', cost: 1,
  description: '每当你获得燃烧时，获得等量一半（向下取整）的护盾。',
  flavor: '敢伸手，才有栗子吃',
  subscriptions: () => [{
    when: AddEffectInstruction,
    phase: 'post',
    filter: (instr) => instr.effectId === 'burn' && instr.target?.side === 'player'
      && (instr.payload?.stacks ?? instr.stacks ?? 0) > 0,
    react: (instr, c) => c.kernel.submitInstruction(new GainShieldInstruction({
      target: c.player,
      amount: Math.floor((instr.payload?.stacks ?? instr.stacks) / 2),
    }), instr),
  }],
});

// 共鸣石（A·2槽）——咏唱轴：你激活的咏唱卡权重 -1（最低 1）。咏唱构筑的核心件。
registerRelic({
  id: 'resonanceStone', name: '共鸣石', rarity: 'A', cost: 2,
  description: '你激活的咏唱卡权重 -1（最低 1）。',
  flavor: '万籁同频',
  onBattleStart(ctx) {
    ctx.battleState.chantWeightDiscount = (ctx.battleState.chantWeightDiscount ?? 0) + 1;
  },
});

// 松鼠的囤积（C·1槽）——留存轴：玩家回合结束时若手牌 ≤ 2，下回合抽牌 +1。
// 打空流的另一条腿（能打就打空，空了多抽一张）。
registerRelic({
  id: 'squirrelHoard', name: '松鼠的囤积', rarity: 'C', cost: 1,
  description: '你的回合结束时，若手牌不多于 2 张，下回合抽牌 +1。',
  flavor: '藏起来的，才算数',
  subscriptions: () => [{
    when: PlayerTurnEndInstruction,
    phase: 'post',
    filter: (instr, c) => c.battleState.zones.hand.length <= 2,
    react: (instr, c) => {
      c.battleState.turnDrawBonus = (c.battleState.turnDrawBonus ?? 0) + 1;
    },
  }],
});

// 破釜沉舟（A·非槽位）——残血博弈：以生命 ≤ 15 进入战斗时，本场 AP 上限 +1。
// battleModifiers 在 PreBattle 折入（读的是进战时点的生命），随战斗消失，无需回滚。
registerRelic({
  id: 'brokenCauldron', name: '破釜沉舟', rarity: 'A', nonSlot: true,
  description: '以生命不多于 15 进入战斗时，本场战斗行动力上限 +1。',
  flavor: '没有退路的时候，路最宽',
  battleModifiers: (p) => (p.hp <= 15 ? { maxActionPoints: 1 } : {}),
});
