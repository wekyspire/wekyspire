// filepath: c:\Users\hineven\CLionProjects\rtvl_test\src\data\battleInstructions\turn\PlayerTurnStartInstruction.js
import { BattleInstruction } from '../BattleInstruction.js';
import backendEventBus, { EventNames } from '../../../backendEventBus.js';
import { enqueueUnlockControl } from '../../animationInstructionHelpers.js';
import {
  createAndSubmitDrawSkillCard,
  createAndSubmitLambda,
  createAndSubmitSkillListCoolDown
} from '../../battleInstructionHelpers.js';
import { ProcessStartOfTurnEffectsInstruction } from '../turnEffects/ProcessStartOfTurnEffectsInstruction.js';
import { submitInstruction } from '../globalExecutor.js';
import { backendGameState as gameState } from '../../gameState.js';

export class PlayerTurnStartInstruction extends BattleInstruction {
  constructor({ player, enemy, parentInstruction = null }) {
    super({ parentInstruction });
    this.player = player;
    this.enemy = enemy;
    this.stage = 0;
    this.effectsInst = null;
  }

  async execute() {
    const player = this.player;
    // 阶段0：基础重置与预事件
    if (this.stage === 0) {
      // 标记为玩家回合（修正：直接写全局 gameState）
      gameState.isEnemyTurn = false;
      // 事件：回合开始前
      backendEventBus.emit(EventNames.Battle.PRE_PLAYER_TURN_START, {});
      // 重置AP
      const mod = player.getModifiedPlayer ? player.getModifiedPlayer() : player;
      player.remainingActionPoints = mod.maxActionPoints;
      // 重置护盾
      player.shield = 0;
      // 技能冷却推进（纳入执行器）
      createAndSubmitSkillListCoolDown(player.frontierSkills || [], 1, this);
      createAndSubmitSkillListCoolDown(player.backupSkills || [], 1, this);
      // 处理回合开始效果
      this.effectsInst = new ProcessStartOfTurnEffectsInstruction({ target: mod, parentInstruction: this });
      submitInstruction(this.effectsInst);
      this.stage = 1;
      return false;
    }

    // 阶段1：处理眩晕与抽牌
    if (this.stage === 1) {
      const isStunned = !!this.effectsInst?.isStunned;
      if (isStunned) {
        backendEventBus.emit(EventNames.Battle.PLAYER_TURN_START, {});
        createAndSubmitLambda(() => {enqueueUnlockControl();}, this);
        // 眩晕：直接结束回合（交给外部发起的 PLAYER_END_TURN 指令或事件）
        return true;
      }
      // 事件：回合开始
      backendEventBus.emit(EventNames.Battle.PLAYER_TURN_START, {});
      // 解锁操作
      createAndSubmitLambda(() => {enqueueUnlockControl();}, this);
      // 抽牌（按上限补到 drawFrontierSkills）
      const mod = player.getModifiedPlayer ? player.getModifiedPlayer() : player;
      const toDraw = Math.min(mod.maxFrontierSkills - mod.frontierSkills.length, mod.drawFrontierSkills);
      if (toDraw > 0) createAndSubmitDrawSkillCard(mod, toDraw, this);
      this.stage = 2;
      return true;
    }

    return true;
  }

  getDebugInfo() {
    return `${super.getDebugInfo()} PlayerTurnStart`;
  }
}
