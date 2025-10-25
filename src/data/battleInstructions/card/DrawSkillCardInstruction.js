/**
 * DrawSkillCardInstruction - 抽卡元语
 * 
 * 从牌库抽取指定数量的卡牌到手牌
 * 
 * 功能：
 * 1. 从backupSkills移动卡牌到frontierSkills
 * 2. 入队卡牌出现动画
 * 3. 触发SKILL_DRAWN事件
 * 4. 检查手牌上限和牌库剩余
 */

import { BattleInstruction } from '../BattleInstruction.js';
import { enqueueState, captureSnapshot } from '../../animationInstructionHelpers.js';
import { enqueueCardAnimation } from '../../../utils/animationHelpers.js';
import backendEventBus, { EventNames } from '../../../backendEventBus.js';

export class DrawSkillCardInstruction extends BattleInstruction {
  /**
   * 构造函数
   * @param {Object} config - 配置对象
   * @param {Player} config.player - 玩家对象
   * @param {number} config.count - 抽卡数量
   * @param {BattleInstruction|null} config.parentInstruction - 父元语引用
   */
  constructor({ player, count = 1, parentInstruction = null }) {
    super({ parentInstruction });
    
    if (!player) {
      throw new Error('DrawSkillCardInstruction: player is required');
    }
    if (typeof count !== 'number' || count < 0) {
      throw new Error('DrawSkillCardInstruction: count must be a non-negative number');
    }
    
    this.player = player;
    this.count = count;
    
    /**
     * 已抽取的卡牌列表
     * @type {Array<Skill>}
     */
    this.drawnSkills = [];
  }

  /**
   * 执行抽卡
   * 
   * @returns {Promise<boolean>} 始终返回true（一次性完成）
   */
  async execute() {
    // 获取修正后的玩家对象
    const modPlayer = this.player.getModifiedPlayer ? this.player.getModifiedPlayer() : this.player;
    
    // 计算实际抽卡数量
    const actualCount = Math.min(
      this.count,
      modPlayer.maxDrawSkillCardCount,
      modPlayer.maxHandSize - modPlayer.frontierSkills.length, // 手牌剩余空间
      modPlayer.backupSkills.length // 牌库剩余卡牌
    );
    
    if (actualCount <= 0) {
      // 无法抽卡
      return true;
    }
    
    // 收集抽到的卡牌ID
    const ids = [];
    
    // 抽卡
    for (let i = 0; i < actualCount; i++) {
      const skill = this.player.backupSkills.shift();
      if (!skill) break; // 牌库空了
      
      this.player.frontierSkills.push(skill);
      this.drawnSkills.push(skill);
      ids.push(skill.uniqueID);
      
      // 触发抽卡事件
      backendEventBus.emit(EventNames.Player.SKILL_DRAWN, {
        skillID: skill.uniqueID
      });
    }
    
    // 同步状态
    enqueueState({ snapshot: captureSnapshot(), durationMs: 0 });
    
    // 批量入队卡牌出现动画
    ids.forEach((id) => {
      enqueueCardAnimation(id, {
        from: { 
          anchor: 'deck', 
          scale: 0.6, 
          opacity: 0 
        },
        to: { 
          scale: 1, 
          opacity: 1 
        },
        duration: 500,
        ease: 'power2.out'
      }, { waitTags: ['state', 'ui'] });
    });
    
    // 抽卡完成
    return true;
  }

  /**
   * 获取调试信息
   * @returns {string}
   */
  getDebugInfo() {
    return `${super.getDebugInfo()} Player:${this.player.name} Count:${this.count} Drawn:${this.drawnSkills.length}`;
  }
}
