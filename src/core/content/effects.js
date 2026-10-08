import { registerEffect, getEffectDefinition } from '../effects/registry.js';
import { TurnStartInstruction, TurnEndInstruction, PlayerTurnStartInstruction, PlayerTurnEndInstruction } from '../instructions/turn.js';
import { DealDamageInstruction, ApplyDamageInstruction, ApplyHealInstruction, GainShieldInstruction, ClearShieldInstruction } from '../instructions/combat.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import { DrawCardsInstruction, DiscardCardInstruction, AddCardInstruction } from '../instructions/cards.js';
import { GainManaInstruction, ConsumeManaInstruction } from '../instructions/resources.js';
import { UseSkillInstruction } from '../instructions/skill.js';
import AIActInstruction from '../instructions/aiAct.js';
import { aliveEnemies, aliveAllies } from '../state/battleState.js';

// 燃烧：自己阵营回合开始时受到等于层数的**固定伤害**（EFFECTS.md：固定＝跳过修正与
// 防御、护盾可挡，不穿透），然后层数 -1。
// 烈焰亲和的减免在此就地折算——固定伤害 payload 白名单为空、PRE 不可修饰。
// 行为完全由订阅表达，结算指令里无任何"燃烧"特判。
registerEffect({
  id: 'burn',
  type: 'debuff',
  stacking: 'count',
  name: '燃烧',
  description: '回合开始时受到等于层数的固定伤害，然后层数减少 1。',
  icon: '🔥',
  color: 'red',
  subscriptions: (unit) => [{
    when: TurnStartInstruction,
    phase: 'post',
    filter: (instr) => instr.side === unit.side && !unit.isDead(),
    react: (instr, ctx) => {
      const stacks = unit.getEffectStacks('burn');
      if (stacks <= 0) return;
      ctx.kernel.submitInstruction(new DealDamageInstruction({
        source: null, target: unit,
        amount: Math.max(0, stacks - unit.getEffectStacks('flameAffinity')),
        fixed: true, tags: ['burn'], type: 'minor',
      }), instr);
      ctx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'burn', stacks: -1,
      }), instr);
    },
  }],
});

// 防御（EFFECTS.md 词条）：受到的伤害减少层数层。各单位 base 防御由 PreBattle 统一
// 转入效果轨（battleRoot），此后增减一律 AddEffect。常驻不衰减；结算公式读
// getStat('defense') 不变，pierce/fixed 照旧绕过。
registerEffect({
  id: 'defense',
  type: 'buff',
  stacking: 'count',
  name: '防御',
  description: '受到的伤害减少层数层。',
  icon: '🧱',
  color: 'gray',
  statModifiers: { defense: (stacks) => stacks },
});

// 格挡（体修·拆体系核心资源，BODY_CULTIVATION_CARDS §0）：buff 层数，≠ 护盾池。
// 受主级攻击时伤害减免 33%（向下取整），层数 -1；扣尽由 AddEffect 通用逻辑注销订阅。
// 基础免伤深度由**武者（44%）/ 武帝（55%）**两级能力抬高（见 abilities.js）——
// "想靠格挡活命必须投入能力位"。
// 挂**应用原语 PRE**（受击侧最后修正）+ 只认主级——附级伤害（荆棘反伤/精通抽卡伤/
// tick）是格挡「响应」不该拦的东西，吃盾但不动格挡层。
registerEffect({
  id: 'block',
  type: 'buff',
  stacking: 'count',
  name: '格挡',
  description: '受到攻击时伤害减少 33%，然后层数减少 1。',
  icon: '🛡️',
  color: 'blue',
  subscriptions: (unit) => [{
    when: ApplyDamageInstruction,
    phase: 'pre',
    // 固定伤害跳过修正步（F2），且其 payload 白名单为空——对 fixed 伤害调用 setPayload 会抛错。
    // 穿透伤害整条格挡响应链都不参与（EFFECTS.md 伤害分类：「穿透伤害：防御、护盾、
    // 格挡都不减免」）。读 basePierce（应用原语的穿透在受击侧不可改，见
    // instructions/combat.js 的 modifiablePayload 注释）。
    filter: (instr) => instr.target === unit && !instr.fixed && !instr.basePierce
      && instr.type === 'major',
    react: (instr, ctx) => {
      instr.setPayload('damage', Math.floor(instr.payload.damage * 0.67));
      ctx.kernel.submitInstruction(
        new AddEffectInstruction({ target: unit, effectId: 'block', stacks: -1 }), instr);
    },
  }],
});

// 忍耐（拆组合机制词；常驻受击引擎，非一次性姿态）：每受到一次伤害获得层数相当的格挡。
// 触发口径：实际造成生命值伤害的结算（被护盾全额吸收不算）；自伤付费（selfcost
// 标记，狂拳类失去生命是代价不是挨打）不算；**主级**伤害才算（附级反伤/抽卡伤是
// 格挡响应不该触发的东西）。
registerEffect({
  id: 'endure', type: 'buff', stacking: 'count',
  name: '忍耐',
  description: '每受到一次伤害，获得层数相当的格挡。',
  icon: '🪨', color: 'blue',
  subscriptions: (unit) => [{
    when: ApplyDamageInstruction, phase: 'post',
    filter: (instr) => instr.target === unit
      && instr.type === 'major'
      && !instr.tags?.includes('selfcost')
      && (instr.result?.dealt ?? 0) > 0
      && !unit.isDead(),
    react: (instr, ctx) => {
      const stacks = unit.getEffectStacks('endure');
      if (stacks > 0) ctx.kernel.submitInstruction(
        new AddEffectInstruction({ target: unit, effectId: 'block', stacks }), instr);
    },
  }],
});

// 滞气（体修通用代价关键词）：debuff，无法抽牌（含回合开始抽牌与技能抽牌），
// 玩家回合结束层数 -1。藏锋系列等高收益卡的费用语言。
// 原型验证：test/slashSeries.test.js。
registerEffect({
  id: 'stall',
  type: 'debuff',
  stacking: 'count',
  name: '滞气',
  description: '无法抽牌。回合结束时层数减少 1。',
  icon: '🌀',
  color: 'gray',
  subscriptions: (unit) => [
    {
      when: DrawCardsInstruction,
      phase: 'pre',
      react: (instr, ctx) => ctx.kernel.veto(instr, 'stall'),
    },
    {
      when: PlayerTurnEndInstruction,
      phase: 'post',
      react: (instr, ctx) => ctx.kernel.submitInstruction(
        new AddEffectInstruction({ target: unit, effectId: 'stall', stacks: -1 }), instr),
    },
  ],
});

