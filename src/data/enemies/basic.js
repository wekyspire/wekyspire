import Enemy from '../enemy.js';
import { addEnemyActionLog } from '../battleLogUtils.js';
import { createAndSubmitLaunchAttack, createAndSubmitGainShield } from '../battleInstructionHelpers.js';

// 史莱姆敌人（指令式API）
export class Slime extends Enemy {
  constructor(battleIntensity) {
    const hp = 27 + Math.floor(6 * battleIntensity);
    const attack = 3 + Math.floor(battleIntensity * 0.6);
    super('史莱姆', hp, attack, 1,
      new URL('../../assets/enemies/slime.png', import.meta.url).href
    );
    this.battleIntensity = battleIntensity;
    this.actionIndex = 0;
    this.description = '一只史莱姆，很可爱捏。';
  }

  // 预告下回合意图
  getIntention() {
    const next = this.actionIndex % 3;
    if (next === 0) {
      // 轻撞：1x 攻击
      const damage = this.calculateDamage(0, null);
      return [{ type: 'attack', times: 1, damage }];
    } else if (next === 1) {
      const damage = this.calculateDamage(this.attack, null);
      return [{ type: 'attack', times: 1, damage }];
    } else {
      const amount = 2 + this.magic;
      return [{ type: 'defend', amount }];
    }
  }

  // 计算伤害
  calculateDamage(base, target) {
    return base + this.attack;
  }

  // 执行行动（在 EnemyActInstruction 执行器环境中运行）
  act(player) {
    // 史莱姆行动序列：
    // 1. 攻击，造成【攻击力】伤害。
    // 2. 攻击，造成【2 * 攻击力】伤害。
    // 3. 防御，获得【2 + 灵能强度】护盾。
    const actions = [
      () => {
        addEnemyActionLog(`${this.name} 冲撞！`);
        createAndSubmitLaunchAttack(this, player, 0);
      },
      () => {
        addEnemyActionLog(`${this.name} 强力冲撞！`);
        createAndSubmitLaunchAttack(this, player, this.attack);
      },
      () => {
        const shieldAmount = 2 + this.magic;
        createAndSubmitGainShield(this, this, shieldAmount);
        addEnemyActionLog(`${this.name} 进入防御状态，获得了 ${shieldAmount} 点护盾！`);
      }
    ];

    const action = actions[this.actionIndex % actions.length];
    this.actionIndex++;
    action();
  }
}