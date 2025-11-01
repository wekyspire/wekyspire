import Skill from "@data/skill"
import {SkillTier} from '@/utils/tierUtils'
import { createAndSubmitAddEffect } from '@data/battleInstructionHelpers.js'
// 抱头（D）（格挡系列）
// 获得1格挡
export class BasicBlocking extends Skill {
  constructor(name = '抱头', tier = SkillTier.D, blockAmount = 1) {
    super(name, 'normal', tier, 0, 1, 1, '格挡');
    this.baseColdDownTurns = 4;
    this.baseBlockAmount = blockAmount;
  }

  get coldDownTurns() {
    return Math.max(this.baseColdDownTurns - this.power, 1);
  }

  get block() {
    return this.baseBlockAmount;
  }

  // 使用技能
  use(player, enemy, stage, ctx) {
    createAndSubmitAddEffect(player, '格挡', this.block, ctx?.parentInstruction ?? null);
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `获得${this.block}/effect{格挡}`;
  }
}

// 格挡（C+）（格挡系列）
// 获得2格挡
export class AdvancedBlocking extends BasicBlocking {
  constructor() {
    super('格挡', SkillTier.C_PLUS, 2);
    this.precessor = '抱头';
  }
}