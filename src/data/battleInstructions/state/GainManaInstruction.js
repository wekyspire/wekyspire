// filepath: c:\Users\hineven\CLionProjects\rtvl_test\src\data\battleInstructions\state\GainManaInstruction.js
import { BattleInstruction } from '../BattleInstruction.js';

/**
 * GainManaInstruction - 魏启变化（正数为获得，负数为消耗）
 * 为了语义清晰，仍提供 GainManaInstruction 与 ConsumeManaInstruction 两个类
 */
export class GainManaInstruction extends BattleInstruction {
  constructor({ target, amount, parentInstruction = null }) {
    super({ parentInstruction });
    if (!target) throw new Error('GainManaInstruction: target is required');
    this.target = target;
    this.amount = Number(amount) || 0;
  }

  async execute() {
    if (this.amount === 0) return true;
    if (typeof this.target.gainMana === 'function') {
      this.target.gainMana(Math.max(0, this.amount));
    }
    return true;
  }

  getDebugInfo() {
    return `${super.getDebugInfo()} GainMana(${this.target?.name||'?'}, +${this.amount})`;
  }
}