// 纳气：玩家回合开始时获得层数点魏启，层数归零（一次性整取，非逐层递减——
// 汲取系卡的"存气"语言：入罐 → 下回合开闸）。魏启获取走上限截断管线。
registerEffect({
  id: 'naqi',
  type: 'buff',
  stacking: 'count',
  name: '纳气',
  description: '回合开始时获得层数点魏启，然后层数归零。',
  icon: '🌀',
  color: 'blue',
  subscriptions: (unit) => [{
    when: PlayerTurnStartInstruction,
    phase: 'post',
    filter: (instr) => instr.side === 'player' && !unit.isDead() && unit.getEffectStacks('naqi') > 0,
    react: (instr, ctx) => {
      const stacks = unit.getEffectStacks('naqi');
      ctx.kernel.submitInstruction(new GainManaInstruction({ amount: stacks }), instr);
      ctx.kernel.submitInstruction(
        new AddEffectInstruction({ target: unit, effectId: 'naqi', stacks: -stacks }), instr);
    },
  }],
});

// 荆棘：受到主级攻击时，攻击来源受到层数点普通伤害（走防御/护盾管线，可被挡，
// 不穿透；无来源的环境伤害不反）。敌我通用（针鼠竖刺 / 反伤遗物同语言）。
// 挂**应用原语 POST**（受击响应）+ 只认主级；反伤本身是**附级**伤害（type:'minor'）
// ——不吃加成、不触发对面再响应，天然不连锁。
registerEffect({
  id: 'thorns',
  type: 'buff',
  stacking: 'count',
  name: '荆棘',
  description: '受到攻击时，对攻击者造成层数点伤害（可被护盾抵挡）。',
  icon: '🌵',
  color: 'green',
  subscriptions: (unit) => [{
    when: ApplyDamageInstruction,
    phase: 'post',
    filter: (instr) => instr.target === unit && instr.source && !instr.source.isDead()
      && instr.type === 'major',
    react: (instr, ctx) => {
      const stacks = unit.getEffectStacks('thorns');
      if (stacks <= 0) return;
      ctx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: instr.source, amount: stacks, tags: ['thorns'], type: 'minor',
      }), instr);
    },
  }],
});

// 虚弱：每层攻击 -1（可把攻击压到负——伤害算式对负面板天然衰减，减半/加成仍对称生效）。
registerEffect({
  id: 'weaken',
  type: 'debuff',
  stacking: 'count',
  statModifiers: {
    attack: (stacks) => -stacks,
  },
  name: '虚弱',
  description: '每层使攻击降低 1 点。',
  icon: '📉',
  color: 'purple',
});

// 防火（EFFECTS.md）：燃烧结算时跳过伤害（层数照常 -1——燃烧自身的递减在 burn 反应里
// 独立提交，veto 伤害不影响它）。识别走伤害指令的 'burn' 标记，不做效果名特判。
registerEffect({
  id: 'fireproof',
  type: 'buff',
  stacking: 'count',
  name: '防火',
  description: '此单位燃烧结算时跳过伤害，层数减少 1。',
  icon: '🧯',
  color: 'blue',
  subscriptions: (unit) => [{
    when: ApplyDamageInstruction,
    phase: 'pre',
    filter: (instr) => instr.target === unit && instr.tags?.includes('burn'),
    react: (instr, ctx) => ctx.kernel.veto(instr, 'fireproof'),
  }],
});

// 烈焰亲和（火灵脉体系效果，EFFECTS.md）：燃烧结算时，减免层数点伤害。
// 燃烧为固定伤害（payload 白名单为空、PRE 不可修饰），减免由燃烧 tick 就地折算
// （burn react 读本层数，min 0）——此处仅作状态轨/图鉴展示，无订阅。
// 与防火（整跳 veto）两级同轴。
registerEffect({
  id: 'flameAffinity',
  type: 'buff',
  stacking: 'count',
  name: '烈焰亲和',
  description: '燃烧结算时，减免层数点伤害。',
  icon: '🧤',
  color: 'red',
});

// 炎魔（火灵脉体系效果，EFFECTS.md）：造成伤害时，赋予伤害对象燃烧1（按当前层数）。
// 循环防护双保险：燃烧跳伤 source 为空天然不触发；'burn' 标记伤害一律不触发（防
// 自馈级联）。目标已死亡不赋予。荆棘反伤等非 burn 标记的己方伤害照常附带（设计语义）。
// **未造成生命伤害不附带燃烧**（被护盾全额吸收/被闪避的结算 dealt=0 → 不烧）
// ——防住了就是真防住。
registerEffect({
  id: 'flameDemon',
  type: 'buff',
  stacking: 'count',
  name: '炎魔',
  description: '造成生命伤害时，赋予伤害对象燃烧1。',
  icon: '👹',
  color: 'red',
  subscriptions: (unit) => [{
    when: DealDamageInstruction,
    phase: 'post',
    // 发动侧特效附加：留在结算原语 POST + 只认主级——附级伤害（荆棘反伤/抽卡伤）
    // 不附带燃烧。
    filter: (instr) => instr.source === unit && !unit.isDead()
      && instr.type === 'major'
      && (instr.result?.dealt ?? 0) > 0
      && !instr.tags?.includes('burn') && !instr.target.isDead(),
    react: (instr, ctx) => {
      ctx.kernel.submitInstruction(new AddEffectInstruction({
        target: instr.target, effectId: 'burn', stacks: unit.getEffectStacks('flameDemon'),
      }), instr);
    },
  }],
});

