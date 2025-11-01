// filepath: c:\Users\hineven\CLionProjects\rtvl_test\src\data\battleInstructions\turnEffects\ProcessEndOfTurnEffectInstruction.js
import { BattleInstruction } from '../BattleInstruction.js';
import { enqueueDelay } from '../../animationInstructionHelpers.js';
import {
  createAndSubmitAddEffect,
  createAndSubmitDealDamage,
  createAndSubmitApplyHeal,
  createAndSubmitGainMana,
  createAndSubmitConsumeMana,
  createAndSubmitAddEffectLog
} from '../../battleInstructionHelpers.js';

/**
 * 处理单个回合结束效果的元语
 * 根据 effectName 执行相应的状态更改与日志/动画，并保持父链
 */
export class ProcessEndOfTurnEffectInstruction extends BattleInstruction {
  constructor({ target, effectName, parentInstruction = null }) {
    super({ parentInstruction });
    if (!target) throw new Error('ProcessEndOfTurnEffectInstruction: target is required');
    if (!effectName) throw new Error('ProcessEndOfTurnEffectInstruction: effectName is required');
    this.target = target;
    this.effectName = effectName;
  }

  async execute() {
    const t = this.target;
    const name = this.effectName;

    switch (name) {
      case '吸收': {
        const amt = t.effects['吸收'] || 0;
        if (amt > 0) {
          createAndSubmitGainMana(t, amt, this);
          createAndSubmitAddEffectLog(`${t.name}通过/effect{吸收}恢复了${amt}点魏启！`, this);
          enqueueDelay(400);
        }
        break;
      }
      case '漏气': {
        const amt = t.effects['漏气'] || 0;
        if (amt > 0) {
          createAndSubmitConsumeMana(t, amt, this);
          createAndSubmitAddEffectLog(`${t.name}因/effect{漏气}失去了${amt}点魏启！`, this);
          enqueueDelay(400);
        }
        break;
      }
      case '中毒': {
        const dmg = t.effects['中毒'] || 0;
        if (dmg > 0) {
          createAndSubmitDealDamage(null, t, dmg, true, this);
          createAndSubmitAddEffect(t, '中毒', -1, this);
          createAndSubmitAddEffectLog(`${t.name}受到/effect{中毒}影响，受到${dmg}真实伤害！`, this);
          enqueueDelay(400);
        }
        break;
      }
      case '再生': {
        const heal = t.effects['再生'] || 0;
        if (heal > 0) {
          createAndSubmitApplyHeal(t, heal, this);
          createAndSubmitAddEffect(t, '再生', -1, this);
          createAndSubmitAddEffectLog(`${t.name}通过/effect{再生}恢复了${heal}点/named{生命}！`, this);
          enqueueDelay(400);
        }
        break;
      }
      case '超然': {
        const stacks = t.effects['超然'] || 0;
        if (stacks > 0) {
          createAndSubmitAddEffect(t, '集中', stacks, this);
          createAndSubmitAddEffectLog(`${t.name}通过/effect{超然}获得了${stacks}层/effect{集中}！`, this);
          enqueueDelay(400);
        }
        break;
      }
      case '侵蚀': {
        const stacks = t.effects['侵蚀'] || 0;
        if (stacks > 0) {
          createAndSubmitAddEffect(t, '集中', -stacks, this);
          createAndSubmitAddEffectLog(`${t.name}受到/effect{侵蚀}影响，失去了${stacks}层/effect{集中}！`, this);
          enqueueDelay(400);
        }
        break;
      }
      case '燃心': {
        const lvl = t.effects['燃心'] || 0;
        if (lvl > 0) {
          const c = 3 * lvl;
          createAndSubmitAddEffect(t, '集中', c, this);
          createAndSubmitAddEffectLog(`${t.name}通过/effect{燃心}获得了${c}层/effect{集中}！`, this);
          enqueueDelay(400);
          const burn = 8 * lvl;
          createAndSubmitAddEffect(t, '燃烧', burn, this);
          createAndSubmitAddEffectLog(`${t.name}通过/effect{燃心}获得了${burn}层/effect{燃烧}！`, this);
          enqueueDelay(400);
        }
        break;
      }
      case '成长': {
        const stacks = t.effects['成长'] || 0;
        if (stacks > 0) {
          createAndSubmitAddEffect(t, '力量', stacks, this);
          createAndSubmitAddEffectLog(`${t.name}通过/effect{成长}获得了${stacks}层/effect{力量}！`, this);
          enqueueDelay(400);
        }
        break;
      }
      case '衰败': {
        const stacks = t.effects['衰败'] || 0;
        if (stacks > 0) {
          createAndSubmitAddEffect(t, '力量', -stacks, this);
          createAndSubmitAddEffectLog(`${t.name}受到/effect{衰败}影响，失去了${stacks}层/effect{力量}！`, this);
          enqueueDelay(400);
        }
        break;
      }
      case '巩固': {
        const stacks = t.effects['巩固'] || 0;
        if (stacks > 0) {
          createAndSubmitAddEffect(t, '坚固', stacks, this);
          createAndSubmitAddEffectLog(`${t.name}通过/effect{巩固}获得了${stacks}层/effect{坚固}！`, this);
          enqueueDelay(400);
        }
        break;
      }
      case '崩溃': {
        const stacks = t.effects['崩溃'] || 0;
        if (stacks > 0) {
          createAndSubmitAddEffect(t, '坚固', -stacks, this);
          createAndSubmitAddEffectLog(`${t.name}受到/effect{崩溃}影响，失去了${stacks}层/effect{坚固}！`, this);
          enqueueDelay(400);
        }
        break;
      }
      case '魏宗圣体': {
        const stacks = t.effects['魏宗圣体'] || 0;
        if (stacks > 0) {
          createAndSubmitAddEffect(t, '集中', stacks, this);
          createAndSubmitAddEffect(t, '力量', stacks, this);
          createAndSubmitAddEffect(t, '坚固', stacks, this);
          createAndSubmitAddEffectLog(`${t.name}通过/effect{魏宗圣体}获得了${stacks}层/effect{集中}、/effect{力量}和/effect{坚固}！`, this);
          enqueueDelay(400);
        }
        break;
      }
      case '解体': {
        const stacks = t.effects['解体'] || 0;
        if (stacks > 0) {
          createAndSubmitAddEffect(t, '集中', -stacks, this);
          createAndSubmitAddEffect(t, '力量', -stacks, this);
          createAndSubmitAddEffect(t, '坚固', -stacks, this);
          createAndSubmitAddEffectLog(`${t.name}受到/effect{解体}影响，失去了${stacks}层/effect{集中}、/effect{力量}和/effect{坚固}！`, this);
          enqueueDelay(400);
        }
        break;
      }
      case '易伤': {
        if ((t.effects['易伤'] || 0) > 0) {
          createAndSubmitAddEffect(t, '易伤', -1, this);
        }
        break;
      }
      case '虚弱': {
        if ((t.effects['虚弱'] || 0) > 0) {
          createAndSubmitAddEffect(t, '虚弱', -1, this);
        }
        break;
      }
      case '不灭': {
        if ((t.effects['不灭'] || 0) > 0) {
          createAndSubmitAddEffect(t, '不灭', -1, this);
        }
        break;
      }
      case '禁忌': {
        if ((t.effects['禁忌'] || 0) > 0) {
          createAndSubmitAddEffect(t, '禁忌', -1, this);
        }
        break;
      }
      case '滞气': {
        if ((t.effects['滞气'] || 0) > 0) {
          createAndSubmitAddEffect(t, '滞气', -1, this);
        }
        break;
      }
      default:
        // 未处理的效果忽略
        break;
    }

    return true;
  }

  getDebugInfo() {
    return `${super.getDebugInfo()} EoT:${this.effectName}(${this.target?.name||'?'})`;
  }
}
