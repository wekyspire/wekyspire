// 示例敌人：火史莱姆
// 继承自Enemy类，实现构造函数和act方法

import { launchAttack } from '../../GameApp.vue';
import Enemy from '../enemy.js';

class FireSlime extends Enemy {
  constructor(battleIntensity) {
    // 调用父类构造函数，传入基础属性
    super('火史莱姆', 30, 8, 2, 1, battleIntensity);
    this.isBoss = false; // 标记为普通敌人
    this.burnDamage = 3; // 燃烧伤害
  }
  
  calculateDamage(attack, player) {
    return attack;
  }

  // 敌人行动方法
  act(player, battleLogs) {
    // 火史莱姆有50%概率使用普通攻击，50%概率使用燃烧攻击
    if (Math.random() < 0.5) {
      // 普通攻击
      const damage = this.calculateDamage(this.attack, player);
      battleLogs.push(`${this.name}冲击！`);
      launchAttack(this, player, damage);
    } else {
      // 燃烧攻击：造成伤害并附加燃烧效果
      const damage = this.calculateDamage(this.magic, player);
      battleLogs.push(`${this.name} 使用了燃烧攻击！`);
      launchAttack(this, player, damage);
      player.addEffect('燃烧', 4);
    }
  }
}

export { FireSlime };