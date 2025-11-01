// 斩类攻击技能
import Skill from "@data/skill";
// 替换：使用指令式 helpers
import { createAndSubmitLaunchAttack, createAndSubmitSkillCoolDown } from '@data/battleInstructionHelpers.js';
import backendEventBus, {EventNames} from "@/backendEventBus";
import { backendGameState as gameState } from '@data/gameState.js';
import {SkillTier} from "@/utils/tierUtils";

// 斩（C-）
export class BasicSlash extends Skill {
  constructor(name = '斩', tier = SkillTier.C_MINUS, damage = 35, powerMultiplier = 7, coldDown = 5, cardForegroundColdDownDecay = 1) {
    super(name, 'normal', tier, 0, 2, 1, '斩');
    this.baseColdDownTurns = coldDown; // 基础冷却时间
    this.baseSlowStart = true; // 慢启动
    this.baseDamage = damage; // 基础伤害
    this.powerMultiplier = powerMultiplier; // 每点力量增加的伤害
    this.cardForegroundColdDownDecay = cardForegroundColdDownDecay; // 卡牌激活冷却时间
    this.listener_ = null;
    // 反转模式：由“拔刀术”等效果设置；true 时，改为“在牌库中则失去冷却”
    this.reverseMode = this.reverseMode || false;
  }

  onEnterBattle(player) {
    super.onEnterBattle(player);
    this.listener_ = () => {
      const uid = this.uniqueID;
      const inFrontier = player.frontierSkills.findIndex(skill => skill.uniqueID === uid) !== -1;
      const inBackup = player.backupSkills.findIndex(skill => skill.uniqueID === uid) !== -1;
      const shouldDecay = this.reverseMode ? inBackup : inFrontier;
      if (shouldDecay) {
        createAndSubmitSkillCoolDown(this, -this.cardForegroundColdDownDecay);
      }
    };
    backendEventBus.on(EventNames.Battle.POST_PLAYER_TURN_END, this.listener_);
  }

  onLeaveBattle(player) {
    super.onLeaveBattle(player);
    if (this.listener_) {
      backendEventBus.off(EventNames.Battle.POST_PLAYER_TURN_END, this.listener_);
      this.listener_ = null;
    }
  }

  get damage () {
    return Math.max(8, this.baseDamage + this.powerMultiplier * this.power);
  }

  use (player, enemy, stage, ctx) {
    createAndSubmitLaunchAttack(player, enemy, this.damage, ctx?.parentInstruction ?? null);
    return true;
  }

  regenerateDescription(player) {
    const decayDesc = this.cardForegroundColdDownDecay > 0 ? (this.reverseMode
      ? `，回合结束在牌库中则失去${this.cardForegroundColdDownDecay}冷却`
      : `，回合结束在手中则失去${this.cardForegroundColdDownDecay}冷却`) : '';
    return `${this.damage + (player?.attack ?? 0)}伤害${decayDesc}`;
  }
}

// 裂石斩（B-)
// 伤害提升，难度提升
export class StoneCleaveSlash extends BasicSlash {
  constructor() {
    super('裂石斩', SkillTier.B_MINUS, 61, 21, 6, 2);
    this.precessor = ['斩', '蓄力斩'];
  }
}

// 摧山斩（B+）
// 伤害大幅提升，难度提升
export class MountainCrushSlash extends BasicSlash {
  constructor() {
    super('崩山斩', SkillTier.B_PLUS, 102, 33, 7, 3);
    this.precessor = ['裂石斩', '奋力斩'];
  }
}

// 分海斩（A）
// 伤害极大提升，难度提升
export class SeaDivideSlash extends BasicSlash {
  constructor() {
    super('分海斩', SkillTier.A_MINUS, 160, 60, 8, 4);
    this.precessor = '崩山斩';
  }
}
// 开天斩（A+）
// 伤害极大提升，难度提升
export class SkyRendSlash extends BasicSlash {
  constructor() {
    super('开天斩', SkillTier.A_PLUS, 280, 105, 9, 5);
    this.precessor = '开天斩';
  }
}

// 断神斩（S）
// 唯一体修S攻击卡，难度提升
export class GodSlayerSlash extends BasicSlash {
  constructor() {
    super('断神斩', SkillTier.S, 9999, 0, 12, 12);
    this.precessor = '开天斩';
  }
  regenerateDescription(player) {
    if(this.remainingUses === 0) {
      return `回合结束在手牌中则损失所有冷却进度`;
    }
    return `/italic{消灭}`;
  }
}

// 另一条路线：蓄力斩系列技能，伤害提升较低，但发动难度降低
export class ChargedSlash extends BasicSlash {
  constructor() {
    super('蓄力斩', SkillTier.C_PLUS, 35, 19, 5, 0);
    this.precessor = '斩';
  }
}
// 奋力斩（B）
export class StriveSlash extends BasicSlash {
  constructor() {
    super('奋力斩', SkillTier.B, 58, 32, 6, 0);
    this.precessor = '蓄力斩';
  }
}
// 极力斩（A-）
export class VigorSlash extends BasicSlash {
  constructor() {
    super('极力斩', SkillTier.A_MINUS, 95, 58, 7, 0);
    this.precessor = '奋力斩';
  }
}
