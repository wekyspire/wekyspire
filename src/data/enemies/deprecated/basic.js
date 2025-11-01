import {launchAttack, gainShield, discoverSkillCard} from '../battleUtils.js';
import Enemy from '../enemy.js';
import { addEnemyActionLog } from '../battleLogUtils.js';

// 史莱姆敌人
export class Slime extends Enemy {
  constructor(battleIntensity) {
    const hp = 27 + Math.floor(6 * battleIntensity);
    const attack = 3 + Math.floor(battleIntensity * 0.6);
    super('史莱姆', hp, attack, 1, 
      new URL('../../assets/enemies/slime.png', import.meta.url).href
    );
    this.battleIntensity = battleIntensity;
    this.actionIndex = 0;
    this.description = "一只史莱姆，很可爱捏。";
  }

  // 计算伤害
  calculateDamage(attack, target) {
    return Math.max(1, attack);
  }

  // 执行行动
  act(player) {
    // 史莱姆行动序列：
    // 1. 攻击，造成【1 + 攻击力】伤害。
    // 2. 攻击，造成【2 * 攻击力】伤害。
    // 3. 防御，获得【2 + 灵能强度】护盾。
    
    const actions = [
      () => {
        addEnemyActionLog(`${this.name} 冲撞！`);
        // 攻击，造成【攻击力】伤害
        const damage = this.calculateDamage(this.attack, player);
        launchAttack(this, player, damage);
      },
      () => {
        addEnemyActionLog(`${this.name} 强力冲撞！`);
        // 攻击，造成【2 * 攻击力】伤害
        const damage = this.calculateDamage(2 * this.attack, player);
        launchAttack(this, player, damage);
      },
      () => {
        // 防御，获得【2 + 灵能强度】护盾
        const shieldAmount = 2 + this.magic;
        gainShield(this, this, shieldAmount);
        addEnemyActionLog(`${this.name} 进入防御状态，获得了 ${shieldAmount} 点护盾！`);
      }
    ];
    
    const action = actions[this.actionIndex % actions.length];
    this.actionIndex++;
    
    // 执行行动
    action();
  }
}

// 瑞米敌人
export class Remi extends Enemy {
  constructor(battleIntensity) {
    const hp = 23 + 5 * battleIntensity;
    const attack = 6 + Math.floor(battleIntensity * 0.8);
    super('魔化瑞米', hp, attack, 1, 
      new URL('../../assets/enemies/slime.png', import.meta.url).href
    );
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
  act(player) {
    // 魔化瑞米行动序列：
    // 1. 攻击，造成【攻击力】伤害。
    // 2. 获得1层闪避。
    // 3. 吃你的钱包，造成【3】伤害，玩家失去10金钱。
    // 4. 获得1层闪避。
    
    let advanceAction = 1;

    const actions = [
      () => {
        // 攻击，造成【攻击力】伤害
        const damage = this.calculateDamage(this.attack, player);
        addEnemyActionLog(`${this.name} 抓挠！`);
        launchAttack(this, player, damage);
      },
      () => {
        // 获得1层闪避
        this.addEffect('闪避', 1);
        addEnemyActionLog(`${this.name} 进入了闪避状态！`);
      },
      () => {
        // 吃你的钱包，造成【3】伤害，玩家失去10金钱
        if (!this.moneyStolen) {
          this.moneyStolen = true;
          addEnemyActionLog(`${this.name} 开始搞事！`);
          enqueueDelay(500);
          const damage = this.calculateDamage(3, player);
          const attackResult = launchAttack(this, player, damage);
          if(attackResult.hpDamage > 0) {
            player.money = Math.max(0, player.money - 10);
            addEnemyActionLog(`${this.name} 偷偷吃掉了你的钱包，你失去了10金钱！`);
          } else {
            addEnemyActionLog(`${this.name} 尝试吃你的钱包，但被挡住了！`);
          }
        } else {
          // 如果已经偷过钱包，则执行普通攻击
          const damage = this.calculateDamage(6 + this.attack, player);
          addEnemyActionLog(`${this.name} 咬人！`);
          launchAttack(this, player, damage);
        }
      },
      () => {
        // 获得1层闪避
        this.addEffect('闪避', 1);
        addEnemyActionLog(`${this.name} 进入了闪避状态！`);
      }
    ];
    
    const action = actions[this.actionIndex % actions.length];
    
    // 执行行动
    action();
    this.actionIndex ++;
  }
}

// 嗡嗡虫群敌人
export class BuzzlingBugs extends Enemy {
  constructor(battleIntensity) {
    const hp = 5 + Math.floor(2 * battleIntensity);
    const attack = 1 + Math.floor(battleIntensity * 0.5);
    super('嗡嗡虫群', hp, attack, 0, 
      new URL('../../assets/enemies/slime.png', import.meta.url).href
    );
    this.battleIntensity = battleIntensity;
    this.actionIndex = 0;
    this.description = "一群烦恼的嗡嗡虫，你很难够到它们。";

    this.addEffect('闪避', 1);
  }

