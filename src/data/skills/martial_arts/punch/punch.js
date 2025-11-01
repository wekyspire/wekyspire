// 拳系列（无限，1行动伤害）
// 延伸卡：爆拳（B-）、雷拳（B+）

// 一些单卡

import Skill from '@data/skill.js';
// 替换：使用指令式helpers而非直接battleUtils
import { createAndSubmitLaunchAttack } from '@data/battleInstructionHelpers.js';
import {signedNumberString, signedNumberStringW0} from "@/utils/nameUtils";
import {SkillTier} from "@/utils/tierUtils";

// 拳（D）（拳系列）
export class Punch extends Skill {
  constructor(name='拳', tier = SkillTier.D, baseDamage = 6, powerMultiplier = 2, apCost = 1) {
    super(name, 'normal', tier, 0, apCost, Infinity, '拳');
    this.baseDamage = baseDamage;
    this.powerMultiplier = powerMultiplier;
  }

  get damage () {
    return Math.max(this.baseDamage + this.powerMultiplier * this.power, 3);
  }

  // 使用技能（指令式）
  use(player, enemy, stage, ctx) {
    // 仅一个阶段：创建攻击指令并返回完成
    createAndSubmitLaunchAttack(player, enemy, this.damage, ctx?.parentInstruction ?? null);
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `造成${this.damage + (player?.attack ?? 0)}点伤害`;
  }
}
// 直拳（C-）（拳系列）
export class StraitPunch extends Punch {
  constructor() {
    super('直拳', SkillTier.C_MINUS, 8, 3);
    this.precessor = '拳';
  }
}
// 猛拳（C+）（拳系列）
export class FiercePunch extends Punch {
  constructor() {
    super('猛拳', SkillTier.C_PLUS, 10, 4);
    this.precessor = '直拳';
  }
}
// 爆拳（B-）（单卡）
export class ExplosivePunch extends Skill {
  constructor() {
    super('爆拳', 'normal', SkillTier.B_MINUS, 0, 1, Infinity, '爆拳');
    this.precessor = '猛拳';
    this.leinoModifiers = 'fire';
  }

  get damage () {
    return Math.max(12 + 4 * this.power, 3);
  }

  getDamage(enemy) {
    return this.damage + (enemy.effects['燃烧'] || 0);
  }

  // 使用技能（指令式）
  use(player, enemy, stage, ctx) {
    createAndSubmitLaunchAttack(player, enemy, this.getDamage(enemy), ctx?.parentInstruction ?? null);
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `造成${this.damage + (player?.attack ?? 0)}伤害，提升敌人/effect{燃烧}层数层伤害`;
  }
}
// 疾猛拳（B）（拳系列）
export class SwiftFiercePunch extends Punch {
  constructor() {
    super('疾猛拳', SkillTier.B, 16, 5);
    this.precessor = '猛拳';
  }
}
// 真拳（A-）（拳系列）
// 开销降到0
export class TruePunch extends Punch {
  constructor() {
    super('真拳', SkillTier.A_MINUS, 19, 6, 0);
    this.precessor = '疾猛拳';
  }
}