import { registerAbility } from '../abilities/registry.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import { DrawCardsInstruction } from '../instructions/cards.js';
import { UseSkillInstruction } from '../instructions/skill.js';
import { DealDamageInstruction, ApplyDamageInstruction, GainShieldInstruction, ApplyHealInstruction } from '../instructions/combat.js';
import { GainManaInstruction, GainActionPointsInstruction, ConsumeActionPointsInstruction, ConsumeManaInstruction } from '../instructions/resources.js';
import { PlayerTurnStartInstruction, PlayerTurnEndInstruction } from '../instructions/turn.js';
import { aliveEnemies } from '../state/battleState.js';
import { getSkillDefinition } from '../skills/registry.js';
import { isBladeCard } from './cardKit.js';
import { poisonAmpSubscription } from './woodSkills.js';
import { applyBattleModifier } from '../run/prep.js';

// 战意：战斗开始时获得 1 层力量。**不再作为初始能力授予**（2026-09 移除初始配置），
// 保留定义供旧档兼容与后续奖励/事件投放使用。
registerAbility({
  id: 'battleFocus', name: '战意',
  description: '战斗开始时获得 1 层力量。',
  onBattleStart(ctx) {
    ctx.player.addEffect('strength', 1);
  },
});

// 火灵脉体系能力（FIRE_VEIN_CARDS §0，2026-09 定）：首次点亮火灵脉时自动授予，
// 战斗开始获得 烈焰亲和3 + 炎魔1。订阅型效果必须经 AddEffectInstruction 入列
// （状态级 addEffect 不挂订阅），不能照抄战意的直改写法。
registerAbility({
  id: 'fireVein', name: '火灵脉',
  description: '战斗开始时，获得烈焰亲和3与炎魔1。',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new AddEffectInstruction({
      target: ctx.player, effectId: 'flameAffinity', stacks: 3,
    }));
    ctx.kernel.submitInstruction(new AddEffectInstruction({
      target: ctx.player, effectId: 'flameDemon', stacks: 1,
    }));
  },
});

// ---- 刀法体系能力（BODY_CULTIVATION_CARDS §2.5，2026-09-13 稿）----
// 获取途径（进阶事件内择精英/大师能力）仍是占位（TODO「精英/大师能力系统实装」）；
// 这里先把**效果本体**按设计稿落地——机制都是现成的：
//   刀客 = 换牌费用上限（battleState.swapCostCap，见 state/battleState.swapCostOf）；
//   刀圣 = 战斗窗口订阅，打出刀法牌（isBladeCard 判据，含碎铁/斩链衍生牌）就抽 1。
registerAbility({
  id: 'bladeMaster', name: '刀客', grade: 'elite',
  description: '弃卡开销不超过 1。',
  onBattleStart(ctx) {
    // 取更严者：将来若有多条能力同时封顶，低的那个生效（null = 无上限）
    ctx.battleState.swapCostCap = Math.min(ctx.battleState.swapCostCap ?? Infinity, 1);
  },
});

registerAbility({
  id: 'bladeSaint', requires: 'bladeMaster', name: '刀圣', grade: 'master',
  description: '每打出一张刀法牌，抽 1 张牌。',
  subscriptions: () => [{
    when: UseSkillInstruction, phase: 'post',
    filter: (instr) => isBladeCard(instr.skill),
    react: (instr, ctx) => ctx.kernel.submitInstruction(
      new DrawCardsInstruction({ count: 1, reason: '刀圣' }), instr),
  }],
});

// ============================================================================
// 精英/大师能力（2026-09-13 实装，FIRE_VEIN_CARDS §1.4/§2.3 + BODY_CULTIVATION_CARDS
// §1.4/§2.5/§3.4）。授予通道 = 进阶事件：灵脉 2 级出精英池、3 级出大师池；
// 体修看隐藏 bodyLevel（同门槛），见 run/ascension.js 的 abilityOffering。
// def.grade：'elite' | 'master'（授予幕间的选项前缀展示）。
// 机制备忘：
//   · 伤害修饰全走 PRE 流水线（payload.damage），多重能力按 priority 降序叠加；
//   · 「同线精英/大师同时持有」取强者（吞日者覆盖吹火者、武帝覆盖武者），filter 里排他；
//   · 武者/武帝的 priority 必须低于格挡 block 的 PRE（默认 0）——它们在 block 减半之后
//     再折算（净减免 = 1/2 × 1/2 = 75%、1/2 × 1/5 = 90%），顺序反了数值会错。
// ============================================================================

