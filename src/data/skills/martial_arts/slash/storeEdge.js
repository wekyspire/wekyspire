// 藏锋：消耗性功能卡，造成高额伤害并获得滞气
import Skill from '@data/skill';
import { createAndSubmitLaunchAttack, createAndSubmitAddEffect } from '@data/battleInstructionHelpers.js';
import {SkillTier} from "@/utils/tierUtils";

// 收刃（C-）（藏锋）
// 造成伤害并获得滞气
export class BasicStoreEdge extends Skill {
  constructor(name = '收刃', tier = SkillTier.C_MINUS, damage = 27, halt = 2) {
    super(name, 'normal', tier, 0, 2, 1, '藏锋'); // B+
    this.baseColdDownTurns = 0; // 消耗
    this.baseDamage = damage;
    this.halt = halt;
  }
  get damage() { return Math.max(this.baseDamage + 10 * this.power, 20); }
  use(player, enemy, stage, ctx) {
    createAndSubmitLaunchAttack(player, enemy, this.damage, ctx?.parentInstruction ?? null);
    createAndSubmitAddEffect(player, '滞气', this.halt, ctx?.parentInstruction ?? null);
    return true;
  }
  regenerateDescription(player){ return `造成${this.damage + (player?.attack ?? 0)}伤害，获得${this.halt}/effect{滞气}`; }
}

// 潜锋（B-）（藏锋）
// 造成更高伤害
export class DeepStoreEdge extends BasicStoreEdge {
  constructor() {
    super('潜锋', SkillTier.B, 55);
    this.precessor = '收刃';
  }
}

// 储锋（B+）（藏锋）
// 造成高额伤害，但获得更多滞气
export class TightStoreEdge extends BasicStoreEdge {
  constructor() {
    super('紧锋', SkillTier.B_PLUS, 109, 3);
    this.precessor = '潜锋';
  }
}

// 藏锋（A-）（藏锋）
// 造成高额伤害
export class StoreEdge extends BasicStoreEdge {
  constructor() {
    super('藏锋', SkillTier.A_MINUS, 89);
    this.precessor = ['潜锋', '紧锋'];
  }
}