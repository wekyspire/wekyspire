// filepath: c:\Users\hineven\CLionProjects\rtvl_test\src\data\battleInstructions\card\DrawSelectedSkillCardInstruction.js
/**
 * DrawSelectedSkillCardInstruction - 抽取指定ID的卡牌
 *
 * 支持从牌库（backupSkills）或 overlaySkills 抽取指定卡牌，并正确触发动画与事件。
 */

import { BattleInstruction } from '../BattleInstruction.js';
import { enqueueState, captureSnapshot } from '../../animationInstructionHelpers.js';
import { enqueueAnimatableElementEnterTracking, enqueueCardAnimation } from '../../../utils/animationHelpers.js';
import backendEventBus, { EventNames } from '../../../backendEventBus.js';

export class DrawSelectedSkillCardInstruction extends BattleInstruction {
  constructor({ player, skillID, parentInstruction = null }) {
    super({ parentInstruction });
    if (!player) throw new Error('DrawSelectedSkillCardInstruction: player is required');
    if (!skillID) throw new Error('DrawSelectedSkillCardInstruction: skillID is required');
    this.player = player;
    this.skillID = skillID;
  }

  async execute() {
    const player = this.player;

    // 手牌已满或抽卡上限为0则直接返回
    if (player.frontierSkills.length >= player.maxHandSize || player.maxDrawSkillCardCount <= 0) {
      return true;
    }

    // 先尝试从牌库抽取
    const index = player.backupSkills.findIndex(skill => skill.uniqueID === this.skillID);
    if (index !== -1) {
      const [drawnSkill] = player.backupSkills.splice(index, 1);
      player.frontierSkills.push(drawnSkill);

      // 状态快照
      enqueueState({ snapshot: captureSnapshot(), durationMs: 0 });

      // 1. 牌库位置出现（小牌）
      const appearTag = enqueueCardAnimation(this.skillID, {
        from: { anchor: 'deck', scale: 0.6, opacity: 1 },
        ease: 'power2.out'
      }, { waitTags: ['all'] });

      // 2. 开启锚点跟踪，飞入手牌
      enqueueAnimatableElementEnterTracking(this.skillID, { waitTags: [appearTag] });

      backendEventBus.emit(EventNames.Player.SKILL_DRAWN, { skillID: drawnSkill.uniqueID });
      return true;
    }

    // 再尝试从 overlaySkills 抽取（新发现的卡牌）
    const overlayIndex = player.overlaySkills.findIndex(skill => skill.uniqueID === this.skillID);
    if (overlayIndex !== -1) {
      // 先飞到中间
      const centerTag = enqueueCardAnimation(this.skillID, {
        anchor: 'center',
        to: { scale: 1.2 },
        duration: 350
      }, { waitTags: ['all'] });

      const [drawnSkill] = player.overlaySkills.splice(overlayIndex, 1);
      player.frontierSkills.push(drawnSkill);

      // 然后回到原位（开启锚点跟踪，自动前往手牌）
      enqueueAnimatableElementEnterTracking(this.skillID, { waitTags: [centerTag] });

      backendEventBus.emit(EventNames.Player.SKILL_DRAWN, { skillID: drawnSkill.uniqueID });
      return true;
    }

    console.warn(`技能ID为 ${this.skillID} 的技能不在后备/Overlay列表中，无法抽取。`);
    return true;
  }

  getDebugInfo() {
    return `${super.getDebugInfo()} Player:${this.player.name} SkillID:${this.skillID}`;
  }
}

