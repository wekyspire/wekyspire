// 火灵脉·叠炎组合（续）（FIRE_VEIN_CARDS §2.1 后半 + §2.2）。
// 自焚（自伤换高伤）/ 焰愈（燃烧换恢复）/ 焚天（燃烧倍增）/ 鬼火（死亡传播）/ 镜燃（获得反哺）
// + 咏唱四连（燃心决 / 取暖系 / 绝炎 / 火焰披风）。
//
// 体系语言：燃烧是叠炎组合的资源——自焚把它当代价、焰愈把它当货币、
// 焚天把它当炸药（一次翻倍）、鬼火与镜燃把它当瘟疫（向场上扩散）、
// 绝炎把它变成不可逆的单向棘轮。
//
// 口径备忘（设计稿未细写处的实现决定，均已在对应卡内注释）：
//   * 「获得燃烧时反哺」按本次增加量（AddEffect payload.stacks > 0）等量镜像；
//   * 「死亡传播」按死亡瞬间的燃烧层数整量传播给其余存活敌人；
//   * 「免疫消耗和下降」= 全场任何单位的燃烧负层数变更一律 veto。

import { registerSkill } from '../skills/registry.js';
import { aliveEnemies, allAliveUnits } from '../state/battleState.js';
import BattleInstruction from '../kernel/BattleInstruction.js';
import AwaitPlayerInputInstruction from '../instructions/input.js';
import { DealDamageInstruction, ApplyHealInstruction, GainShieldInstruction } from '../instructions/combat.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import { BurnCardInstruction } from '../instructions/cards.js';
import { GainManaInstruction } from '../instructions/resources.js';
import { ChantTriggerInstruction } from '../instructions/turn.js';
import { attackDamage, addEffect, randomAliveEnemy, resolvedDamageText, buildCardSelectionRequest } from './cardKit.js';

// ==== 自焚系列（§2.1：自伤换高伤）============================================
// 玩火 D / 引焰 C / 焚灭 B：0 费攻击（设计稿未写费用 = 免费，battle.md §7.2 缺省约定），
// 冷却 1（charges 1 格 + 冷却 1 回合——零费卡若无冷却就是无限的免费自伤泵）；
// 伤害吃攻击面板轨（F1：基数 + 攻击面板 + power），燃烧作为体系副作用落在自己身上。
// 敌人全灭时结算退化为裸面板值（enemyTarget 落 null 由 cardKit 兜底口径处理）。
function selfImmolate({ id, name, tier, base, burn }) {
  registerSkill({
    id, name, type: 'fire', tier, series: 'selfImmolate',
    cost: { mana: 0, actionPoint: 0 },
    charges: { max: 1, cooldownTurns: 1 },
    cardMode: 'normal', targetMode: 'enemy',
    use(sctx) {
      attackDamage(sctx, base);
      addEffect(sctx, 'burn', burn); // 默认 target = sctx.player：代价给自己
      return true;
    },
    describe: () => `${base}伤害，自身/effect{燃烧}${burn}`,
    battleDescribe: (sctx) => `${resolvedDamageText(sctx, base)}，自身/effect{燃烧}${burn}`,
  });
}

selfImmolate({ id: 'playWithFire', name: '玩火', tier: 'D', base: 12, burn: 2 });
selfImmolate({ id: 'drawFlame', name: '引焰', tier: 'C', base: 17, burn: 3 });
selfImmolate({ id: 'immolate', name: '焚灭', tier: 'B', base: 24, burn: 5 });

