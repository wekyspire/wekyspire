import { registerAbility } from '../abilities/registry.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import { DiscardCardInstruction, DrawCardsInstruction } from '../instructions/cards.js';
import { UseSkillInstruction } from '../instructions/skill.js';
import { DealDamageInstruction, ApplyDamageInstruction, GainShieldInstruction } from '../instructions/combat.js';
import { GainManaInstruction, GainActionPointsInstruction } from '../instructions/resources.js';
import { PlayerTurnStartInstruction, PlayerTurnEndInstruction } from '../instructions/turn.js';
import { aliveEnemies } from '../state/battleState.js';
import { isBladeCard, gainPower } from './cardKit.js';

// 战意：战斗开始时获得 1 层力量。不作为初始能力授予，
// 保留定义供旧档兼容与后续奖励/事件投放使用。
registerAbility({
  id: 'battleFocus', name: '战意',
  description: '战斗开始时获得 1 层力量。',
  onBattleStart(ctx) {
    ctx.player.addEffect('strength', 1);
  },
});

// 火灵脉体系能力（FIRE_VEIN_CARDS §0）：首次点亮火灵脉时自动授予，
// 战斗开始获得可燃1（2026-10-10 火系大改：烈焰亲和3 → 可燃1——燃烧结算每层
// 减免 3 + 因燃烧掉血洗入余烬，基础能力从免税额变成余烬经济的启动器）。
// 订阅型效果必须经 AddEffectInstruction 入列（状态级 addEffect 不挂订阅），
// 不能照抄战意的直改写法。
registerAbility({
  id: 'fireVein', name: '火灵脉',
  description: '战斗开始时，获得可燃1。',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new AddEffectInstruction({
      target: ctx.player, effectId: 'flammable', stacks: 1,
    }));
  },
});

// ---- 刀子体系能力（BODY_CULTIVATION_CARDS §2.5）----
registerAbility({
  id: 'bladeMaster', name: '刀客', grade: 'elite',
  description: '你每弃 1 张牌，获得 1 护盾。',
  subscriptions: () => [{
    when: DiscardCardInstruction, phase: 'post',
    filter: (instr) => Boolean(instr.result.card),
    react: (instr, ctx) => ctx.kernel.submitInstruction(
      new GainShieldInstruction({ target: ctx.player, amount: 1 }), instr),
  }],
});

registerAbility({
  id: 'bladeSaint', requires: 'bladeMaster', name: '刀圣', grade: 'master',
  description: '你每弃 2 张牌，所有刀法牌伤害+1。',
  subscriptions: () => {
    let count = 0;
    return [{
      when: DiscardCardInstruction, phase: 'post',
      filter: (instr) => Boolean(instr.result.card),
      react: (instr, ctx) => {
        count += 1;
        if (count % 2 !== 0) return;
        for (const zone of ['hand', 'deck']) {
          for (const card of ctx.battleState.zones[zone]) {
            if (isBladeCard(card)) gainPower(ctx, card, 1);
          }
        }
      },
    }];
  },
});

// ============================================================================
// 精英/大师能力（FIRE_VEIN_CARDS §1.4/§2.3 + BODY_CULTIVATION_CARDS
// §1.4/§2.5/§3.4）。授予通道 = 进阶事件：灵脉 2 级出精英池、3 级出大师池；
// 体修看隐藏 bodyLevel（同门槛），见 run/ascension.js 的 abilityOffering。
// def.grade：'elite' | 'master'（授予幕间的选项前缀展示）。
// 机制备忘：
//   · 伤害修饰全走 PRE 流水线（payload.damage），多重能力按 priority 降序叠加；
//   · 「同线精英/大师同时持有」取强者（吞日者覆盖吹火者、武帝覆盖武者），filter 里排他；
//   · 武者/武帝的 priority 必须低于格挡 block 的 PRE（默认 0）——它们在 block 的基础
//     免伤（×0.67）之后**再折算**（净减免 = 44%、55%，乘子 0.56/0.67、0.45/0.67），
//     顺序反了数值会错。block 基础免伤只留轻掩，这两级能力是格挡免伤的主要来源。
// ============================================================================

