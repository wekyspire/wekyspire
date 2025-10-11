// 刀系列技能
// 丢卡
import Skill from "../../skill";
import {dropSkillCard, launchAttack} from "../../battleUtils";
import backendEventBus, {EventNames} from "../../../backendEventBus";
import { backendGameState as gameState } from '../../gameState.js';
import {SkillTier} from "../../../utils/tierUtils";

// 花刀（C-）（刀系列）
export class Machete extends Skill {
  constructor(
    name = '花刀',
    tier = SkillTier.C_MINUS,
    damage = 10,
    powerMultiplier = 3,
    times = 1,
    breakAtSelf = false,
    selectiveDrop = false) {
    super(name, 'normal', tier, 0, 1, 1, '刀');
    this.baseColdDownTurns = 3; // 基础冷却时间
    this.baseDamage = damage; // 基础伤害
    this.powerMultiplier = powerMultiplier; // 每点力量增加的伤害
    this.times = times; // 攻击次数
    this.breakAtSelf = breakAtSelf; // 是否在自己位置断开丢卡
    this.selectiveDrop = selectiveDrop;
  }

  get damage() {
    return Math.max(7, this.baseDamage + this.powerMultiplier * this.power);
  }

  use(player, enemy, stage) {
    if(stage < this.times) {
      launchAttack(player, enemy, this.damage);
      const selfIndex = gameState.player.frontierSkills.findIndex(skill => skill.uniqueID === this.uniqueID);
      if (selfIndex === -1 || selfIndex !== 0) {
        if (gameState.player.frontierSkills.length > 0) {
          if(this.selectiveDrop) selectAndDropFrontierSkillCard(player, [this.uniqueID]);
          else dropSkillCard(player, player.frontierSkills[0].uniqueID);
        }
      } else {
        if (this.breakAtSelf) return true;
        if (gameState.player.frontierSkills.length > 1) {
          if(this.selectiveDrop) selectAndDropFrontierSkillCard(player, [this.uniqueID]);
          else dropSkillCard(player, player.frontierSkills[1].uniqueID);
        }
      }
      return false;
    }
    return true;
  }

  regenerateDescription(player) {
    if(this.breakAtSelf) {
      return `丢弃/named{前方}所有卡，每张造成${this.damage + (player?.attack ?? 0)}伤害`;
    }
    if(this.times > 1) {
      return `${this.damage + (player?.attack ?? 0)}伤害，丢弃最左侧卡，重复${this.times - 1}`;
    }
    return `${this.damage + (player?.attack ?? 0)}伤害，丢弃最前方卡`;
  }
}

// 二重花刀（C+）（刀系列）
export class DoubleMachete extends Machete {
  constructor() {
    super('二重花刀', SkillTier.C_PLUS, 8, 2, 2);
    this.precessor = '花刀';
  }
}

// 快速花刀（B-）（刀系列）
// 冷却降低，额外获得1格挡，伤害略降
export class AgileMachete extends Machete {
  constructor() {
    super('快速花刀', SkillTier.B_MINUS, 7, 2, 1);
    this.precessor = '花刀';
    this.baseColdDownTurns = 1; // 基础冷却时间
  }
}

// 银刀乱舞（B）（刀系列）
// 丢弃此卡前方所有卡
export class DanceMachete extends Machete {
  constructor() {
    super('银刀乱舞', SkillTier.B_PLUS, 9, 3, 100, true);
    this.precessor = '二重花刀';
  }
}

// 风暴刀舞（A-）
// 丢所有卡
export class StormMachete extends Machete {
  constructor() {
    super('风暴刀舞', SkillTier.A_MINUS, 12, 5, 100, false);
    this.precessor = '银刀乱舞';
    this.baseColdDownTurns = 4; // 基础冷却时间
  }
}

// 完美花刀（B+）（刀系列）
// 选牌丢弃
export class PerfectMachete extends Machete {
  constructor() {
    super('完美花刀', SkillTier.B_MINUS, 7, 2, 1, false, true);
    this.precessor = '快速花刀';
    this.baseColdDownTurns = 1; // 基础冷却时间
  }
}