import { registerAbility } from '../abilities/registry.js';
import { AddEffectInstruction } from '../instructions/effects.js';

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