// ---- 火·爆炎子体系（§1.4）----

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

// 大师 **起手式**：战斗中，你打出的第一张攻击牌让你回复 3 魏启。
// 「攻击牌」= 该次出牌的指令子树含对敌伤害（风怒同口径）。
registerAbility({
  id: 'openerGambit', requires: 'pyroBlast', name: '起手式', grade: 'master',
  description: '战斗中，你打出的第一张攻击牌让你回复 3 魏启。',
  subscriptions: () => {
    let used = false; // 战斗窗口闭包：每场重置（订阅随战斗销毁）
    return [{
      when: UseSkillInstruction, phase: 'post',
      filter: () => !used,
      react: (instr, ctx) => {
        const dealtToEnemy = (node) => node.children?.some(c =>
          (c instanceof DealDamageInstruction && c.target?.side === 'enemy') || dealtToEnemy(c));
        if (!dealtToEnemy(instr)) return;
        used = true;
        ctx.kernel.submitInstruction(new GainManaInstruction({ amount: 3 }), instr);
      },
    }];
  },
});

// 精英 **避火术**：战斗开始时，获得烈焰亲和4
//（基础能力不白送大量烈焰亲和，免税额度集中到精英/大师线上）。
registerAbility({
  id: 'fireWard', name: '避火术', grade: 'elite',
  description: '战斗开始时，获得烈焰亲和4。',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new AddEffectInstruction({
      target: ctx.player, effectId: 'flameAffinity', stacks: 4,
    }));
  },
});

// 大师 **避焰决**：战斗开始时，获得烈焰亲和5
//（精英已 4，大师必须压过其上位的精英，否则阶梯倒挂）。
registerAbility({
  id: 'flameSever', requires: 'fireWard', name: '避焰决', grade: 'master',
  description: '战斗开始时，获得烈焰亲和5。',
  onBattleStart(ctx) {
    ctx.kernel.submitInstruction(new AddEffectInstruction({
      target: ctx.player, effectId: 'flameAffinity', stacks: 5,
    }));
  },
});

// ---- 火·叠炎子体系（§2.3）----

// 精英 **灼脉**：你的每 2 层燃烧为你提供全伤害 +1（PRE 加算，玩火自焚的正收益面）。
registerAbility({
  id: 'scorchVein', name: '灼脉', grade: 'elite',
  description: '你的每 2 层燃烧为你提供全伤害 +1。',
  subscriptions: () => [{
    when: DealDamageInstruction, phase: 'pre',
    filter: (instr, ctx) => instr.source === ctx.player && !instr.fixed
      && instr.type === 'major'
      && ctx.player.getEffectStacks('burn') > 1,
    react: (instr, ctx) => instr.setPayload('damage',
      instr.payload.damage + Math.floor(ctx.player.getEffectStacks('burn') / 2)),
  }],
});

