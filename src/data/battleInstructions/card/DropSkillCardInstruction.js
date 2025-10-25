/**
 * DropSkillCardInstruction - 弃卡元语
 * 
 * 将卡牌从手牌/咏唱位丢回牌库
 */

import { BattleInstruction } from '../BattleInstruction.js';
import { enqueueCardDropToDeck } from '../../animationInstructionHelpers.js';
import backendEventBus, { EventNames } from '../../../backendEventBus.js';

export class DropSkillCardInstruction extends BattleInstruction {
  constructor({ player, skillID, deckPosition = -1, parentInstruction = null }) {
    super({ parentInstruction });
    
    if (!player) throw new Error('DropSkillCardInstruction: player is required');
    if (!skillID) throw new Error('DropSkillCardInstruction: skillID is required');
    
    this.player = player;
    this.skillID = skillID;
    this.deckPosition = deckPosition; // -1表示牌库底
  }

  async execute() {
    let droppedSkill = null;
    
    // 尝试从手牌丢弃
    const frontierIndex = this.player.frontierSkills.findIndex(skill => skill.uniqueID === this.skillID);
    if (frontierIndex !== -1) {
      enqueueCardDropToDeck(this.skillID, {}, {});
      [droppedSkill] = this.player.frontierSkills.splice(frontierIndex, 1);
    } else {
      // 尝试从咏唱位丢弃
      const activatedIndex = Array.isArray(this.player.activatedSkills) 
        ? this.player.activatedSkills.findIndex(skill => skill.uniqueID === this.skillID) 
        : -1;
      if (activatedIndex !== -1) {
        enqueueCardDropToDeck(this.skillID, {}, {});
        [droppedSkill] = this.player.activatedSkills.splice(activatedIndex, 1);
      } else {
        // 最后尝试从overlaySkills丢弃
        const overlayIndex = this.player.overlaySkills.findIndex(skill => skill.uniqueID === this.skillID);
        if (overlayIndex !== -1) {
          enqueueCardDropToDeck(this.skillID, {}, {});
          [droppedSkill] = this.player.overlaySkills.splice(overlayIndex, 1);
        } else {
          console.warn(`技能ID为 ${this.skillID} 的技能不在前台/咏唱位/Overlay列表中，无法丢弃。`);
          return true;
        }
      }
    }
    
    // 放回牌库
    if (this.deckPosition < 0) {
      this.player.backupSkills.push(droppedSkill);
    } else {
      this.player.backupSkills.splice(this.deckPosition, 0, droppedSkill);
    }
    
    // 触发技能丢弃事件
    backendEventBus.emit(EventNames.Player.SKILL_DROPPED, { skill: droppedSkill });
    
    return true;
  }

  getDebugInfo() {
    return `${super.getDebugInfo()} Player:${this.player.name} SkillID:${this.skillID} DeckPos:${this.deckPosition}`;
  }
}