// 暴怒（卡达斯体系效果）：受伤时获得等同**当前层数**的力量；己方回合开始时层数清零
// （力量不清——压力设计：打它越狠，它下一拍越痛，但层数不跨回合复利）。
// 读 result.dealt（护盾/防御吸收后的实际生命损失）；只回应**主级**攻击
// （附级反伤/抽卡伤/tick 不算「被打」）。
registerEffect({
  id: 'rage',
  type: 'buff',
  stacking: 'count',
  name: '暴怒',
  description: '受伤时获得等同层数的力量；己方回合开始时层数清零。',
  icon: '💢',
  color: 'red',
  subscriptions: (unit) => [
    {
      when: ApplyDamageInstruction,
      phase: 'post',
      filter: (instr) => instr.target === unit && !unit.isDead()
        && instr.type === 'major'
        && (instr.result?.dealt ?? 0) > 0,
      react: (instr, ctx) => {
        const stacks = unit.getEffectStacks('rage');
        if (stacks <= 0) return;
        ctx.kernel.submitInstruction(new AddEffectInstruction({
          target: unit, effectId: 'strength', stacks,
        }), instr);
      },
    },
    {
      when: TurnStartInstruction,
      phase: 'post',
      filter: (instr) => instr.side === unit.side,
      react: (instr, ctx) => {
        const stacks = unit.getEffectStacks('rage');
        if (stacks <= 0) return;
        ctx.kernel.submitInstruction(new AddEffectInstruction({
          target: unit, effectId: 'rage', stacks: -stacks,
        }), instr);
      },
    },
  ],
});

// 中毒（EFFECTS.md）：回合结束时受到层数点**穿透伤害**（防御与护盾都不减免），
// 然后层数 -1。与燃烧的区别：回合末结算 + 穿透（燃烧为固定伤害、护盾可挡）。
registerEffect({
  id: 'poison',
  type: 'debuff',
  stacking: 'count',
  name: '中毒',
  description: '回合结束时受到等于层数的穿透伤害，然后层数减少 1。',
  icon: '☠️',
  color: 'green',
  subscriptions: (unit) => [{
    when: TurnEndInstruction,
    phase: 'post',
    filter: (instr) => instr.side === unit.side && !unit.isDead(),
    react: (instr, ctx) => {
      const stacks = unit.getEffectStacks('poison');
      if (stacks <= 0) return;
      ctx.kernel.submitInstruction(new DealDamageInstruction({
        source: null, target: unit, amount: stacks, pierce: true, tags: ['poison'], type: 'minor',
      }), instr);
      ctx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'poison', stacks: -1,
      }), instr);
    },
  }],
});

// 笨拙（EFFECTS.md）：每次尝试抽牌取消该次抽牌并 -1 层（逐层消耗，区别于滞气的整回合锁）。
// 用 payload 归零而非 veto：被取消节点的子节点不执行（A4），-1 必须挂在仍然执行的节点上。
registerEffect({
  id: 'clumsy',
  type: 'debuff',
  stacking: 'count',
  name: '笨拙',
  description: '抽牌时取消该次抽牌，然后层数减少 1。',
  icon: '🐾',
  color: 'gray',
  subscriptions: (unit) => [{
    when: DrawCardsInstruction,
    phase: 'pre',
    filter: () => unit.getEffectStacks('clumsy') > 0,
    react: (instr, ctx) => {
      instr.setPayload('count', 0); // 本次抽牌落空
      ctx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'clumsy', stacks: -1,
      }), instr);
    },
  }],
});

// 再生：回合开始恢复层数点生命，然后层数 -1（EFFECTS.md 目录既有定义的正式落地）。
registerEffect({
  id: 'regen',
  type: 'buff',
  stacking: 'count',
  name: '再生',
  description: '回合开始时恢复层数点生命，然后层数减少 1。',
  icon: '💚',
  color: 'green',
  subscriptions: (unit) => [{
    when: TurnStartInstruction,
    phase: 'post',
    filter: (instr) => instr.side === unit.side && !unit.isDead() && unit.getEffectStacks('regen') > 0,
    react: (instr, ctx) => {
      const stacks = unit.getEffectStacks('regen');
      ctx.kernel.submitInstruction(new ApplyHealInstruction({
        target: unit, amount: stacks,
      }), instr);
      ctx.kernel.submitInstruction(
        new AddEffectInstruction({ target: unit, effectId: 'regen', stacks: -1 }), instr);
    },
  }],
});

// ==== 呼吸系列（刀系·弃牌回补）==================================================
// 打出呼吸卡即获得对应效果：效果自带「弃牌 POST」监听——每弃 1 牌抽 1/层。
// 监听器生命周期与效果实例绑定（首获挂载 / 扣尽注销）；回合末自行消散
// （提交 -全部层数 → 过零自动注销订阅）。换牌（R3）内部走弃牌指令，同样触发。

// 回合内增益自清：玩家回合结束提交 -全部层数（扣尽 → 订阅按 owner 自动注销）
const clearsAtPlayerTurnEnd = (effectId) => (unit) => ({
  when: PlayerTurnEndInstruction,
  phase: 'post',
  filter: () => unit.getEffectStacks(effectId) > 0,
  react: (instr, ctx) => ctx.kernel.submitInstruction(new AddEffectInstruction({
    target: unit, effectId, stacks: -unit.getEffectStacks(effectId),
  }), instr),
});

function registerBreathEffect({ id, name }) {
  registerEffect({
    id, type: 'buff', stacking: 'count', name,
    description: '本回合内每弃 1 张牌：抽 1 张牌（每层 1 张）。回合结束时消散。',
    icon: '🌬️',
    color: 'green',
    subscriptions: (unit) => [{
      when: DiscardCardInstruction,
      phase: 'post',
      filter: (instr) => Boolean(instr.result.card), // 落空的弃牌（牌不在手）不计
      react: (instr, ctx) => {
        const stacks = unit.getEffectStacks(id);
        if (stacks <= 0) return;
        ctx.kernel.submitInstruction(new DrawCardsInstruction({ count: stacks }), instr);
      },
    }, clearsAtPlayerTurnEnd(id)(unit)],
  });
}
registerBreathEffect({ id: 'breath', name: '呼吸' });

