// 虚形拳
import Skill from "../../skill";
import {drawSkillCard, launchAttack} from "../../battleUtils";
import backendEventBus, {EventNames} from "../../../backendEventBus";
import { backendGameState as gameState } from '../../gameState.js';
import {SkillTier} from "../../../utils/tierUtils";

// 仿形拳（C-）（虚形拳）
// 造成伤害，若为最后一张手牌，抽2张牌
export class BasicShapelessPunch extends Skill {
  constructor(name = '仿形拳', tier = SkillTier.C_MINUS, damage = 17, powerMultiplier = 7, coldDown = 6,
              apCost = 2, extraDamage = 0, drawCardCount = 2) {
    super(name, 'normal', tier, 0, apCost, 1, '虚形拳');
    this.baseColdDownTurns = coldDown; // 基础冷却时间
    this.baseDamage = damage; // 基础伤害
    this.powerMultiplier = powerMultiplier; // 每点力量增加的伤害
    this.extraDamage = extraDamage; // 额外伤害
    this.drawCardCount = drawCardCount;
  }

  get damage () {
    return Math.max(8, this.baseDamage + this.powerMultiplier * this.power);
  }

  isLastCardInHand (player) {
    if(!player) return false;
    const skillIndex = player.frontierSkills.findIndex(skill => skill.uniqueID === this.uniqueID);
    return skillIndex === player.frontierSkills.length - 1;
  }

  getDamage (player) {
    if(this.isLastCardInHand(player)) {
      return this.damage + this.extraDamage;
    }
    return this.damage;
  }

  use (player, enemy, stage) {
    launchAttack(player, enemy, this.getDamage(player));
    if(this.isLastCardInHand(player) && this.drawCardCount > 0) {
      drawSkillCard(player, this.drawCardCount);
    }
    return true;
  }
  regenerateDescription (player) {
    let desc = `${this.damage + (player?.attack ?? 0)}伤害`;
    if(this.drawCardCount > 0) {
      desc += `。若为唯一手牌，抽${this.drawCardCount}牌`;
    }
    if(this.extraDamage > 0) {
      if(this.drawCardCount <= 0) {
        desc += '。若为唯一手牌';
      }
      desc += `，额外造成${this.extraDamage}伤害`;
    }
    return desc;
  }
}

// 猫形拳（C+）（虚形拳）
// AP消耗降低，冷却降低
export class CatShapelessPunch extends BasicShapelessPunch {
  constructor() {
    super('猫形拳', SkillTier.B_MINUS, 12, 7, 5, 1);
    this.precessor = '仿形拳';
  }
}

// 豹形拳（B-）（虚形拳）
// 开始拥有额外伤害
export class LeopardShapelessPunch extends BasicShapelessPunch {
  constructor() {
    super('豹形拳', SkillTier.B_MINUS, 12, 7, 5, 1, 13);
    this.precessor = '犬形拳';
  }
}

// 狮形拳（B）（虚形拳）
// 额外伤害提升，抽牌提升
export class LionShapelessPunch extends BasicShapelessPunch {
  constructor() {
    super('狮形拳', SkillTier.B, 12, 7, 5, 1, 13, 3);
    this.precessor = '豹形拳';
  }
}

// 龙形拳（B+）（虚形拳）
// 额外伤害提升，冷却降低
export class DragonShapelessPunch extends BasicShapelessPunch {
  constructor() {
    super('龙形拳', SkillTier.B_PLUS, 12, 7, 4, 1, 17, 3);
    this.precessor = '狮形拳';
  }
}

// 空形拳（A-）（虚形拳）
// 额外伤害提升，抽卡数提升
export class TrueShapelessPunch extends BasicShapelessPunch {
  constructor() {
    super('空形拳', SkillTier.A_MINUS, 12, 7, 4, 1, 33, 4);
    this.precessor = '龙形拳';
  }
}