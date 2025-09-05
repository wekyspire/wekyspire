// 示例敌人：火史莱姆
// 继承自Enemy类，实现构造函数和act方法

import { launchAttack } from '../../GameApp.vue';
import Enemy from '../enemy.js';

class FireSlime extends Enemy {
  constructor(battleIntensity) {
    // 调用父类构造函数，传入基础属性
    super('火史莱姆', 13, 8, 1, 1, battleIntensity);
    this.burnDamage = 3; // 燃烧伤害
    this.description = "一只史莱姆，但它为什么在冒火？";
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
    
    // 返回Promise以适配新的act方法
    return Promise.resolve();
  }
}

export { FireSlime };