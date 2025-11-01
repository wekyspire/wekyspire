import Enemy from '../enemy.js';
import { launchAttack } from '../battleUtils.js';
import { addEnemyActionLog } from '../battleLogUtils.js';
import {enqueueDelay} from "../animationInstructionHelpers";

// 雪狼 精英敌人
export class BigWolf extends Enemy {
  constructor(battleIntensity) {
    const hp = 40 + 7 * battleIntensity;
    const attack = Math.round(2 + 0.6 * battleIntensity);
    super('雪狼', hp, attack, Math.floor(battleIntensity / 5), 0);
    this.actionIndex = 0;
    this.actRounds = 0;
    this.description = "一只狼，没有什么特别的能力，但似乎过于巨大。";
    this.type = 'special';
    this.addEffect('格挡', 5);
  }

    // 执行行动
  act(player) {
    this.actRounds += 1;
    // 在第二回合为玩家增加虚弱效果
    if (this.actRounds === 2) {
      addEnemyActionLog(`${this.name} 发出一生怒吼，你双股战战几欲跌倒！`);
      player.addEffect('虚弱', 2);
      return ;
    }

    // 正常行动序列
    const actions = [
      () => {
        addEnemyActionLog(`${this.name} 冲撞攻击！`);
        const damage = 1 + this.attack;
        launchAttack(this, player, damage);
      },
      () => {
        addEnemyActionLog(`${this.name} 连续撕咬。`);
        const times = 2 + ((Math.random() > 0.5) ? 1 : 0);
        const damage = 1 + Math.floor(this.attack / 2);
        // 逐个执行攻击，并在每次攻击之间添加延时
        for(var i = 0; i < times; i++) {
            launchAttack(this, player, damage);
            // 添加延时后再执行下一次攻击
            enqueueDelay(1200);
        }
      }
    ];

    const action = actions[this.actionIndex % actions.length];
    action();
    this.actionIndex++;
  }
}