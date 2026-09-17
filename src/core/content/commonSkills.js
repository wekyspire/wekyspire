// 通用单卡（COMMON_CARDS.md：所有体系共享的灰色单卡，看作体修体系）。
// 两组语言：
//   汲取 = 魏启获取（纳气存气 + 护盾/AP 代价），跨战斗资源引擎的战斗内表达；
//   激发 = 魏启 → AP 的即时转换（AP 获取不受上限截断，爆发蓄能语义）。
// 魏启罐系列无费用无冷却，纯消耗品（纳气 N，打出即焚）。
// §2 散卡：杂技（下一张进入牌库的卡抽回手牌）。

import { registerSkill } from '../skills/registry.js';
import { zoneOf } from '../state/battleState.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import { DealDamageInstruction, GainShieldInstruction, ApplyHealInstruction } from '../instructions/combat.js';
import { GainActionPointsInstruction, GainManaInstruction } from '../instructions/resources.js';
import { PlayerTurnEndInstruction } from '../instructions/turn.js';
import {
  AddCardInstruction, DiscardCardInstruction, MoveCardInstruction, TransformCardInstruction,
  DrawCardsInstruction,
} from '../instructions/cards.js';
import { UseSkillInstruction } from '../instructions/skill.js';

// ---- 状态卡（敌方塞入，非奖励池）----

// 灼伤（燃焰术士塞入的状态牌，2026-09-13 用户设计）：无法打出；回合结束时若还在
// 手牌中，受到 2 点固定伤害。塞的是「牌库」——抽到手上才开始计时；dump（付费弃牌）
// 与焚毁类处理卡是它的两个出口。Z 阶 + canSpawnAsReward:false 双保险永不入奖励池。
registerSkill({
  id: 'burnWound', name: '灼伤', type: 'normal', tier: 'Z',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  canSpawnAsReward: false,
  canUse: () => false, // 无法打出（状态牌；why 诊断走 def.canUse 分支点名）
  use() { return true; },
  subscriptions: (sctx) => [{
    when: PlayerTurnEndInstruction, phase: 'post',
    filter: (instr, ctx) => zoneOf(ctx.battleState, sctx.self.uniqueID) === 'hand',
    react: (instr, ctx) => ctx.kernel.submitInstruction(new DealDamageInstruction({
      source: null, target: ctx.player, amount: 2, fixed: true, tags: ['burnWound'],
    }), instr),
  }],
  describe: () => '无法打出。回合结束时，若此卡在手牌中，受到2点伤害',
});

// 迷眼粉尘（嗡嗡虫塞入的状态牌，2026-09-14 章1「塔基爆发」）：灼伤的**轻量版**
// （1 伤，第一章口径）——无法打出，回合结束时若还在手牌中受到 1 点固定伤害。
// 与粘液（软卡手：1AP 抽 1 的处理税）构成两档卡手语言；dump 弃牌与焚毁类是它的出口。
registerSkill({
  id: 'dustCloud', name: '迷眼粉尘', type: 'normal', tier: 'Z',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  canSpawnAsReward: false,
  canUse: () => false,
  use() { return true; },
  subscriptions: (sctx) => [{
    when: PlayerTurnEndInstruction, phase: 'post',
    filter: (instr, ctx) => zoneOf(ctx.battleState, sctx.self.uniqueID) === 'hand',
    react: (instr, ctx) => ctx.kernel.submitInstruction(new DealDamageInstruction({
      source: null, target: ctx.player, amount: 1, fixed: true, tags: ['dustCloud'],
    }), instr),
  }],
  describe: () => '无法打出。回合结束时，若此卡在手牌中，受到1点伤害',
});

// 墨渍（第四章高压敌塞入的状态牌，2026-09-14 用户设计）：灼伤同款口径、数值加重一档
// （在手回合末受 3 伤）——档案馆巨像/墨海母核的持续干扰件。处理出口同为 dump/焚毁。
registerSkill({
  id: 'inkBlot', name: '墨渍', type: 'normal', tier: 'Z',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  canSpawnAsReward: false,
  canUse: () => false,
  use() { return true; },
  subscriptions: (sctx) => [{
    when: PlayerTurnEndInstruction, phase: 'post',
    filter: (instr, ctx) => zoneOf(ctx.battleState, sctx.self.uniqueID) === 'hand',
    react: (instr, ctx) => ctx.kernel.submitInstruction(new DealDamageInstruction({
      source: null, target: ctx.player, amount: 3, fixed: true, tags: ['inkBlot'],
    }), instr),
  }],
  describe: () => '无法打出。回合结束时，若此卡在手牌中，受到3点伤害',
});

