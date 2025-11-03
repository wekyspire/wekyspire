// 狠狠一击（D）（一击）
import Skill from '@data/skill';
import { createAndSubmitLaunchAttack, createAndSubmitSkillCoolDown } from '@data/battleInstructionHelpers.js';
import backendEventBus, {EventNames} from '@/backendEventBus';
import { backendGameState as gameState } from '@data/gameState.js';
import {SkillTier} from '@/utils/tierUtils';

export class FinalStrike extends Skill {
  constructor(name = '狠狠一击', tier = SkillTier.C_MINUS, coldDownTurns = 4, damage = 18, powerMultiplier = 7, cardActivationColdDown = 0, canColdDownInBackground = true) {
    super(name, 'normal', tier, 0, 1, 1, '一击');
    this.baseColdDownTurns = coldDownTurns; // 基础冷却时间
    this.baseSlowStart = true; // 慢启动
    this.baseDamage = damage; // 基础伤害
    this.powerMultiplier = powerMultiplier; // 每点力量增加的伤害
    this.cardActivationColdDown = cardActivationColdDown; // 卡牌激活冷却时间
    this.canColdDownInBackground = canColdDownInBackground;
    // listener_ 延后在 onEnterBattle 中基于响应式实例建立
    this.listener_ = null;
  }

  onEnterBattle() {
    super.onEnterBattle();
    if (!this.listener_) {
      this.listener_ = () => {
        const uid = this.uniqueID;
        let shouldColdDown = true;
        if(!this.canColdDownInBackground) {
          if(-1 === gameState.player.frontierSkills.findIndex(skill => skill.uniqueID === uid))
            shouldColdDown = false;
        }
        for (let i = 0; i < this.cardActivationColdDown; i++) {
          if (shouldColdDown && this.canColdDown()) {
            createAndSubmitSkillCoolDown(this, 1);
          }
        }

      };
    }
    backendEventBus.on(EventNames.Player.SKILL_USED, this.listener_);
    // 初始调试输出
    // console.log('[FinalStrike] onEnterBattle slowStart init', this.coldDownTurns, this.remainingUses, this.maxUses, 'cdLeft=', this.remainingColdDownTurns);
  }
  onLeaveBattle() {
    super.onLeaveBattle();
    if (this.listener_) backendEventBus.off(EventNames.Player.SKILL_USED, this.listener_);
  }

  get damage () {
    return Math.max(8, this.baseDamage + this.powerMultiplier * this.power);
  }

  use (player, enemy, stage, ctx) {
    createAndSubmitLaunchAttack(player, enemy, this.damage, ctx?.parentInstruction ?? null);
    return true;
  }

  regenerateDescription (player) {
    if(this.cardActivationColdDown > 0) {
      return `造成${this.damage + (player?.attack ?? 0)}点伤害，任意牌发动后${this.canColdDownInBackground ? '' : '，在手则'}冷却${this.cardActivationColdDown}次`;
    }
    return `造成${this.damage + (player?.attack ?? 0)}点伤害`;
  }
}

// 强击（C+）
// 造成27伤害
export class RendingFist extends FinalStrike {
  constructor() {
    super('强击', SkillTier.C_PLUS, 5, 25, 11, 1);
    this.precessor = '狠狠一击';
  }
}

// 悍拳（B-）
// 造成40伤害
export class ViciousFist extends FinalStrike {
  constructor() {
    super('悍拳', SkillTier.B_MINUS, 6, 40, 15, 1);
    this.precessor = '强击';
  }
}

// 崩拳（B+）
// 造成90伤害
export class CrashingFist extends FinalStrike {
  constructor() {
    super('崩拳', SkillTier.B_PLUS, 7, 90, 20, 1);
    this.precessor = '悍拳';
  }
}