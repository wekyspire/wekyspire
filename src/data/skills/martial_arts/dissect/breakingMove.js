// 破势
import Skill from "@data/skill"
import {SkillTier} from '@/utils/tierUtils';
// 替换：使用指令式 helpers
import { createAndSubmitLaunchAttack, createAndSubmitRemoveEffect } from '@data/battleInstructionHelpers.js';

// 破势（C+）（破势）
// 造成12伤害，失去至多4层格挡提升四倍失去层数伤害
export class BreakingMove extends Skill {
  constructor(name = '破势', tier = SkillTier.C_PLUS, damage = 9,
              powerMultiplier = 5, maxGuardLost = 4, guardDamageMultiplier = 4) {
    super(name, 'normal', tier, 0, 1, 1, '破势');
    this.baseColdDownTurns = 3;
    this.baseDamage = damage;
    this.powerMultiplier = powerMultiplier;
    this.maxGuardLost = maxGuardLost;
    this.guardDamageMultiplier = guardDamageMultiplier;
  }
  get damage() {
    return Math.max(this.baseDamage + 4 * this.power, 6);
  }
  getGuardLost(player) {
    return Math.min(player?.effects['格挡'] || 0, this.maxGuardLost);
  }
  getDamage(player) {
    return this.damage + this.getGuardLost(player) * this.guardDamageMultiplier;
  }
  use(player, enemy, stage, ctx) {
    if(stage === 0) {
      const toRemove = player.effects['格挡'] || 0;
      if (toRemove > 0) {
        createAndSubmitRemoveEffect(player, '格挡', toRemove, ctx?.parentInstruction ?? null);
      }
      createAndSubmitLaunchAttack(player, enemy, this.getDamage(player), ctx?.parentInstruction ?? null);
      return true;
    }
    return true;
  }
  regenerateDescription(player) {
    if(player) {
      return `${this.getDamage(player) + (player?.attack ?? 0)}伤害，失去${this.getGuardLost(player)}层格挡`;
    }
    return `${this.damage}伤害，失去至多${this.maxGuardLost}层/effect{格挡}并提升${this.guardDamageMultiplier}倍失去层数伤害`;
  }
}

// 解体（B）（破势）
// 造成15伤害，失去至多7层格挡提升6倍失去层数伤害
export class Disassemble extends BreakingMove {
  constructor() {
    super('解体', SkillTier.B, 15, 6, 7, 6);
    this.precessor = '破势';
  }
}

// 贯心（A-）（破势）
// 造成22伤害，失去所有格挡，提升12倍失去层数伤害
export class HeartPiercingStrike extends BreakingMove {
  constructor() {
    super('贯心', SkillTier.A_MINUS, 22, 7, Infinity, 12);
    this.precessor = '解体';
  }
  regenerateDescription(player) {
    if(player) {
      return super.regenerateDescription(player);
    }
    return `${this.damage}伤害，失去所有/effect{格挡}并提升${this.guardDamageMultiplier}倍失去层数伤害`;
  }
}