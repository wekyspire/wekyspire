// filepath: c:\Users\hineven\CLionProjects\rtvl_test\src\data\battleInstructions\turnEffects\ProcessStartOfTurnEffectInstruction.js
import { BattleInstruction } from '../BattleInstruction.js';
import { enqueueDelay } from '../../animationInstructionHelpers.js';
import { createAndSubmitAddEffect, createAndSubmitGainMana, createAndSubmitSkillCoolDown, createAndSubmitDealDamage, createAndSubmitAddEffectLog } from '../../battleInstructionHelpers.js';

export class ProcessStartOfTurnEffectInstruction extends BattleInstruction {
  constructor({ target, effectName, parentInstruction = null }) {
    super({ parentInstruction });
    if (!target) throw new Error('ProcessStartOfTurnEffectInstruction: target is required');
    if (!effectName) throw new Error('ProcessStartOfTurnEffectInstruction: effectName is required');
    this.target = target;
    this.effectName = effectName;
  }

  async execute() {
    const t = this.target;
    const name = this.effectName;

    switch (name) {
      case '警戒': {
        if ((t.effects['警戒'] || 0) > 0) {
          createAndSubmitAddEffect(t, '警戒', -1, this);
        } else {
          // 无警戒，清空护盾
          t.shield = 0;
        }
        break;
      }
      case '吸热': {
        const stacks = Math.min(t.effects['吸热'] || 0, t.effects['燃烧'] || 0);
        if (stacks > 0) {
          createAndSubmitAddEffect(t, '燃烧', -stacks, this);
          enqueueDelay(400);
        }
        break;
      }
      case '燃烧': {
        const burn = t.effects['燃烧'] || 0;
        if (burn > 0) {
          const resistant = t.effects['火焰抗性'] || 0;
          const damage = Math.max(burn - resistant, 0);
          createAndSubmitAddEffect(t, '燃烧', -1, this);
          if (damage > 0) {
            createAndSubmitAddEffectLog(`${t.name}被烧伤了，受到${damage}伤害！`, this);
            createAndSubmitDealDamage(null, t, damage, false, this);
          }
          enqueueDelay(400);
        }
        break;
      }
      case '聚气': {
        const amt = t.effects['聚气'] || 0;
        if (amt > 0) {
          createAndSubmitGainMana(t, amt, this);
          createAndSubmitAddEffectLog(`${t.name}通过/effect{聚气}恢复了${amt}点魏启！`, this);
          enqueueDelay(400);
          createAndSubmitAddEffect(t, '聚气', -amt, this);
        }
        break;
      }
      case '肌肉记忆': {
        if (t.frontierSkills) {
          t.frontierSkills.forEach(skill => {
            try { if (skill.canColdDown()) createAndSubmitSkillCoolDown(skill, 1, this); } catch (_) {}
          });
        }
        createAndSubmitAddEffect(t, '肌肉记忆', -1, this);
        break;
      }
      case '飞行': {
        if ((t.effects['飞行'] || 0) > 0) {
          createAndSubmitAddEffect(t, '闪避', 1, this);
          createAndSubmitAddEffectLog(`${t.name}通过/effect{飞行}获得了1层/effect{闪避}！`, this);
          enqueueDelay(400);
        }
        break;
      }
      case '眩晕': {
        if ((t.effects['眩晕'] || 0) > 0) {
          createAndSubmitAddEffect(t, '眩晕', -1, this);
          createAndSubmitAddEffectLog(`${t.name}处于眩晕状态，跳过回合！`, this);
          enqueueDelay(400);
        }
        break;
      }
      default:
        break;
    }

    return true;
  }

  getDebugInfo() {
    return `${super.getDebugInfo()} SoT:${this.effectName}(${this.target?.name||'?'})`;
  }
}
