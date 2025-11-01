// filepath: c:\Users\hineven\CLionProjects\rtvl_test\src\data\battleInstructions\skill\SkillCoolDownInstruction.js
/**
 * SkillCoolDownInstruction - 技能冷却推进元语
 *
 * 将某个技能的冷却进度推进 deltaStacks（可为负，表示减冷却）。
 * 实际动画/事件由 skill.coldDown 内部负责（会发出 cooldown-tick 覆盖层动画）。
 */
import { BattleInstruction } from '../BattleInstruction.js';

export class SkillCoolDownInstruction extends BattleInstruction {
  constructor({ skill, deltaStacks = 1, parentInstruction = null }) {
    super({ parentInstruction });
    if (!skill) throw new Error('SkillCoolDownInstruction: skill is required');
    this.skill = skill;
    this.deltaStacks = deltaStacks;
  }

  async execute() {
    try {
      if (typeof this.skill.coldDown === 'function') {
        this.skill.coldDown(this.deltaStacks);
      }
    } catch (_) {}
    return true;
  }

  getDebugInfo() {
    return `${super.getDebugInfo()} Skill:${this.skill?.name} Delta:${this.deltaStacks}`;
  }
}

