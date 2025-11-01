// filepath: c:\Users\hineven\CLionProjects\rtvl_test\src\data\battleInstructions\turnEffects\ProcessEndOfTurnEffectsInstruction.js
import { BattleInstruction } from '../BattleInstruction.js';
import { ProcessEndOfTurnEffectInstruction } from './ProcessEndOfTurnEffectInstruction.js';
import { submitInstruction } from '../globalExecutor.js';

export class ProcessEndOfTurnEffectsInstruction extends BattleInstruction {
  constructor({ target, parentInstruction = null }) {
    super({ parentInstruction });
    this.target = target;
  }

  async execute() {
    const t = this.target;
    if (!t) return true;

    // 固定顺序展开为子元语，保持与旧实现语义一致
    const order = [
      '吸收', '漏气', '中毒', '再生',
      '超然', '侵蚀', '燃心',
      '成长', '衰败', '巩固', '崩溃',
      '魏宗圣体', '解体',
      '易伤', '虚弱', '不灭', '禁忌', '滞气'
    ];

    for (const name of order) {
      if ((t.effects?.[name] || 0) > 0) {
        submitInstruction(new ProcessEndOfTurnEffectInstruction({ target: t, effectName: name, parentInstruction: this }));
      }
    }

    return true;
  }

  getDebugInfo() {
    return `${super.getDebugInfo()} ProcessEndOfTurnEffects(${this.target?.name||'?'})`;
  }
}