// 活页（装订巨蟒塞入的重物牌，2026-09-14 用户设计「开局塞大卡」）：不是纯死重——
// 2AP 打出可自伤 4 换抽 2，是「付代价的清障选择」：留着占手牌位挤容量，打掉付血换过牌。
// 消耗（打出即焚）；Z 阶 + canSpawnAsReward:false 双保险永不入奖励池。
registerSkill({
  id: 'looseLeaf', name: '活页', type: 'normal', tier: 'Z',
  keywords: ['exhaust'],
  cost: { mana: 0, actionPoint: 2 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  canSpawnAsReward: false,
  use(sctx) {
    sctx.kernel.submitInstruction(new DealDamageInstruction({
      source: null, target: sctx.player, amount: 4, fixed: true, tags: ['looseLeaf'],
    }));
    sctx.kernel.submitInstruction(new DrawCardsInstruction({ count: 2, reason: 'looseLeaf' }));
    return true;
  },
  describe: () => '消耗。自伤4，抽2',
});

// ---- 汲取·纯化线（MP 换纳气 + 护盾）----

// 纯化（汲取 D）：1MP，冷却1：纳气2，3护盾。
registerSkill({
  id: 'purify', name: '纯化', type: 'normal', pack: 'common', tier: 'D',
  cost: { mana: 1, actionPoint: 0 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  promotesTo: 'deepPurify',
  use(sctx) {
    sctx.kernel.submitInstruction(new AddEffectInstruction({ target: sctx.player, effectId: 'naqi', stacks: 2 }));
    sctx.kernel.submitInstruction(new GainShieldInstruction({ target: sctx.player, amount: 3 }));
    return true;
  },
  describe: () => '/effect{纳气}2，3护盾',
});

// 深度纯化（汲取 C）：1MP，冷却1：纳气2，7护盾。
registerSkill({
  id: 'deepPurify', name: '深度纯化', type: 'normal', pack: 'common', tier: 'C',
  cost: { mana: 1, actionPoint: 0 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  use(sctx) {
    sctx.kernel.submitInstruction(new AddEffectInstruction({ target: sctx.player, effectId: 'naqi', stacks: 2 }));
    sctx.kernel.submitInstruction(new GainShieldInstruction({ target: sctx.player, amount: 7 }));
    return true;
  },
  describe: () => '/effect{纳气}2，7护盾',
});

// 萃取（汲取 C）：3MP，冷却1：纳气4，12护盾。
registerSkill({
  id: 'extract', name: '萃取', type: 'normal', pack: 'common', tier: 'C',
  cost: { mana: 3, actionPoint: 0 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  promotesTo: 'deepExtract',
  use(sctx) {
    sctx.kernel.submitInstruction(new AddEffectInstruction({ target: sctx.player, effectId: 'naqi', stacks: 4 }));
    sctx.kernel.submitInstruction(new GainShieldInstruction({ target: sctx.player, amount: 12 }));
    return true;
  },
  describe: () => '/effect{纳气}4，12护盾',
});

// 深度萃取（汲取 B）：3MP，冷却1：纳气5，12护盾。
registerSkill({
  id: 'deepExtract', name: '深度萃取', type: 'normal', pack: 'common', tier: 'B',
  cost: { mana: 3, actionPoint: 0 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  use(sctx) {
    sctx.kernel.submitInstruction(new AddEffectInstruction({ target: sctx.player, effectId: 'naqi', stacks: 5 }));
    sctx.kernel.submitInstruction(new GainShieldInstruction({ target: sctx.player, amount: 12 }));
    return true;
  },
  describe: () => '/effect{纳气}5，12护盾',
});

// ---- 汲取·汲取线（AP 换纳气，长冷却）----

// 汲取（C）：1AP，冷却3：纳气2。
registerSkill({
  id: 'drawQi', name: '汲取', type: 'normal', pack: 'common', tier: 'C',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 3 },
  cardMode: 'normal',
  promotesTo: 'squeezeQi',
  use(sctx) {
    sctx.kernel.submitInstruction(new AddEffectInstruction({ target: sctx.player, effectId: 'naqi', stacks: 2 }));
    return true;
  },
  describe: () => '/effect{纳气}2',
});

// 压榨（B）：1AP，冷却3：纳气3。
registerSkill({
  id: 'squeezeQi', name: '压榨', type: 'normal', pack: 'common', tier: 'B',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 3 },
  cardMode: 'normal',
  use(sctx) {
    sctx.kernel.submitInstruction(new AddEffectInstruction({ target: sctx.player, effectId: 'naqi', stacks: 3 }));
    return true;
  },
  describe: () => '/effect{纳气}3',
});

// ---- 魏启罐系列（无费用消耗品：纳气 N）----

const manaJar = (id, name, tier, stacks) => registerSkill({
  id, name, type: 'normal', pack: 'common', tier,
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  keywords: ['exhaust'],
  use(sctx) {
    sctx.kernel.submitInstruction(new AddEffectInstruction({ target: sctx.player, effectId: 'naqi', stacks }));
    return true;
  },
  describe: () => `/effect{纳气}${stacks}`,
});
manaJar('manaJar', '魏启罐', 'D', 1);
manaJar('manaJarPlus', '高级魏启罐', 'C', 2);
manaJar('manaJarUltra', '极品魏启罐', 'B', 3);
manaJar('manaJarRoyal', '冉牌魏启罐', 'A', 5);
manaJar('manaJarLegend', '何猥魏启罐', 'S', 12);

// ---- 激发系列（魏启 → AP 即时转换，消耗）----

const stimulant = (id, name, tier, mana, ap) => registerSkill({
  id, name, type: 'normal', pack: 'common', tier,
  cost: { mana, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  keywords: ['exhaust'],
  use(sctx) {
    sctx.kernel.submitInstruction(new GainActionPointsInstruction({ amount: ap }));
    return true;
  },
  describe: () => `获得${ap}行动点`,
});
stimulant('stimulant', '激发', 'C', 2, 2);
stimulant('burstStimulant', '爆发', 'B', 2, 4);
stimulant('fullStimulant', '充分激发', 'B', 1, 2);

// ---- 灵能护盾系列（MP 换纯护盾，2026-09 设计稿新增）----

// 灵力护盾 C / 灵能护盾 B：2MP，冷却1：10/16 护盾。通用包的纯防御位——
// 无纳气、无格挡，性价比随等阶拉开。2026-09-17 用户定削 2（原 12/18）。
const psiShield = (id, name, tier, shield, promotesTo) => registerSkill({
  id, name, type: 'normal', pack: 'common', tier,
  cost: { mana: 2, actionPoint: 0 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  promotesTo,
  use(sctx) {
    sctx.kernel.submitInstruction(new GainShieldInstruction({ target: sctx.player, amount: shield }));
    return true;
  },
  describe: () => `${shield}护盾`,
});
psiShield('psiShield', '灵力护盾', 'C', 10, 'greaterPsiShield');
psiShield('greaterPsiShield', '灵能护盾', 'B', 16);

// ---- §2 散卡 ----

// 杂技（A，1AP）：下一张进入牌库的卡抽回手牌。
// 「进入牌库」覆盖三条主要路径：打出的卡收尾回库（UseSkill POST）、弃牌回库
// （DiscardCard POST）、造牌/移动回库（AddCard / MoveCard POST）。登记一组监听，
// 首次命中即把该卡从牌库移入手牌，并注销其余监听（owner 统一，命中后清干净）。
// 排除自身：杂技收尾同样回库，不能把自己捞回来。
registerSkill({
  id: 'acrobatics', name: '杂技', type: 'normal', pack: 'common', tier: 'A',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  use(sctx) {
    const owner = `acrobatics:${sctx.self.uniqueID}`;
    let pulled = false;
    const pull = (card, ctx, parent) => {
      if (pulled || !card || card.uniqueID === sctx.self.uniqueID) return;
      if (zoneOf(ctx.battleState, card.uniqueID) !== 'deck') return;
      pulled = true;
      ctx.kernel.submitInstruction(
        new MoveCardInstruction({ uniqueID: card.uniqueID, toZone: 'hand' }), parent);
      ctx.kernel.removeSubscriptionsByOwner(owner);
    };
    const watchers = [
      [UseSkillInstruction, (instr) => instr.skill],
      [DiscardCardInstruction, (instr) => instr.result?.card],
      [AddCardInstruction, (instr) => instr.result?.card],
      [MoveCardInstruction, (instr) => (instr.result?.toZone === 'deck' ? instr.result?.card : null)],
    ];
    for (const [when, pick] of watchers) {
      sctx.kernel.addSubscription({
        when, phase: 'post', owner,
        react: (instr, ctx) => pull(pick(instr), ctx, instr),
      });
    }
    return true;
  },
  describe: () => '下一张进入牌库的卡抽回手牌',
});

// 早有防备（C，1MP，消耗，固有）：起手在手的 9 护盾（先手防御位；固有开局直接
// 入手，不占初始抽牌位）。
registerSkill({
  id: 'prePrepared', name: '早有防备', type: 'normal', pack: 'common', tier: 'C',
  cost: { mana: 1, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  keywords: ['exhaust', 'innate'],
  use(sctx) {
    sctx.kernel.submitInstruction(new GainShieldInstruction({ target: sctx.player, amount: 9 }));
    return true;
  },
  describe: () => '9护盾',
});

// 盼盼小面包（C，1AP，消耗）：恢复 3 生命（即时治疗，走 ApplyHeal 管线）。
registerSkill({
  id: 'panpanBread', name: '盼盼小面包', type: 'normal', pack: 'common', tier: 'C',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  keywords: ['exhaust'],
  use(sctx) {
    sctx.kernel.submitInstruction(new ApplyHealInstruction({ target: sctx.player, amount: 3 }));
    return true;
  },
  describe: () => '恢复3生命',
});

// 午休（D，消耗）：晕眩1，治疗8。设计稿未写费用 → 0 费。代价语言：跳过下一次
// 行动阶段换一张大治疗账单——「治疗」是效果（回合开始整取回血后清零，见
// content/effects.js），与晕眩同在下一回合开始生效：睡这一觉 = 下回合动不了，
// 醒来时回 8 点。
registerSkill({
  id: 'noonNap', name: '午休', type: 'normal', pack: 'common', tier: 'D',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  keywords: ['exhaust'],
  use(sctx) {
    sctx.kernel.submitInstruction(new AddEffectInstruction({ target: sctx.player, effectId: 'stun', stacks: 1 }));
    sctx.kernel.submitInstruction(new AddEffectInstruction({ target: sctx.player, effectId: 'mend', stacks: 8 }));
    return true;
  },
  describe: () => '/effect{晕眩}1，/effect{治疗}8',
});

// ---- 高速魏启罐系列（2026-09-12 设计稿新增）----
// 与上面「魏启罐」的区别：**即时回蓝**（GainMana，走上限截断）而不是「纳气」（下回合开始整取）。
// 无费用、无冷却、消耗——纯应急燃料（同阶比纳气罐少 1 点量，换"现在就能用"）。
const swiftManaJar = (id, name, tier, amount) => registerSkill({
  id, name, type: 'normal', pack: 'common', tier,
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  keywords: ['exhaust'],
  use(sctx) {
    sctx.kernel.submitInstruction(new GainManaInstruction({ amount }));
    return true;
  },
  describe: () => `获得${amount}魏启`,
});
swiftManaJar('swiftManaJar', '高速魏启罐', 'B', 2);
swiftManaJar('swiftManaJarPlus', '高速大魏启罐', 'A', 4);

// ---- HeLiCoPtEr（A，消耗，2026-09-12 设计稿新增）----
// 「将所有手牌变换为 0 开销**猛烈肘击**」：逐张 TransformCardInstruction（换绑 defId，
// keepPower 延续；与斩链的局内转化同一指令）→ 目标卡 = 肘击系列的免费形态
// `fierceElbowFree`（0 费咏唱1、P5 随机伤害、伤害带 `elbow` 标记**吃牢大翻倍**，
// 只在 bodySkills.js 里定义、不进奖励池）。整套牌因此被肘击稀释——放弃体系协同换
// 「一手法师肘」的整活构筑（牢大 + HeLiCoPtEr 是设计上的梗组合）。
registerSkill({
  id: 'helicopter', name: 'HeLiCoPtEr', type: 'normal', pack: 'common', tier: 'A',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  keywords: ['exhaust'],
  use(sctx) {
    // 快照手牌（变换会把卡暂迁 pending，边遍历边转会错位）。
    // ⚠ **已激活的咏唱不转化**：激活咏唱发动后回手点亮、常驻手中（如「牢大」），
    // 把它们一起换掉 = 当场拆掉自己的引擎——而这张牌的梗组合恰恰是「牢大 + 一手法师肘」。
    const hand = [...sctx.battleState.zones.hand].filter(c => !c.isActivated);
    for (const card of hand) {
      sctx.kernel.submitInstruction(
        new TransformCardInstruction({ uniqueID: card.uniqueID, toDefId: 'fierceElbowFree' }),
      );
    }
    return true;
  },
  describe: () => '将手中未激活的牌变换为0开销/named{猛烈肘击}',
  battleDescribe: (sctx) => '将手中未激活的牌变换为0开销/named{猛烈肘击}'
    + `（当前可变换${sctx.battleState.zones.hand.filter(c => !c.isActivated).length}张）`,
});
