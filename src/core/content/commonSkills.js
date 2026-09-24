// 通用单卡（COMMON_CARDS.md：所有体系共享的灰色单卡，看作体修体系）。
// 两组语言：
//   汲取 = 魏启获取（纳气存气 + 护盾/AP 代价），跨战斗资源引擎的战斗内表达；
//   激发 = 魏启 → AP 的即时转换（AP 获取不受上限截断，爆发蓄能语义）。
// 魏启罐系列无费用无冷却，纯消耗品（纳气 N，打出即焚）。
// §2 散卡：杂技（下一张进入牌库的卡抽回手牌）。

import { registerSkill } from '../skills/registry.js';
import { enemyTarget } from './skills.js';
import { zoneOf } from '../state/battleState.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import { DealDamageInstruction, GainShieldInstruction, ApplyHealInstruction } from '../instructions/combat.js';
import { GainActionPointsInstruction, GainManaInstruction } from '../instructions/resources.js';
import { PlayerTurnEndInstruction } from '../instructions/turn.js';
import {
  AddCardInstruction, DiscardCardInstruction, MoveCardInstruction, TransformCardInstruction,
  DrawCardsInstruction,
} from '../instructions/cards.js';
import { UseSkillInstruction, SkillCooldownInstruction } from '../instructions/skill.js';
import { ChantTriggerInstruction } from '../instructions/turn.js';
import { applyBattleModifier } from '../run/prep.js';
import { requestHandSelection, selected } from './cardKit.js';

// ---- 状态卡（敌方塞入，非奖励池）----

// 灼伤（燃焰术士塞入的状态牌，2026-09-13 用户设计）：无法打出；回合结束时若还在
// 手牌中，受到 2 点固定伤害。塞的是「牌库」——抽到手上才开始计时；dump（付费弃牌）
// 与焚毁类处理卡是它的两个出口。Z 阶 + canSpawnAsReward:false 双保险永不入奖励池。
registerSkill({
  id: 'burnWound', image: 'burnWound', name: '灼伤', type: 'normal', tier: 'Z',
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
  id: 'dustCloud', image: 'dustCloud', name: '迷眼粉尘', type: 'normal', tier: 'Z',
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
  id: 'inkBlot', image: 'inkBlot', name: '墨渍', type: 'normal', tier: 'Z',
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
  id: 'looseLeaf', image: 'looseLeaf', name: '活页', type: 'normal', tier: 'Z',
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
  describe: () => '自伤4，抽2',
});

// 躲闪（神兵躯壳二阶段【回忆】洗入牌库 7 张的答案牌，2026-09-20 用户设计稿）：
// 1AP，消耗——令神兵的下次扫射段数 -2（层数标记「弹道干扰」）。
// 终塔 Boss 的扫射是**段数伤害**：护盾/格挡按段分摊，单发大盾吃得下，段数多才要命——
// 所以答案不在「更厚的盾」而在「按段拆」。同一张卡也是**污染**（7 张稀释牌库，
// 打出即焚、用一次少一张）——答案自带代价，这是它与「塞废牌」型 Boss 机制的镜像。
// Z 阶 + canSpawnAsReward:false 双保险永不入奖励池。
registerSkill({
  id: 'sidestep', image: 'sidestep', name: '躲闪', type: 'normal', tier: 'Z',
  keywords: ['exhaust'],
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'enemy',
  canSpawnAsReward: false,
  use(sctx) {
    const target = enemyTarget(sctx); // 无存活敌人（收尾拍）时静默落空
    if (target) {
      sctx.kernel.submitInstruction(new AddEffectInstruction({
        target, effectId: 'scatterJam', stacks: 1, // 1 张 = 1 层 = 下次扫射 -2 段
      }));
    }
    return true;
  },
  describe: () => '令神兵的下次扫射次数下降2',
});

// ---- 汲取·纯化线（MP 换纳气 + 护盾）----
// 2026-09-21 大调（COMMON_CARDS 定稿）：纯化 D→C，深度纯化 C→B 且护盾 7→5，
// 补 A 档极致纯化（纳气2，7护盾）。

