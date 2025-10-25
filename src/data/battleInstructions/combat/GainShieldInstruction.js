/**
 * GainShieldInstruction - 获得护盾元语
 * 
 * 为目标提供护盾值
 * 
 * 功能：
 * - 增加目标的shield属性
 * - 添加战斗日志
 */

import { BattleInstruction } from '../BattleInstruction.js';
import { addHealLog } from '../../battleLogUtils.js';

export class GainShieldInstruction extends BattleInstruction {
  /**
   * 构造函数
   * @param {Object} config - 配置对象
   * @param {Unit} config.caster - 施法者
   * @param {Unit} config.target - 目标
   * @param {number} config.shieldAmount - 护盾值
   * @param {BattleInstruction|null} config.parentInstruction - 父元语引用
   */
  constructor({ caster, target, shieldAmount, parentInstruction = null }) {
    super({ parentInstruction });
    
    if (!caster) {
      throw new Error('GainShieldInstruction: caster is required');
    }
    if (!target) {
      throw new Error('GainShieldInstruction: target is required');
    }
    if (typeof shieldAmount !== 'number' || shieldAmount < 0) {
      throw new Error('GainShieldInstruction: shieldAmount must be a non-negative number');
    }
    
    this.caster = caster;
    this.target = target;
    this.shieldAmount = shieldAmount;
  }

  /**
   * 执行护盾获得
   * 
   * 流程：
   * 1. 增加目标的shield属性
   * 2. 添加治疗日志
   * 
   * @returns {Promise<boolean>} 始终返回true（一次性完成）
   */
  async execute() {
    // 增加护盾
    this.target.shield += this.shieldAmount;
    
    // 添加日志
    if (this.caster === this.target) {
      addHealLog(`${this.target.name}获得了${this.shieldAmount}点护盾！`);
    } else {
      addHealLog(`${this.target.name}从${this.caster.name}获得了${this.shieldAmount}点护盾！`);
    }
    
    // 一次性完成
    return true;
  }

  /**
   * 获取调试信息
   * @returns {string}
   */
  getDebugInfo() {
    return `${super.getDebugInfo()} Caster:${this.caster.name} Target:${this.target.name} Shield:${this.shieldAmount}`;
  }
}
