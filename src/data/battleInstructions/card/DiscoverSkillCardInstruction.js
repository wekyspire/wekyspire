/**
 * DiscoverSkillCardInstruction - 发现卡牌元语
 * 
 * 创建新卡牌并添加到玩家牌组
 */

import { BattleInstruction } from '../BattleInstruction.js';
import { DrawSkillCardInstruction } from './DrawSkillCardInstruction.js';
import { DropSkillCardInstruction } from './DropSkillCardInstruction.js';
import { BurnSkillCardInstruction } from './BurnSkillCardInstruction.js';
import { submitInstruction } from '../globalExecutor.js';
import { enqueueDelay } from '../../animationInstructionHelpers.js';
import { enqueueCardAppearInPlace } from '../../../utils/animationHelpers.js';
import backendEventBus, { EventNames } from '../../../backendEventBus.js';

export class DiscoverSkillCardInstruction extends BattleInstruction {
  constructor({ player, skill, destination = 'skills-hand', parentInstruction = null }) {
    super({ parentInstruction });
    
    if (!player) throw new Error('DiscoverSkillCardInstruction: player is required');
    if (!skill) throw new Error('DiscoverSkillCardInstruction: skill is required');
    
    this.player = player;
    this.skill = skill;
    this.destination = destination; // 'skills-hand' 或 'deck'
    this.executionStage = 0;
  }

  async execute() {
    if (this.executionStage === 0) {
      // 先放入overlaySkills以注册card牌DOM元素
      this.player.overlaySkills.push(this.skill);
      enqueueDelay(0);
      enqueueCardAppearInPlace(this.skill.uniqueID, { duration: 300 });
      
      // 触发发现事件
      backendEventBus.emit(EventNames.Player.SKILL_DISCOVERED, {
        skill: this.skill,
        destination: this.destination
      });
      
      this.executionStage = 1;
      return false;
    }
    
    if (this.executionStage === 1) {
      // 根据destination处理
      if (this.destination === 'skills-hand') {
        if (this.player.frontierSkills.length >= this.player.maxHandSize) {
          // 手牌已满，焚毁
          const burnInst = new BurnSkillCardInstruction({
            player: this.player,
            skillID: this.skill.uniqueID,
            parentInstruction: this
          });
          submitInstruction(burnInst);
        } else {
          // 抽到手牌
          const drawInst = new DrawSkillCardInstruction({
            player: this.player,
            count: 1, // 只抽这张特定的卡
            parentInstruction: this
          });
          // 注意：这里需要特殊处理，因为drawSelectedSkillCard是从backupSkills或overlaySkills中抽取特定卡
          // 为简化，直接调用dropSkillCard让它进入backupSkills，然后用DrawSkillCardInstruction抽取
          const dropInst = new DropSkillCardInstruction({
            player: this.player,
            skillID: this.skill.uniqueID,
            deckPosition: 0, // 放在牌库顶
            parentInstruction: this
          });
          submitInstruction(dropInst);
          // 暂时不提交drawInst，等dropInst完成后在下一阶段处理
          this.executionStage = 2;
          return false;
        }
      } else {
        // 放入牌库
        const dropInst = new DropSkillCardInstruction({
          player: this.player,
          skillID: this.skill.uniqueID,
          parentInstruction: this
        });
        submitInstruction(dropInst);
      }
      
      return true;
    }
    
    if (this.executionStage === 2) {
      // 从牌库顶抽一张（就是刚才放进去的）
      const drawInst = new DrawSkillCardInstruction({
        player: this.player,
        count: 1,
        parentInstruction: this
      });
      submitInstruction(drawInst);
      return true;
    }
    
    return true;
  }

  getDebugInfo() {
    return `${super.getDebugInfo()} Player:${this.player.name} Skill:${this.skill.name} Dest:${this.destination}`;
  }
}
