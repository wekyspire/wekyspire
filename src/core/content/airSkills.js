// 空灵脉（AIR_VEIN_CARDS，2026-09-14 二轮推敲定稿）============================
// 体系哲学：咏唱、增强、自动化。两个子体系：
//   御风组合（闪避/多重攻击——特殊免伤与速度输出）
//   逍遥组合（咏唱/咏唱容量/自动化——咏唱卡群、占位减负、从牌库直接发动）
// 数值锚点见设计文档§0：闪避1 ≈ 4~5（怕多段/怕环境/会蒸发）；多段总伤 < 同阶单段、
// 3AP 梭哈给效率溢价；扩容只给咏唱容量（chantCapacity，用户定——maxHandSize 在
// 抽满制下是全卡组通用顶级资源，太危险）；从牌库发动 1AP 随机平价、自选 B 阶。
//
// 口径备忘：
//   * 咏唱容量走 applyBattleModifier('chantCapacity') 战斗级通道（战斗结束自动归零）；
//   * 漂浮系嵌套发动走 UseSkillInstruction + costOverride 0（万变拳/铁雨同通道）：
//     拉出的卡正常走 pending/落位全流程，咏唱卡按激活判定（免费点亮＝白嫖彩蛋），
//     X 费被覆写为 0；filter 排除 'blood' 卖血卡（随机发动拉出自杀卡不可接受）；
//   * 「下 N 张牌无开销」与万变拳同型：PRE 把消耗指令 payload 置 0，计数器放
//     skillRuntime（规则：不藏闭包）；同一张卡的 AP/蓝两次消耗只扣一份额度
//     （按结算栈内层 UseSkillInstruction 的 uniqueID 记忆）。

import { registerSkill, getSkillDefinition } from '../skills/registry.js';
import { aliveEnemies } from '../state/battleState.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import { ChantTriggerInstruction } from '../instructions/turn.js';
import { UseSkillInstruction } from '../instructions/skill.js';
import { ConsumeActionPointsInstruction, ConsumeManaInstruction } from '../instructions/resources.js';
import { DrawCardsInstruction } from '../instructions/cards.js';
import { GainShieldInstruction } from '../instructions/combat.js';
import { applyBattleModifier } from '../run/prep.js';
import {
  attackDamage, gainShield, addEffect, drawCards, resolvedDamageText, randomAliveEnemy,
  requestDeckSelection, selected,
} from './cardKit.js';

// ---- 共用：漂浮系候选口径（排除卖血卡；返回牌库数组的子集，不改动原数组）----
function floatableDeck(battleState) {
  return battleState.zones.deck.filter(
    c => !getSkillDefinition(c.defId).keywords?.includes('blood'));
}

// ---- 共用：以 0 开销嵌套发动一张卡（敌方目标随机；万变拳/铁雨同通道）----
function freePlayCard(sctx, card) {
  sctx.kernel.submitInstruction(new UseSkillInstruction({
    skill: card,
    costOverride: { mana: 0, actionPoint: 0 },
    targetUniqueID: randomAliveEnemy(sctx)?.uniqueID ?? null,
  }));
}

// ==== 御风组合 ===============================================================

