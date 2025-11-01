import { Slime } from './enemies/basic.js';
import { Remi, BuzzlingBugs, SlimySlime, StinkyBugs } from './enemies/extended.js';
import { MEFM3, Karmura } from './enemies/bosses.js';

// 敌人工厂类
class EnemyFactory {
  constructor() {
    this.enemyRegistry = new Map(); // 新增敌人注册表
    this.bossEnemyRegistry = new Map();
    this.specialEnemyRegistry = new Map();
    this.normalEnemyRegistry = new Map();
    
    // 初始化时注册预定义敌人
    this.registerEnemy(Slime);
    this.registerEnemy(Remi);
    this.registerEnemy(BuzzlingBugs);
    this.registerEnemy(SlimySlime);
    this.registerEnemy(StinkyBugs);
    this.registerEnemy(MEFM3);
    this.registerEnemy(Karmura);
    // this.registerEnemy(FireSlime);
    // this.registerEnemy(StinkyBugs);
    // this.registerEnemy(BuzzlingBugs);
    // this.registerEnemy(SlimySlime);

    // this.registerEnemy(BigWolf);
    // this.registerEnemy(MEFM3);
    // this.registerEnemy(Karmura);
  }
  
  // 注册敌人
  registerEnemy(EnemyClass) {
    const enemySample = new EnemyClass(1);
    this.enemyRegistry.set(enemySample.name, EnemyClass);
    if(enemySample.isBoss) this.bossEnemyRegistry.set(enemySample.name, EnemyClass);
    if(enemySample.isSpecial) this.specialEnemyRegistry.set(enemySample.name, EnemyClass);
    if(enemySample.isNormal) this.normalEnemyRegistry.set(enemySample.name, EnemyClass);
  }
  
  static createEnemy(typeName, battleIntensity) {
    const instance = this.getInstance();
    const EnemyClass = instance.enemyRegistry.get(typeName);
    if (EnemyClass) {
      return new EnemyClass(battleIntensity);
    }
    throw new Error(`Unknown enemy typeName: ${typeName}`);
  }

  static createEnemyFromClass(classType, battleIntensity) {
    return new classType(battleIntensity);
  }

  // 根据战斗强度和类型生成随机敌人
  static generateRandomEnemy(battleIntensity, isBoss = false) {
    if (isBoss) {
      const instance = this.getInstance();
      const bossEnemies = Array.from(instance.bossEnemyRegistry.keys());
      const randomType = bossEnemies[Math.floor(Math.random() * bossEnemies.length)];
      const enemy = this.createEnemy(randomType, battleIntensity);
      enemy.init();
      return enemy;
    }
    
    // 随机选择普通敌人 / 特殊敌人
    const instance = this.getInstance();
    const roll = Math.random();
    if(roll < 0.3 && battleIntensity > 4) {
      const specialEnemies = Array.from(instance.specialEnemyRegistry.keys());
      const randomType = specialEnemies[Math.floor(Math.random() * specialEnemies.length)];
      const enemy = this.createEnemy(randomType, battleIntensity);
      enemy.init();
      return enemy;
    } else {
      const normalEnemies = Array.from(instance.normalEnemyRegistry.keys());
      const randomType = normalEnemies[Math.floor(Math.random() * normalEnemies.length)];
      const enemy = this.createEnemy(randomType, battleIntensity);
      enemy.init();
      return enemy;
    }
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