// ==== 焰愈系列（§2.1：燃烧换恢复）============================================
// 焰愈 C / 炽愈 B / 涅槃 A：1AP 消耗，治疗量 = 基础值 + 自身燃烧层数 × 每层加成。
// 只读不消耗：燃烧仍是活资源（下回合照常跳伤）——「顶着火烤取暖」的风险收益，
// 与自焚系列（主动叠燃烧）天然成轴。读层时点 = 结算时点，与 battleDescribe 同源。
function flameHealSkill({ id, name, tier, base, per }) {
  const amountOf = (sctx) => base + sctx.player.getEffectStacks('burn') * per;
  registerSkill({
    id, name, type: 'fire', tier, series: 'flameHeal',
    cost: { mana: 0, actionPoint: 1 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'normal',
    keywords: ['exhaust'],
    use(sctx) {
      sctx.kernel.submitInstruction(new ApplyHealInstruction({
        target: sctx.player, amount: amountOf(sctx),
      }));
      return true;
    },
    describe: () => `回复${base}生命；每层/effect{燃烧}使治愈+${per}`,
    battleDescribe: (sctx) => `回复${amountOf(sctx)}生命`,
  });
}

flameHealSkill({ id: 'flameHeal', name: '焰愈', tier: 'C', base: 5, per: 1 });
flameHealSkill({ id: 'blazingHeal', name: '炽愈', tier: 'B', base: 7, per: 2 });
flameHealSkill({ id: 'nirvana', name: '涅槃', tier: 'A', base: 10, per: 3 });

// ==== 焚天系列（2026-09-12 设计稿改版：燃烧层数倍增）=========================
// 爆燃 C / 焚烧 B / 焚天 A / 星炎 S｜**所有燃烧层数翻倍**（星炎翻 3 倍），冷却1
// （星炎无冷却）。作用域按设计稿字面「所有」= 全场存活单位（含自己与盟友身上的燃烧——
// 火焰体系的自焚是常态，翻倍自焚是这张牌的代价面）。
// 实现 = 对每个有燃烧的单位追加等量层数（AddEffect 正层数；燃烧的逐层递减是另一条订阅）。
const burnDoubler = ({ id, name, tier, ap, mult, promotesTo = null, cooldown = 1 }) => registerSkill({
  id, name, type: 'fire', tier, series: 'burnDoubler',
  cost: { mana: 0, actionPoint: ap },
  charges: cooldown ? { max: 1, cooldownTurns: cooldown } : { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
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
burnDoubler({ id: 'burnBurst', name: '爆燃', tier: 'C', ap: 3, mult: 2, promotesTo: 'burnBurstPlus' });
burnDoubler({ id: 'burnBurstPlus', name: '焚烧', tier: 'B', ap: 2, mult: 2, promotesTo: 'burnBurstGrand' });
burnDoubler({ id: 'burnBurstGrand', name: '焚天', tier: 'A', ap: 1, mult: 2, promotesTo: 'burnBurstStar' });
burnDoubler({ id: 'burnBurstStar', name: '星炎', tier: 'S', ap: 1, mult: 3, cooldown: 0 });

// ==== 鬼火（§2.2 咏唱：死亡传播，2026-09-12 由「焚原」改名而来）=================
// 鬼火 B（咏唱1）｜敌人死亡时，其燃烧传播给所有敌人。
// 口径：伤害指令只改生命，效果轨不随死亡清零（AddEffect 仅在层数扣尽时移除），
// 故 POST 阶段读 target 的燃烧 = 「死亡瞬间的瞬时层数」——若死于燃烧跳伤，
// 跳伤后的 -1 递减指令排在跳伤之后提交，读到的同样是跳伤当拍的整量；
// 传播对象 = 其余存活敌人（aliveEnemies 已滤死者，V5 死亡单位不可为目标）；
// 场上再无其他敌人时传播落空，战斗照常判胜。
registerSkill({
  id: 'willOWisp', name: '鬼火', type: 'fire', tier: 'B', series: 'willOWisp',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 1,
  use() { return true; },
  activated: {
    subscriptions: () => [{
      when: DealDamageInstruction, phase: 'post',
      filter: (instr) => instr.target.side === 'enemy'
        && instr.result?.targetDead === true
        && instr.target.getEffectStacks('burn') > 0,
      react: (instr, ctx) => {
        const stacks = instr.target.getEffectStacks('burn');
        for (const e of aliveEnemies(ctx.battleState)) {
          ctx.kernel.submitInstruction(
            new AddEffectInstruction({ target: e, effectId: 'burn', stacks }), instr);
        }
      },
    }],
  },
  describe: () => '敌人死亡时，其燃烧传播给所有敌人',
  battleDescribe: (sctx) => '敌人死亡时，其燃烧传播给所有敌人',
});

// ==== 镜燃系列（§2.1：获得反哺）==============================================
// 镜燃 C / 业火 A｜自己获得燃烧时，把本次增加的层数等量施加给
// 随机敌人 / 所有敌人。
// 口径：「获得」= AddEffect(burn) 落在玩家身上且本次变化量为正
// （payload.stacks > 0——经 PRE 修饰后的实际生效量；递减 -1 不算获得）；
// 镜像量按本次增加量等量（设计稿未写数量，镜燃取「镜像」语义）。
// 敌方身上的燃烧不回灌（filter 限定 target 为玩家），无死循环。
// spread = { targetText, apply(ctx, stacks, emit) }：目标文案 + 撒布方式
// （emit(target) 由工厂接线为「向该目标提交等量燃烧」的反应指令）。
function burnMirror({ id, name, tier, spread }) {
  registerSkill({
    id, name, type: 'fire', tier, series: 'mirrorBurn',
    cost: { mana: 0, actionPoint: 0 },
    charges: { max: Infinity, cooldownTurns: 0 },
    cardMode: 'chant', chantWeight: 2,
    use() { return true; },
    activated: {
      subscriptions: (sctx) => [{
        when: AddEffectInstruction, phase: 'post',
        filter: (instr) => instr.effectId === 'burn'
          && instr.target === sctx.player
          && (instr.payload.stacks ?? 0) > 0,
        react: (instr, ctx) => {
          spread.apply(ctx, instr.payload.stacks, (target) =>
            ctx.kernel.submitInstruction(
              new AddEffectInstruction({ target, effectId: 'burn', stacks: instr.payload.stacks }),
              instr));
        },
      }],
    },
    describe: () => `获得/effect{燃烧}时，对${spread.targetText}施加等量燃烧`,
    battleDescribe: (sctx) => `获得/effect{燃烧}时，对${spread.targetText}施加等量燃烧`,
  });
}

burnMirror({
  id: 'mirrorBurn', name: '镜燃', tier: 'C',
  spread: {
    targetText: '随机敌人',
    apply: (ctx, stacks, emit) => {
      const enemy = randomAliveEnemy(ctx); // 走种子 rng（可复现）；无存活敌人返回 null 落空
      if (enemy) emit(enemy);
    },
  },
});
burnMirror({
  id: 'karmaFire', name: '业火', tier: 'A',
  spread: {
    targetText: '所有敌人',
    apply: (ctx, stacks, emit) => {
      for (const e of aliveEnemies(ctx.battleState)) emit(e);
    },
  },
});

// ==== 咏唱（§2.2）=============================================================

// 燃心决 A｜消耗 + 锁定，每回合 P5 咏唱节拍获得 3 魏启 + 自身燃烧 7。
// chantWeight 0：激活后不占手牌容量；anchored：激活后不可主动打出解除（也不可换下），
// 与 exhaust 一起表达「激活即钉死在手」——唯一出口是被焚/弃等离手路径。
// 触发挂点 = ChantTriggerInstruction POST（「快速咏唱」提前触发复用同一挂载点）。
registerSkill({
  id: 'burningHeart', name: '燃心决', type: 'fire', tier: 'A', series: 'fireChant',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 0,
  keywords: ['exhaust', 'anchored'],
  use() { return true; },
  activated: {
    subscriptions: () => [{
      when: ChantTriggerInstruction, phase: 'post',
      react: (instr, ctx) => {
        ctx.kernel.submitInstruction(new GainManaInstruction({ amount: 3 }), instr);
        ctx.kernel.submitInstruction(new AddEffectInstruction({
          target: ctx.player, effectId: 'burn', stacks: 7,
        }), instr);
      },
    }],
  },
  describe: () => '获得3魏启，/effect{燃烧}7',
  battleDescribe: (sctx) => '获得3魏启，/effect{燃烧}7',
});

// 取暖/灼目/灼身 C/B/A｜1AP，每回合 P5 对所有存活敌人施加 N 层燃烧
// （无存活敌人时循环体为空，静默落空）。层数走自然递减（敌方回合开始跳伤后 -1），
// 是叠炎体系的慢速群压引擎。2026-09 设计稿由单卡扩为三阶系列。
const scorchChantCard = ({ id, name, tier, stacks, promotesTo }) => registerSkill({
  id, name, type: 'fire', tier, series: 'fireChant',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 1,
  promotesTo,
  use() { return true; },
  activated: {
    subscriptions: () => [{
      when: ChantTriggerInstruction, phase: 'post',
      react: (instr, ctx) => {
        for (const e of aliveEnemies(ctx.battleState)) {
          ctx.kernel.submitInstruction(
            new AddEffectInstruction({ target: e, effectId: 'burn', stacks }), instr);
        }
      },
    }],
  },
  describe: () => `对所有敌人施加/effect{燃烧}${stacks}`,
  battleDescribe: (sctx) => `对所有敌人施加/effect{燃烧}${stacks}`,
});
scorchChantCard({ id: 'warmUp', name: '取暖', tier: 'C', stacks: 1, promotesTo: 'dazzleEye' });
scorchChantCard({ id: 'dazzleEye', name: '灼目', tier: 'B', stacks: 2, promotesTo: 'scorchBody' });
scorchChantCard({ id: 'scorchBody', name: '灼身', tier: 'A', stacks: 3 });

// 火焰披风 B｜3魏启，咏唱1：每回合 P5 若你正在燃烧，获得 9 护盾
// （火灵脉防御位：燃烧从代价转为收入，与可燃血液/焰愈同轴）。只读不消耗燃烧。
registerSkill({
  id: 'flameCloak', name: '火焰披风', type: 'fire', tier: 'B', series: 'fireChant',
  cost: { mana: 3, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 1,
  use() { return true; },
  activated: {
    subscriptions: (sctx) => [{
      when: ChantTriggerInstruction, phase: 'post',
      react: (instr, ctx) => {
        if (sctx.player.getEffectStacks('burn') > 0) {
          ctx.kernel.submitInstruction(
            new GainShieldInstruction({ target: sctx.player, amount: 9 }), instr);
        }
      },
    }],
  },
  describe: () => '若你正在燃烧，获得9护盾',
  battleDescribe: (sctx) => `若你正在燃烧（当前/effect{燃烧}${sctx.player.getEffectStacks('burn')}），获得9护盾`,
});

// 炼化/炼解 C/B｜咏唱1（2026-09-13 用户新文档新增）：每回合 P5 选 1 张手牌焚毁，
// 获得 1/2 魏启。把手牌当柴烧的蓝量引擎——与高热系列（自燃换纳气）并列为
// 火系两条「每回合变现」轴：高热烧自己，炼化烧手牌。选牌请求走 cardKit 唯一
// 形状（min/max 1/1）；空手时不发起请求（空集守卫，静默落空）。选到激活态的
// 咏唱卡也照烧（含引擎自身——烧自己=立即止损，与刀法咏唱的选弃口径一致）。
class BurnHandForManaInstruction extends BattleInstruction {
  constructor({ mana = 1, reason = null } = {}, opts = {}) {
    super(opts);
    this.mana = mana;
    this.reason = reason;
  }

  execute(ctx) {
    switch (this._stage) {
      case 0: {
        const request = buildCardSelectionRequest(ctx, {
          source: 'hand', min: 1, max: 1, reason: this.reason,
        });
        if (!request) return true; // 空手：无事发生
        this._ask = new AwaitPlayerInputInstruction({ request });
        ctx.kernel.submitInstruction(this._ask, this);
        return false;
      }
      default: {
        const ids = this._ask.result?.selection ?? [];
        for (const id of ids) {
          ctx.kernel.submitInstruction(new BurnCardInstruction({ uniqueID: id }), this);
        }
        if (ids.length > 0) {
          ctx.kernel.submitInstruction(
            new GainManaInstruction({ amount: this.mana * ids.length }), this);
        }
        return true;
      }
    }
  }
}
const smeltChantCard = ({ id, name, tier, mana, promotesTo }) => registerSkill({
  id, name, type: 'fire', tier, series: 'fireChant',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 1,
  promotesTo,
  use() { return true; },
  activated: {
    subscriptions: () => [{
      when: ChantTriggerInstruction, phase: 'post',
      react: (instr, ctx) => ctx.kernel.submitInstruction(
        new BurnHandForManaInstruction({ mana, reason: `${name}：选1张手牌焚毁，获得${mana}魏启` }),
        instr),
    }],
  },
  describe: () => `选1张手牌焚毁，获得${mana}魏启`,
  battleDescribe: (sctx) => `选1张手牌焚毁，获得${mana}魏启`,
});
smeltChantCard({ id: 'smeltCard', name: '炼化', tier: 'C', mana: 1, promotesTo: 'smeltCardPlus' });
smeltChantCard({ id: 'smeltCardPlus', name: '炼解', tier: 'B', mana: 2 });

// 绝炎 A｜1AP，咏唱3（2026-09-13 权重分档：少量强卡 3-4 咏），任何燃烧层数免疫消耗和下降。
// 口径：「消耗和下降」统一折算为「燃烧层数减少事件」——全场任何单位（敌我不分）
// 的 AddEffect(burn) 负层数（自然递减 -1 / 驱散 -N）一律 PRE veto；
// 跳伤结算不受影响：燃烧照常按层数跳固定伤害，只是不再衰减——
// 每层燃烧都变成永续持续输出源（代价：自己身上的燃烧同样棘轮化，
// 需焰愈/防火体系消化）。被 veto 的指令不触发任何 POST，无级联。
registerSkill({
  id: 'absoluteFlame', name: '绝炎', type: 'fire', tier: 'A', series: 'fireChant',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 3,
  use() { return true; },
  activated: {
    subscriptions: () => [{
      when: AddEffectInstruction, phase: 'pre',
      filter: (instr) => instr.effectId === 'burn'
        && (instr.payload.stacks ?? 0) < 0,
      react: (instr, ctx) => ctx.kernel.veto(instr, 'absoluteFlame'),
    }],
  },
  describe: () => '所有单位的/effect{燃烧}层数免疫消耗和下降',
  battleDescribe: (sctx) => '所有单位的/effect{燃烧}层数免疫消耗和下降',
});