// 治疗（EFFECTS.md）：回合开始时恢复层数点生命，失去所有层数——与再生的区别是
// 整取清零（一次结清而非逐层递减），午休的「醒来回血」账单。
registerEffect({
  id: 'mend',
  type: 'buff',
  stacking: 'count',
  name: '治疗',
  description: '回合开始时恢复层数点生命，然后失去所有层数。',
  icon: '💉',
  color: 'green',
  subscriptions: (unit) => [{
    when: TurnStartInstruction,
    phase: 'post',
    filter: (instr) => instr.side === unit.side && !unit.isDead() && unit.getEffectStacks('mend') > 0,
    react: (instr, ctx) => {
      const stacks = unit.getEffectStacks('mend');
      ctx.kernel.submitInstruction(new ApplyHealInstruction({
        target: unit, amount: stacks,
      }), instr);
      ctx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'mend', stacks: -stacks,
      }), instr);
    },
  }],
});

// 闪避：免疫下一次攻击（层数 -1）。判定口径与火墙一致：「攻击」= 有来源、
// 非燃烧/中毒等环境标记的伤害指令（玩家普攻/多段/固定伤害都算；燃烧跳伤、
// 中毒结算不算）。被 veto 的结算无联动（A4）——荆棘不反、命中探针不触发。
// 可储存但会蒸发（防多层蓄成永久无敌）：持有者**回合开始时**层数 -1——
// 挂在回合开始而非结束，保证本回合拿的闪避一定能挡过这轮敌方攻击。
registerEffect({
  id: 'dodge',
  type: 'buff',
  stacking: 'count',
  name: '闪避',
  description: '免疫下一次攻击，然后层数减少 1。自己回合开始时层数 -1。',
  icon: '💨',
  color: 'cyan',
  subscriptions: (unit) => [{
    when: ApplyDamageInstruction,
    phase: 'pre',
    // 挂应用原语 PRE（受击侧拦截）+ 只认主级——附级伤害（荆棘反伤/精通抽卡伤）
    // 不消耗闪避层。
    filter: (instr) => instr.target === unit
      && instr.source
      && instr.type === 'major',
    react: (instr, ctx) => ctx.kernel.veto(instr, 'dodge', [
      new AddEffectInstruction({ target: unit, effectId: 'dodge', stacks: -1 }),
    ]),
  }, {
    when: TurnStartInstruction,
    phase: 'post',
    filter: (instr) => instr.side === unit.side && !unit.isDead()
      && unit.getEffectStacks('dodge') > 0,
    react: (instr, ctx) => {
      ctx.kernel.submitInstruction(
        new AddEffectInstruction({ target: unit, effectId: 'dodge', stacks: -1 }), instr);
    },
  }],
});

// 晕眩（EFFECTS.md）：回合行动时跳过行动，层数 -1。
// AI 单位（敌人/盟友）经 AIActInstruction PRE veto 实现（被取消的结算无联动，A4；
// 层数 -1 作为 veto 替代指令插入）；玩家的「行动」是回合阶段机的 P4 操作段，
// 订阅无法 veto 一个 WAIT，由 PlayerTurnInstruction 内按层数跳过（见 turn.js）。
registerEffect({
  id: 'stun',
  type: 'debuff',
  stacking: 'count',
  name: '晕眩',
  description: '回合行动时跳过行动，然后层数减少 1。',
  icon: '💫',
  color: 'gray',
  subscriptions: (unit) => [{
    when: AIActInstruction,
    phase: 'pre',
    filter: (instr) => instr.unit === unit,
    react: (instr, ctx) => ctx.kernel.veto(instr, 'stun', [
      new AddEffectInstruction({ target: unit, effectId: 'stun', stacks: -1 }),
    ]),
  }],
});

// 引线（EFFECTS.md·爆炸引线）：自己回合结束时层数 -1，**层数归 0 时引爆**——
// 对玩家阵营全体造成 14 群伤并自爆死亡。持有者被提前击杀则什么都不发生
// （新生版爆囊的定时炸弹口径：杀它=拆弹，拖满倒计时=挨炸）。
registerEffect({
  id: 'blastFuse',
  type: 'buff',
  stacking: 'count',
  name: '爆炸引线',
  description: '自己回合结束时层数减少 1；层数归零时爆炸——对玩家阵营全体造成 14 伤害，自身死亡。',
  icon: '🧨',
  color: 'red',
  subscriptions: (unit) => [{
    when: TurnEndInstruction,
    phase: 'post',
    filter: (instr) => instr.side === unit.side && !unit.isDead(),
    react: (instr, ctx) => {
      const stacks = unit.getEffectStacks('blastFuse');
      if (stacks <= 0) return;
      ctx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'blastFuse', stacks: -1,
      }), instr);
      if (stacks <= 1) {
        // 归零引爆：玩家阵营全体 14 群伤 + 自爆（走正规死亡结算）。fixed = 定值爆炸
        // 不吃蓄势等修正，仍走护盾吸收、可被满盾挡下。
        for (const t of [ctx.player, ...aliveAllies(ctx.battleState)]) {
          if (t.isDead()) continue;
          ctx.kernel.submitInstruction(new DealDamageInstruction({
            source: unit, target: t, amount: 14, fixed: true, type: 'major', tags: ['blast'],
          }), instr);
        }
        ctx.kernel.submitInstruction(new DealDamageInstruction({
          source: unit, target: unit, amount: 999, pierce: true, tags: ['blast'],
        }), instr);
      }
    },
  }],
});

// 奇迹（塞西莉亚体系通用机制）：生命拒绝降到 0 或以下——minHp 地板 = 1
// 走 getStat 读轨，与伤害管线同源、不特判。
// 自己回合结束时层数 -1；**层数归零 = 奇迹终结 = 死亡**。
// 归零结算顺序不可颠倒：先由 AddEffect 摘掉地板（层数归零同时注销本订阅），再以 fixed
// 伤害直落 0——反过来的话地板会把致命伤再挡回 1，永远死不掉。
// 归零死亡带 tags:['miracle']：塞西莉亚之恩赐的「致命拦截」按此标记豁免，否则
// 「延迟死亡 → 奇迹耗尽 → 又被拦截」会自我续命成不死。
// 同一效果供两处复用：遗物「塞西莉亚之恩赐」（奇迹1）与技能「塞西莉亚奇迹」（奇迹3）。
registerEffect({
  id: 'miracle',
  type: 'buff',
  stacking: 'count',
  name: '奇迹',
  description: '生命不会降到 0 或以下；自己回合结束时层数 -1，层数归零时死亡。',
  icon: '🕊️',
  color: 'green',
  statModifiers: { minHp: () => 1 },
  subscriptions: (unit) => [{
    when: TurnEndInstruction,
    phase: 'post',
    filter: (instr) => instr.side === unit.side && !unit.isDead(),
    react: (instr, ctx) => {
      const stacks = unit.getEffectStacks('miracle');
      if (stacks <= 0) return;
      ctx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'miracle', stacks: -1,
      }), instr);
      if (stacks <= 1) {
        // 层数归零：奇迹终结即死亡。amount = hp + shield 保证落到 0（fixed 不过防御，
        // 护盾先吸掉 shield、余额正好打空生命）。附级：系统结算，不该触发任何响应。
        ctx.kernel.submitInstruction(new DealDamageInstruction({
          source: null, target: unit, amount: unit.hp + unit.shield,
          fixed: true, tags: ['miracle'], type: 'minor',
        }), instr);
      }
    },
  }],
});

