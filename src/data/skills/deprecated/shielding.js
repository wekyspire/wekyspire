import Skill from '../skill.js';
import { launchAttack, dealDamage, gainShield } from '../battleUtils.js';
import {enqueueDelay} from "../animationInstructionHelpers";

// 紧急护盾技能
// 获得14点护盾，每次使用后，冷却时间增1
export class EmergencyShield extends Skill {
  
  constructor() {
    super('紧急护盾', 'normal', 0, 0, 1, 1);
    this.baseColdDownTurns = 2;
    this.extraColdDownTurns = 0; // 额外冷却时间
  }
  
  get coldDownTurns () {
    return this.extraColdDownTurns + Math.max(this.baseColdDownTurns - this.power, 1);
  }

  // 使用技能
  use(player, enemy) {
    gainShield(player, player, 14);
    this.extraColdDownTurns += 1;
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `获得14/named{护盾}，使用后/named{冷却}时间增1`;
  }
}

// 快速护盾技能
// 获得10护盾，重置相邻技能冷却进度
export class QuickShield extends Skill {
  constructor() {
    super('快速护盾', 'normal', 0, 0, 1, 1);
    this.baseColdDownTurns = 2;
  }

  get coldDownTurns () {
    return Math.max(this.baseColdDownTurns - this.power, 1);
  }

  get shield () {
    return Math.max(10 + Math.min(this.power * 4, 0), 3);
  }
  
  use(player, enemy) {
    gainShield(player, player, this.shield);
    const leftSkill = player.frontierSkills[this.getInBattleIndex(player) - 1];
    if(leftSkill) leftSkill.resetColdDownProcess();
    // 看看右边技能有没有充能
    const rightSkill = player.frontierSkills[this.getInBattleIndex(player) + 1];
    if(rightSkill) rightSkill.resetColdDownProcess();
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if(this.power > 0) return `获得${this.shield}/named{护盾}，重置/named{左邻}技能冷却进度`
    return `获得${this.shield}/named{护盾}，重置相邻技能冷却进度`;
  }
}

// 冲锋盾
// 造成3伤害，获得2+攻击护盾
export class ChargeShield extends Skill {
  constructor() {
    super('冲锋盾', 'normal', 0, 0, 1, 1);
    this.baseColdDownTurns = 1;
  }

  get damage () {
    return Math.max(3 + this.power, 1);
  }

  getShieldAmount(player) {
    return 2 + player.attack;
  }
  
  use(player, enemy, stage) {
    if(stage === 0) {
      launchAttack(player, enemy, this.damage);
      enqueueDelay(500);
      return false;
    }
    gainShield(player, player, this.getShieldAmount(player));
    return true;
  }
  
  regenerateDescription(player) {
    if(player) {
      return `造成${this.damage + player.attack}伤害，获得${this.getShieldAmount(player)}/named{护盾}`;
    }
    return `造成${this.damage}伤害，获得【2+/effect{力量}】/named{护盾}`;
  }
}

// 警戒
// 获得1x警戒
export class GuardShield extends Skill {
  constructor() {
    super('警戒', 'normal', 0, 0, 1, 1);
    this.baseColdDownTurns = 1;
  }

  get coldDownTurns () {
    return this.baseColdDownTurns - Math.min(0, this.power);
  }

  get stack () {
    return Math.max(1 + this.power, 1);
  }
  
  use(player, enemy) {
    player.addEffect('警戒', 1);
    return true;
  }

  regenerateDescription(player) {
    return `获得${this.stack}层/effect{警戒}`;
  }
}

// 格挡
// 获得1格挡
export class BlockShield extends Skill {
  constructor() {
    super('格挡', 'normal', 0, 0, 1, 1);
    this.baseColdDownTurns = 1;
  }

  get stack () {
    return Math.max(1 + this.power, 1);
  }

  use(player, enemy) {
    player.addEffect('格挡', this.stack);
    return true;
  }

  regenerateDescription(player) {
    return `获得${this.stack}层/effect{格挡}`;
  }
}

// 灵能盾
// 获得13+【2x灵能】点护盾，1层警戒
export class PsychicShield extends Skill {
  constructor() {
    super('灵能盾', 'normal', 0, 1, 1, 1);
    this.baseColdDownTurns = 4;
  }

  get coldDownTurns () {
    return Math.max(this.baseColdDownTurns - this.power, 1);
  }

  get shield () {
    return Math.max(13 + 2 * this.power, 5);
  }
  get guardStacks() {
    return Math.max(1 + Math.floor(this.power / 2), 1);
  }

  getShieldAmount(player) {
    return this.shield + 2 * player.magic;
  }

  use(player, enemy, stage) {
    if(stage === 0) {
      gainShield(player, player, this.getShieldAmount(player));
      enqueueDelay(500);
      return false;
    } else {
      player.addEffect('警戒', this.guardStacks);
      return true;
    }
  }

  regenerateDescription(player) {
    if(player) return `获得${this.getShieldAmount(player)}/named{护盾}，${this.guardStacks}层/effect{警戒}`;
    return `获得【${this.shield}+2x/named{灵能}】/named{护盾}，${this.guardStacks}层/effect{警戒}`;
  }
}