// ---- 火·爆炎（§1.4）----

// 精英 **聚爆**：群伤技能只命中一个敌人时，其受 1.5 倍伤害。
// 判据 = tags:['aoe'] 且存活敌人仅 1 只（aoe 每敌一枚指令，单敌时自然只有一枚命中）。
registerAbility({
  id: 'pyroBlast', name: '聚爆', grade: 'elite',
  description: '群伤技能只命中一个敌人时，其受到 1.5 倍伤害。',
  subscriptions: () => [{
    when: DealDamageInstruction, phase: 'pre',
    filter: (instr, ctx) => instr.source === ctx.player && !instr.fixed
      && instr.type === 'major'
      && instr.tags?.includes('aoe') && aliveEnemies(ctx.battleState).length === 1,
    react: (instr) => instr.setPayload('damage', Math.floor(instr.payload.damage * 1.5)),
  }],
});

// 大师 **起手式**：战斗中，你打出的第一张火灵脉攻击牌伤害翻倍。
// 判据 = 伤害指令携带的 skill 反查 def.type === 'fire'（dealDamage 透传 sctx.self）。
registerAbility({
  id: 'openerGambit', requires: 'pyroBlast', name: '起手式', grade: 'master',
  description: '战斗中，你打出的第一张火灵脉攻击牌伤害翻倍。',
  subscriptions: () => {
    let used = false; // 战斗窗口闭包：每场重置（订阅随战斗销毁）
    return [{
      when: DealDamageInstruction, phase: 'pre',
      filter: (instr, ctx) => !used && instr.source === ctx.player && !instr.fixed
        && instr.type === 'major'
        && instr.skill && getSkillDefinition(instr.skill.defId)?.type === 'fire',
      react: (instr) => { used = true; instr.setPayload('damage', instr.payload.damage * 2); },
    }];
  },
});

// 精英 **避火术**：战斗开始时，获得烈焰亲和4。
registerAbility({
  id: 'fireWard', name: '避火术', grade: 'elite',
  description: '战斗开始时，获得烈焰亲和4。',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new AddEffectInstruction({
      target: ctx.player, effectId: 'flameAffinity', stacks: 4,
    }));
  },
});

// 大师 **避焰决**：战斗开始时，获得烈焰亲和5。
registerAbility({
  id: 'flameSever', requires: 'fireWard', name: '避焰决', grade: 'master',
  description: '战斗开始时，获得烈焰亲和5。',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new AddEffectInstruction({
      target: ctx.player, effectId: 'flameAffinity', stacks: 5,
    }));
  },
});

// ---- 火·叠炎（§2.3）----

// 精英 **灼脉**：你的每层燃烧为你提供全伤害 +1（PRE 加算，玩火自焚的正收益面）。
registerAbility({
  id: 'scorchVein', name: '灼脉', grade: 'elite',
  description: '你的每层燃烧为你提供全伤害 +1。',
  subscriptions: () => [{
    when: DealDamageInstruction, phase: 'pre',
    filter: (instr, ctx) => instr.source === ctx.player && !instr.fixed
      && instr.type === 'major'
      && ctx.player.getEffectStacks('burn') > 0,
    react: (instr, ctx) => instr.setPayload('damage',
      instr.payload.damage + ctx.player.getEffectStacks('burn')),
  }],
});

// 大师 **炎魔**：战斗开始时炎魔1（与火灵脉基础能力的 1 层叠加）。
registerAbility({
  id: 'flameDemonLord', requires: 'scorchVein', name: '炎魔', grade: 'master',
  description: '战斗开始时，获得炎魔1。',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new AddEffectInstruction({
      target: ctx.player, effectId: 'flameDemon', stacks: 1,
    }));
  },
});

