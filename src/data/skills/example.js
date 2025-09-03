import Skill from '../skill.js';
import { launchAttack } from '../../GameApp.vue';

// 示例技能：火球术
export class Fireball extends Skill {
  constructor() {
    super('火球术', 'magic', 1, '造成【3+魔法力】伤害', 2, 2, '火球术');
    this.baseDamage = 3;
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      const damage = this.baseDamage + player.magic;
      launchAttack(player, enemy, damage);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      const damage = this.baseDamage + player.magic;
      return `造成${damage}点伤害`;
    }
    return this.description;
  }
}

// 可以在这里添加更多技能

// 导出所有技能
export default {
  Fireball
};