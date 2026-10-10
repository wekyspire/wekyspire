// 火灵脉·叠炎组合（续）（FIRE_VEIN_CARDS §2.1 后半 + §2.2）。
// 自焚（自伤换高伤）/ 焰愈（燃烧换恢复）/ 焚烧（燃烧倍增）/ 鬼火（死亡传播）/ 业火（焚毁反哺）
// + 咏唱四连（燃心决 / 取暖系 / 绝炎 / 火焰披风）。
//
// 体系语言：燃烧是叠炎组合的资源——自焚把它当代价、焰愈把它当货币、
// 焚烧把它当炸药（一次翻倍）、鬼火与镜燃把它当瘟疫（向场上扩散）、
// 绝炎把它变成不可逆的单向棘轮。
//
// 口径备忘（设计稿未细写处的实现决定，均已在对应卡内注释）：
//   * 「焚毁反哺」（业火）按每次卡牌焚毁事件触发，固定 2 层；
//   * 「死亡传播」按死亡瞬间的燃烧层数整量传播给其余存活敌人；
//   * 「免疫消耗和下降」= 全场任何单位的燃烧负层数变更一律 veto。

import { registerSkill } from '../skills/registry.js';
import { aliveEnemies, allAliveUnits } from '../state/battleState.js';
import { DealDamageInstruction, ApplyDamageInstruction, ApplyHealInstruction, GainShieldInstruction } from '../instructions/combat.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import { BurnCardInstruction, AddCardInstruction } from '../instructions/cards.js';
import { GainManaInstruction } from '../instructions/resources.js';
import { ChantTriggerInstruction } from '../instructions/turn.js';
import { attackDamage, addEffect, randomAliveEnemy, resolvedDamageText, buildCardSelectionRequest, reactFx } from './cardKit.js';

// ==== 自焚系列（§2.1：自伤换高伤）==============================================
// 玩火 C/B/A：0 费攻击，冷却 1；伤害 11/14/17，自燃烧全阶统一 4。
// 「效果翻倍」buff（自焚卡）：battleState.selfImmolateDouble 置位后伤害与燃烧都 ×2。
function selfImmolate({ id, name, tier, base, promotesTo = null }) {
  registerSkill({
    id, name, type: 'fire', tier, series: 'selfImmolate', subsystem: 'blaze',
    cost: { mana: 0, actionPoint: 0 },
    charges: { max: 1, cooldownTurns: 1 },
    cardMode: 'normal', targetMode: 'enemy',
    promotesTo,
    use(sctx) {
      const mult = sctx.battleState.selfImmolateDouble ? 2 : 1;
      attackDamage(sctx, base * mult);
      addEffect(sctx, 'burn', 4 * mult); // 默认 target = sctx.player：代价给自己
      reactFx(sctx, sctx.self, 'backfire');
      return true;
    },
    describe: () => `${base}伤害，/effect{燃烧}4`,
    battleDescribe: (sctx) => {
      const mult = sctx.battleState.selfImmolateDouble ? 2 : 1;
      return `${resolvedDamageText(sctx, base * mult)}，/effect{燃烧}${4 * mult}`;
    },
  });
}

selfImmolate({ id: 'playFireC', name: '玩火', tier: 'C', base: 11, promotesTo: 'playFireB' });
selfImmolate({ id: 'playFireB', name: '玩火', tier: 'B', base: 14, promotesTo: 'playFireA' });
selfImmolate({ id: 'playFireA', name: '玩火', tier: 'A', base: 17 });

