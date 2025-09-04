import { BuzzlingBugs, Slime } from './enemies/basic.js';
import { Remi } from './enemies/basic.js';
import { MEFM3 } from './enemies/boss.js';
import { FireSlime } from './enemies/example.js'; // 示例敌人

// 敌人工厂类
class EnemyFactory {
  constructor() {
    this.enemyRegistry = new Map(); // 新增敌人注册表
    
    // 初始化时注册预定义敌人
    this.registerEnemy('slime', Slime);
    this.registerEnemy('remi', Remi);
    this.registerEnemy('mefm3', MEFM3);
    this.registerEnemy('fireSlime', FireSlime);
    this.registerEnemy('buzzlingBugs', BuzzlingBugs);
  }
  
  // 注册敌人
  registerEnemy(enemyType, EnemyClass) {
    this.enemyRegistry.set(enemyType, EnemyClass);
  }
  
  static createEnemy(type, battleIntensity) {
    const instance = this.getInstance();
    const EnemyClass = instance.enemyRegistry.get(type);
    if (EnemyClass) {
      return new EnemyClass(battleIntensity);
    }
    throw new Error(`Unknown enemy type: ${type}`);
  }
  
  // 根据战斗强度和类型生成随机敌人
  static generateRandomEnemy(battleIntensity, isBoss = false) {
    if (isBoss) {
      const enemy = this.createEnemy('mefm3', battleIntensity);
      enemy.init();
      return enemy;
    }
    
    // 随机选择普通敌人
    const instance = this.getInstance();
    const normalEnemies = Array.from(instance.enemyRegistry.keys()).filter(key => key !== 'mefm3');
    const randomType = normalEnemies[Math.floor(Math.random() * normalEnemies.length)];
    const enemy = this.createEnemy(randomType, battleIntensity);
    enemy.init();
    return enemy;
  }
  
  // 获取EnemyFactory实例
  static getInstance() {
    if (!this.instance) {
      this.instance = new EnemyFactory();
    }
    return this.instance;
  }
}

export default EnemyFactory;