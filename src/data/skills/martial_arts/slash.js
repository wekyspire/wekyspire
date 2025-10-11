// 斩类攻击技能
import Skill from "../../skill";
import {launchAttack} from "../../battleUtils";
import backendEventBus, {EventNames} from "../../../backendEventBus";
import { backendGameState as gameState } from '../../gameState.js';
import {SkillTier} from "../../../utils/tierUtils";

// 斩（C-）
export class BasicSlash extends Skill {
  constructor(name = '斩', tier = SkillTier.C_MINUS, damage = 26, powerMultiplier = 7, coldDown = 5, cardForegroundColdDownDecay = 1) {
    super(name, 'normal', tier, 0, 2, 1, '斩');
    this.baseColdDownTurns = coldDown; // 基础冷却时间
    this.baseSlowStart = true; // 慢启动
    this.baseDamage = damage; // 基础伤害
    this.powerMultiplier = powerMultiplier; // 每点力量增加的伤害
    this.cardForegroundColdDownDecay = cardForegroundColdDownDecay; // 卡牌激活冷却时间
    this.listener_ = null;
  }

  onEnterBattle(player) {
    super.onEnterBattle(player);
    this.listener_ = () => {
      const isInFrontier = -1 !== player.frontierSkills.findIndex(
        skill => skill.uniqueID === this.uniqueID
      );
      if(isInFrontier) {
        this.coldDown(-this.cardForegroundColdDownDecay);
      }
    };
    backendEventBus.on(EventNames.Battle.POST_PLAYER_TURN_END, this.listener_);
  }

  get damage () {
    return Math.max(8, this.baseDamage + this.powerMultiplier * this.power);
  }

  use (player, enemy, stage) {
    launchAttack(player, enemy, this.damage);
    return true;
  }

  regenerateDescription(player) {
    return `${this.damage + (player?.attack ?? 0)}伤害，回合结束在手中则失去${this.cardForegroundColdDownDecay}冷却`;
  }
}

// 裂石斩（B-)
// 伤害提升
export class StoneCleaveSlash extends BasicSlash {
  constructor() {
    super('裂石斩', SkillTier.B_MINUS, 41, 21, 6, 2);
    this.precessor = '斩';
  }
}

// 摧山斩（B+）
// 伤害大幅提升
export class MountainCrushSlash extends BasicSlash {
  constructor() {
    super('崩山斩', SkillTier.B_PLUS, 72, 33, 7, 3);
    this.precessor = '斩';
  }
}

// 分海斩（A）
// 伤害极大提升
export class SeaDivideSlash extends BasicSlash {
  constructor() {
    super('分海斩', SkillTier.A_MINUS, 130, 60, 8, 4);
    this.precessor = '斩';
  }
}
// 开天斩（A+）
// 伤害极大提升
export class SkyRendSlash extends BasicSlash {
  constructor() {
    super('开天斩', SkillTier.A_PLUS, 230, 105, 9, 5);
    this.precessor = '斩';
  }
}

// 断神斩（S）
// 唯一体修S攻击卡
export class GodBreakerSlash extends BasicSlash {
  constructor() {
    super('断神斩', SkillTier.S, 9999, 0, 10, 10);
    this.precessor = '开天斩';
  }
  regenerateDescription(player) {
    if(this.remainingUses === 0) {
      return `回合结束在手牌中则损失所有冷却进度`;
    }
    return `/italic{消灭}`;
  }
}
