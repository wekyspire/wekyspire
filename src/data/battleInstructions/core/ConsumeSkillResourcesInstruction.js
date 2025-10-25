/**
 * ConsumeSkillResourcesInstruction - 消耗技能资源元语
 * 
 * 消耗使用技能所需的资源：
 * - 行动力（actionPoints）
 * - 魏启（mana）
 * - 使用次数（uses）
 * 
 * 通常作为UseSkillInstruction的第一个子元语执行
 */

import { BattleInstruction } from '../BattleInstruction.js';

export class ConsumeSkillResourcesInstruction extends BattleInstruction {
  /**
   * 构造函数
   * @param {Object} config - 配置对象
   * @param {Player} config.player - 玩家对象
   * @param {Skill} config.skill - 技能对象
   * @param {BattleInstruction|null} config.parentInstruction - 父元语引用
   */
  constructor({ player, skill, parentInstruction = null }) {
    super({ parentInstruction });
    
    if (!player) {
      throw new Error('ConsumeSkillResourcesInstruction: player is required');
    }
    if (!skill) {
      throw new Error('ConsumeSkillResourcesInstruction: skill is required');
    }
    
    this.player = player;
    this.skill = skill;
  }

  /**
   * 执行资源消耗
   * 
   * 流程：
   * 1. 消耗行动力
   * 2. 消耗魏启
   * 3. 消耗使用次数
   * 
   * @returns {Promise<boolean>} 始终返回true（一次性完成）
   */
  async execute() {
    // 消耗行动力
    if (this.skill.actionPointCost > 0) {
      this.player.consumeActionPoints(this.skill.actionPointCost);
    }
    
    // 消耗魏启
    if (this.skill.manaCost > 0) {
      this.player.consumeMana(this.skill.manaCost);
    }
    
    // 消耗使用次数
    if (this.skill.maxUses !== Infinity) {
      this.skill.consumeUses(1);
    }
    
    // 一次性完成
    return true;
  }

  /**
   * 获取调试信息
   * @returns {string}
   */
  getDebugInfo() {
    return `${super.getDebugInfo()} Player:${this.player.name} Skill:${this.skill.name} AP:${this.skill.actionPointCost} Mana:${this.skill.manaCost}`;
  }
}
