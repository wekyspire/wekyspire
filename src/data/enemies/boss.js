import Enemy from '../enemy.js';
import { launchAttack } from '../battleUtils.js';

// MEFM-3 Boss敌人
export class MEFM3 extends Enemy {
  constructor(battleIntensity) {
    const hp = 50 + 11 * battleIntensity;
    const attack = Math.round((3 + battleIntensity) * 0.5);
    super(
      'MEFM-3', hp, attack, 1 + Math.floor(battleIntensity / 5), 0,
      new URL('../assets/enemies/slime.png', import.meta.url).href
    );
    this.type = 'boss'; // 标记为Boss敌人
    this.battleIntensity = battleIntensity;
    this.actionIndex = 0;
    this.prepared = false;
    this.hpThresholdReached = false;
    this.subtitle = "嗡鸣的古代机械";
    this.description = "冷冰冰的钢铁包不住炙热的心，现在——它要燃起来了！\n 第一次生命值低于50%时，眩晕1回合。";
  }

  // 执行行动
  act(player, battleLogs) {
    // 准备阶段
    if (!this.prepared) {
      this.prepared = true;
      this.addEffect('高燃弹药', 1);
      battleLogs.push(`${this.name} 完成了弹药装载，要来了！`);
      return Promise.resolve();
    }
    
    // 检查是否达到生命值阈值
    if (!this.hpThresholdReached && this.hp < this.maxHp * 0.5) {
      this.hpThresholdReached = true;
      battleLogs.push(`${this.name} 承受了太多伤害，陷入了故障状态！`);
      this.addEffect('眩晕', 1);
      return Promise.resolve();
    }
    
    // 正常行动序列
    const actions = [
      () => {
        return new Promise((resolve) => {
          battleLogs.push(`${this.name} 使用射流机枪扫射！`);
          const times = 2 + (this.effects['机枪升温'] || 0);
          const damage = 1 + this.attack;
          // 逐个执行攻击，并在每次攻击之间添加延时
          let i = 0;
          const executeAttack = () => {
            if (i < times) {
              launchAttack(this, player, damage);
              i++;
              // 添加延时后再执行下一次攻击
              setTimeout(executeAttack, 800);
            } else {
              // 所有攻击执行完毕
              resolve();
            }
          };
          executeAttack();
        });
      },
      () => {
        if(Math.random() < 0.5) {
          return new Promise((resolve) => {
            battleLogs.push(`${this.name} 使用射流机枪连续射击！`);
            const times = 2 + (this.effects['机枪升温'] || 0);
            const damage = 1 + this.attack;
            // 逐个执行攻击，并在每次攻击之间添加延时
            let i = 0;
            const executeAttack = () => {
              if (i < times) {
                launchAttack(this, player, damage);
                i++;
                // 添加延时后再执行下一次攻击
                setTimeout(executeAttack, 800);
              } else {
                // 所有攻击执行完毕
                resolve();
              }
            };
            executeAttack();
          });
        } else {
          return new Promise((resolve) => {
            battleLogs.push(`${this.name} 的钩爪抓住了你，你的防御变得薄弱。`);
            player.addEffect('防御', -2);
            setTimeout(() =>{resolve();}, 1000);
          });
        }
      },
      () => {
        return new Promise((resolve) => {
          battleLogs.push(`${this.name} 启动能量耦合，泄露的魏启在空气中扭曲，它周遭的温度又升高了。`);
          this.addEffect('机枪升温', 1);
          const X = () => {
            battleLogs.push(`${this.name} 完成了装甲强化。`);
            this.addEffect('格挡', 2);
            resolve();
          };
          setTimeout(X, 1000);
        });
      }
    ];
    
    const action = actions[this.actionIndex % actions.length];
    this.actionIndex++;
    
    return action();
  }
}