// 纯化（C）：1MP，冷却1：纳气2，3护盾。
registerSkill({
  id: 'purify', image: 'purify', name: '纯化', type: 'normal', pack: 'common', tier: 'C',
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

// 深度纯化（B）：1MP，冷却1：纳气2，5护盾。
registerSkill({
  id: 'deepPurify', image: 'purify', name: '深度纯化', type: 'normal', pack: 'common', tier: 'B',
  cost: { mana: 1, actionPoint: 0 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  promotesTo: 'peakPurify',
  use(sctx) {
    sctx.kernel.submitInstruction(new AddEffectInstruction({ target: sctx.player, effectId: 'naqi', stacks: 2 }));
    sctx.kernel.submitInstruction(new GainShieldInstruction({ target: sctx.player, amount: 5 }));
    return true;
  },
  describe: () => '/effect{纳气}2，5护盾',
});

// 极致纯化（A）：1MP，冷却1：纳气2，7护盾。
registerSkill({
  id: 'peakPurify', image: 'purify', name: '极致纯化', type: 'normal', pack: 'common', tier: 'A',
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

// 萃取（C）：3MP，冷却1：纳气4，5护盾。
registerSkill({
  id: 'extract', image: 'extract', name: '萃取', type: 'normal', pack: 'common', tier: 'C',
  cost: { mana: 3, actionPoint: 0 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  promotesTo: 'deepExtract',
  use(sctx) {
    sctx.kernel.submitInstruction(new AddEffectInstruction({ target: sctx.player, effectId: 'naqi', stacks: 4 }));
    sctx.kernel.submitInstruction(new GainShieldInstruction({ target: sctx.player, amount: 5 }));
    return true;
  },
  describe: () => '/effect{纳气}4，5护盾',
});

// 深度萃取（B）：3MP，冷却1：纳气4，7护盾。
registerSkill({
  id: 'deepExtract', image: 'extract', name: '深度萃取', type: 'normal', pack: 'common', tier: 'B',
  cost: { mana: 3, actionPoint: 0 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  promotesTo: 'limitExtract',
  use(sctx) {
    sctx.kernel.submitInstruction(new AddEffectInstruction({ target: sctx.player, effectId: 'naqi', stacks: 4 }));
    sctx.kernel.submitInstruction(new GainShieldInstruction({ target: sctx.player, amount: 7 }));
    return true;
  },
  describe: () => '/effect{纳气}4，7护盾',
});

// 极限萃取（A）：3MP，冷却1：纳气5，7护盾。
registerSkill({
  id: 'limitExtract', image: 'extract', name: '极限萃取', type: 'normal', pack: 'common', tier: 'A',
  cost: { mana: 3, actionPoint: 0 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal',
  use(sctx) {
    sctx.kernel.submitInstruction(new AddEffectInstruction({ target: sctx.player, effectId: 'naqi', stacks: 5 }));
    sctx.kernel.submitInstruction(new GainShieldInstruction({ target: sctx.player, amount: 7 }));
    return true;
  },
  describe: () => '/effect{纳气}5，7护盾',
});

// ---- 汲取·汲取线（AP 换纳气，长冷却）----
// 2026-09-21 大调：C 汲取冷却 3→4、纳气 2→1；补 B 档（同名汲取，冷却3）；
// 压榨 B→A、纳气 3→2。

// 汲取（C）：1AP，冷却4：纳气1。
// 汲取（B）：1AP，冷却3：纳气1。
// 压榨（A）：1AP，冷却3：纳气2。
const drawQiCard = (id, name, tier, cooldown, stacks, promotesTo = null) => registerSkill({
  id, name, type: 'normal', pack: 'common', tier,
  image: 'drawQi',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: cooldown },
  cardMode: 'normal',
  promotesTo,
  use(sctx) {
    sctx.kernel.submitInstruction(new AddEffectInstruction({ target: sctx.player, effectId: 'naqi', stacks }));
    return true;
  },
  describe: () => `/effect{纳气}${stacks}`,
});
drawQiCard('drawQi', '汲取', 'C', 4, 1, 'drawQiPlus');
drawQiCard('drawQiPlus', '汲取', 'B', 3, 1, 'squeezeQi');
drawQiCard('squeezeQi', '压榨', 'A', 3, 2);

// ---- 魏启罐系列（无费用消耗品：纳气 N）----
// 2026-09-21 大调：魏启罐 D→C 纳气 1→2、高级 C→B 纳气 2→3、冉牌 5→4、何猥 12→8；
// 极品魏启罐（manaJarUltra）从设计稿移除，删卡。

const manaJar = (id, name, tier, stacks) => registerSkill({
  id, name, type: 'normal', pack: 'common', tier,
  image: 'manaJar',
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
manaJar('manaJar', '魏启罐', 'C', 2);
manaJar('manaJarPlus', '高级魏启罐', 'B', 3);
manaJar('manaJarRoyal', '冉牌魏启罐', 'A', 4);
manaJar('manaJarLegend', '何猥魏启罐', 'S', 8);

// ---- 激发系列（魏启 → AP 即时转换，消耗）----
// 2026-09-21 大调：激发 C→B；爆发 B→A 且 4AP→3AP；充分激发 B→A。

const stimulant = (id, name, tier, mana, ap) => registerSkill({
  id, name, type: 'normal', pack: 'common', tier,
  image: 'stimulant',
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
stimulant('stimulant', '激发', 'B', 2, 2);
stimulant('burstStimulant', '爆发', 'A', 2, 3);
stimulant('fullStimulant', '充分激发', 'A', 1, 2);

// ---- 灵能护盾系列（MP 换纯护盾）----
// 灵力护盾 C / 灵能护盾 B：2MP，冷却1：10/14 护盾（2026-09-21 大调：B 档 16→14）。
// 通用包的纯防御位——无纳气、无格挡，性价比随等阶拉开。
const psiShield = (id, name, tier, shield, promotesTo) => registerSkill({
  id, name, type: 'normal', pack: 'common', tier,
  image: 'psiShield',
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
psiShield('greaterPsiShield', '灵能护盾', 'B', 14);

// ---- §2 散卡 ----

// 杂技（A，1AP）：下一张进入牌库的卡抽回手牌。
// 「进入牌库」覆盖三条主要路径：打出的卡收尾回库（UseSkill POST）、弃牌回库
// （DiscardCard POST）、造牌/移动回库（AddCard / MoveCard POST）。登记一组监听，
// 首次命中即把该卡从牌库移入手牌，并注销其余监听（owner 统一，命中后清干净）。
// 排除自身：杂技收尾同样回库，不能把自己捞回来。
registerSkill({
  id: 'acrobatics', image: 'acrobatics', name: '杂技', type: 'normal', pack: 'common', tier: 'A',
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

// 早有防备 C/B/A（1MP，消耗，固有）：起手在手的 9/11/13 护盾（先手防御位；
// 固有开局直接入手，不占初始抽牌位）。2026-09-21 大调补 B/A 档成链。
const prePreparedCard = (id, tier, shield, promotesTo = null) => registerSkill({
  id, name: '早有防备', type: 'normal', pack: 'common', tier,
  image: 'prePrepared',
  cost: { mana: 1, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  keywords: ['exhaust', 'innate'],
  promotesTo,
  use(sctx) {
    sctx.kernel.submitInstruction(new GainShieldInstruction({ target: sctx.player, amount: shield }));
    return true;
  },
  describe: () => `${shield}护盾`,
});
prePreparedCard('prePrepared', 'C', 9, 'prePreparedPlus');
prePreparedCard('prePreparedPlus', 'B', 11, 'prePreparedA');
prePreparedCard('prePreparedA', 'A', 13);

// 盼盼小面包 C/B/A（1AP，消耗）：恢复 3/4/5 生命（即时治疗，走 ApplyHeal 管线）。
// 2026-09-21 大调补 B/A 档成链。
const panpanBreadCard = (id, tier, heal, promotesTo = null) => registerSkill({
  id, name: '盼盼小面包', type: 'normal', pack: 'common', tier,
  image: 'panpanBread',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  keywords: ['exhaust'],
  promotesTo,
  use(sctx) {
    sctx.kernel.submitInstruction(new ApplyHealInstruction({ target: sctx.player, amount: heal }));
    return true;
  },
  describe: () => `恢复${heal}生命`,
});
panpanBreadCard('panpanBread', 'C', 3, 'panpanBreadPlus');
panpanBreadCard('panpanBreadPlus', 'B', 4, 'panpanBreadA');
panpanBreadCard('panpanBreadA', 'A', 5);

// 午休 C/B/A（消耗，设计稿未写费用 → 0 费）：晕眩1，治疗8/11/14。
// 代价语言：跳过下一次行动阶段换一张大治疗账单——「治疗」是效果（回合开始整取回血后
// 清零，见 content/effects.js），与晕眩同在下一回合开始生效：睡这一觉 = 下回合动不了。
// 2026-09-21 大调：D→C 并补 B/A 档成链。
const noonNapCard = (id, tier, mend, promotesTo = null) => registerSkill({
  id, name: '午休', type: 'normal', pack: 'common', tier,
  image: 'noonNap',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  keywords: ['exhaust'],
  promotesTo,
  use(sctx) {
    sctx.kernel.submitInstruction(new AddEffectInstruction({ target: sctx.player, effectId: 'stun', stacks: 1 }));
    sctx.kernel.submitInstruction(new AddEffectInstruction({ target: sctx.player, effectId: 'mend', stacks: mend }));
    return true;
  },
  describe: () => `/effect{晕眩}1，/effect{治疗}${mend}`,
});
noonNapCard('noonNap', 'C', 8, 'noonNapPlus');
noonNapCard('noonNapPlus', 'B', 11, 'noonNapA');
noonNapCard('noonNapA', 'A', 14);

// 防住！C/B/A（消耗，设计稿未写费用 → 0 费，2026-09-21 大调新增）：13/17/21 护盾。
// 一次性大盾——消耗品定位与同阶护盾件（灵力护盾 2MP 10盾 可循环）错位：
// 不耗蓝、不管冷却，但整场战斗就这一发。
const holdOutCard = (id, tier, shield, promotesTo = null) => registerSkill({
  id, name: '防住！', type: 'normal', pack: 'common', tier,
  image: 'holdOut',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  keywords: ['exhaust'],
  promotesTo,
  use(sctx) {
    sctx.kernel.submitInstruction(new GainShieldInstruction({ target: sctx.player, amount: shield }));
    return true;
  },
  describe: () => `${shield}护盾`,
});
holdOutCard('holdOut', 'C', 13, 'holdOutPlus');
holdOutCard('holdOutPlus', 'B', 17, 'holdOutA');
holdOutCard('holdOutA', 'A', 21);

// 瞬间冷却（A，消耗，设计稿未写费用 → 0 费）：选一张手牌，令其冷却5。
// 结算期选牌两段式（段0请求，段1读应答冷却）；空手则跳过请求。
registerSkill({
  id: 'instantCooldown', image: 'instantCooldown', name: '瞬间冷却', type: 'normal', pack: 'common', tier: 'A',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  keywords: ['exhaust'],
  use(sctx, stage) {
    if (stage === 0) {
      if (sctx.battleState.zones.hand.length === 0) return true;  // 无牌可选：直接收尾
      sctx.self._pick = requestHandSelection(sctx, {
        count: 1, reason: '瞬间冷却：选1张手牌，令其冷却5',
      });
      return false;
    }
    const ids = selected(sctx.self._pick);
    sctx.self._pick = null;
    for (const uniqueID of ids) {
      const card = sctx.battleState.zones.hand.find(c => c.uniqueID === uniqueID);
      if (card) sctx.kernel.submitInstruction(new SkillCooldownInstruction({ skill: card, delta: 5 }));
    }
    return true;
  },
  describe: () => '选1张手牌，令其冷却5',
});

// 念念有词 C/B（消耗，1AP / B 级 0AP）：/named{快速咏唱}——提前拍一次咏唱节拍
// （提交 ChantTriggerInstruction，与 P5 同一挂载点，激活咏唱卡的触发订阅照常响应）。
const murmurCard = (id, tier, ap, promotesTo = null) => registerSkill({
  id, name: '念念有词', type: 'normal', pack: 'common', tier,
  image: 'murmurChant',
  cost: { mana: 0, actionPoint: ap },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  keywords: ['exhaust'],
  promotesTo,
  use(sctx) {
    sctx.kernel.submitInstruction(new ChantTriggerInstruction());
    return true;
  },
  describe: () => '/named{快速咏唱}',
});
murmurCard('murmurChant', 'C', 1, 'murmurChantPlus');
murmurCard('murmurChantPlus', 'B', 0);

// 扩容 A/S（消耗，设计稿未写费用 → 0 费）：本场战斗咏唱容量 +1/+2
// （applyBattleModifier 战斗级通道，战斗结束自动归零——与空系自在系列同口径，
// 「扩容只给咏唱容量」用户定 2026-09-14）。
const expandChantCard = (id, tier, n) => registerSkill({
  id, name: '扩容', type: 'normal', pack: 'common', tier,
  image: 'expandChant',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  keywords: ['exhaust'],
  use(sctx) {
    applyBattleModifier(sctx, 'chantCapacity', n);
    return true;
  },
  describe: () => `本场战斗咏唱容量+${n}`,
});
expandChantCard('expandChant', 'A', 1);
expandChantCard('expandChantS', 'S', 2);

// ---- 高速魏启罐系列（2026-09-12 设计稿新增）----
// 与上面「魏启罐」的区别：**即时回蓝**（GainMana，走上限截断）而不是「纳气」（下回合开始整取）。
// 无费用、无冷却、消耗——纯应急燃料（同阶比纳气罐少 1 点量，换"现在就能用"）。
// 2026-09-21 大调：A 档改名「豪华魏启罐」、4→3（与文档定稿对齐）。
const swiftManaJar = (id, name, tier, amount) => registerSkill({
  id, name, type: 'normal', pack: 'common', tier,
  image: 'manaJar',
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
swiftManaJar('swiftManaJarPlus', '豪华魏启罐', 'A', 3);

// ---- HeLiCoPtEr（A，消耗，2026-09-12 设计稿新增；2026-09-21 大调：设计稿未写费用 → 0费）----
// 「将手中/named{自由牌}变换为 0 开销**猛烈肘击**」：逐张 TransformCardInstruction（换绑 defId，
// keepPower 延续；与斩链的局内转化同一指令）→ 目标卡 = 肘击系列的免费形态
// `fierceElbowFree`（0 费咏唱1、P5 随机伤害、伤害带 `elbow` 标记**吃牢大翻倍**，
// 只在 bodySkills.js 里定义、不进奖励池）。整套牌因此被肘击稀释——放弃体系协同换
// 「一手法师肘」的整活构筑（牢大 + HeLiCoPtEr 是设计上的梗组合）。
registerSkill({
  id: 'helicopter', image: 'helicopter', name: 'HeLiCoPtEr', type: 'normal', pack: 'common', tier: 'A',
  cost: { mana: 0, actionPoint: 0 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',
  keywords: ['exhaust'],
  use(sctx) {
    // 快照手牌（变换会把卡暂迁 pending，边遍历边转会错位）。
    // ⚠ **已激活的咏唱不转化**（「自由牌」口径，NAMED.md）：激活咏唱发动后回手点亮、
    // 常驻手中（如「牢大」），把它们一起换掉 = 当场拆掉自己的引擎——而这张牌的梗组合
    // 恰恰是「牢大 + 一手法师肘」。
    const hand = [...sctx.battleState.zones.hand].filter(c => !c.isActivated);
    for (const card of hand) {
      sctx.kernel.submitInstruction(
        new TransformCardInstruction({ uniqueID: card.uniqueID, toDefId: 'fierceElbowFree' }),
      );
    }
    return true;
  },
  describe: () => '将手中/named{自由牌}变换为0开销/named{猛烈肘击}',
  battleDescribe: (sctx) => '将手中/named{自由牌}变换为0开销/named{猛烈肘击}'
    + `（当前可变换${sctx.battleState.zones.hand.filter(c => !c.isActivated).length}张）`,
});
