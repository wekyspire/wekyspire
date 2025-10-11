// 回转
// 从牌库末抽卡
import Skill from "../../skill";
import {drawSelectedSkillCard, launchAttack} from "../../battleUtils";
import { backendGameState as gameState } from '../../gameState.js';
import {countString} from "../../../utils/nameUtils";
import {SkillTier} from "../../../utils/tierUtils";

// 回旋斩（C-）（回转）
// 从牌库末抽卡
export class RoundSlash extends Skill {
  constructor(name = '回旋斩', tier = SkillTier.C_MINUS, damage = 9, powerMultiplier = 5, drawCardCount = 1, apConsumption = 2, coldDownTurns = 3) {
    super(name, 'normal', tier, 0, apConsumption, 1, '回转');
    this.baseColdDownTurns = coldDownTurns; // 基础冷却时间
    this.baseDamage = damage; // 基础伤害
    this.powerMultiplier = powerMultiplier; // 每点力量增加的伤害
    this.drawCardCount = drawCardCount; // 造成伤害后抽牌数量
  }
  get damage () {
    return Math.max(6, this.baseDamage + this.powerMultiplier * this.power);
  }

  use (player, enemy, stage) {
    const result = launchAttack(player, enemy, this.damage);
    for (let i = 0; i < this.drawCardCount; i++) {
      const lastCardID = gameState.player.backupSkills.length > 0 ? gameState.player.backupSkills[gameState.player.backupSkills.length - 1].uniqueID : null;
      if(lastCardID) {
        drawSelectedSkillCard(player, lastCardID);
      }
    }
    return true;
  }
  regenerateDescription (player) {
    return `${this.damage + (player?.attack ?? 0)}伤害，从牌库末抽${countString(this.drawCardCount, '张')}牌`;
  }
}

// 回旋烈斩（B-）
// 抽两张牌
export class RoundFierceSlash extends RoundSlash {
  constructor() {
    super('回旋烈斩', SkillTier.B_MINUS, 12, 6, 2, 2);
    this.precessor = '回旋斩';
  }
}

// 轻灵回斩（B）
// AP开销降低，冷却降低
export class AgileRoundSlash extends RoundSlash {
  constructor() {
    super('轻灵回斩', SkillTier.B, 10, 4, 1, 1, 1);
    this.precessor = '回旋斩';
  }
}

// 回旋爆斩（B+）
// 伤害提升，抽三张牌
export class RoundExplosiveSlash extends RoundSlash {
  constructor() {
    super('回旋爆斩', SkillTier.B_PLUS, 15, 7, 3, 2);
    this.precessor = '回旋斩';
  }
}

// 光速回斩（A-）
// 无冷却
export class LightspeedRoundSlash extends RoundSlash {
  constructor() {
    super('光速回斩', SkillTier.A_MINUS, 14, 5, 1, 1, 0);
    this.precessor = '轻灵回斩';
  }
}
