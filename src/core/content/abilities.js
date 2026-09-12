import { registerAbility } from '../abilities/registry.js';
import { AddEffectInstruction } from '../instructions/effects.js';
import { DrawCardsInstruction } from '../instructions/cards.js';
import { UseSkillInstruction } from '../instructions/skill.js';
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
  id: 'bladeMaster', name: '刀客',
  description: '换卡开销不超过 1。',
  onBattleStart(ctx) {
    // 取更严者：将来若有多条能力同时封顶，低的那个生效（null = 无上限）
    ctx.battleState.swapCostCap = Math.min(ctx.battleState.swapCostCap ?? Infinity, 1);
  },
});

registerAbility({
  id: 'bladeSaint', name: '刀圣',
  description: '每打出一张刀法牌，抽 1 张牌。',
  subscriptions: () => [{
    when: UseSkillInstruction, phase: 'post',
    filter: (instr) => isBladeCard(instr.skill),
    react: (instr, ctx) => ctx.kernel.submitInstruction(
      new DrawCardsInstruction({ count: 1, reason: '刀圣' }), instr),
  }],
});

