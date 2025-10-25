/**
 * ApplyHealInstruction - 治疗元语
 * 
 * 为目标恢复生命值
 * 
 * 功能：
 * - 恢复目标的HP（不超过maxHp）
 * - 入队治疗动画（hpDamage为负值）
 */

import { BattleInstruction } from '../BattleInstruction.js';
import { enqueueHurtAnimation } from '../../animationInstructionHelpers.js';

export class ApplyHealInstruction extends BattleInstruction {
  /**
   * 构造函数
   * @param {Object} config - 配置对象
   * @param {Unit} config.target - 目标单位
   * @param {number} config.healAmount - 治疗量
   * @param {BattleInstruction|null} config.parentInstruction - 父元语引用
   */
  constructor({ target, healAmount, parentInstruction = null }) {
    super({ parentInstruction });
    
    if (!target) {
      throw new Error('ApplyHealInstruction: target is required');
    }
    if (typeof healAmount !== 'number' || healAmount < 0) {
      throw new Error('ApplyHealInstruction: healAmount must be a non-negative number');
    }
    
    this.target = target;
    this.healAmount = healAmount;
    
    /**
     * 实际治疗量
     * @type {number}
     */
    this.actualHeal = 0;
  }

  /**
   * 执行治疗
   * 
   * 流程：
   * 1. 计算实际治疗量（不超过maxHp）
   * 2. 恢复目标HP
   * 3. 入队治疗动画（hpDamage为负值表示治疗）
   * 
   * @returns {Promise<boolean>} 始终返回true（一次性完成）
   */
  async execute() {
    // 计算可治疗量
    const canHeal = Math.max(0, this.target.maxHp - this.target.hp);
    this.actualHeal = Math.min(canHeal, this.healAmount);
    
    // 恢复生命值
    this.target.hp += this.healAmount;
    if (this.target.hp > this.target.maxHp) {
      this.target.hp = this.target.maxHp;
    }
    
    // 入队治疗动画（hpDamage为负值表示治疗）
    try {
      enqueueHurtAnimation({
        unitId: this.target.uniqueID,
        hpDamage: -Math.abs(this.actualHeal),
        passThroughDamage: 0
      });
    } catch (error) {
      console.warn(`Failed to enqueue heal animation for ${this.target.name}:`, error);
    }
    
    // 一次性完成
    return true;
  }

  /**
   * 获取调试信息
   * @returns {string}
   */
  getDebugInfo() {
    return `${super.getDebugInfo()} Target:${this.target.name} Heal:${this.healAmount} Actual:${this.actualHeal}`;
  }
}
