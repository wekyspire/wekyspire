import Enemy from '../enemy.js';
import { addEnemyActionLog } from '../battleLogUtils.js';
import { createAndSubmitLaunchAttack } from '../battleInstructionHelpers.js';

// MEFM-3 Boss
export class MEFM3 extends Enemy {
  constructor(battleIntensity) {
    const hp = 25 + 11 * battleIntensity;
    const attack = Math.round((3 + battleIntensity) * 0.4);
    super('MEFM-3', hp, attack, 1 + Math.floor(battleIntensity / 5),
      new URL('../../assets/enemies/slime.png', import.meta.url).href
    );
    this.type = 'boss';
    this.battleIntensity = battleIntensity;
    this.actionIndex = 0;
    this.prepared = false;
    this.hpThresholdReached = false;
    this.subtitle = '嗡鸣的古代机械';
    this.description = '冷冰冰的钢铁包不住炙热的心，现在——它要燃起来了！\n 第一次生命值低于50%时，眩晕1回合。';
  }
  getIntention() {
    if (!this.prepared) return [{ type: 'buff', name: '装填高燃弹药' }];
    if (!this.hpThresholdReached && this.hp < this.maxHp * 0.5) return [{ type: 'debuff', name: '自陷入故障(眩晕)' }];
    const next = this.actionIndex % 3;
    if (next === 0) return [{ type: 'attack', times: 2 + (this.effects['机枪升温'] || 0), damage: 1 + this.attack }];
    if (next === 1) return [{ type: 'special', name: '连续射击或降防' }];
    return [{ type: 'buff', name: '升温+1, 格挡+2' }];
  }
  act(player) {
    if (!this.prepared) {
      this.prepared = true;
      this.addEffect('高燃弹药', 1);
      addEnemyActionLog(`${this.name} 完成了弹药装载，要来了！`);
      return;
    }
    if (!this.hpThresholdReached && this.hp < this.maxHp * 0.5) {
      this.hpThresholdReached = true;
      addEnemyActionLog(`${this.name} 承受了太多伤害，陷入了故障状态！`);
      this.addEffect('眩晕', 1);
      return;
    }
    const actions = [
      () => {
        addEnemyActionLog(`${this.name} 使用射流机枪扫射！`);
        const times = 2 + (this.effects['机枪升温'] || 0);
        const damage = 1;
        for (let i = 0; i < times; i++) {
          createAndSubmitLaunchAttack(this, player, damage);
        }
      },
      () => {
        if (Math.random() < 0.5) {
          addEnemyActionLog(`${this.name} 使用射流机枪连续射击！`);
          const times = 2 + (this.effects['机枪升温'] || 0);
          const damage = 1;
          for (let i = 0; i < times; i++) {
            createAndSubmitLaunchAttack(this, player, damage);
          }
        } else {
          addEnemyActionLog(`${this.name} 的钩爪抓住了你，你的防御变得薄弱。`);
          player.addEffect('坚固', -2);
        }
      },
      () => {
        addEnemyActionLog(`${this.name} 启动能量耦合，泄露的魏启在空气中扭曲，它周遭的温度又升高了。`);
        this.addEffect('机枪升温', 1);
        addEnemyActionLog(`${this.name} 完成了装甲强化。`);
        this.addEffect('格挡', 2);
      }
    ];
    const action = actions[this.actionIndex % actions.length];
    action();
    this.actionIndex++;
  }
}

// 卡姆拉 Boss
export class Karmura extends Enemy {
  constructor(battleIntensity) {
    const hp = 20 + 8 * battleIntensity;
    const attack = Math.round((6 + battleIntensity) * 0.6);
    super('卡姆拉', hp, attack, 1,
      new URL('../../assets/enemies/slime.png', import.meta.url).href
    );
    this.type = 'boss';
    this.battleIntensity = battleIntensity;
    this.actionIndex = 0;
    this.hpThresholdReached = false;
    this.subtitle = '狂躁的猛兽';
    this.description = '一只可怖的猛兽，伊休山脉间的著名朝圣者杀手！';
    this.effects['暴怒'] = 1;
  }
  getIntention() {
    if (!this.hpThresholdReached && this.hp < this.maxHp * 0.5) {
      return [{ type: 'buff', name: '狂怒(暴怒+3 力量+3 格挡+1)' }];
    }
    const next = this.actionIndex % 3;
    if (next === 0) return [{ type: 'buff', name: '暴怒+1' }];
    return [{ type: 'attack', times: 1, damage: this.attack }];
  }
  act(player) {
    if (!this.hpThresholdReached && this.hp < this.maxHp * 0.5) {
      this.hpThresholdReached = true;
      addEnemyActionLog(`${this.name} 狂嚎！它彻底暴怒了！`);
      this.addEffect('暴怒', 3);
      this.addEffect('力量', 3);
      this.addEffect('格挡', 1);
      return;
    }
    const actions = [
      () => {
        addEnemyActionLog(`${this.name} 对你虎视眈眈。`);
        this.addEffect('暴怒', 1);
      },
      () => {
        addEnemyActionLog(`${this.name} 扑击！`);
        createAndSubmitLaunchAttack(this, player, 0);
        // 额外奖励
        this.applyHeal(1 + (this.effects['暴怒'] || 0));
        this.addEffect('力量', 1);
      },
      () => {
        addEnemyActionLog(`${this.name} 狂热撕咬！`);
        createAndSubmitLaunchAttack(this, player, 0);
        this.applyHeal(1 + (this.effects['暴怒'] || 0));
        this.addEffect('力量', 1);
      }
    ];
    const action = actions[this.actionIndex % actions.length];
    action();
    this.actionIndex++;
  }
}

