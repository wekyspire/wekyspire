// filepath: c:\Users\hineven\CLionProjects\rtvl_test\src\data\battleInstructions\misc\LambdaInstruction.js
import { BattleInstruction } from '../BattleInstruction.js';

/**
 * LambdaInstruction - 通用执行器节点
 * 执行传入的函数以实现任意结算路径上的副作用（如日志显示）。
 */
export class LambdaInstruction extends BattleInstruction {
  constructor({ fn, description = 'lambda', parentInstruction = null }) {
    super({ parentInstruction });
    if (typeof fn !== 'function') throw new Error('LambdaInstruction: fn must be a function');
    this.fn = fn;
    this.description = description;
  }

  async execute() {
    try { this.fn(); } catch (e) { console.warn('[LambdaInstruction] fn failed:', e); }
    return true;
  }

  getDebugInfo() {
    return `${super.getDebugInfo()} ${this.description}`;
  }
}