// 精英 **吹火者**：每点溢出魏启赋予所有敌人燃烧2（溢出 = 获取量超出上限被截断的部分；
// 持有吞日者时被覆盖，不双触发）。
registerAbility({
  id: 'fireBlower', name: '吹火者', grade: 'elite',
  description: '每点溢出魏启，赋予所有敌人燃烧2。',
  subscriptions: () => [{
    when: GainManaInstruction, phase: 'post',
    filter: (instr, ctx) => !ctx.player.abilities.includes('sunSwallower')
      && (instr.payload.amount - (instr.result?.gained ?? 0)) > 0,
    react: (instr, ctx) => {
      const overflow = instr.payload.amount - instr.result.gained;
      for (const e of aliveEnemies(ctx.battleState)) {
        ctx.kernel.submitInstruction(new AddEffectInstruction({
          target: e, effectId: 'burn', stacks: overflow * 2,
        }), instr);
      }
    },
  }],
});

// 大师 **吞日者**：每点溢出魏启赋予所有敌人燃烧4（吹火者的上位，同持覆盖）。
registerAbility({
  id: 'sunSwallower', requires: 'fireBlower', name: '吞日者', grade: 'master',
  description: '每点溢出魏启，赋予所有敌人燃烧4。',
  subscriptions: () => [{
    when: GainManaInstruction, phase: 'post',
    filter: (instr) => (instr.payload.amount - (instr.result?.gained ?? 0)) > 0,
    react: (instr, ctx) => {
      const overflow = instr.payload.amount - instr.result.gained;
      for (const e of aliveEnemies(ctx.battleState)) {
        ctx.kernel.submitInstruction(new AddEffectInstruction({
          target: e, effectId: 'burn', stacks: overflow * 4,
        }), instr);
      }
    },
  }],
});

// ---- 体修·拳（§1.4）----

// 精英 **拳师**：每回合打出第 5 张牌后，回复 1 AP。
registerAbility({
  id: 'boxer', name: '拳师', grade: 'elite',
  description: '每回合打出第 5 张牌后，回复 1 行动点。',
  subscriptions: () => {
    let count = 0; // 本回合出牌数（战斗窗口闭包，回合开始重置）
    return [
      {
        when: UseSkillInstruction, phase: 'post',
        filter: () => true,
        react: (instr, ctx) => {
          count += 1;
          if (count === 5) {
            ctx.kernel.submitInstruction(new GainActionPointsInstruction({ amount: 1 }), instr);
          }
        },
      },
      {
        when: PlayerTurnStartInstruction, phase: 'post',
        filter: () => true,
        react: () => { count = 0; },
      },
    ];
  },
});

// 大师 **拳王**：每回合打出第 8 张牌后，回复 1 AP（与拳师独立计数，同持双触发）。
registerAbility({
  id: 'champion', requires: 'boxer', name: '拳王', grade: 'master',
  description: '每回合打出第 8 张牌后，回复 1 行动点。',
  subscriptions: () => {
    let count = 0;
    return [
      {
        when: UseSkillInstruction, phase: 'post',
        filter: () => true,
        react: (instr, ctx) => {
          count += 1;
          if (count === 8) {
            ctx.kernel.submitInstruction(new GainActionPointsInstruction({ amount: 1 }), instr);
          }
        },
      },
      {
        when: PlayerTurnStartInstruction, phase: 'post',
        filter: () => true,
        react: () => { count = 0; },
      },
    ];
  },
});


// ---- 体修·拳/刀补强（2026-09-13 批次 12，BODY_CULTIVATION_CARDS §1.4/§2.5 用户文档定稿）----

// 精英 **挡拆**：你每打出一张牌，获得 1 护盾（咏唱发动同样过 UseSkillInstruction → 天然计入）。
registerAbility({
  id: 'parryFist', name: '挡拆', grade: 'elite',
  description: '你每打出一张牌，获得 1 护盾。',
  subscriptions: () => [{
    when: UseSkillInstruction, phase: 'post',
    filter: () => true,
    react: (instr, ctx) => ctx.kernel.submitInstruction(
      new GainShieldInstruction({ target: ctx.player, amount: 1 }), instr),
  }],
});