// ---- 脆弱 / 伤残（EFFECTS.md §负面效果；恶魔 roll 与遗物共用的通用负面效果）----

// 脆弱：获得护盾时，获得量减少层数层（不可小于 0）。层数不随触发递减（文档未写递减）。
registerEffect({
  id: 'fragile',
  type: 'debuff',
  stacking: 'count',
  name: '脆弱',
  description: '获得护盾时，获得量减少层数层。',
  icon: '🪨',
  color: 'purple',
  subscriptions: (unit) => [{
    when: GainShieldInstruction,
    phase: 'pre',
    filter: (instr) => instr.target === unit,
    react: (instr) => {
      const stacks = unit.getEffectStacks('fragile');
      if (stacks > 0) instr.setPayload('amount', Math.max(0, instr.payload.amount - stacks));
    },
  }],
});

// 伤残：所有来源伤害增加层数层。固定伤害跳过修正步（F2）且 payload 白名单为空，不受影响
// （与格挡同一条铁律，见上方 block 的注释）。
registerEffect({
  id: 'maim',
  type: 'debuff',
  stacking: 'count',
  name: '伤残',
  description: '受到的伤害增加层数层（固定伤害不受影响）。',
  icon: '🩸',
  color: 'purple',
  subscriptions: (unit) => [{
    when: ApplyDamageInstruction,
    phase: 'pre',
    filter: (instr) => instr.target === unit && !instr.fixed,
    react: (instr) => {
      const stacks = unit.getEffectStacks('maim');
      if (stacks > 0) instr.setPayload('damage', instr.payload.damage + stacks);
    },
  }],
});

// 如山（EFFECTS.md）：护盾不自动清空——回合开始的例行清盾对持有者失效。
// 1 层即恒效、不随触发递减（多层无额外意义，只表强度）：无人战体的 150 初始盾
// 全靠它跨回合存续（否则敌方回合开始的清盾让任何盾都活不过「护一个玩家回合」）。
registerEffect({
  id: 'mountain',
  type: 'buff',
  stacking: 'count',
  name: '如山',
  description: '护盾不自动清空。',
  icon: '⛰️',
  color: 'gray',
  subscriptions: (unit) => [{
    when: ClearShieldInstruction,
    phase: 'pre',
    filter: (instr) => instr.target === unit,
    react: (instr, ctx) => ctx.kernel.veto(instr, 'mountain'),
  }],
});

// 纯净（EFFECTS.md）：抵消一次负面效果赋予，层数 -1。识别走效果定义的 type
// 而非名单特判；层数递减（负数赋予）与正面效果不消耗。
registerEffect({
  id: 'pure',
  type: 'buff',
  stacking: 'count',
  name: '纯净',
  description: '抵消一次负面效果赋予，层数减少 1。',
  icon: '✨',
  color: 'blue',
  subscriptions: (unit) => [{
    when: AddEffectInstruction,
    phase: 'pre',
    filter: (instr) => instr.target === unit
      && instr.payload.stacks > 0
      && getEffectDefinition(instr.effectId)?.type === 'debuff'
      && unit.getEffectStacks('pure') > 0,
    react: (instr, ctx) => ctx.kernel.veto(instr, 'pure', [
      new AddEffectInstruction({ target: unit, effectId: 'pure', stacks: -1 }),
    ]),
  }],
});

// 凝滞（EFFECTS.md）：一切状态都无法变更——效果、生命、护盾等全部冻结
// （对持有者的一切状态类指令 veto；多层时连 AI 行动一并冻结）。
// 持有者回合开始时层数 -1（在其它回合开始结算之前解除——1 层凝滞的下一拍行动正常）。
// 首用：无人战体盾碎转阶段（整机挂起，玩家剩余输出打不动冻结的机器）。
// type 定为 buff：它对持有者是保护性冻结，不能被「纯净」当负面吃掉（否则盾碎瞬间
// 挂上的凝滞会被自己的纯净 4 拦截，转阶段永远不触发）。
registerEffect({
  id: 'stasis',
  type: 'buff',
  stacking: 'count',
  name: '凝滞',
  description: '一切状态都无法变更（效果、生命、护盾）。自己回合开始时层数减少 1。',
  icon: '🧊',
  color: 'cyan',
  subscriptions: (unit) => [
    {
      when: ApplyDamageInstruction,
      phase: 'pre',
      filter: (instr) => instr.target === unit && unit.getEffectStacks('stasis') > 0,
      react: (instr, ctx) => ctx.kernel.veto(instr, 'stasis'),
    },
    {
      when: ApplyHealInstruction,
      phase: 'pre',
      filter: (instr) => instr.target === unit && unit.getEffectStacks('stasis') > 0,
      react: (instr, ctx) => ctx.kernel.veto(instr, 'stasis'),
    },
    {
      when: GainShieldInstruction,
      phase: 'pre',
      filter: (instr) => instr.target === unit && unit.getEffectStacks('stasis') > 0,
      react: (instr, ctx) => ctx.kernel.veto(instr, 'stasis'),
    },
    {
      when: ClearShieldInstruction,
      phase: 'pre',
      filter: (instr) => instr.target === unit && unit.getEffectStacks('stasis') > 0,
      react: (instr, ctx) => ctx.kernel.veto(instr, 'stasis'),
    },
    {
      when: AddEffectInstruction,
      phase: 'pre',
      // 递减自身（stasis 负层数）必须放行——否则自己挡自己，层数永不减少
      filter: (instr) => instr.target === unit && unit.getEffectStacks('stasis') > 0
        && !(instr.effectId === 'stasis' && instr.payload.stacks < 0),
      react: (instr, ctx) => ctx.kernel.veto(instr, 'stasis'),
    },
    {
      // 多层凝滞连行动一并冻结（1 层已在回合开始扣完，正常行动）
      when: AIActInstruction,
      phase: 'pre',
      filter: (instr) => instr.unit === unit && unit.getEffectStacks('stasis') > 0,
      react: (instr, ctx) => ctx.kernel.veto(instr, 'stasis'),
    },
    {
      when: TurnStartInstruction,
      phase: 'post',
      priority: 50, // 早于燃烧等回合开始结算（priority 0）：解除在本回合开始一刻生效
      filter: (instr) => instr.side === unit.side && !unit.isDead() && unit.getEffectStacks('stasis') > 0,
      react: (instr, ctx) => ctx.kernel.submitInstruction(
        new AddEffectInstruction({ target: unit, effectId: 'stasis', stacks: -1 }), instr),
    },
  ],
});

