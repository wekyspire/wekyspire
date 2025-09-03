import Enemy from '../enemy.js';

// MEFM-3 Boss敌人
export class MEFM3 extends Enemy {
  constructor(battleIntensity) {
    const hp = 50 + 5 * battleIntensity;
    const attack = 5 + battleIntensity;
    super('MEFM-3', hp, attack, 1 + battleIntensity, 0);
    this.isBoss = true; // 标记为Boss敌人
    this.battleIntensity = battleIntensity;
    this.actionIndex = 0;
    this.prepared = false;
    this.hpThresholdReached = false;
  }

  // 执行行动
  act(player, battleLogs) {
    // 准备阶段
    if (!this.prepared) {
      this.prepared = true;
      // this.addEffect('高燃弹药', 1); // 保持不变，因为addEffect方法已更新
      this.addEffect('高燃弹药', 1);
      return { type: 'prepare' }; // 保持不变
    }
    
    // 检查是否达到生命值阈值
    if (!this.hpThresholdReached && this.hp < this.maxHp * 0.5) {
      this.hpThresholdReached = true;
      // this.addEffect('电子故障', 1); // 保持不变
      this.addEffect('电子故障', 1);
      return { type: 'special' }; // 保持不变
    }
    
    // 正常行动序列
    const actions = [
      () => ({ type: 'spray', times: 2 + (this.effects['机枪升温'] || 0), value: 1 + this.attack }),
      () => ({ type: 'spray', times: 3 + (this.effects['机枪升温'] || 0), value: 1 + this.attack }),
      () => {
        this.addEffect('机枪升温', 1);
        this.addEffect('加固', 2);
        return { type: 'couple' };
      }
    ];
    
    const action = actions[this.actionIndex % actions.length];
    this.actionIndex++;
    
    return action();
  }
}