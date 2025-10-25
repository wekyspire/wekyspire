/**
 * AddEffectInstruction - 添加效果元语
 * 
 * 为目标添加状态效果（燃烧、格挡、力量等）
 * 
 * 功能：
 * - 修改目标的effects对象
 * - 触发玩家效果变化事件（用于UI更新）
 * - 支持添加正数（增加层数）和负数（减少层数）
 */

import { BattleInstruction } from '../BattleInstruction.js';
import backendEventBus, { EventNames } from '../../../backendEventBus.js';

export class AddEffectInstruction extends BattleInstruction {
  /**
   * 构造函数
   * @param {Object} config - 配置对象
   * @param {Unit} config.target - 目标单位
   * @param {string} config.effectName - 效果名称
   * @param {number} config.stacks - 层数（可为负数表示移除）
   * @param {BattleInstruction|null} config.parentInstruction - 父元语引用
   */
  constructor({ target, effectName, stacks = 1, parentInstruction = null }) {
    super({ parentInstruction });
    
    if (!target) {
      throw new Error('AddEffectInstruction: target is required');
    }
    if (!effectName || typeof effectName !== 'string') {
      throw new Error('AddEffectInstruction: effectName must be a non-empty string');
    }
    if (typeof stacks !== 'number') {
      throw new Error('AddEffectInstruction: stacks must be a number');
    }
    
    this.target = target;
    this.effectName = effectName;
    this.stacks = stacks;
  }

  /**
   * 执行效果添加
   * 
   * 流程：
   * 1. 修改目标的effects对象
   * 2. 如果目标是玩家，触发EFFECT_CHANGED事件
   * 
   * @returns {Promise<boolean>} 始终返回true（一次性完成）
   */
  async execute() {
    // 跳过0层数的操作
    if (this.stacks === 0) {
      return true;
    }
    
    // 修改目标效果
    if (this.target.effects[this.effectName]) {
      this.target.effects[this.effectName] += this.stacks;
    } else {
      this.target.effects[this.effectName] = this.stacks;
    }
    
    // 如果目标是玩家，触发效果变化事件
    if (this.target.type === 'player') {
      backendEventBus.emit(EventNames.Player.EFFECT_CHANGED, {
        effectName: this.effectName,
        deltaStacks: this.stacks
      });
    }
    
    // 一次性完成
    return true;
  }

  /**
   * 获取调试信息
   * @returns {string}
   */
  getDebugInfo() {
    return `${super.getDebugInfo()} Target:${this.target.name} Effect:${this.effectName} Stacks:${this.stacks}`;
  }
}
