import Skill from '@data/skill';
import {SkillTier} from '@/utils/tierUtils';
import {
  createAndSubmitLaunchAttack,
  createAndSubmitDropSkillCard,
  createAndSubmitBurnSkillCard,
  createAndSubmitDrawAt,
  createAndSubmitDrawRelative
} from '@data/battleInstructionHelpers.js';

// 飞刀（C-）（飞刀）
// 攻击并丢弃相邻牌，需要前后都有牌
export class FlyingDagger extends Skill {
  constructor(name = '飞刀', tier = SkillTier.C_PLUS, baseDamage = 18, powerMultiplier = 7, consumable = false) {
    super(name, 'normal', tier, 0, 1, 1);
    this.baseColdDownTurns = consumable ? 0 : 1;
    this.powerMultiplier = powerMultiplier;
    this.baseDamage = baseDamage;
  }

  get damage () {
    return Math.max(this.baseDamage + this.powerMultiplier * this.power, 5);
  }

  canUse(player) {
    if (super.canUse(player)) {
      const index = this.getInBattleIndex(player);
      if (index > 0 && index < player.frontierSkills.length - 1) {
        return true;
      }
    }
    return false;
  }

  use(player, enemy, stage, ctx) {
    createAndSubmitLaunchAttack(player, enemy, this.damage, ctx?.parentInstruction ?? null);
    const idx = this.getInBattleIndex(player);
    const leftSkill = player.frontierSkills[idx - 1];
    if (leftSkill) {
      createAndSubmitDropSkillCard(player, leftSkill.uniqueID, -1, ctx?.parentInstruction ?? null);
    }
    const rightSkill = player.frontierSkills[idx + 1];
    if (rightSkill) {
      createAndSubmitDropSkillCard(player, rightSkill.uniqueID, -1, ctx?.parentInstruction ?? null);
    }
    return true;
  }

  regenerateDescription(player) {
    return `${this.damage + (player?.attack ?? 0)}伤害，丢弃两侧卡，发动需两侧有卡`;
  }
}

// 强力飞刀（B-）（飞刀）
// 伤害提升
export class StrongFlyingDagger extends FlyingDagger {
  constructor() {
    super('强力飞刀', SkillTier.B_MINUS, 27, 8);
    this.precessor = '飞刀';
  }
}

// 绝技飞刀（B+）（飞刀）
// 伤害进一步提升
export class MasterfulFlyingDagger extends FlyingDagger {
  constructor() {
    super('绝技飞刀', SkillTier.B_PLUS, 36, 9);
    this.precessor = '强力飞刀';
  }
}

// 绝灭飞刀（A-）（飞刀）
// 伤害大幅提升，但是变成消耗卡
export class UltimateFlyingDagger extends FlyingDagger {
  constructor() {
    super('绝灭飞刀', SkillTier.A_MINUS, 55, 20, true);
    this.precessor = '绝技飞刀';
  }
}

// 回旋飞刀：弃牌后抽牌进入两侧，没有牌也能发动
export class WhirlingDagger extends Skill {
  constructor(){
    super('回旋飞刀', 'normal', SkillTier.B, 0, 1, 1, '飞刀'); this.baseColdDownTurns = 2;
    this.precessor = '强力飞刀';
  }
  get damage(){ return Math.max(27 + 8 * this.power, 8); }
  use(player, enemy, stage, ctx){
    // 攻击并丢弃左右各1张，然后分别在自身的前/后插入抽到的两张（更鲁棒：以自身uniqueID为锚点）
    createAndSubmitLaunchAttack(player, enemy, this.damage, ctx?.parentInstruction ?? null);
    const idx = this.getInBattleIndex(player);
    const L = player.frontierSkills[idx-1]; if (L) createAndSubmitDropSkillCard(player, L.uniqueID, -1, ctx?.parentInstruction ?? null);
    const R = player.frontierSkills[idx+1]; if (R) createAndSubmitDropSkillCard(player, R.uniqueID, -1, ctx?.parentInstruction ?? null);
    // 以当前卡牌为锚点：在自己前后分别插入1张
    if(L) createAndSubmitDrawRelative(player, [{ anchorId: this.uniqueID, mode: 'before' },], 1, ctx?.parentInstruction ?? null);
    if(R) createAndSubmitDrawRelative(player, [{ anchorId: this.uniqueID, mode: 'after' },], 1, ctx?.parentInstruction ?? null);
    return true;
  }
  regenerateDescription(player){ return `${this.damage + (player?.attack ?? 0)}伤害，换两侧牌`; }
}

// 精致飞刀：只弃左边牌，没有牌也能发动
export class ExquisiteDagger extends Skill {
  constructor(){
    super('精致飞刀', 'normal', SkillTier.B, 0, 1, 1, '飞刀');
    this.baseColdDownTurns = 1;
    this.precessor = '强力飞刀';
  }
  get damage(){ return Math.max(36 + 9 * this.power, 9); }
  use(player, enemy, stage, ctx){
    createAndSubmitLaunchAttack(player, enemy, this.damage, ctx?.parentInstruction ?? null);
    const idx = this.getInBattleIndex(player);
    const L = player.frontierSkills[idx-1]; if (L) createAndSubmitDropSkillCard(player, L.uniqueID, -1, ctx?.parentInstruction ?? null);
    return true;
  }
  regenerateDescription(player){ return `${this.damage + (player?.attack ?? 0)}伤害，丢弃左侧牌`; }
}

// 完美飞刀：消耗两侧牌，从牌库中找到两张抽取，没有牌也能发动
export class PerfectDagger extends Skill {
  constructor(){
    super('完美飞刀', 'normal', SkillTier.A, 0, 1, 1, '飞刀');
    this.baseColdDownTurns = 0;
    this.precessor = '绝灭飞刀';
  }
  get damage(){ return Math.max(55 + 20 * this.power, 10); }
  use(player, enemy, stage, ctx){
    createAndSubmitLaunchAttack(player, enemy, this.damage, ctx?.parentInstruction ?? null);
    const idx = this.getInBattleIndex(player);
    const L = player.frontierSkills[idx-1]; if (L) createAndSubmitBurnSkillCard(player, L.uniqueID, ctx?.parentInstruction ?? null);
    const R = player.frontierSkills[idx+1]; if (R) createAndSubmitBurnSkillCard(player, R.uniqueID, ctx?.parentInstruction ?? null);
    // 从牌库抽两张并基于自身为锚点插入左右
    createAndSubmitDrawRelative(player, [
      { anchorId: this.uniqueID, mode: 'before' },
      { anchorId: this.uniqueID, mode: 'after' }
    ], 2, ctx?.parentInstruction ?? null);
    return true;
  }
  regenerateDescription(player){ return `${this.damage + (player?.attack ?? 0)}伤害，消耗两侧牌，从牌库中找到2张抽取（原型）`; }
}
