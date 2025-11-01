// filepath: c:\Users\hineven\CLionProjects\rtvl_test\src\data\battleInstructions\core\ManualStopActivatedSkillInstruction.js
/**
 * ManualStopActivatedSkillInstruction - 手动停止咏唱技能指令
 *
 * 顺序：使用该咏唱技能一次（指令式）→ 停用咏唱 → 根据规则丢回牌库或焚毁。
 */
import { BattleInstruction } from '../BattleInstruction.js';
import { UseSkillInstruction } from './UseSkillInstruction.js';
import { willSkillBurn } from '../../battleUtils.js';
import { submitInstruction } from '../globalExecutor.js';
import { createAndSubmitBurnSkillCard, createAndSubmitDropSkillCard } from '../../battleInstructionHelpers.js';
import backendEventBus, { EventNames } from '../../../backendEventBus.js';

export class ManualStopActivatedSkillInstruction extends BattleInstruction {
  constructor({ player, skill, enemy, parentInstruction = null }) {
    super({ parentInstruction });
    if (!player) throw new Error('ManualStopActivatedSkillInstruction: player is required');
    if (!skill) throw new Error('ManualStopActivatedSkillInstruction: skill is required');
    if (!enemy) throw new Error('ManualStopActivatedSkillInstruction: enemy is required');
    this.player = player;
    this.skill = skill;
    this.enemy = enemy;
    this.stage = 0;
  }

  async execute() {
    // 停用咏唱 + 丢/焚
    const player = this.player;
    const skill = this.skill;
    const shouldBurn = willSkillBurn(skill);
    try { skill.onDisable(player, 'manual'); } catch (_) {}
    backendEventBus.emit(EventNames.Player.ACTIVATED_SKILL_DISABLED, { skill, reason: 'manual' });
    if (shouldBurn) {
      createAndSubmitBurnSkillCard(player, skill.uniqueID, this);
    } else {
      createAndSubmitDropSkillCard(player, skill.uniqueID, -1, this);
    }
    backendEventBus.emit(EventNames.Player.ACTIVATED_SKILLS_UPDATED, { activatedSkills: player.activatedSkills });
    return true;
  }

  getDebugInfo() {
    return `${super.getDebugInfo()} ManualStopActivatedSkill(${this.skill?.name})`;
  }
}

