// filepath: c:\Users\hineven\CLionProjects\rtvl_test\src\data\battleInstructions\card\SkillLeaveBattleInstruction.js
/**
 * SkillLeaveBattleInstruction - 技能离场生命周期（第一阶段）
 *
 * 调用技能的 onLeaveBattle 钩子，并广播必要事件；不做容器迁移和动画。
 */
import { BattleInstruction } from '../BattleInstruction.js';
import backendEventBus, { EventNames } from '../../../backendEventBus.js';

export class SkillLeaveBattleInstruction extends BattleInstruction {
  constructor({ player, skillID, parentInstruction = null }) {
    super({ parentInstruction });
    if (!player) throw new Error('SkillLeaveBattleInstruction: player is required');
    if (!skillID) throw new Error('SkillLeaveBattleInstruction: skillID is required');
    this.player = player;
    this.skillID = skillID;
  }

  async execute() {
    const player = this.player;
    const all = [...(player.frontierSkills||[]), ...(player.backupSkills||[]), ...(player.activatedSkills||[])];
    const skill = all.find(sk => sk.uniqueID === this.skillID);
    if (!skill) return true;
    try { skill.onLeaveBattle(player); } catch (_) {}
    // 若有需要，可以在这里 emit 专用事件：例如 SKILL_LEAVE_BATTLE
    // backendEventBus.emit('SKILL_LEAVE_BATTLE', { player, skill });
    return true;
  }

  getDebugInfo() {
    return `${super.getDebugInfo()} Player:${this.player.name} SkillID:${this.skillID}`;
  }
}