// 弹道干扰（神兵躯壳）：段数减免标记——每层令目标**下一次扫射**的段数 -2
// （整量消耗，扫射结算时清空）。首用：Boss【回忆】洗入玩家牌库的「躲闪」。
// 纯标记效果（无订阅，读数与清除都写在神兵躯壳的 act/getIntention 里）。
// type 定为 buff（与凝滞同一条理由）：这是打在机器上的干扰标记，不该被它自己的
// 「纯净」当负面效果吃掉——纯净 3 若把它拦下，玩家手里 7 张躲闪就全是废牌。
registerEffect({
  id: 'scatterJam',
  type: 'buff',
  stacking: 'count',
  name: '弹道干扰',
  description: '下一次扫射的段数减少 2（每层）。扫射结算后清除。',
  icon: '🎯',
  color: 'cyan',
});

// 无敌：生命不会降到 1 以下（minHp 地板，与伤害管线同源）。无自动递减、不自杀——
// 何时终结（移除）由施加方控制。首用：无人战体死亡拍的自爆协议（宕机→锁死→下一拍引爆）。
// 与奇迹的区别：奇迹自带「回合末递减 + 归零即死」的倒计时，无敌是外部托管的绝对态。
registerEffect({
  id: 'invulnerable',
  type: 'buff',
  stacking: 'count',
  name: '无敌',
  description: '生命不会降到 1 以下。',
  icon: '🛡️',
  color: 'yellow',
  statModifiers: { minHp: () => 1 },
});

// 充能（静电毛球）：每层攻击 +1；**受攻击时层数 -2**（提前放电）。
// 与蓄势的差异：蓄势是纯滚雪球标记（不打它就白白变强），充能可被玩家攻击泄放——
// 「不打它越充越强，打它有泄压收益」的攻防节奏抉择；与力量的差异：力量不因受击衰减。
registerEffect({
  id: 'charge',
  type: 'buff',
  stacking: 'count',
  name: '充能',
  description: '每层使攻击提高 1 点。受到攻击时层数减少 2。',
  icon: '🔋',
  color: 'yellow',
  statModifiers: {
    attack: (stacks) => stacks,
  },
  subscriptions: (unit) => [{
    when: ApplyDamageInstruction,
    phase: 'post',
    // 被打中护盾也算「受攻击」（电是接触即放）；无来源的环境伤害不触发；
    // 泄放是受击响应，只认主级攻击。
    filter: (instr) => instr.target === unit && instr.source
      && instr.type === 'major' && !unit.isDead(),
    react: (instr, ctx) => {
      const stacks = unit.getEffectStacks('charge');
      if (stacks <= 0) return;
      ctx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'charge', stacks: -2,
      }), instr);
    },
  }],
});

// 紧勒（EFFECTS.md：「手牌上限减少层数张」。首用：腐苔球的腐烂蔓延）——第一章
// 「卡手」主题的语言。效果轨实现：扣减走 statModifiers，handLimitOf 经 getStat 折入
// ——修正的生命周期 = 效果实例的生命周期（战斗结束随 PreBattle/PostBattle 的
// clearEffects 自动出清，不存在直改字段与重算互相覆盖的窗口）。
// 「施加者死亡时归还其施加的层数」是施加方行为（腐苔球亡语），非效果本体规则。
registerEffect({
  id: 'constrict',
  type: 'debuff',
  stacking: 'count',
  statModifiers: {
    maxHandSize: (stacks) => -stacks,
  },
  name: '紧勒',
  description: '手牌上限减少层数张。',
  icon: '🪢',
  color: 'purple',
});

// 扩容（EFFECTS.md：「手牌上限提升层数张」）：紧勒的镜像，同走效果轨。
// 首用：火系「膨胀」。（空系「扩容」给的是咏唱容量 chantCapacity，与本效果不同轨。）
registerEffect({
  id: 'expand',
  type: 'buff',
  stacking: 'count',
  statModifiers: {
    maxHandSize: (stacks) => stacks,
  },
  name: '扩容',
  description: '手牌上限提升层数张。',
  icon: '🖐️',
  color: 'blue',
});

// ---- 章 1 敌用效果（甲壳 / 电动 / 蓄势 / 融合）----

// 甲壳：受到主级伤害时伤害减半，然后层数 -1。挂应用原语 PRE（受击侧最后修正，
// 与格挡同管线），只认主级、非固定、非穿透（穿透不吃减伤是 EFFECTS.md 伤害分类铁律）。
registerEffect({
  id: 'shell',
  type: 'buff',
  stacking: 'count',
  name: '甲壳',
  description: '受到攻击时伤害减半，然后层数减少 1。',
  icon: '🐚',
  color: 'gray',
  subscriptions: (unit) => [{
    when: ApplyDamageInstruction,
    phase: 'pre',
    filter: (instr) => instr.target === unit && !instr.fixed && !instr.basePierce
      && instr.type === 'major' && unit.getEffectStacks('shell') > 0,
    react: (instr, ctx) => {
      instr.setPayload('damage', Math.ceil(instr.payload.damage / 2));
      ctx.kernel.submitInstruction(
        new AddEffectInstruction({ target: unit, effectId: 'shell', stacks: -1 }), instr);
    },
  }],
});

