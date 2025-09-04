import Skill from '../skill.js';
import { launchAttack, dealDamage, gainShield } from '../../GameApp.vue';

export class PurifyWeky extends Skill {
  constructor() {
    super('纯化', 'normal', 1, '获得【2】/effect{聚气}', 1, 3);
    this.stack = 2;
    this.coldDownTurns = 2;
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      player.addEffect('聚气', this.stack);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      return `获得${this.stack}/effect{聚气}`;
    }
    return this.description;
  }
}

export class StrongPurifyWeky extends Skill {
  constructor() {
    super('超纯化', 'normal', 4, '获得【2+/named{灵能}】/effect{聚气}', 2, 3);
    this.stack = 2;
    this.coldDownTurns = 2;
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      const stack = this.stack + player.magic;
      player.addEffect('聚气', stack);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      const stack = this.stack + player.magic;
      return `获得${stack}/effect{聚气}`;
    }
    return this.description;
  }
}

// 恢复I 技能
export class VeryWeakRecovery extends Skill {
  constructor() {
    super('恢复I', '木', 1, '获得【3+/named{灵能}】/effect{再生}', 1, 3);
    this.stack = 3;
    this.coldDownTurns = 2;
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

// 恢复II 技能
export class WeakRecovery extends Skill {
  constructor() {
    super('恢复II', '木', 3, '获得【7+/named{灵能}】/effect{再生}', 2, 2);
    this.stack = 7;
    this.coldDownTurns = 2;
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
