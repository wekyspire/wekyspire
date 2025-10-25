/**
 * BurnSkillCardInstruction - 焚毁卡牌元语
 * 
 * 永久移除卡牌（移入焚毁区）
 */

import { BattleInstruction } from '../BattleInstruction.js';
import { enqueueState, captureSnapshot } from '../../animationInstructionHelpers.js';
import { enqueueCardBurn } from '../../../utils/animationHelpers.js';
import backendEventBus, { EventNames } from '../../../backendEventBus.js';

export class BurnSkillCardInstruction extends BattleInstruction {
  constructor({ player, skillID, parentInstruction = null }) {
    super({ parentInstruction });
    
    if (!player) throw new Error('BurnSkillCardInstruction: player is required');
    if (!skillID) throw new Error('BurnSkillCardInstruction: skillID is required');
    
    this.player = player;
    this.skillID = skillID;
  }

  async execute() {
    const frontierIndex = this.player.frontierSkills.findIndex(skill => skill.uniqueID === this.skillID);
    const backupIndex = this.player.backupSkills.findIndex(skill => skill.uniqueID === this.skillID);
    const activatedIndex = Array.isArray(this.player.activatedSkills) 
      ? this.player.activatedSkills.findIndex(skill => skill.uniqueID === this.skillID) 
      : -1;
    
    if (frontierIndex === -1 && backupIndex === -1 && activatedIndex === -1) {
      console.warn(`技能ID为 ${this.skillID} 的技能不在前台/后备/咏唱位列表中，无法焚烧。`);
      return true;
    }

    let exhaustedSkill = null;
    let fromContainer = 'unknown';
    
    if (activatedIndex !== -1) {
      exhaustedSkill = this.player.activatedSkills[activatedIndex];
      fromContainer = 'activated-bar';
    } else if (frontierIndex !== -1) {
      exhaustedSkill = this.player.frontierSkills[frontierIndex];
      fromContainer = 'skills-hand';
    } else {
      exhaustedSkill = this.player.backupSkills[backupIndex];
      fromContainer = 'deck';
    }
    
    // 卡牌离场
    exhaustedSkill.onLeaveBattle(this.player);

    // 使用新的焚毁动画系统
    enqueueCardBurn(this.skillID, { waitTags: ['all'] });

    // 修改状态
    if (activatedIndex !== -1) {
      this.player.activatedSkills.splice(activatedIndex, 1);
      this.player.burntSkills.push(exhaustedSkill);
    } else if (frontierIndex !== -1) {
      this.player.frontierSkills.splice(frontierIndex, 1);
      this.player.burntSkills.push(exhaustedSkill);
    } else if (backupIndex !== -1) {
      this.player.backupSkills.splice(backupIndex, 1);
      this.player.burntSkills.push(exhaustedSkill);
    }
    
    // 从总技能数组移除
    const skillListIndex = this.player.skills.findIndex(skill => skill === exhaustedSkill);
    if (skillListIndex !== -1) this.player.skills.splice(skillListIndex, 1);
    
    // 触发技能焚毁事件
    backendEventBus.emit(EventNames.Player.SKILL_BURNT, { skill: exhaustedSkill });
    enqueueState({ snapshot: captureSnapshot(), durationMs: 0 });
    
    return true;
  }

  getDebugInfo() {
    return `${super.getDebugInfo()} Player:${this.player.name} SkillID:${this.skillID}`;
  }
}
