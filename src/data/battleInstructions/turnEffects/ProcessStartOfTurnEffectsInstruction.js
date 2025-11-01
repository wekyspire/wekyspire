// filepath: c:\Users\hineven\CLionProjects\rtvl_test\src\data\battleInstructions\turnEffects\ProcessStartOfTurnEffectsInstruction.js
import { BattleInstruction } from '../BattleInstruction.js';
import { submitInstruction } from '../globalExecutor.js';
import { ProcessStartOfTurnEffectInstruction } from './ProcessStartOfTurnEffectInstruction.js';

export class ProcessStartOfTurnEffectsInstruction extends BattleInstruction {
  constructor({ target, parentInstruction = null }) {
    super({ parentInstruction });
    this.target = target;
    this.isStunned = false;
  }

  async execute() {
    const t = this.target;
    if (!t) return true;

    // 固定顺序展开关键效果（按旧逻辑顺序）
    const order = ['警戒', '吸热', '燃烧', '聚气', '肌肉记忆', '飞行'];
    for (const name of order) {
      if ((t.effects?.[name] || 0) > 0) {
        submitInstruction(new ProcessStartOfTurnEffectInstruction({ target: t, effectName: name, parentInstruction: this }));
      }
    }

    // 眩晕单独处理以设置 isStunned
    if ((t.effects?.['眩晕'] || 0) > 0) {
      this.isStunned = true;
      submitInstruction(new ProcessStartOfTurnEffectInstruction({ target: t, effectName: '眩晕', parentInstruction: this }));
    }

    return true;
  }

  getDebugInfo() {
    return `${super.getDebugInfo()} ProcessStartOfTurnEffects(${this.target?.name||'?'})`;
  }
}
