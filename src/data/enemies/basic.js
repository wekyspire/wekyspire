import { launchAttack, gainShield } from '../../GameApp.vue';
import Enemy from '../enemy.js';

// 史莱姆敌人
export class Slime extends Enemy {
  constructor(battleIntensity) {
    const hp = 13 + Math.floor(2.5 * battleIntensity);
    const attack = 1 + Math.floor(battleIntensity * 0.35);
    super('史莱姆', hp, attack, 1, battleIntensity + 1);
    this.isBoss = false; // 标记为普通敌人
    this.battleIntensity = battleIntensity;
    this.actionIndex = 0;
    this.description = "一只史莱姆，可爱捏。";
  }

  // 计算伤害
  calculateDamage(attack, target) {
    return Math.max(1, attack);
  }

  // 执行行动
  act(player, battleLogs) {
    // 史莱姆行动序列：
    // 1. 攻击，造成【1 + 攻击力】伤害。
    // 2. 攻击，造成【2 * 攻击力】伤害。
    // 3. 防御，获得【2 + 灵能强度】护盾。
    
    const actions = [
      () => {
        // 攻击，造成【3+攻击力】伤害
        const damage = this.calculateDamage(1 + this.attack, player);
        battleLogs.push(`${this.name} 冲撞！`);
        launchAttack(this, player, damage);
      },
      () => {
        // 攻击，造成【2 * 攻击力】伤害
        battleLogs.push(`${this.name} 强力冲撞！`);
        const damage = this.calculateDamage(2 * this.attack, player);
        launchAttack(this, player, damage);
      },
      () => {
        // 防御，获得【2 + 灵能强度】护盾
        const shieldAmount = 2 + this.magic;
        gainShield(this, this, shieldAmount);
        battleLogs.push(`${this.name} 进入防御状态，获得了 ${shieldAmount} 点护盾！`);
      }
    ];
    
    const action = actions[this.actionIndex % actions.length];
    this.actionIndex++;
    
    // 执行行动
    action();
    
    // 返回Promise以适配新的act方法
    return Promise.resolve();
  }
}

// 瑞米敌人
export class Remi extends Enemy {
  constructor(battleIntensity) {
    const hp = 11 + 2 * battleIntensity;
    const attack = 1 + Math.floor(battleIntensity * 0.5);
    super('魔化瑞米', hp, attack, 1, battleIntensity + 1);
    this.isBoss = false; // 标记为普通敌人
    this.battleIntensity = battleIntensity;
    this.actionIndex = 0;
    this.moneyStolen = false;
    this.description = "一只并不友善的瑞米。";
  }

  // 计算伤害
  calculateDamage(attack, target) {
    return Math.max(1, attack);
  }

  // 执行行动
  act(player, battleLogs) {
    // 魔化瑞米行动序列：
    // 1. 攻击，造成【2 + 攻击力】伤害。
    // 2. 获得1层闪避。
    // 3. 吃你的钱包，造成【3】伤害，玩家失去10金钱。
    // 4. 获得1层闪避。
    
    const actions = [
      () => {
        // 攻击，造成【2 + 攻击力】伤害
        const damage = this.calculateDamage(2 + this.attack, player);
        battleLogs.push(`${this.name} 抓挠！`);
        launchAttack(this, player, damage);
      },
      () => {
        // 获得1层闪避
        this.addEffect('闪避', 1);
        battleLogs.push(`${this.name} 进入了闪避状态！`);
      },
      () => {
        // 吃你的钱包，造成【3】伤害，玩家失去10金钱
        if (!this.moneyStolen) {
          battleLogs.push(`${this.name} 开始搞事！`);
          this.moneyStolen = true;
          const damage = this.calculateDamage(3, player);
          const attackResult = launchAttack(this, player, damage);
          if(attackResult.hpDamage > 0) {
            player.money = Math.max(0, player.money - 10);
            battleLogs.push(`${this.name} 偷偷吃掉了你的钱包，你失去了10金钱！`);
          } else {
            battleLogs.push(`${this.name} 尝试吃你的钱包，但被挡住了！`);
          }
        } else {
          // 如果已经偷过钱包，则执行普通攻击
          const damage = this.calculateDamage(6 + this.attack, player);
          battleLogs.push(`${this.name} 咬人！`);
          launchAttack(this, player, damage);
          player.hp -= damage;
        }
      },
      () => {
        // 获得1层闪避
        this.addEffect('闪避', 1);
        battleLogs.push(`${this.name} 进入了闪避状态！`);
      }
    ];
    
    const action = actions[this.actionIndex % actions.length];
    this.actionIndex++;
    
    // 执行行动
    action();
    
    // 返回Promise以适配新的act方法
    return Promise.resolve();
  }
}

// 嗡嗡虫敌人
export class BuzzlingBugs extends Enemy {
  constructor(battleIntensity) {
    const hp = 5 + Math.floor(battleIntensity);
    const attack = 1 + Math.floor(battleIntensity * 0.25);
    super('嗡嗡虫群', hp, attack, 1, battleIntensity + 1);
    this.isBoss = false; // 标记为普通敌人
    this.battleIntensity = battleIntensity;
    this.actionIndex = 0;
    this.description = "一群烦恼的嗡嗡虫，你很难够到它们。";

    this.addEffect('闪避', 2);
  }

  // 计算伤害
  calculateDamage(attack, target) {
    return Math.max(1, attack);
  }

  // 执行行动
  act(player, battleLogs) {
    // 嗡嗡虫群行动序列：
    // 1. 高飞，获得 4 层闪避。
    // 2. 攻击，造成4 x 攻击力伤害。
    let actions = [
      () => {
        // 高飞，获得 4 层闪避。
        this.addEffect('闪避', 4);
        battleLogs.push(`${this.name} 高高飞起，你很难碰到他们！`);
      return Promise.resolve();
      },
      () => {
        return new Promise((resolve) => {
          // 攻击，造成4 x 攻击力伤害。
          const damage = this.calculateDamage(this.attack, player);
          battleLogs.push(`${this.name} 集结成群，向下俯冲！`);
          const times = 4;
          // 逐个执行攻击，并在每次攻击之间添加延时
          let i = 0;
          const executeAttack = () => {
            if (i < times) {
              launchAttack(this, player, damage);
              i++;
              // 添加延时后再执行下一次攻击
              setTimeout(executeAttack, 500);
            } else {
              // 所有攻击执行完毕
              resolve();
            }
          };
        executeAttack();
        });
      }
    ];

    const action = actions[this.actionIndex % actions.length];
    this.actionIndex++;
    
    return action();
  }
}