// 自焚 B/A（1AP，B 消耗）：本场战斗中你所有玩火卡牌的效果翻倍。
function selfImmolateRite({ id, tier, exhaust, promotesTo = null }) {
  registerSkill({
    id, name: '自焚', type: 'fire', tier, series: 'selfImmolate', subsystem: 'blaze',
    keywords: exhaust ? ['exhaust'] : [],
    cost: { mana: 0, actionPoint: 1 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal',
    promotesTo,
    use(sctx) {
      sctx.battleState.selfImmolateDouble = true;
      return true;
    },
    describe: () => '本场战斗中，你所有玩火卡牌的效果翻倍',
    battleDescribe: (sctx) => sctx.battleState.selfImmolateDouble
      ? '玩火卡牌效果已翻倍' : '本场战斗中，你所有玩火卡牌的效果翻倍',
  });
}
selfImmolateRite({ id: 'selfImmolateB', tier: 'B', exhaust: true, promotesTo: 'selfImmolateA' });
selfImmolateRite({ id: 'selfImmolateA', tier: 'A', exhaust: false });

// ==== 焰愈系列（§2.1：燃烧换恢复）============================================
// 焰愈 C/B/A / 涅槃 S：1AP 消耗，治疗量 = 基础值 + 自身燃烧层数 × 每层加成。
// 只读不消耗：燃烧仍是活资源（下回合照常跳伤）——「顶着火烤取暖」的风险收益，
// 与自焚系列（主动叠燃烧）天然成轴。读层时点 = 结算时点，与 battleDescribe 同源。
// 基础 5/7/10/10、每层 +1/+1/+1/+2（涅槃 S 独享每层+2）。
function flameHealSkill({ id, name, tier, base, per, promotesTo = null }) {
  const amountOf = (sctx) => base + sctx.player.getEffectStacks('burn') * per;
  registerSkill({
    id, name, type: 'fire', tier, series: 'flameHeal', subsystem: 'blaze',
    cost: { mana: 0, actionPoint: 1 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal',
    keywords: ['exhaust'],
    promotesTo,
    use(sctx) {
      sctx.kernel.submitInstruction(new ApplyHealInstruction({
        target: sctx.player, amount: amountOf(sctx),
      }));
      return true;
    },
    describe: () => `回复${base}生命；每层/effect{燃烧}，+${per}`,
    battleDescribe: (sctx) => {
      const burn = sctx.player.getEffectStacks('burn');
      return `回复${amountOf(sctx)}生命；每层/effect{燃烧}，+${per}（燃烧${burn}）`;
    },
  });
}

flameHealSkill({ id: 'flameHealC', name: '焰愈', tier: 'C', base: 5, per: 1, promotesTo: 'flameHealB' });
flameHealSkill({ id: 'flameHealB', name: '焰愈', tier: 'B', base: 7, per: 1, promotesTo: 'flameHealA' });
flameHealSkill({ id: 'flameHealA', name: '焰愈', tier: 'A', base: 10, per: 1 });
flameHealSkill({ id: 'nirvana', name: '涅槃', tier: 'S', base: 10, per: 2 });

// ==== 焚烧系列（燃烧层数倍增）=================================================
// 焚烧 B/A / 星炎 S｜**所有燃烧层数翻倍**（星炎翻 3 倍），全系列冷却 2
// （倍增器复读是火系最强的爆发推手；链内 AP 2/2/1、倍率 2/2/3、冷却持平。
// 注意冷却只约束同一张：打出回库底须重抽，大牌组里
// 冷却常被抽牌循环盖过，多份同回合不受限——多份密度归 S 直出频率管）。系列 B 起步。
// 作用域按设计稿字面「所有」= 全场存活单位（含自己与盟友身上的燃烧——
// 火焰体系的自焚是常态，翻倍自焚是这张牌的代价面）。
// 实现 = 对每个有燃烧的单位追加等量层数（AddEffect 正层数；燃烧的逐层递减是另一条订阅）。
const burnDoubler = ({ id, name, tier, ap, mult, promotesTo = null, mini = false }) => registerSkill({
  id, name, type: 'fire', tier, series: 'burnDoubler', subsystem: 'blaze',
  cost: { mana: 0, actionPoint: ap },
  charges: { max: 1, cooldownTurns: 2 },
  cardMode: 'normal',
  // 迷你（A/S 档专属）：计 0 张手牌——冷却大牌捏在手里不占手位
  keywords: mini ? ['mini'] : [],
  promotesTo,
  use(sctx) {
    for (const unit of allAliveUnits(sctx.battleState, sctx.player)) {
      const stacks = unit.getEffectStacks('burn');
      if (stacks > 0) addEffect(sctx, 'burn', stacks * (mult - 1), unit);
    }
    return true;
  },
  describe: () => `所有/effect{燃烧}层数翻${mult}倍`,
  battleDescribe: (sctx) => {
    const total = allAliveUnits(sctx.battleState, sctx.player)
      .reduce((n, u) => n + u.getEffectStacks('burn'), 0);
    return `所有/effect{燃烧}层数翻${mult}倍（当前全场${total}层）`;
  },
});
burnDoubler({ id: 'burnBurstB', name: '焚烧', tier: 'B', ap: 2, mult: 2, promotesTo: 'burnBurstA' });
burnDoubler({ id: 'burnBurstA', name: '焚烧', tier: 'A', ap: 2, mult: 2, mini: true });
burnDoubler({ id: 'burnBurstStar', name: '星炎', tier: 'S', ap: 1, mult: 3, mini: true });

// ==== 鬼火（§2.2 咏唱：死亡传播）===============================================
// 鬼火 B/A（1AP，咏唱1）｜敌人死亡时，其燃烧传播给所有敌人。
// 口径：伤害应用只改生命，效果轨不随死亡清零（AddEffect 仅在层数扣尽时移除），
// 故 POST 阶段读 target 的燃烧 = 「死亡瞬间的瞬时层数」——若死于燃烧跳伤，
// 跳伤后的 -1 递减指令排在跳伤之后提交，读到的同样是跳伤当拍的整量；
// 死亡检测挂应用原语 POST（死亡发生在受击结算处，不筛主/附级）；
// 传播对象 = 其余存活敌人（aliveEnemies 已滤死者，V5 死亡单位不可为目标）；
// 场上再无其他敌人时传播落空，战斗照常判胜。
const willOWispCard = ({ id, tier, chantWeight, ap, promotesTo = null }) => registerSkill({
  id, name: '鬼火', type: 'fire', tier, series: 'willOWisp', subsystem: 'blaze',
  cost: { mana: 0, actionPoint: ap },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight,
  promotesTo,
  use() { return true; },
  activated: {
    subscriptions: (sctx) => [{
      when: ApplyDamageInstruction, phase: 'post',
      filter: (instr) => instr.target.side === 'enemy'
        && instr.result?.targetDead === true
        && !(instr.result?.skipped ?? false) // 过期目标守卫的占位结果不算（多段击杀余段会重复带 targetDead）
        && instr.target.getEffectStacks('burn') > 0,
      react: (instr, ctx) => {
        const stacks = instr.target.getEffectStacks('burn');
        const receivers = aliveEnemies(ctx.battleState);
        for (const e of receivers) {
          ctx.kernel.submitInstruction(
            new AddEffectInstruction({ target: e, effectId: 'burn', stacks }), instr);
        }
        if (receivers.length) reactFx(sctx, sctx.self, 'benefit', { variant: 'proc', magnitude: stacks });
      },
    }],
  },
  describe: () => '敌人死亡时，其/effect{燃烧}传播给所有敌人',
  battleDescribe: () => '敌人死亡时，其/effect{燃烧}传播给所有敌人',
});
willOWispCard({ id: 'willOWispB', tier: 'B', chantWeight: 1, ap: 1, promotesTo: 'willOWispA' });
willOWispCard({ id: 'willOWispA', tier: 'A', chantWeight: 1, ap: 0 });

// ==== 业火系列（§2.1：焚毁反哺）=================================================
// 业火 B/A｜咏唱1：你的卡牌被焚毁时，向随机敌人（B）/ 所有敌人（A）施加 2 层燃烧。
// 2026-10-10 火系大改：触发从「获得燃烧」（原镜燃）改为「卡牌焚毁」——与烧却/狂焰/
// 炼化时代价付掉的每一张牌都变成场上的火。全场只可能焚毁玩家侧的卡（敌方干扰牌
// 也进玩家牌库），无需再过滤归属。
function karmaFireCard({ id, tier, spread }) {
  registerSkill({
    id, name: '业火', type: 'fire', tier, series: 'mirrorBurn', subsystem: 'blaze',
    cost: { mana: 0, actionPoint: 0 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'chant', chantWeight: 1,
    use() { return true; },
    activated: {
      subscriptions: (sctx) => [{
        when: BurnCardInstruction, phase: 'post',
        filter: (instr) => Boolean(instr.result?.card),
        react: (instr, ctx) => {
          spread.apply(ctx, (target) => ctx.kernel.submitInstruction(
            new AddEffectInstruction({ target, effectId: 'burn', stacks: 2 }), instr));
          reactFx(sctx, sctx.self, 'benefit', { variant: 'proc' });
        },
      }],
    },
    describe: () => `卡牌焚毁时，对${spread.targetText}施加/effect{燃烧}2`,
    battleDescribe: () => `卡牌焚毁时，对${spread.targetText}施加/effect{燃烧}2`,
  });
}
karmaFireCard({
  id: 'mirrorBurn', tier: 'B',
  spread: {
    targetText: '随机敌人',
    apply: (ctx, emit) => {
      const enemy = randomAliveEnemy(ctx);
      if (enemy) emit(enemy);
    },
  },
});
karmaFireCard({
  id: 'karmaFire', tier: 'A',
  spread: {
    targetText: '所有敌人',
    apply: (ctx, emit) => {
      for (const e of aliveEnemies(ctx.battleState)) emit(e);
    },
  },
});

// ==== 咏唱（§2.2）=============================================================

// 燃心决 A｜消耗 + 封咏，每回合 P5 咏唱节拍获得 3 魏启 + 自身燃烧 7。
// chantWeight 0：激活后不占手牌容量；anchored：激活后不可主动打出解除（也不可换下），
// 与 exhaust 一起表达「激活即钉死在手」——唯一出口是被焚/弃等离手路径。
// 触发挂点 = ChantTriggerInstruction POST（「快速咏唱」提前触发复用同一挂载点）。
registerSkill({
  id: 'burningHeart', name: '燃心决', type: 'fire', tier: 'A', series: 'fireChant', subsystem: 'blaze',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 0,
  keywords: ['exhaust', 'anchored'],
  use() { return true; },
  activated: {
    subscriptions: (sctx) => [{
      when: ChantTriggerInstruction, phase: 'post',
      react: (instr, ctx) => {
        ctx.kernel.submitInstruction(new GainManaInstruction({ amount: 3 }), instr);
        ctx.kernel.submitInstruction(new AddEffectInstruction({
          target: ctx.player, effectId: 'burn', stacks: 7,
        }), instr);
        reactFx(sctx, sctx.self, 'backfire');
      },
    }],
  },
  describe: () => '获得3魏启，/effect{燃烧}7',
  battleDescribe: (sctx) => '获得3魏启，/effect{燃烧}7',
});

// 取暖 C/B/A｜1AP/0AP/0AP，层数 2/2/3，
// 每回合 P5 对所有存活敌人施加 N 层燃烧
// （无存活敌人时循环体为空，静默落空）。层数走自然递减（敌方回合开始跳伤后 -1），
// 是叠炎体系的慢速群压引擎。
const scorchChantCard = ({ id, name, tier, ap, stacks, promotesTo }) => registerSkill({
  id, name, type: 'fire', tier, series: 'fireChant', subsystem: 'blaze',
  cost: { mana: 0, actionPoint: ap },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 1,
  promotesTo,
  use() { return true; },
  activated: {
    subscriptions: (sctx) => [{
      when: ChantTriggerInstruction, phase: 'post',
      react: (instr, ctx) => {
        for (const e of aliveEnemies(ctx.battleState)) {
          ctx.kernel.submitInstruction(
            new AddEffectInstruction({ target: e, effectId: 'burn', stacks }), instr);
        }
        reactFx(sctx, sctx.self, 'benefit', { variant: 'proc' });
      },
    }],
  },
  describe: () => `对所有敌人施加/effect{燃烧}${stacks}`,
  battleDescribe: (sctx) => `对所有敌人施加/effect{燃烧}${stacks}`,
});
scorchChantCard({ id: 'warmUpC', name: '取暖', tier: 'C', ap: 1, stacks: 2, promotesTo: 'warmUpB' });
scorchChantCard({ id: 'warmUpB', name: '取暖', tier: 'B', ap: 0, stacks: 2, promotesTo: 'warmUpA' });
scorchChantCard({ id: 'warmUpA', name: '取暖', tier: 'A', ap: 0, stacks: 3 });

// 火焰披风 B/A｜3魏启，咏唱1：每回合 P5 若你正在燃烧，获得 4/6 护盾
//（火灵脉防御位：燃烧从代价转为收入，与可燃血液/焰愈同轴）。只读不消耗燃烧。
const flameCloakCard = ({ id, tier, shield, promotesTo = null }) => registerSkill({
  id, name: '火焰披风', type: 'fire', tier, series: 'fireChant', subsystem: 'blaze',
  cost: { mana: 3, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 1,
  promotesTo,
  use() { return true; },
  activated: {
    subscriptions: (sctx) => [{
      when: ChantTriggerInstruction, phase: 'post',
      react: (instr, ctx) => {
        if (sctx.player.getEffectStacks('burn') > 0) {
          ctx.kernel.submitInstruction(
            new GainShieldInstruction({ target: sctx.player, amount: shield }), instr);
          reactFx(sctx, sctx.self, 'benefit', { variant: 'proc' });
        }
      },
    }],
  },
  describe: () => `正在/effect{燃烧}时，获得${shield}护盾`,
  // 不写 battleDescribe：判定条件只有「正在燃烧」一条，静态描述已说清——
  // 实时读数版反而把机制淹没在层数数字里。
});
flameCloakCard({ id: 'flameCloakB', tier: 'B', shield: 4, promotesTo: 'flameCloakA' });
flameCloakCard({ id: 'flameCloakA', tier: 'A', shield: 6 });

// 炼化 B/A｜1AP/0AP，咏唱1：每回合 P5 获得 1/2 魏启并洗入 2 张余烬。
// 2026-10-10 火系大改：不再选牌焚毁（焚毁反哺交给业火），炼化变成余烬经济的
// 每回合稳定泵——蓝量与余烬双产。
function smeltChantCard({ id, tier, mana, chantWeight, ap, promotesTo }) {
  registerSkill({
    id, name: '炼化', type: 'fire', tier, series: 'fireChant', subsystem: 'blaze',
    cost: { mana: 0, actionPoint: ap },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'chant', chantWeight,
    promotesTo,
    use() { return true; },
    activated: {
      subscriptions: (sctx) => [{
        when: ChantTriggerInstruction, phase: 'post',
        react: (instr, ctx) => {
          ctx.kernel.submitInstruction(new GainManaInstruction({ amount: mana }), instr);
          for (let i = 0; i < 2; i++) {
            ctx.kernel.submitInstruction(new AddCardInstruction({
              defId: 'emberMote', toZone: 'deck', index: 'random',
            }), instr);
          }
          reactFx(sctx, sctx.self, 'benefit', { variant: 'proc' });
        },
      }],
    },
    describe: () => `获得${mana}魏启，/named{洗入2}/card{emberMote}`,
    battleDescribe: () => `获得${mana}魏启，/named{洗入2}/card{emberMote}`,
  });
}
smeltChantCard({ id: 'smeltB', tier: 'B', mana: 1, chantWeight: 1, ap: 1, promotesTo: 'smeltA' });
smeltChantCard({ id: 'smeltA', tier: 'A', mana: 2, chantWeight: 1, ap: 0 });

// 绝炎 A｜1AP，咏唱1，任何燃烧层数免疫消耗和下降。
// 口径：「消耗和下降」统一折算为「燃烧层数减少事件」——全场任何单位（敌我不分）
// 的 AddEffect(burn) 负层数（自然递减 -1 / 驱散 -N）一律 PRE veto；
// 跳伤结算不受影响：燃烧照常按层数跳固定伤害，只是不再衰减——
// 每层燃烧都变成永续持续输出源（代价：自己身上的燃烧同样棘轮化，
// 需焰愈/防火体系消化）。被 veto 的指令不触发任何 POST，无级联。
registerSkill({
  id: 'absoluteFlame', name: '绝炎', type: 'fire', tier: 'A', series: 'fireChant', subsystem: 'blaze',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 1,
  use() { return true; },
  activated: {
    subscriptions: (sctx) => [{
      when: AddEffectInstruction, phase: 'pre',
      filter: (instr) => instr.effectId === 'burn'
        && (instr.payload.stacks ?? 0) < 0,
      react: (instr, ctx) => ctx.kernel.veto(instr, 'absoluteFlame'),
    }],
  },
  describe: () => '任何/effect{燃烧}层数免疫消耗和下降',
  battleDescribe: (sctx) => '任何/effect{燃烧}层数免疫消耗和下降',
});
