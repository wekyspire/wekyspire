
import Skill from "../skill";

// 恢复I (C-)
export class VeryWeakRecovery extends Skill {
  constructor() {
    super('恢复I', '木', 1, '获得【3+/named{灵能}】/effect{再生}', 1, 3);
    this.stack = 3;
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      player.addEffect('再生', this.stack + player.magic);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      const stack = this.stack + player.magic;
      return `获得${stack}/effect{再生}`;
    }
    return this.description;
  }
}

// 恢复II （B-）
export class WeakRecovery extends Skill {
  constructor() {
    super('恢复II', '木', 3, '获得【7+/named{灵能}】/effect{再生}', 2, 2);
    this.stack = 7;
    this.upgradeTo = "恢复III";
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      const stack = this.stack + player.magic;
      player.addEffect('再生', this.stack);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      const stack = this.stack + player.magic;
      return `获得${stack}/effect{再生}`;
    }
    return this.description;
  }
}

// 恢复III （B+）
export class Recovery extends Skill {
  constructor() {
    super('恢复III', '木', 5, '获得【10+/named{灵能}】/effect{再生}', 3, 1);
    this.stack = 10;
    this.upgradeTo = "复苏";
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      const stack = this.stack + player.magic;
      player.addEffect('再生', this.stack);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      const stack = this.stack + player.magic;
      return `获得${stack}/effect{再生}`;
    }
    return this.description;
  }
}

// 复苏（A)
export class MiraculousRecovery extends Skill {
  constructor() {
    super('复苏', '木', 8, '立刻恢复60%生命，并获得【15+/named{灵能}】/effect{再生}', 4, 1);
    this.stack = 15;
    this.upgradeTo = "奇迹";
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      const stack = this.stack + player.magic;
      player.addEffect('再生', this.stack);
      player.applyHeal(Math.floor(player.maxHp * 0.6));
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      const stack = this.stack + player.magic;
      return `立刻恢复60%生命，并获得${stack}/effect{再生}`;
    }
    return this.description;
  }
}

// 奇迹(S)
export class Miracle extends Skill {
  constructor() {
    super('奇迹', '木', 10, '清空负面效果，恢复所有生命，获得【4】层/effect{不灭}和/effect{禁忌}', 5, 1);
    this.stack = 20;
    this.subtitle = "用禁忌对抗死亡";
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      player.clearNegativeEffects();
      player.hp = player.maxHp;
      player.addEffect('不灭', 4);
      player.addEffect('禁忌', 4);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `清空负面效果，恢复所有生命，获得4层/effect{不灭}和/effect{禁忌}`;
  }
}