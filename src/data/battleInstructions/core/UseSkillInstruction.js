/**
 * UseSkillInstruction - 使用技能元语
 * 
 * 表示玩家使用一张技能卡的完整流程：
 * 1. 消耗资源（行动力、魏启、使用次数）
 * 2. 发动技能（执行技能效果）
 * 3. 技能使用后处理（焚毁/回到牌库）
 * 
 * 这是最顶层的技能使用元语，通常由Battle.js或用户操作触发。
 */

import { BattleInstruction } from '../BattleInstruction.js';
import { ConsumeSkillResourcesInstruction } from './ConsumeSkillResourcesInstruction.js';
import { ActivateSkillInstruction } from './ActivateSkillInstruction.js';
import { submitInstruction } from '../globalExecutor.js';
import { addPlayerActionLog } from '../../battleLogUtils.js';
import { enqueueDelay, enqueueState, captureSnapshot, enqueueCardDropToDeck } from '../../animationInstructionHelpers.js';
import { enqueueCardAnimation } from '../../../utils/animationHelpers.js';
import { willSkillBurn } from '../../battleUtils.js';
import { createAndSubmitBurnSkillCard, createAndSubmitDropSkillCard } from '../../battleInstructionHelpers.js';
import backendEventBus, { EventNames } from '../../../backendEventBus.js';

export class UseSkillInstruction extends BattleInstruction {
  /**
   * 构造函数
   * @param {Object} config - 配置对象
   * @param {Player} config.player - 使用技能的玩家
   * @param {Skill} config.skill - 要使用的技能对象
   * @param {Enemy} config.enemy - 目标敌人
   * @param {BattleInstruction|null} config.parentInstruction - 父元语引用
   */
  constructor({ player, skill, enemy, parentInstruction = null }) {
    super({ parentInstruction });
    
    if (!player) {
      throw new Error('UseSkillInstruction: player is required');
    }
    if (!skill) {
      throw new Error('UseSkillInstruction: skill is required');
    }
    if (!enemy) {
      throw new Error('UseSkillInstruction: enemy is required');
    }
    
    this.player = player;
    this.skill = skill;
    this.enemy = enemy;
    
    /**
     * 执行阶段
     * 0: 初始状态，添加日志和动画，创建ConsumeSkillResourcesInstruction
     * 1: 资源消耗完成，创建ActivateSkillInstruction
     * 2: 技能发动完成，处理技能使用后逻辑（咏唱/焚毁/回牌库）
     */
    this.executionStage = 0;
  }

  /**
   * 执行技能使用（多阶段）
   * 
   * @returns {Promise<boolean>}
   */
  async execute() {
    if (this.executionStage === 0) {
      // 阶段0: 添加日志和动画，创建资源消耗元语
      
      // 添加战斗日志
      addPlayerActionLog(`你使用了 /blue{${this.skill.name}}！`);
      
      // 技能脱手发动动画（卡牌移动到中央）
      enqueueCardAnimation(this.skill.uniqueID, {
        anchor: 'center',
        to: { scale: 1.2 },
        duration: 350
      }, { tags: ['card-use'], waitTags: [] });
      enqueueDelay(0);
      
      // 创建资源消耗元语
      const consumeResourcesInst = new ConsumeSkillResourcesInstruction({
        player: this.player,
        skill: this.skill,
        parentInstruction: this
      });
      submitInstruction(consumeResourcesInst);
      
      // 进入下一阶段
      this.executionStage = 1;
      return false;
    }
    
    if (this.executionStage === 1) {
      // 阶段1: 创建技能发动元语
      
      const activateInst = new ActivateSkillInstruction({
        player: this.player,
        skill: this.skill,
        enemy: this.enemy,
        parentInstruction: this
      });
      submitInstruction(activateInst);
      
      // 进入下一阶段
      this.executionStage = 2;
      return false;
    }
    
    if (this.executionStage === 2) {
      // 阶段2: 技能使用后处理
      
      // 发送技能使用事件
      backendEventBus.emit(EventNames.Player.SKILL_USED, {
        player: this.player,
        skill: this.skill
      });
      
      // 咏唱型技能特殊处理：进入咏唱位，不走普通后处理
      if (this.skill.cardMode === 'chant') {
        this._activateChantSkill();
      } else {
        this._handleSkillAfterUse();
      }
      
      enqueueDelay(0);
      
      // 技能使用完成
      return true;
    }
    
    // 不应该到达这里
    console.error(`UseSkillInstruction: Unexpected executionStage ${this.executionStage}`);
    return true;
  }

  /**
   * 咏唱型技能：将技能放入咏唱位
   * @private
   */
  _activateChantSkill() {
    const player = this.player;
    const skill = this.skill;
    
    // 从手牌中移除
    const idx = player.frontierSkills.indexOf(skill);
    if (idx !== -1) {
      player.frontierSkills.splice(idx, 1);
    }
    
    // 若需要替换现有咏唱
    if (!player.hasFreeActivatedSlot() && player.activatedSkills.length) {
      const replaced = player.activatedSkills[0];
      if (replaced) {
        const willBurnReplaced = willSkillBurn(replaced);
        // 生命周期钩子在burn/丢弃之前调用
        try {
          replaced.onDisable(player, 'replaced');
        } catch (_) {}
        backendEventBus.emit(EventNames.Player.ACTIVATED_SKILL_DISABLED, {
          skill: replaced,
          reason: 'replaced'
        });
        
        if (willBurnReplaced) {
          // 指令式焚毁（会处理容器迁移与动画）
          createAndSubmitBurnSkillCard(player, replaced.uniqueID, this);
        } else {
          // 指令式丢回牌库底（会从activated中移除并进后备）
          createAndSubmitDropSkillCard(player, replaced.uniqueID, -1, this);
        }
      }
    }
    
    // 放入咏唱位
    player.activatedSkills.push(skill);
    try {
      skill.onEnable(player);
    } catch (_) {}
    backendEventBus.emit(EventNames.Player.ACTIVATED_SKILL_ENABLED, {
      skill,
      reason: 'use'
    });
    backendEventBus.emit(EventNames.Player.ACTIVATED_SKILLS_UPDATED, {
      activatedSkills: player.activatedSkills
    });
    
    enqueueState({ snapshot: captureSnapshot(), durationMs: 0 });
    
    // Transition animation - 卡牌从手牌移动到咏唱位
    enqueueCardAnimation(skill.uniqueID, {
      to: { scale: 1.0 },
      duration: 400,
      ease: 'power2.inOut'
    }, { tags: ['card-activate'], waitTags: ['state'] });
  }

  /**
   * 普通技能使用后处理（焚毁/回牌库）
   * @private
   */
  _handleSkillAfterUse() {
    const player = this.player;
    const skill = this.skill;
    const shouldBurn = willSkillBurn(skill);
    if (shouldBurn) {
      // 指令式焚毁（两阶段：离场→焚毁）
      createAndSubmitBurnSkillCard(player, skill.uniqueID, this);
    } else {
      // 指令式回牌库（丢到牌库底）
      createAndSubmitDropSkillCard(player, skill.uniqueID, -1, this);
    }
  }

  /**
   * 获取调试信息
   * @returns {string}
   */
  getDebugInfo() {
    return `${super.getDebugInfo()} Player:${this.player.name} Skill:${this.skill.name} Enemy:${this.enemy.name} Stage:${this.executionStage}`;
  }
}
