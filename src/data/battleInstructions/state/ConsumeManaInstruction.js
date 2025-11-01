// filepath: c:\Users\hineven\CLionProjects\rtvl_test\src\data\battleInstructions\state\ConsumeManaInstruction.js
import { BattleInstruction } from '../BattleInstruction.js';

/**
 * ConsumeManaInstruction - 消耗魏启
 */
export class ConsumeManaInstruction extends BattleInstruction {
  constructor({ target, amount, parentInstruction = null }) {
    super({ parentInstruction });
    if (!target) throw new Error('ConsumeManaInstruction: target is required');
    this.target = target;
    this.amount = Math.max(0, Number(amount) || 0);
  }

  async execute() {
    if (this.amount === 0) return true;
    if (typeof this.target.consumeMana === 'function') {
      this.target.consumeMana(this.amount);
    } else if (typeof this.target.gainMana === 'function') {
      // 兜底：没有consume时用负增
      this.target.gainMana(-this.amount);
    }
    return true;
  }

  getDebugInfo() {
    return `${super.getDebugInfo()} ConsumeMana(${this.target?.name||'?'}, -${this.amount})`;
  }
}