// 大师 **以攻为守**（前置：挡拆）：你每造成一次伤害（实际落血），获得 1 护盾。
// source 空（燃烧/反伤）与被全挡（dealt 0）不计——只奖**主级**真实命中
// （2026-09-15 拆分定调：附级被动伤害不算「攻」）。
registerAbility({
  id: 'shieldedOffense', name: '以攻为守', grade: 'master', requires: 'parryFist',
  description: '你每造成一次伤害，获得 1 护盾。',
  subscriptions: () => [{
    when: DealDamageInstruction, phase: 'post',
    filter: (instr, ctx) => instr.source === ctx.player
      && instr.type === 'major' && (instr.result?.dealt ?? 0) > 0,
    react: (instr, ctx) => ctx.kernel.submitInstruction(
      new GainShieldInstruction({ target: ctx.player, amount: 1 }), instr),
  }],
});

// 精英 **人刀一体**：回合结束时，牌库中每张刀法牌提供 1 护盾（持有人刀一心时被覆盖）。
registerAbility({
  id: 'bladeUnity', name: '人刀一体', grade: 'elite',
  description: '回合结束时，你的牌库中每有一张刀法牌，获得 1 护盾。',
  subscriptions: () => [{
    when: PlayerTurnEndInstruction, phase: 'post',
    filter: (instr, ctx) => !ctx.player.abilities.includes('bladeSoul'),
    react: (instr, ctx) => {
      const n = ctx.battleState.zones.deck.filter(c => isBladeCard(c)).length;
      if (n > 0) ctx.kernel.submitInstruction(
        new GainShieldInstruction({ target: ctx.player, amount: n }), instr);
    },
  }],
});

// 大师 **人刀一心**（前置：人刀一体）：牌库中每张刀法牌提供 2 护盾（人刀一体的上位）。
registerAbility({
  id: 'bladeSoul', name: '人刀一心', grade: 'master', requires: 'bladeUnity',
  description: '回合结束时，你的牌库中每有一张刀法牌，获得 2 护盾。',
  subscriptions: () => [{
    when: PlayerTurnEndInstruction, phase: 'post',
    filter: () => true,
    react: (instr, ctx) => {
      const n = ctx.battleState.zones.deck.filter(c => isBladeCard(c)).length;
      if (n > 0) ctx.kernel.submitInstruction(
        new GainShieldInstruction({ target: ctx.player, amount: n * 2 }), instr);
    },
  }],
});

// ---- 体修·拆（§3.4）----


// 精英 **武者**：格挡 ≥3 层时，受攻击从减免 50% 变为减免 75%（block 减半后再折半；
// 持有武帝时被覆盖）。priority -10 = 必须在 block 的 PRE（默认 0）之后跑。
// 2026-09-15 拆分：随 block 同迁**应用原语 PRE**（同为格挡响应链，只认主级）。
registerAbility({
  id: 'warrior', name: '武者', grade: 'elite',
  description: '格挡不少于 3 层时，受攻击减免 75% 伤害。',
  subscriptions: () => [{
    when: ApplyDamageInstruction, phase: 'pre', priority: -10,
    filter: (instr, ctx) => instr.target === ctx.player && !instr.fixed
      && instr.type === 'major'
      && ctx.player.getEffectStacks('block') >= 3
      && !ctx.player.abilities.includes('warEmperor'),
    react: (instr) => instr.setPayload('damage', Math.floor(instr.payload.damage / 2)),
  }],
});

// 大师 **武帝**：格挡 ≥5 层时，减免 90% 伤害（block 减半后再折到 1/5；武者的上位）。
registerAbility({
  id: 'warEmperor', requires: 'warrior', name: '武帝', grade: 'master',
  description: '格挡不少于 5 层时，受攻击减免 90% 伤害。',
  subscriptions: () => [{
    when: ApplyDamageInstruction, phase: 'pre', priority: -10,
    filter: (instr, ctx) => instr.target === ctx.player && !instr.fixed
      && instr.type === 'major'
      && ctx.player.getEffectStacks('block') >= 5,
    react: (instr) => instr.setPayload('damage', Math.floor(instr.payload.damage / 5)),
  }],
});


// ============================================================================
// 木灵脉 / 空灵脉能力（WOOD_VEIN_CARDS §4 + AIR_VEIN_CARDS §3，2026-09-14 实装）。
// 获赠能力随首次 0→1 进阶自动授予（FIRST_ASCENSION_GRANT）；精英/大师走
// 进阶事件授予池（灵脉 2 级出精英、3 级出大师，大师 requires 前置精英）。
// ============================================================================