// 电动：每有一个**其他**友军存活，攻击提高 3（层数是强度系数：1 层 = 每友军 +3）。
// 走 statModifiers 的 view 通道（getStat 第三参 = battleState，跨实体衍生的既定口径，
// 同火焰主宰读敌燃烧）——友军增减即时反映到面板与意图。view 缺席（无战斗上下文）时
// 按 1 个友军兜底，保证 tooltip/意图不归零。
registerEffect({
  id: 'dynamo',
  type: 'buff',
  stacking: 'count',
  name: '电动',
  description: '每有一个友军，攻击提高 3。',
  icon: '🔌',
  color: 'yellow',
  statModifiers: {
    attack: (stacks, unit, view) => {
      if (!view) return stacks * 3;
      const side = unit.side === 'enemy' ? aliveEnemies(view) : aliveAllies(view);
      const friends = side.filter(u => u !== unit && !u.isDead()).length;
      return stacks * 3 * friends;
    },
  },
});

// 蓄势（EFFECTS.md）：所有伤害增加层数层（发动侧 PRE，逐次伤害各自加成——多段攻击
// 每段都吃到）；受到任何**生命值**伤害（dealt>0，被盾全额吸收不算）时层数 -1。
// 与力量的差异：力量走攻击面板（进意图公式）且不因受击衰减，蓄势直接加在每次伤害上
// 且会被打掉——「趁热打铁，别让它养起来」的攻防拉扯。
registerEffect({
  id: 'momentum',
  type: 'buff',
  stacking: 'count',
  name: '蓄势',
  description: '所有伤害增加层数层；受到生命伤害时层数减少 1。',
  icon: '📈',
  color: 'yellow',
  subscriptions: (unit) => [
    {
      when: DealDamageInstruction,
      phase: 'pre',
      filter: (instr) => instr.source === unit && !instr.fixed
        && unit.getEffectStacks('momentum') > 0,
      react: (instr) => {
        instr.setPayload('damage', instr.payload.damage + unit.getEffectStacks('momentum'));
      },
    },
    {
      when: ApplyDamageInstruction,
      phase: 'post',
      filter: (instr) => instr.target === unit
        && (instr.result?.dealt ?? 0) > 0
        && unit.getEffectStacks('momentum') > 0,
      react: (instr, ctx) => {
        ctx.kernel.submitInstruction(
          new AddEffectInstruction({ target: unit, effectId: 'momentum', stacks: -1 }), instr);
      },
    },
  ],
});

// 融合（EFFECTS.md，自持亡语）：死亡时，友军所有史莱姆族恢复 8 生命并获得 2 力量
// ——打小的喂大的，斩杀顺序与 AOE 的低压力教学。
// 亡语挂在效果自身的死亡响应上（任何持有「融合」的单位都生效，不依赖敌人 def.onDeath）；
// 史莱姆族口径：slime / slimeB / slimeletA / slimeletB / slimelet / bigSlime。
const SLIME_FAMILY = new Set(['slime', 'slimeB', 'slimeletA', 'slimeletB', 'slimelet', 'bigSlime']);
registerEffect({
  id: 'fusion',
  type: 'buff',
  stacking: 'count',
  name: '融合',
  description: '死亡时，友军所有史莱姆恢复 8 生命并获得 2 力量。',
  icon: '🫠',
  color: 'green',
  subscriptions: (unit) => [{
    when: ApplyDamageInstruction,
    phase: 'post',
    // 只认「真实致死」的结算（targetDead 且非 skipped）——多段攻击中途击杀后，余段
    // 打在尸体上会带 { targetDead:true, skipped:true } 的占位结果（execute 的过期目标
    // 守卫），不滤掉会把亡语按剩余段数重复触发（攻2×5 首段击杀 = 白送 4 次融合）。
    filter: (instr) => instr.target === unit
      && (instr.result?.targetDead ?? false) && !(instr.result?.skipped ?? false),
    react: (instr, ctx) => {
      for (const e of aliveEnemies(ctx.battleState)) {
        if (e === unit || !SLIME_FAMILY.has(e.defId)) continue;
        ctx.kernel.submitInstruction(new ApplyHealInstruction({ target: e, amount: 8 }), instr);
        ctx.kernel.submitInstruction(
          new AddEffectInstruction({ target: e, effectId: 'strength', stacks: 2 }), instr);
      }
    },
  }],
});

// ==== 章2 效果（南孚宫；EFFECTS.md 已收录，随 ENEMIES_2 实装落地）====================

// 漏气（大队战士）：玩家回合开始时失去层数点魏启，层数归零（纳气的镜像——一次性整取）。
// 失去量经 ConsumeMana 的下限 0 截断（没蓝就少扣，不产生负蓝）。
registerEffect({
  id: 'leak',
  type: 'debuff',
  stacking: 'count',
  name: '漏气',
  description: '回合开始时失去层数点魏启，然后层数归零。',
  icon: '💨',
  color: 'gray',
  subscriptions: (unit) => [{
    when: PlayerTurnStartInstruction,
    phase: 'post',
    filter: (instr) => instr.side === 'player' && unit.getEffectStacks('leak') > 0,
    react: (instr, ctx) => {
      const stacks = unit.getEffectStacks('leak');
      ctx.kernel.submitInstruction(
        new ConsumeManaInstruction({ amount: stacks }), instr);
      ctx.kernel.submitInstruction(
        new AddEffectInstruction({ target: unit, effectId: 'leak', stacks: -stacks }), instr);
    },
  }],
});

