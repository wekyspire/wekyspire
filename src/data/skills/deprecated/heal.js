
import Skill from '../skill.js';

// 恢复I (C-)
export class VeryWeakRecovery extends Skill {
  constructor() {
    super('恢复I', 'wood', 1, 1, 1, 1, '恢复');
    this.baseColdDownTurns = 6;
    this.upgradeTo = "恢复II";
  }

  get baseStacks() {
    return Math.max(3 + this.power, 1);
  }

  getStacks(player) {
    return this.baseStacks + player.magic;
  }

  // 使用技能
  use(player, enemy) {
    player.addEffect('再生', this.getStacks(player));
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if(player) return `获得${this.getStacks(player)}/effect{再生}`;
    return `获得【${this.baseStacks}+/named{灵能}】层/effect{再生}`;
  }
}

// 恢复II （B-）
export class WeakRecovery extends Skill {
  constructor() {
    super('恢复II', 'wood', 3, 1, 1, 1, '恢复');
    this.baseColdDownTurns = 8;
    this.upgradeTo = "恢复III";
  }

  get baseStacks() {
    return Math.max(4 + this.power, 1);
  }

  getStacks(player) {
    return this.baseStacks + player.magic;
  }

  // 使用技能
  use(player, enemy) {
    player.addEffect('再生', this.getStacks(player));
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if(player) return `获得${this.getStacks(player)}/effect{再生}`;
    return `获得【${this.baseStacks}+/named{灵能}】层/effect{再生}`;
  }
}

// 强力恢复 （B+）
export class Recovery extends Skill {
  constructor() {
    super('强力恢复', 'wood', 5, 1, 1, 1, '恢复');
    this.baseColdDownTurns = 10;
    this.upgradeTo = "强力恢复";
  }

  get baseStacks() {
    return Math.max(7 + this.power, 1);
  }

  getStacks(player) {
    return this.baseStacks + player.magic;
  }

  // 使用技能
  use(player, enemy) {
    player.addEffect('再生', this.getStacks(player));
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if(player) return `获得${this.getStacks(player)}/effect{再生}`;
    return `获得【${this.baseStacks}+/named{灵能}】层/effect{再生}`;
  }
}

// 治疗I （C+）
export class WeakHeal extends Skill {
  constructor() {
    super('治疗I', 'wood', 2, 1, 1, 1, '治疗');
    this.baseColdDownTurns = 4;
    this.upgradeTo = "治疗II";
  }

  get baseHeal() {
    return Math.max(7 + 3 * this.power, 1);
  }

  getHeal(player) {
    return this.baseHeal + 2 * player.magic;
  }

  // 使用技能
  use(player, enemy) {
    player.heal(this.getHeal(player))
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if(player) return `治疗${this.getHeal(player)}`;
    return `治疗【${this.baseHeal}+2x/named{灵能}】`;
  }
}

// 治疗II （B）
export class Heal extends Skill {
  constructor() {
    super('治疗II', 'wood', 4, 2, 1, 1, '治疗');
    this.baseColdDownTurns = 4;
    this.upgradeTo = "治愈";
  }

  get baseHeal() {
    return Math.max(9 + 5 * this.power, 1);
  }

  getHeal(player) {
    return this.baseHeal + 4 * player.magic;
  }

  // 使用技能
  use(player, enemy) {
    player.heal(this.getHeal(player))
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if(player) return `治疗${this.getHeal(player)}`;
    return `治疗【${this.baseHeal}+4x/named{灵能}】`;
  }
}

// 治愈 （A-）
export class StrongHeal extends Skill {
  constructor() {
    super('治愈', 'wood', 6, 3, 1, 1, '治疗');
    this.baseColdDownTurns = 4;
    this.upgradeTo = "复苏";
  }

  get baseHeal() {
    return Math.max(12 + 8 * this.power, 1);
  }

  getHeal(player) {
    return this.baseHeal + 6 * player.magic;
  }

  // 使用技能
  use(player, enemy) {
    player.heal(this.getHeal(player))
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if(player) return `治疗${this.getHeal(player)}`;
    return `治疗【${this.baseHeal}+6x/named{灵能}】`;
  }
}


// 复苏（A+）
export class StrongRecovery extends Skill {
  constructor() {
    super('复苏', 'wood', 8, 4, 1, 1, '复苏');
    this.baseColdDownTurns = 10;
    this.upgradeTo = "奇迹";
  }

  get baseStacks() {
    return Math.max(15 + 4 * this.power, 1);
  }

  getStacks(player) {
    return this.baseStacks + player.magic;
  }

  // 使用技能
  use(player, enemy, stage) {
    if(stage === 0) {
      player.addEffect('再生', this.getStacks(player));
      return false;
    } else {
      player.applyHeal(Math.floor(player.maxHp * 0.6));
      return true;
    }
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if(player)
      return `立刻恢复60%生命，并获得${this.getStacks(player)}/effect{再生}`;
    return `立刻恢复60%生命，并获得【${this.baseStacks}+/named{灵能}】层/effect{再生}`;
  }
}

// 奇迹(S)
export class Miracle extends Skill {
  constructor() {
    super('奇迹', 'wood', 9, 5, 1, 1, '奇迹');
    this.baseColdDownTurns = 10;
    this.subtitle = "用禁忌对抗死亡";
    this.image = "奇迹.png";
  }

  get stacks() {
    return Math.max(3 + this.power, 1);
  }

  // 使用技能
  use(player, enemy, stage) {
    if (stage === 0) {
      player.applyHeal(player.maxHp);
      return false;
    } else if(stage === 1) {
      player.addEffect('不灭', this.stacks);
      return false;
    } else {
      player.addEffect('禁忌', this.stacks);
      return true;
    }
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `恢复生命，获得${this.stacks}层/effect{不灭}和/effect{禁忌}`;
  }
}