// ---- 获赠：木灵脉（战斗开始 再生2+荆棘1，对标火灵脉 烈焰亲和3+炎魔1）----
registerAbility({
  id: 'woodVein', name: '木灵脉',
  description: '战斗开始时，获得再生2与荆棘1。',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new AddEffectInstruction({
      target: ctx.player, effectId: 'regen', stacks: 2,
    }));
    ctx.kernel.submitInstruction(new AddEffectInstruction({
      target: ctx.player, effectId: 'thorns', stacks: 1,
    }));
  },
});

// ---- 获赠：空灵脉（T1 回合开始闪避1 + 战斗开始抽1）----
// 闪避必须等 T1 回合开始的 POST 再上：闪避蒸发订阅挂在同一时点，战斗开始直接上
// 会被 T1 回合开始立刻蒸发（从未有机会挡刀——2026-09-14 冒烟抓出的白嫖 bug）。
registerAbility({
  id: 'airVein', name: '空灵脉',
  description: '第一回合开始时，获得闪避1；战斗开始时，抽1牌。',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new DrawCardsInstruction({ count: 1, reason: '空灵脉' }));
  },
  subscriptions: () => [{
    when: PlayerTurnStartInstruction, phase: 'post',
    filter: (instr, c) => c.battleState.turn.count === 1,
    react: (instr, c) => {
      c.kernel.submitInstruction(new AddEffectInstruction({
        target: c.player, effectId: 'dodge', stacks: 1,
      }), instr);
    },
  }],
});

// ---- 木·生息 精英 **茁壮**：你的治疗量 +2（ApplyHeal PRE 流水线，目标为你）----
registerAbility({
  id: 'renew', name: '茁壮', grade: 'elite',
  description: '你的治疗量 +2。',
  subscriptions: () => [{
    when: ApplyHealInstruction, phase: 'pre',
    filter: (instr, ctx) => instr.target === ctx.player && instr.payload.amount > 0,
    react: (instr) => instr.setPayload('amount', instr.payload.amount + 2),
  }],
});

// ---- 木·瘴毒 精英 **瘴主**：你施加的中毒 +1 层（判据=目标是敌人，见 woodSkills）----
registerAbility({
  id: 'blightLord', name: '瘴主', grade: 'elite',
  description: '你施加的中毒 +1 层。',
  subscriptions: () => [poisonAmpSubscription(1)],
});

// ---- 木·生息 大师 **森林之心**：每回合开始，若生命不高于一半，获得再生1 ----
registerAbility({
  id: 'forestHeart', requires: 'renew', name: '森林之心', grade: 'master',
  description: '每回合开始时，若你生命不高于一半，获得再生1。',
  subscriptions: () => [{
    when: PlayerTurnStartInstruction, phase: 'post',
    filter: (instr, ctx) => ctx.player.hp * 2 <= ctx.player.maxHp,
    react: (instr, ctx) => ctx.kernel.submitInstruction(new AddEffectInstruction({
      target: ctx.player, effectId: 'regen', stacks: 1,
    }), instr),
  }],
});

// ---- 木·瘴毒 大师 **瘟疫之源**：敌方单位死亡时，其余所有敌人中毒2 ----
// 死亡判据 = 应用原语 POST 的 target 已是尸体（毒/燃/直伤致死全走伤害应用；
// 2026-09-15 拆分后死亡检测挂应用原语——死亡发生在受击结算处，不筛主/附级）。
registerAbility({
  id: 'plagueSource', requires: 'blightLord', name: '瘟疫之源', grade: 'master',
  description: '敌方单位死亡时，其余所有敌人中毒2。',
  subscriptions: () => [{
    when: ApplyDamageInstruction, phase: 'post',
    filter: (instr) => instr.target?.side === 'enemy' && instr.target.isDead(),
    react: (instr, ctx) => {
      for (const e of aliveEnemies(ctx.battleState)) {
        ctx.kernel.submitInstruction(new AddEffectInstruction({
          target: e, effectId: 'poison', stacks: 2,
        }), instr);
      }
    },
  }],
});