// 幻象（巨型妖蝶）：抽出的卡牌 AP 开销随机 −1/0/+1（妖蝶鳞粉的错觉——费用不可信）。
// 层数 = 持续回合数（玩家回合结束 −1，滞气同款时长语义）；开销扰动落在卡的 runtime
// 字段 apCostShift 上——结算（ConsumeSkillResources）/合法预检（canUseSkill）/费用徽章
// （projection）三处同源读它。每次抽牌重掷（覆盖旧值）：离手回库后再抽会重新摇，
// 幻象过期后抽到的卡不再携带。层数归零时扫清手牌中的残留扰动。
registerEffect({
  id: 'illusion',
  type: 'debuff',
  stacking: 'count',
  name: '幻象',
  description: '抽到的卡牌，AP 开销随机增减 0 或 1。回合结束时层数减少 1。',
  icon: '🦋',
  color: 'purple',
  subscriptions: (unit) => [
    {
      when: DrawCardsInstruction,
      phase: 'post',
      filter: () => unit.getEffectStacks('illusion') > 0,
      react: (instr, ctx) => {
        for (const card of instr.result?.drawn ?? []) {
          card.apCostShift = ctx.battleState.rng.pick([-1, 0, 1]);
        }
      },
    },
    {
      when: PlayerTurnEndInstruction,
      phase: 'post',
      react: (instr, ctx) => {
        const stacks = unit.getEffectStacks('illusion');
        ctx.kernel.submitInstruction(
          new AddEffectInstruction({ target: unit, effectId: 'illusion', stacks: -1 }), instr);
        if (stacks <= 1) {
          for (const card of ctx.battleState.zones.hand) card.apCostShift = 0;
        }
      },
    },
  ],
});

// 冲撞（仪仗铁卫）：攻击伤害提升当前护盾值的一半（以盾代攻——破盾直接削它的伤害，
// 读数实时跟随护盾）。与蓄势同为 DealDamage PRE 修正；固定伤害（payload 白名单为空）
// 不受影响。
registerEffect({
  id: 'ram',
  type: 'buff',
  stacking: 'count',
  name: '冲撞',
  description: '攻击伤害提升当前护盾值的一半。',
  icon: '🛡️',
  color: 'yellow',
  subscriptions: (unit) => [{
    when: DealDamageInstruction,
    phase: 'pre',
    filter: (instr) => instr.source === unit && !instr.fixed,
    react: (instr) => {
      const bonus = Math.floor(unit.shield / 2);
      if (bonus > 0) instr.setPayload('damage', instr.payload.damage + bonus);
    },
  }],
});

// 齐射（军号手）：攻击分为多段，段数等于当前存活友军数（含自身）——状态轨/图鉴展示件，
// 分段行为在敌人 act 里实现（效果系统不管攻击的段数结构）。
registerEffect({
  id: 'volley',
  type: 'buff',
  stacking: 'count',
  name: '齐射',
  description: '攻击分为多段，段数等于当前存活友军数（含自身）。',
  icon: '🎺',
  color: 'yellow',
});

// 灵体（公司刺客）：受到伤害时伤害置 1，层数 -1。固定伤害（tick 类，payload 不可修饰）
// 不受影响——燃烧/中毒照常全额跳伤。多段攻击逐段消耗层数。
registerEffect({
  id: 'phantom',
  type: 'buff',
  stacking: 'count',
  name: '灵体',
  description: '受到伤害时，将伤害置 1，层数减少 1。',
  icon: '👻',
  color: 'cyan',
  subscriptions: (unit) => [
    {
      when: DealDamageInstruction,
      phase: 'pre',
      filter: (instr) => instr.target === unit && !instr.fixed
        && unit.getEffectStacks('phantom') > 0 && instr.payload.damage > 1,
      react: (instr) => instr.setPayload('damage', 1),
    },
    {
      when: ApplyDamageInstruction,
      phase: 'post',
      filter: (instr) => instr.target === unit && (instr.result?.dealt ?? 0) > 0,
      react: (instr, ctx) => ctx.kernel.submitInstruction(
        new AddEffectInstruction({ target: unit, effectId: 'phantom', stacks: -1 }), instr),
    },
  ],
});

// 灵态：受到高于 1 点的实际伤害后获得灵体 1（通用机制，无自持——重置/永续类
// 保底是施加方的自身特性，写在其订阅里，不进词条）。净效果 = 每第二次伤害被
// 清理到 1。固定伤害（燃烧/中毒 tick）不受灵体的 PRE 减免，但「受到高于1伤害」
// 的判定含它——按实际落血判定，与灵体的消耗判定同口径。
registerEffect({
  id: 'spiritStance',
  type: 'buff',
  stacking: 'count',
  name: '灵态',
  description: '受到高于1点的伤害后，获得灵体1。',
  icon: '🌀',
  color: 'cyan',
  subscriptions: (unit) => [
    {
      when: ApplyDamageInstruction,
      phase: 'post',
      filter: (instr) => instr.target === unit && (instr.result?.dealt ?? 0) > 1,
      react: (instr, ctx) => ctx.kernel.submitInstruction(
        new AddEffectInstruction({ target: unit, effectId: 'phantom', stacks: 1 }), instr),
    },
  ],
});

// 杀手（杀手）：每有一张牌被打出，获得蓄势 1——出牌量税，速攻流的节奏对冲。
// 订阅玩家出牌指令 POST（嵌套强发也计入——被万变拳白嫖打出的牌同样是「被打出」）。
registerEffect({
  id: 'killer',
  type: 'buff',
  stacking: 'count',
  name: '杀手',
  description: '每有一张牌被打出，获得蓄势 1。',
  icon: '🗡️',
  color: 'red',
  subscriptions: (unit) => [{
    when: UseSkillInstruction,
    phase: 'post',
    react: (instr, ctx) => ctx.kernel.submitInstruction(
      new AddEffectInstruction({ target: unit, effectId: 'momentum', stacks: 1 }), instr),
  }],
});

// 干扰（灵御猎手）：每回复 1 魏启，向牌库洗入 1 张虚无——回蓝体系的对冲件
// （当前回蓝手段少近乎空转，回蓝卡补齐后是主要压力源）。按实际到账量计
//（result.gained，上限截断后），不是请求量。
registerEffect({
  id: 'interfere',
  type: 'debuff',
  stacking: 'count',
  name: '干扰',
  description: '每回复 1 魏启，向牌库洗入 1 张虚无。',
  icon: '📻',
  color: 'purple',
  subscriptions: () => [{
    when: GainManaInstruction,
    phase: 'post',
    react: (instr, ctx) => {
      const n = instr.result?.gained ?? 0;
      for (let i = 0; i < n; i++) {
        ctx.kernel.submitInstruction(new AddCardInstruction({
          defId: 'voidCard', toZone: 'deck', index: 'random',
        }), instr);
      }
    },
  }],
});
