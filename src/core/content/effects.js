import { registerEffect } from '../effects/registry.js';
import { TurnStartInstruction, TurnEndInstruction, PlayerTurnStartInstruction, PlayerTurnEndInstruction } from '../instructions/turn.js';
import { DealDamageInstruction, ApplyHealInstruction, GainShieldInstruction } from '../instructions/combat.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import { DrawCardsInstruction, DiscardCardInstruction } from '../instructions/cards.js';
import { GainManaInstruction } from '../instructions/resources.js';
import AIActInstruction from '../instructions/aiAct.js';

// 燃烧：自己阵营回合开始时受到等于层数的**固定伤害**（EFFECTS.md 2026-09 定调：
// 固定＝跳过修正与防御、护盾可挡，不穿透），然后层数 -1。
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
        fixed: true, tags: ['burn'],
      }), instr);
      ctx.kernel.submitInstruction(new AddEffectInstruction({
        target: unit, effectId: 'burn', stacks: -1,
      }), instr);
    },
  }],
});

// 格挡（体修·拆体系核心资源，BODY_CULTIVATION_CARDS §0）：buff 层数，≠ 护盾池。
// 受攻击时伤害减半（向下取整），层数 -1；扣尽由 AddEffect 通用逻辑注销订阅。
// 原型验证：test/posture.test.js（此处为正式落地，语义不变）。
registerEffect({
  id: 'block',
  type: 'buff',
  stacking: 'count',
  name: '格挡',
  description: '受到攻击时伤害减半，然后层数减少 1。',
  icon: '🛡️',
  color: 'blue',
  subscriptions: (unit) => [{
    when: DealDamageInstruction,
    phase: 'pre',
    // 固定伤害跳过修正步（F2），且其 payload 白名单为空——对 fixed 伤害调用 setPayload 会抛错
    filter: (instr) => instr.target === unit && !instr.fixed,
    react: (instr, ctx) => {
      instr.setPayload('damage', Math.floor(instr.payload.damage / 2));
      ctx.kernel.submitInstruction(
        new AddEffectInstruction({ target: unit, effectId: 'block', stacks: -1 }), instr);
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

// 荆棘：受到攻击时，攻击来源受到层数点普通伤害（走防御/护盾管线，可被挡；
// 无来源的环境伤害不反）。2026-09 定调：反伤不再穿透——穿透固定伤害过强。
// 敌我通用（针鼠竖刺 / 未来反伤遗物同语言）。定位与调参档位见 ENEMIES_1.md §4.1。
// ⚠️ 双方同时持有会互相递归（A 反 B、B 反 A…直到一方死亡，单次攻击内连锁结算完）：
// 做玩家侧反伤遗物前必须先定连锁策略（仅一方生效 / 限一次 / 限层数）。
registerEffect({
  id: 'thorns',
  type: 'buff',
  stacking: 'count',
  name: '荆棘',
  description: '受到攻击时，对攻击者造成层数点伤害（可被护盾抵挡）。',
  icon: '🌵',
  color: 'green',
  subscriptions: (unit) => [{
    when: DealDamageInstruction,
    phase: 'post',
    filter: (instr) => instr.target === unit && instr.source && !instr.source.isDead(),
    react: (instr, ctx) => {
      const stacks = unit.getEffectStacks('thorns');
      if (stacks <= 0) return;
      ctx.kernel.submitInstruction(new DealDamageInstruction({
        source: unit, target: instr.source, amount: stacks, tags: ['thorns'],
      }), instr);
    },
  }],
});

// 蓄势：每层攻击 +1（纯读轨标记，滚雪球压力源——暗影刺客等蓄力型敌人用）。
registerEffect({
  id: 'focus',
  type: 'buff',
  stacking: 'count',
  statModifiers: {
    attack: (stacks) => stacks,
  },
  name: '蓄势',
  description: '每层使攻击提高 1 点。',
  icon: '⚡',
  color: 'yellow',
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
    when: DealDamageInstruction,
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
registerEffect({
  id: 'flameDemon',
  type: 'buff',
  stacking: 'count',
  name: '炎魔',
  description: '造成伤害时，赋予伤害对象燃烧1。',
  icon: '👹',
  color: 'red',
  subscriptions: (unit) => [{
    when: DealDamageInstruction,
    phase: 'post',
    filter: (instr) => instr.source === unit && !unit.isDead()
      && !instr.tags?.includes('burn') && !instr.target.isDead(),
    react: (instr, ctx) => {
      ctx.kernel.submitInstruction(new AddEffectInstruction({
        target: instr.target, effectId: 'burn', stacks: unit.getEffectStacks('flameDemon'),
      }), instr);
    },
  }],
});

// 中毒（EFFECTS.md，2026-09 定调）：回合结束时受到层数点**穿透伤害**（防御与护盾
// 都不减免），然后层数 -1。与燃烧的区别：回合末结算 + 穿透（燃烧为固定伤害、护盾可挡）。
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
        source: null, target: unit, amount: stacks, pierce: true, tags: ['poison'],
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
// 打出呼吸卡即获得对应效果：效果自带「弃牌 POST」监听——每弃 1 牌抽 1/层
// （武者/完美另加格挡与力量各层数层）。正面增益：监听器生命周期与效果实例绑定
// （首获挂载 / 扣尽注销），敌方清除增益时随层数一并拆除；回合末自行消散
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

function registerBreathEffect({ id, name, enhanced }) {
  registerEffect({
    id, type: 'buff', stacking: 'count', name,
    description: enhanced
      ? '本回合内每弃 1 张牌：抽 1 张牌、获得格挡与力量各 1 层（每层各 1）。回合结束时消散。'
      : '本回合内每弃 1 张牌：抽 1 张牌（每层 1 张）。回合结束时消散。',
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
        if (enhanced) {
          ctx.kernel.submitInstruction(new AddEffectInstruction({
            target: unit, effectId: 'block', stacks,
          }), instr);
          ctx.kernel.submitInstruction(new AddEffectInstruction({
            target: unit, effectId: 'strength', stacks,
          }), instr);
        }
      },
    }, clearsAtPlayerTurnEnd(id)(unit)],
  });
}
registerBreathEffect({ id: 'breath', name: '呼吸', enhanced: false });
registerBreathEffect({ id: 'warriorBreath', name: '武者呼吸', enhanced: true });
registerBreathEffect({ id: 'perfectBreath', name: '完美呼吸', enhanced: true });

// 治疗（EFFECTS.md 2026-09 新增）：回合开始时恢复层数点生命，失去所有层数——
// 与再生的区别是整取清零（一次结清而非逐层递减），午休的「醒来回血」账单。
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
registerEffect({
  id: 'dodge',
  type: 'buff',
  stacking: 'count',
  name: '闪避',
  description: '免疫下一次攻击，然后层数减少 1。',
  icon: '💨',
  color: 'cyan',
  subscriptions: (unit) => [{
    when: DealDamageInstruction,
    phase: 'pre',
    filter: (instr) => instr.target === unit
      && instr.source
      && !instr.tags?.includes('burn')
      && !instr.tags?.includes('poison'),
    react: (instr, ctx) => ctx.kernel.veto(instr, 'dodge', [
      new AddEffectInstruction({ target: unit, effectId: 'dodge', stacks: -1 }),
    ]),
  }],
});

// 晕眩（EFFECTS.md 2026-09 新增）：回合行动时跳过行动，层数 -1。
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

// 引线：纯标记层数——爆囊的亡语伤害 = 6 + 3×层数（无自身订阅，只被 def.onDeath 读）。
// 用效果而不是私有字段，是为了走统一的层数显示/结算与「层数变更」订阅语言。
registerEffect({
  id: 'blastFuse',
  type: 'buff',
  stacking: 'count',
  name: '引线',
  description: '死亡时爆炸伤害 +3/层（爆囊亡语）。',
  icon: '🧨',
  color: 'red',
});

// 奇迹（2026-09 用户定，塞西莉亚体系通用机制）：生命拒绝降到 0 或以下——minHp 地板 = 1
// 走 getStat 读轨，与伤害管线同源、不特判。
// 自己回合结束时层数 -1；**层数归零 = 奇迹终结 = 死亡**。
// 归零结算顺序不可颠倒：先由 AddEffect 摘掉地板（层数归零同时注销本订阅），再以 fixed
// 伤害直落 0——反过来的话地板会把致命伤再挡回 1，永远死不掉。
// 归零死亡带 tags:['miracle']：塞西莉亚之恩赐的「致命拦截」按此标记豁免，否则
// 「延迟死亡 → 奇迹耗尽 → 又被拦截」会自我续命成不死。
// 同一效果供两处复用：遗物「塞西莉亚之恩赐」（奇迹1）与旧版技能「塞西莉亚奇迹」（奇迹3）。
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
        // 护盾先吸掉 shield、余额正好打空生命）。
        ctx.kernel.submitInstruction(new DealDamageInstruction({
          source: null, target: unit, amount: unit.hp + unit.shield,
          fixed: true, tags: ['miracle'],
        }), instr);
      }
    },
  }],
});

// ---- 脆弱 / 伤残（EFFECTS.md §负面效果；2026-09-11 实装）----
// 这两个是老虎机「恶魔 roll」也需要的通用负面效果，遗物「老旧的战术目镜」先用上。

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
    when: DealDamageInstruction,
    phase: 'pre',
    filter: (instr) => instr.target === unit && !instr.fixed,
    react: (instr) => {
      const stacks = unit.getEffectStacks('maim');
      if (stacks > 0) instr.setPayload('damage', instr.payload.damage + stacks);
    },
  }],
});
