
import Skill from '../skill.js';

// 恢复I (C-)
export class VeryWeakRecovery extends Skill {
  constructor() {
    super('恢复I', '木', 1, 1, 1, 2, '恢复');
    this.coldDownTurns = 1;
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
    super('恢复II', '木', 3, 1, 1, 3, '恢复');
    this.coldDownTurns = 1;
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
    super('强力恢复', '木', 5, 1, 1, 3, '恢复');
    this.coldDownTurns = 1;
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

// 复苏（A)
export class StrongRecovery extends Skill {
  constructor() {
    super('复苏', '木', 7, 3, 1, 1, '复苏');
    this.coldDownTurns = 4;
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
    super('奇迹', '木', 9, 5, 1, 1, '奇迹');
    this.coldDownTurns = 5;
    this.subtitle = "用禁忌对抗死亡";
  }

  get stacks() {
    return Math.max(4 + this.power, 1);
  }

  // 使用技能
  use(player, enemy, stage) {
    if (stage == 0) {
      player.applyHeal(player.maxHp);
      return false;
    } else if(stage == 1) {
      player.addEffect('不灭', this.stacks);
      return false;
    } else {
      player.addEffect('禁忌', this.stacks);
      return true;
    }
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `恢复所有生命，获得${this.stacks}层/effect{不灭}和/effect{禁忌}`;
  }
}