// ---- 空·御风 精英 **风怒**：每回合你第一次打出攻击牌后，抽1牌 ----
// 「攻击牌」= 该次出牌的指令子树含对敌伤害（虚弱赎罪同口径）；回合计数标记放
// ctx.player 私有字段（unit._atonement 同范式）。
registerAbility({
  id: 'galeFury', name: '风怒', grade: 'elite',
  description: '每回合你第一次打出攻击牌后，抽1牌。',
  subscriptions: () => [{
    when: UseSkillInstruction, phase: 'post',
    filter: (instr, ctx) => ctx.player._galeFuryTurn !== ctx.battleState.turn.count,
    react: (instr, ctx) => {
      const dealtToEnemy = (node) => node.children?.some(c =>
        (c instanceof DealDamageInstruction && c.target?.side === 'enemy') || dealtToEnemy(c));
      if (!dealtToEnemy(instr)) return;
      ctx.player._galeFuryTurn = ctx.battleState.turn.count;
      ctx.kernel.submitInstruction(
        new DrawCardsInstruction({ count: 1, reason: '风怒' }), instr);
    },
  }],
});

// ---- 空·逍遥 精英 **行云**：战斗开始时，随机发动牌库中1张咏唱卡（无开销）----
// 自动化点题：开局点亮一张咏唱。onBattleStart 时初始抽牌尚未进行（牌库完整）。
registerAbility({
  id: 'wanderClouds', name: '行云', grade: 'elite',
  description: '战斗开始时，随机发动牌库中1张咏唱卡（无开销）。',
  onBattleStart(ctx) {
    const chants = ctx.battleState.zones.deck.filter(
      c => getSkillDefinition(c.defId).cardMode === 'chant');
    if (chants.length === 0) return;
    const pick = chants[ctx.battleState.rng.int(0, chants.length - 1)];
    ctx.kernel.submitInstruction(new UseSkillInstruction({
      skill: pick, costOverride: { mana: 0, actionPoint: 0 },
    }));
  },
});

// ---- 空·御风 大师 **风之主宰**：每回合你打出的第一张牌无开销 ----
// 逍遥游同型双 PRE（AP/蓝消耗指令置 0）+ 回合计数标记；同一张卡的两次资源消耗
// 按结算栈内层 UseSkill 的 uniqueID 记忆，只吃一份额度。
registerAbility({
  id: 'windLord', requires: 'galeFury', name: '风之主宰', grade: 'master',
  description: '每回合你打出的第一张牌无开销。',
  // 可用性钩子（裁决链第二环）：本回合尚未免单时放行费用检查——否则资源低于
  // 牌面费用时 canUse 先拒、免单根本启动不了（逍遥游 battleState.freePlays 同问题）。
  canUseSkill(sctx) {
    return sctx.player._windLordTurn !== sctx.battleState.turn.count ? true : undefined;
  },
  subscriptions: () => {
    const innerUseUid = (ctx) => [...ctx.kernel.stack].reverse()
      .find(i => i instanceof UseSkillInstruction)?.skill?.uniqueID ?? null;
    const subs = [];
    for (const Instr of [ConsumeActionPointsInstruction, ConsumeManaInstruction]) {
      subs.push({
        when: Instr, phase: 'pre',
        filter: (_instr, ctx) => {
          const uid = innerUseUid(ctx);
          if (uid === null) return false;
          const p = ctx.player;
          return p._windLordTurn !== ctx.battleState.turn.count || p._windLordCard === uid;
        },
        react: (instr, ctx) => {
          const p = ctx.player;
          const uid = innerUseUid(ctx);
          if (p._windLordTurn !== ctx.battleState.turn.count) {
            p._windLordTurn = ctx.battleState.turn.count;
            p._windLordCard = uid;
          }
          instr.setPayload('amount', 0);
        },
      });
    }
    return subs;
  },
});

// ---- 空·逍遥 大师 **空无**：咏唱容量+2（用户定 2026-09-14：扩容只给咏唱容量）----
registerAbility({
  id: 'voidness', requires: 'wanderClouds', name: '空无', grade: 'master',
  description: '咏唱容量 +2。',
  onBattleStart(ctx) {
    applyBattleModifier(ctx, 'chantCapacity', 2);
  },
});
