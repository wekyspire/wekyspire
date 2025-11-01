import Enemy from '../enemy.js';
import { launchAttack } from '../battleUtils.js';
import { addEnemyActionLog } from '../battleLogUtils.js';
import {enqueueDelay} from "../animationInstructionHelpers";

// MEFM-3 Boss敌人
export class MEFM3 extends Enemy {
  constructor(battleIntensity) {
    const hp = 25 + 11 * battleIntensity;
    const attack = Math.round((3 + battleIntensity) * 0.4);
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
  act(player) {
    // 准备阶段
    if (!this.prepared) {
      this.prepared = true;
      this.addEffect('高燃弹药', 1);
      addEnemyActionLog(`${this.name} 完成了弹药装载，要来了！`);
      return;
    }
    
    // 检查是否达到生命值阈值
    if (!this.hpThresholdReached && this.hp < this.maxHp * 0.5) {
      this.hpThresholdReached = true;
      addEnemyActionLog(`${this.name} 承受了太多伤害，陷入了故障状态！`);
      this.addEffect('眩晕', 1);
      return;
    }
    
    // 正常行动序列
    const actions = [
      () => {
        addEnemyActionLog(`${this.name} 使用射流机枪扫射！`);
        const times = 2 + (this.effects['机枪升温'] || 0);
        const damage = 1 + this.attack;
        // 逐个执行攻击，并在每次攻击之间添加延时
        for(let i = 0; i < times; i++) {
          launchAttack(this, player, damage);
          enqueueDelay(800);
        }
      },
      () => {
        if(Math.random() < 0.5) {
          addEnemyActionLog(`${this.name} 使用射流机枪连续射击！`);
          const times = 2 + (this.effects['机枪升温'] || 0);
          const damage = 1 + this.attack;
          // 逐个执行攻击，并在每次攻击之间添加延时
          for(let i = 0; i < times; i++) {
            enqueueDelay(800);
            launchAttack(this, player, damage);
          }
        } else {
          addEnemyActionLog(`${this.name} 的钩爪抓住了你，你的防御变得薄弱。`);
          player.addEffect('坚固', -2);
        }
      },
      () => {
        addEnemyActionLog(`${this.name} 启动能量耦合，泄露的魏启在空气中扭曲，它周遭的温度又升高了。`);
        this.addEffect('机枪升温', 1);
        enqueueDelay(1000);
        addEnemyActionLog(`${this.name} 完成了装甲强化。`);
        this.addEffect('格挡', 2);
      }
    ];
    
    const action = actions[this.actionIndex % actions.length];
    action();
    this.actionIndex++;
  }
}


// 卡姆拉 Boss敌人
export class Karmura extends Enemy {
  constructor(battleIntensity) {
    const hp = 20 + 8 * battleIntensity;
    const attack = Math.round((6 + battleIntensity) * 0.6);
    super(
      '卡姆拉', hp, attack, 1, 0,
      new URL('../assets/enemies/slime.png', import.meta.url).href
    );
    this.type = 'boss'; // 标记为Boss敌人
    this.battleIntensity = battleIntensity;
    this.actionIndex = 0;
    this.hpThresholdReached = false;
    this.subtitle = "狂躁的猛兽";
    this.description = "一只可怖的猛兽，伊休山脉间的著名朝圣者杀手！\n ";
    this.addEffect('暴怒', 1);
  }

  // 执行行动
  act(player) {
    // 检查是否达到生命值阈值
    if (!this.hpThresholdReached && this.hp < this.maxHp * 0.5) {
      this.hpThresholdReached = true;
      addEnemyActionLog(`${this.name} 狂嚎！它彻底暴怒了！`);
      enqueueDelay(400);
      this.addEffect('暴怒', 3);
      enqueueDelay(400);
      this.addEffect('力量', 3);
      enqueueDelay(400);
      this.addEffect('格挡', 1);
      return;
    }

    // 正常行动序列
    const actions = [
      () => {
        addEnemyActionLog(`${this.name} 对你虎视眈眈。`);
        this.addEffect('暴怒', 1);
      },
      () => {
        addEnemyActionLog(`${this.name} 扑击！`);
        const result = launchAttack(this, player, this.attack);
        if (result.hpDamage > 0) {
          enqueueDelay(400);
          addEnemyActionLog(`你的鲜血让 ${this.name} 更加兴奋了！`);
          enqueueDelay(800);
          this.applyHeal(1 + this.effects['暴怒']);
          enqueueDelay(800);
          this.addEffect('力量', 1);
        }
      },
      () => {
        addEnemyActionLog(`${this.name} 狂热撕咬！`);
        const result = launchAttack(this, player, this.attack);
        if (result.hpDamage > 0) {
          enqueueDelay(400);
          addEnemyActionLog(`你的鲜血让 ${this.name} 更加兴奋了！`);
          enqueueDelay(800);
          this.applyHeal(1 + this.effects['暴怒']);
          enqueueDelay(800);
          this.addEffect('力量', 1);
        }
      },
    ];

    const action = actions[this.actionIndex % actions.length];
    action();
    this.actionIndex++;
  }
}