// 大师 **烬灭**（2026-10-10 火系大改，替代原「炎魔」大师位——炎魔效果收归炎魔决卡）：
// 抽到余烬时，抽 1（每张余烬各触发一次——余烬链抽上来即续抽，级联合法；
// 订阅挂抽牌 POST，抽上来的余烬再触发由后续指令自然承接，无重入）。
registerAbility({
  id: 'emberOut', requires: 'scorchVein', name: '烬灭', grade: 'master',
  description: '抽到余烬时，抽 1。',
  subscriptions: () => [{
    when: DrawCardsInstruction, phase: 'post',
    filter: (instr) => (instr.result?.drawn ?? []).some(c => c.defId === 'emberMote'),
    react: (instr, ctx) => {
      const n = instr.result.drawn.filter(c => c.defId === 'emberMote').length;
      ctx.kernel.submitInstruction(new DrawCardsInstruction({ count: n }), instr);
    },
  }],
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

// ---- 体修·拳子体系（§1.5）----

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

// 大师 **拳王**：每回合打出第 9 张牌后，回复 1 AP（与拳师独立计数，同持双触发）。
registerAbility({
  id: 'champion', requires: 'boxer', name: '拳王', grade: 'master',
  description: '每回合打出第 9 张牌后，回复 1 行动点。',
  subscriptions: () => {
    let count = 0;
    return [
      {
        when: UseSkillInstruction, phase: 'post',
        filter: () => true,
        react: (instr, ctx) => {
          count += 1;
          if (count === 9) {
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


// ---- 体修·拳/刀子体系补强（BODY_CULTIVATION_CARDS §1.5/§2.5）----

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

// 大师 **以攻为守**（前置：挡拆）：你每**单次**造成 16 点以上伤害，获得 4 护盾
// （多段小额不产盾——「攻防同源」拆成「重击换盾」，5 伤瞬击一类即抛牌彻底退出
// 盾源，只有大单发能把伤害变现成防御）。
// source 空（燃烧/反伤）与被全挡（dealt 0）不计——只奖**主级**真实命中
// （附级被动伤害不算「攻」）。读数口径沿用「实际落血」
// （同肾上腺素注射器的「单次造成超过 15 点伤害」，所见即所算）。
registerAbility({
  id: 'shieldedOffense', name: '以攻为守', grade: 'master', requires: 'parryFist',
  description: '你每单次造成 16 点以上伤害，获得 4 护盾。',
  subscriptions: () => [{
    when: DealDamageInstruction, phase: 'post',
    filter: (instr, ctx) => instr.source === ctx.player
      && instr.type === 'major' && (instr.result?.dealt ?? 0) >= 16,
    react: (instr, ctx) => ctx.kernel.submitInstruction(
      new GainShieldInstruction({ target: ctx.player, amount: 4 }), instr),
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

// ---- 体修·拆子体系（§3.5）----


// 精英 **武者**：格挡 ≥3 层时，受攻击总减免 44%（block ×0.67 之后 ×(0.56/0.67)；持有武帝时被覆盖）。
// priority -10 = 必须在 block 的 PRE（默认 0）之后跑；链条取整用 round 贴合稿面百分比。
// 随 block 同挂**应用原语 PRE**（同为格挡响应链，只认主级）；穿透伤害整链不参与
// （EFFECTS.md：穿透不吃防御/护盾/格挡）——filter 排除 basePierce。
registerAbility({
  id: 'warrior', name: '武者', grade: 'elite',
  description: '格挡不少于 3 层时，受攻击减免 44% 伤害。',
  subscriptions: () => [{
    when: ApplyDamageInstruction, phase: 'pre', priority: -10,
    filter: (instr, ctx) => instr.target === ctx.player && !instr.fixed && !instr.basePierce
      && instr.type === 'major'
      && ctx.player.getEffectStacks('block') >= 3
      && !ctx.player.abilities.includes('warEmperor'),
    react: (instr) => instr.setPayload('damage', Math.round(instr.payload.damage * (0.56 / 0.67))),
  }],
});

// 大师 **武帝**：格挡 ≥5 层时，受攻击总减免 55%（block ×0.67 之后 ×(0.45/0.67)；武者的上位）。
registerAbility({
  id: 'warEmperor', requires: 'warrior', name: '武帝', grade: 'master',
  description: '格挡不少于 5 层时，受攻击减免 55% 伤害。',
  subscriptions: () => [{
    when: ApplyDamageInstruction, phase: 'pre', priority: -10,
    filter: (instr, ctx) => instr.target === ctx.player && !instr.fixed && !instr.basePierce
      && instr.type === 'major'
      && ctx.player.getEffectStacks('block') >= 5,
    react: (instr) => instr.setPayload('damage', Math.round(instr.payload.damage * (0.45 / 0.67))),
  }],
});