// 风刃系列（攻击+闪避混合件）：风刃→疾风连击→闪空灭→飓风乱舞
const windBladeCard = (id, name, tier, ap, damage, hits, { dodge = 0, draw = 0, cd = 1, promotesTo = null } = {}) => registerSkill({
  id, name, type: 'air', tier, series: 'airBlade',
  cost: { mana: 0, actionPoint: ap },
  charges: { max: 1, cooldownTurns: cd },
  cardMode: 'normal', targetMode: 'enemy',
  promotesTo,
  use(sctx) {
    for (let i = 0; i < hits; i++) attackDamage(sctx, damage);
    if (dodge > 0) addEffect(sctx, 'dodge', dodge);
    if (draw > 0) drawCards(sctx, draw);
    return true;
  },
  describe: () => `${damage}伤害${hits > 1 ? `×${hits}` : ''}${dodge > 0 ? `，/effect{闪避}${dodge}` : ''}${draw > 0 ? `，抽${draw}` : ''}`,
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, damage)}${hits > 1 ? `×${hits}` : ''}${dodge > 0 ? `，闪避${dodge}` : ''}${draw > 0 ? `，抽${draw}` : ''}`,
});
windBladeCard('windBlade', '风刃', 'D', 1, 4, 1, { dodge: 1, promotesTo: 'galeCombo' });
windBladeCard('galeCombo', '疾风连击', 'C', 1, 3, 2, { dodge: 1, promotesTo: 'skyFlash' });
// 闪空灭（原则点名「高AP多重」）：3AP 梭哈给效率溢价 5×5=25（8.3/AP）；力量滚雪球×5 段
windBladeCard('skyFlash', '闪空灭', 'B', 3, 5, 5, { promotesTo: 'hurricaneDance' });
windBladeCard('hurricaneDance', '飓风乱舞', 'A', 2, 5, 3, { dodge: 1, draw: 1 });

// 轻身系列（纯闪避防御件）：轻身→疾风步→残影→虚无身
const lightnessCard = (id, name, tier, ap, dodge, { shield = 0, cd = 1, promotesTo = null } = {}) => registerSkill({
  id, name, type: 'air', tier, series: 'airDodge',
  cost: { mana: 0, actionPoint: ap },
  charges: { max: 1, cooldownTurns: cd },
  cardMode: 'normal', targetMode: 'none',
  promotesTo,
  use(sctx) {
    if (shield > 0) gainShield(sctx, shield);
    addEffect(sctx, 'dodge', dodge);
    return true;
  },
  describe: () => `${shield > 0 ? `${shield}护盾，` : ''}/effect{闪避}${dodge}`,
  battleDescribe: () => `${shield > 0 ? `${shield}护盾，` : ''}闪避${dodge}`,
});
lightnessCard('lightness', '轻身', 'D', 1, 1, { shield: 3, promotesTo: 'windStep' });
// 疾风步：0 费起步件——「彻底 0 开销卡必须谨慎」，冷却 2 兜底（代价是牌库循环位）
lightnessCard('windStep', '疾风步', 'C', 0, 1, { cd: 2, promotesTo: 'afterimage' });
lightnessCard('afterimage', '残影', 'B', 1, 2, { promotesTo: 'voidBody' });
lightnessCard('voidBody', '虚无身', 'A', 1, 3, { cd: 2 });

// 御风者（S，消耗）：闪避3 + 抽2
registerSkill({
  id: 'windRider', name: '御风者', type: 'air', tier: 'S', series: 'airDodge',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  keywords: ['exhaust'],
  use(sctx) {
    addEffect(sctx, 'dodge', 3);
    drawCards(sctx, 2);
    return true;
  },
  describe: () => '/effect{闪避}3，抽2',
  battleDescribe: () => '闪避3，抽2',
});

// 天闪（A 深入，御风门禁）：8伤×2 + 闪避2
registerSkill({
  id: 'skyBolt', name: '天闪', type: 'air', tier: 'A', series: 'airBlade', deep: 'gale',
  cost: { mana: 0, actionPoint: 2 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'enemy',
  use(sctx) {
    attackDamage(sctx, 8);
    attackDamage(sctx, 8);
    addEffect(sctx, 'dodge', 2);
    return true;
  },
  describe: () => '8伤害×2，/effect{闪避}2',
  battleDescribe: (sctx) => `${resolvedDamageText(sctx, 8)}×2，闪避2`,
});

// ==== 逍遥组合 ===============================================================

// 自在系列（咏唱容量功能件；构筑内值钱、构筑外废纸＝体系粘合剂，用户定 2026-09-14）：
// 自在→空灵漫步→大自在。战斗结束容量修正自动归零（modifiers 通道）。
const easeCard = (id, name, tier, expand, { dodge = 0, draw = 0, exhaust = false, promotesTo = null } = {}) => registerSkill({
  id, name, type: 'air', tier, series: 'airEase',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'none',
  keywords: exhaust ? ['exhaust'] : [],
  promotesTo,
  use(sctx) {
    applyBattleModifier(sctx, 'chantCapacity', expand);
    if (dodge > 0) addEffect(sctx, 'dodge', dodge);
    if (draw > 0) drawCards(sctx, draw);
    return true;
  },
  describe: () => `本场战斗咏唱容量+${expand}${dodge > 0 ? `，/effect{闪避}${dodge}` : ''}${draw > 0 ? `，抽${draw}` : ''}`,
  battleDescribe: () => `咏唱容量+${expand}${dodge > 0 ? `，闪避${dodge}` : ''}${draw > 0 ? `，抽${draw}` : ''}`,
});
easeCard('atEase', '自在', 'C', 1, { promotesTo: 'cloudWalk' });
easeCard('cloudWalk', '空灵漫步', 'B', 2, { dodge: 1, promotesTo: 'greatFreedom' });
easeCard('greatFreedom', '大自在', 'A', 3, { draw: 2, exhaust: true });

// ---- 漂浮系（从牌库直接发动，原则点名机制）----

// 漂浮（C）：随机发动牌库中 1 张牌（无开销，敌方目标随机；排除卖血卡）
registerSkill({
  id: 'floating', name: '漂浮', type: 'air', tier: 'C', series: 'airFloat',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'none',
  promotesTo: 'floatingArt',
  use(sctx) {
    const pool = floatableDeck(sctx.battleState);
    if (pool.length === 0) return true;   // 无可发动候选：落空
    freePlayCard(sctx, pool[sctx.battleState.rng.int(0, pool.length - 1)]);
    return true;
  },
  describe: () => '随机发动牌库中1张牌（无开销，敌方目标随机）',
  battleDescribe: () => '随机发动牌库中1张牌',
});

// 漂浮术（B 冷却1）：从牌库选 1 张牌发动（无开销，敌方目标随机；排除卖血卡）
registerSkill({
  id: 'floatingArt', name: '漂浮术', type: 'air', tier: 'B', series: 'airFloat',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 1 },
  cardMode: 'normal', targetMode: 'none',
  use(sctx, stage) {
    if (stage === 0) {
      sctx.self._floatPick = requestDeckSelection(sctx, {
        count: 1,
        filter: (c) => !getSkillDefinition(c.defId).keywords?.includes('blood'),
        reason: '漂浮术：选牌库中1张牌发动',
      });
      // 空集守卫（buildCardSelectionRequest 返回 null＝不发起请求）：静默落空
      return sctx.self._floatPick ? false : true;
    }
    const ids = selected(sctx.self._floatPick);
    sctx.self._floatPick = null;
    const card = ids[0]
      ? sctx.battleState.zones.deck.find(c => c.uniqueID === ids[0]) ?? null
      : null;
    if (!card) return true;   // 结算中途被挪走：静默落空（DiscardCard 范式）
    freePlayCard(sctx, card);
    return true;
  },
  describe: () => '从牌库选1张牌发动（无开销，敌方目标随机）',
  battleDescribe: () => '从牌库选1张牌发动',
});

// ---- 咏唱线（空灵脉主打，D 阶起）----
// 沐风(D 盾3/回合) → 听风(C 抽1/回合) → 登天术(B 闪避1/回合)；御风诀(B 力量1/回合)独立。
// 「每回合小收益」骨架上的效果跃迁即本链的机制跃迁点。
const windChantCard = ({ id, name, tier, weight, effectId = null, stacks = 0, draw = 0, shield = 0, promotesTo = null }) => registerSkill({
  id, name, type: 'air', tier, series: 'airChant',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: weight,
  promotesTo,
  use() { return true; },
  activated: {
    subscriptions: () => [{
      when: ChantTriggerInstruction, phase: 'post',
      react: (instr, ctx) => {
        if (shield > 0) ctx.kernel.submitInstruction(
          new GainShieldInstruction({ target: ctx.player, amount: shield }), instr);
        if (draw > 0) ctx.kernel.submitInstruction(
          new DrawCardsInstruction({ count: draw }), instr);
        if (effectId) ctx.kernel.submitInstruction(
          new AddEffectInstruction({ target: ctx.player, effectId, stacks }), instr);
      },
    }],
  },
  describe: () => `每回合开始：${shield > 0 ? `${shield}护盾` : draw > 0 ? `抽${draw}` : `/effect{${effectId === 'dodge' ? '闪避' : '力量'}}${stacks}`}`,
  battleDescribe: () => `每回合开始：${shield > 0 ? `${shield}护盾` : draw > 0 ? `抽${draw}` : `${effectId === 'dodge' ? '闪避' : '力量'}${stacks}`}`,
});
windChantCard({ id: 'bathWind', name: '沐风', tier: 'D', weight: 1, shield: 3, promotesTo: 'listenWind' });
windChantCard({ id: 'listenWind', name: '听风', tier: 'C', weight: 1, draw: 1, promotesTo: 'ascensionChant' });
windChantCard({ id: 'ascensionChant', name: '登天术', tier: 'B', weight: 2, effectId: 'dodge', stacks: 1 });
windChantCard({ id: 'windMantra', name: '御风诀', tier: 'B', weight: 2, effectId: 'strength', stacks: 1 });

// 风行者（A 深入，逍遥门禁，咏唱3）：每回合开始自动发动牌库顶牌（无开销，敌方目标随机）
registerSkill({
  id: 'windWalker', name: '风行者', type: 'air', tier: 'A', series: 'airChant', deep: 'wander',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'chant', chantWeight: 3,
  use() { return true; },
  activated: {
    subscriptions: () => [{
      when: ChantTriggerInstruction, phase: 'post',
      react: (instr, ctx) => {
        const top = ctx.battleState.zones.deck[0];
        if (!top || getSkillDefinition(top.defId).keywords?.includes('blood')) return;
        ctx.kernel.submitInstruction(new UseSkillInstruction({
          skill: top,
          costOverride: { mana: 0, actionPoint: 0 },
          targetUniqueID: aliveEnemies(ctx.battleState)[0]?.uniqueID ?? null,
        }), instr);
      },
    }],
  },
  describe: () => '每回合开始：自动发动牌库顶牌（无开销，敌方目标随机）',
  battleDescribe: () => '每回合开始：自动发动牌库顶牌',
});

// 逍遥游（S，消耗）：抽3 + 下2张打出的牌无开销。
// 双轨实现：①可用性豁免 battleState.freePlays（canUseSkill 放行贵牌，helpers.js 同通道注释）；
// ②支付侧 PRE 置 0（万变拳同型）并按牌扣额度——同一张卡的 AP/蓝两次消耗只扣一份
// （按结算栈内层 UseSkill 的 uniqueID 记忆，计数器在 battleState 可序列化）。
registerSkill({
  id: 'freeWander', name: '逍遥游', type: 'air', tier: 'S', series: 'airEase',
  cost: { mana: 0, actionPoint: 1 },
  charges: { max: 1, cooldownTurns: 0 },
  cardMode: 'normal', targetMode: 'none',
  keywords: ['exhaust'],
  use(sctx) {
    drawCards(sctx, 3);
    sctx.battleState.freePlays = (sctx.battleState.freePlays ?? 0) + 2;
    sctx.battleState.freePlayCard = null;
    const innerUseUid = (ctx) => [...ctx.kernel.stack].reverse()
      .find(i => i instanceof UseSkillInstruction)?.skill?.uniqueID ?? null;
    for (const Instr of [ConsumeActionPointsInstruction, ConsumeManaInstruction]) {
      sctx.kernel.addSubscription({
        when: Instr, phase: 'pre', window: 'battle',
        filter: (_instr, ctx) => {
          const uid = innerUseUid(ctx);
          return uid !== null
            && ((ctx.battleState.freePlays ?? 0) > 0 || ctx.battleState.freePlayCard === uid);
        },
        react: (instr, ctx) => {
          const uid = innerUseUid(ctx);
          if (ctx.battleState.freePlayCard !== uid) {
            if ((ctx.battleState.freePlays ?? 0) <= 0) return;
            ctx.battleState.freePlays -= 1;
            ctx.battleState.freePlayCard = uid;
          }
          instr.setPayload('amount', 0);
        },
      });
    }
    return true;
  },
  describe: () => '抽3；下2张打出的牌无开销',
  battleDescribe: (sctx) => `抽3；下${sctx.battleState.freePlays ?? 2}张牌无开销`,
});
