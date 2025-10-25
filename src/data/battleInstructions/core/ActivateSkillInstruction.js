/**
 * ActivateSkillInstruction - 发动技能元语
 * 
 * 执行技能的实际效果逻辑（调用skill.use方法）
 * 
 * 功能：
 * 1. 处理技能发动时效果（连发等）
 * 2. 检查战斗是否结束
 * 3. 调用skill.use方法（支持多阶段技能）
 * 4. 发送SKILL_USED事件
 * 
 * 设计说明：
 * - 保留skill.use作为技能效果定义入口，最小化对现有技能代码的改动
 * - skill.use内部可调用辅助函数创建并提交新元语
 * - 支持多阶段技能（通过stage参数）
 */

import { BattleInstruction } from '../BattleInstruction.js';
import { processSkillActivationEffects } from '../../effectProcessor.js';
import backendEventBus, { EventNames } from '../../../backendEventBus.js';

export class ActivateSkillInstruction extends BattleInstruction {
  /**
   * 构造函数
   * @param {Object} config - 配置对象
   * @param {Player} config.player - 玩家对象
   * @param {Skill} config.skill - 技能对象
   * @param {Enemy} config.enemy - 敌人对象
   * @param {BattleInstruction|null} config.parentInstruction - 父元语引用
   */
  constructor({ player, skill, enemy, parentInstruction = null }) {
    super({ parentInstruction });
    
    if (!player) {
      throw new Error('ActivateSkillInstruction: player is required');
    }
    if (!skill) {
      throw new Error('ActivateSkillInstruction: skill is required');
    }
    if (!enemy) {
      throw new Error('ActivateSkillInstruction: enemy is required');
    }
    
    this.player = player;
    this.skill = skill;
    this.enemy = enemy;
    
    /**
     * 技能内部阶段（对应skill.use的stage参数）
     * 支持多阶段技能
     */
    this.stage = 0;
  }

  /**
   * 执行技能发动（多阶段）
   * 
   * 流程：
   * 1. 处理技能发动时效果
   * 2. 检查战斗是否结束，若结束则取消自身并返回true
   * 3. 调用skill.use(player, enemy, stage)
   * 4. 若skill.use返回true，发送SKILL_USED事件并返回true
   * 5. 否则stage++并返回false（下次继续调用skill.use）
   * 
   * @returns {Promise<boolean>}
   */
  async execute() {
    // 处理技能发动时效果（仅在stage=0时处理）
    if (this.stage === 0) {
      // 使用修正后的玩家对象
      const modPlayer = this.player.getModifiedPlayer ? this.player.getModifiedPlayer() : this.player;
      processSkillActivationEffects(modPlayer);
      
      // 检查战斗是否结束
      if (this._checkBattleEnded()) {
        this.cancel(); // 取消自身
        return true;
      }
    }
    
    // 调用skill.use方法
    // 使用修正后的玩家对象
    const modPlayer = this.player.getModifiedPlayer ? this.player.getModifiedPlayer() : this.player;
    const result = this.skill.use(modPlayer, this.enemy, this.stage);
    
    // 检查战斗是否结束
    if (this._checkBattleEnded()) {
      this.cancel(); // 取消自身
      return true;
    }
    
    // 根据返回值决定是否完成
    if (result === true) {
      // 技能使用完成，发送事件
      backendEventBus.emit(EventNames.Battle.SKILL_USED, {
        skill: this.skill,
        player: this.player,
        enemy: this.enemy
      });
      return true;
    } else {
      // 未完成，进入下一阶段
      this.stage++;
      return false; // 保留在栈顶，下次继续执行
    }
  }

  /**
   * 检查战斗是否结束
   * @returns {boolean}
   * @private
   */
  _checkBattleEnded() {
    const isPlayerDead = this.player.hp <= 0;
    const isEnemyDead = this.enemy.hp <= 0;
    
    if (isPlayerDead || isEnemyDead) {
      // 战斗结束，触发胜利/失败事件
      backendEventBus.emit(EventNames.Battle.BATTLE_VICTORY, !isPlayerDead);
      return true;
    }
    
    return false;
  }

  /**
   * 获取调试信息
   * @returns {string}
   */
  getDebugInfo() {
    return `${super.getDebugInfo()} Player:${this.player.name} Skill:${this.skill.name} Enemy:${this.enemy.name} Stage:${this.stage}`;
  }
}
