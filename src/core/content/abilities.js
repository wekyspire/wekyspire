import { registerAbility } from '../abilities/registry.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import { DrawCardsInstruction } from '../instructions/cards.js';
import { UseSkillInstruction } from '../instructions/skill.js';
import { DealDamageInstruction } from '../instructions/combat.js';
import { GainManaInstruction, GainActionPointsInstruction } from '../instructions/resources.js';
import { PlayerTurnStartInstruction } from '../instructions/turn.js';
import { aliveEnemies } from '../state/battleState.js';
import { getSkillDefinition } from '../skills/registry.js';
import { isBladeCard } from './cardKit.js';

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
  description: '换卡开销不超过 1。',
  onBattleStart(ctx) {
    // 取更严者：将来若有多条能力同时封顶，低的那个生效（null = 无上限）
    ctx.battleState.swapCostCap = Math.min(ctx.battleState.swapCostCap ?? Infinity, 1);
  },
});

registerAbility({
  id: 'bladeSaint', name: '刀圣', grade: 'master',
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
      && instr.tags?.includes('aoe') && aliveEnemies(ctx.battleState).length === 1,
    react: (instr) => instr.setPayload('damage', Math.floor(instr.payload.damage * 1.5)),
  }],
});

// 大师 **起手式**：战斗中，你打出的第一张火灵脉攻击牌伤害翻倍。
// 判据 = 伤害指令携带的 skill 反查 def.type === 'fire'（dealDamage 透传 sctx.self）。
registerAbility({
  id: 'openerGambit', name: '起手式', grade: 'master',
  description: '战斗中，你打出的第一张火灵脉攻击牌伤害翻倍。',
  subscriptions: () => {
    let used = false; // 战斗窗口闭包：每场重置（订阅随战斗销毁）
    return [{
      when: DealDamageInstruction, phase: 'pre',
      filter: (instr, ctx) => !used && instr.source === ctx.player && !instr.fixed
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
  id: 'flameSever', name: '避焰决', grade: 'master',
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
      && ctx.player.getEffectStacks('burn') > 0,
    react: (instr, ctx) => instr.setPayload('damage',
      instr.payload.damage + ctx.player.getEffectStacks('burn')),
  }],
});

// 大师 **炎魔**：战斗开始时炎魔1（与火灵脉基础能力的 1 层叠加）。
registerAbility({
  id: 'flameDemonLord', name: '炎魔', grade: 'master',
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
  id: 'sunSwallower', name: '吞日者', grade: 'master',
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
  id: 'champion', name: '拳王', grade: 'master',
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

// ---- 体修·拆（§3.4）----

// 精英 **武者**：格挡 ≥3 层时，受攻击从减免 50% 变为减免 75%（block 减半后再折半；
// 持有武帝时被覆盖）。priority -10 = 必须在 block 的 PRE（默认 0）之后跑。
registerAbility({
  id: 'warrior', name: '武者', grade: 'elite',
  description: '格挡不少于 3 层时，受攻击减免 75% 伤害。',
  subscriptions: () => [{
    when: DealDamageInstruction, phase: 'pre', priority: -10,
    filter: (instr, ctx) => instr.target === ctx.player && !instr.fixed
      && ctx.player.getEffectStacks('block') >= 3
      && !ctx.player.abilities.includes('warEmperor'),
    react: (instr) => instr.setPayload('damage', Math.floor(instr.payload.damage / 2)),
  }],
});

// 大师 **武帝**：格挡 ≥5 层时，减免 90% 伤害（block 减半后再折到 1/5；武者的上位）。
registerAbility({
  id: 'warEmperor', name: '武帝', grade: 'master',
  description: '格挡不少于 5 层时，受攻击减免 90% 伤害。',
  subscriptions: () => [{
    when: DealDamageInstruction, phase: 'pre', priority: -10,
    filter: (instr, ctx) => instr.target === ctx.player && !instr.fixed
      && ctx.player.getEffectStacks('block') >= 5,
    react: (instr) => instr.setPayload('damage', Math.floor(instr.payload.damage / 5)),
  }],
});

