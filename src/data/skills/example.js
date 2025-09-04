import Skill from '../skill.js';
import { launchAttack } from '../../GameApp.vue';

// 示例技能：火弹术
export class Fireshot extends Skill {
  constructor() {
    super('火弹术', 'magic', 1, '造成【2+2x/named{灵能}】伤害', 1, 2, '火弹术', 1);
    this.baseDamage = 2;
    this.upgradeTo = "火球术";
  }

  getDamage(player) {
    return this.baseDamage + player.magic * 2;
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      launchAttack(player, enemy, this.getDamage(player));
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      return `造成${this.getDamage(player)}点伤害`;
    }
    return this.description;
  }
}

// 示例技能：火球术
export class Fireball extends Skill {
  constructor() {
    super('火球术', 'magic', 2, '造成【3+3x/named{灵能}】伤害', 1, 1, '火球术', 1);
    this.baseDamage = 3;
  }

  getDamage(player) {
    return this.baseDamage + player.magic * 3;
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      launchAttack(player, enemy, this.getDamage(player));
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      return `造成${this.getDamage(player)}点伤害`;
    }
    return this.description;
  }
}

// 示例技能：大火球术
export class LargeFireball extends Skill {
  constructor() {
    super('大火球术', 'magic', 5, '造成【5+6x/named{灵能}】伤害', 2, 1, '大火球术', 1);
    this.baseDamage = 5;
  }

  getDamage(player) {
    return this.baseDamage + player.magic * 6;
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      launchAttack(player, enemy, this.getDamage(player));
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      return `造成${this.getDamage(player)}点伤害`;
    }
    return this.description;
  }
}

// 可以在这里添加更多技能

// 导出所有技能
export default {
  Fireshot,
  Fireball,
  LargeFireball
};