  // 计算伤害
  calculateDamage(attack, target) {
    return Math.max(1, attack);
  }

  // 执行行动
  act(player) {
    let advanceAction = 0;
    // 嗡嗡虫群行动序列：
    // 1. 高飞，获得 4 层闪避。
    // 2. 攻击，造成4 x 攻击力伤害。
    let actions = [
      () => {
        // 高飞，获得 1 层闪避。
        this.addEffect('闪避', 1);
        addEnemyActionLog(`${this.name} 高高飞起，你很难碰到他们！`);
        advanceAction = 1;
        return {};
      },
      () => {
        // 攻击，造成4 x 攻击力伤害。
        const damage = this.calculateDamage(this.attack, player);
        addEnemyActionLog(`${this.name} 集结成群，向下俯冲！`);
        for(var i = 0; i < 4; i++) {
          enqueueDelay(500);
          launchAttack(this, player, damage);
        }
        return {};
      }
    ];

    const action = actions[this.actionIndex % actions.length];
    action();
    this.actionIndex ++;
  }
}

// 黏黏史莱姆敌人
import { SlimeCurse } from '../skills/curse/enemyCurses.js';
import {enqueueDelay} from "../animationInstructionHelpers";

export class SlimySlime extends Enemy {
  constructor(battleIntensity) {
    const hp = 27 + Math.floor(6 * battleIntensity);
    const attack = 3 + Math.floor(battleIntensity * 0.6);
    super('黏黏史莱姆', hp, attack, 1, 
      new URL('../../assets/enemies/slime.png', import.meta.url).href
    );
    this.battleIntensity = battleIntensity;
    this.actionIndex = 0;
    this.description = "一只充满了粘液的史莱姆。";
  }

  // 计算伤害
  calculateDamage(attack, target) {
    return Math.max(1, attack);
  }

  // 执行行动
  act(player) {
    // 史莱姆行动序列：
    // 1. 诅咒，为玩家添加粘液后备技能。
    // 2. 攻击，造成【1 + 攻击力】伤害。
    // 3. 攻击，造成【2 * 攻击力】伤害。
    
    const actions = [
      () => {
        // 诅咒
        const curse = new SlimeCurse();
        discoverSkillCard(player, curse, 'deck');
        addEnemyActionLog(`${this.name} 喷了你一脸，你的后备技能中多了一张/skill{${curse.name}}！`);
      },
      () => {
        addEnemyActionLog(`${this.name} 冲撞！`);
        // 攻击，造成【攻击力】伤害
        const damage = this.calculateDamage(this.attack, player);
        launchAttack(this, player, damage);
      },
      () => {
        addEnemyActionLog(`${this.name} 强力冲撞！`);
        // 攻击，造成【2 * 攻击力】伤害
        const damage = this.calculateDamage(2 * this.attack, player);
        launchAttack(this, player, damage);
      }
    ];
    
    const action = actions[this.actionIndex % actions.length];
    this.actionIndex++;
    
    // 执行行动
    action();
  }
}

// 腐食甲虫敌人
export class StinkyBugs extends Enemy {
  constructor(battleIntensity) {
    const hp = 18 + Math.floor(4 * battleIntensity);
    const attack = 1 + Math.floor(battleIntensity * 0.2);
    super('腐食甲虫', hp, attack, 1,
      new URL('../../assets/enemies/slime.png', import.meta.url).href
    );
    this.battleIntensity = battleIntensity;
    this.actionIndex = 0;
    this.description = "一群散发着臭气的大甲虫，噫，好恶心。";
    this.addEffect("坚固", 2);
  }

  // 计算伤害
  calculateDamage(attack, target) {
    return Math.max(1, attack);
  }

  // 执行行动
  act(player) {
    // 1. 攻击，造成【攻击力】伤害。同时为玩家添加中毒x3效果。

    const actions = [
      () => {
        addEnemyActionLog(`${this.name} 撞击！`);
        // 攻击，造成【攻击力】伤害
        const damage = this.calculateDamage(this.attack, player);
        const attackResult = launchAttack(this, player, damage);
        enqueueDelay(600);
        player.addEffect('中毒', 3);
        addEnemyActionLog(`${this.name} 的臭气让你感到恶心，你中毒了！`);
      }
    ];

    const action = actions[this.actionIndex % actions.length];
    this.actionIndex++;

    // 执行行动
    action();
  }
}