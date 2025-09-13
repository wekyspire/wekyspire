import Skill from '../skill.js';
import { launchAttack, dealDamage, gainShield } from '../battleUtils.js';

// 紧急护盾技能
// 获得14点护盾，每次使用后，冷却时间增1
export class EmergencyShield extends Skill {
  
  constructor() {
    super('紧急护盾', 'normal', 0, 0, 1, 1);
    this.extraColdDownTurns = 0;
  }
  
  get coldDownTurns () {
    return this.extraColdDownTurns + Math.max(2 - this.power, 1);
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
  }

get coldDownTurns () {
    return Math.max(2 - this.power, 1);
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
    this.coldDownTurns = 1;
  }

  get damage () {
    return Math.max(3 + this.power, 1);
  }
  
  use(player, enemy, stage) {
    if(stage == 0) {
        dealDamage(player, enemy, this.damage);
        return false;
    }
    gainShield(player, player, 2 + player.attack);
    return true;
  }
  
  regenerateDescription(player) {
    if(player) {
      return `造成${this.damage}伤害，获得2+${player.attack}/named{护盾}`;
    }
    return `造成${this.damage}伤害，获得【2+/effect{力量}】/named{护盾}`;
  }
}

// 警戒
// 获得1x警戒
export class GuardShield extends Skill {
  constructor() {
    super('警戒', 'normal', 0, 0, 1, 1);
  }

  get coldDownTurns () {
    return 1 - Math.min(0, this.power);
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
