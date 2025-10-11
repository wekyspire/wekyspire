// 盖世武学系列（体修·咏唱）：过牌造成伤害

import Skill from '../../skill.js';
import { launchAttack } from '../../battleUtils.js';
import { backendGameState } from '../../gameState.js';
import backendEventBus, { EventNames } from '../../../backendEventBus.js';
import { SkillTier } from '../../../utils/tierUtils.js';

// 入门（C+）（武学）
// 抽牌则敌人造成固定伤害
class BasicPeakMartialArt extends Skill {
  constructor(
    name = '入门',
    tier = SkillTier.C_PLUS,
    baseDamagePerDraw = 1,
    apCost = 2,
    coldDownTurns = 0
  ) {
    // 咏唱卡：一次性使用，放入咏唱位持续生效；无冷却
    super(name, 'normal', tier, 0, apCost, 1, '武学');
    this.cardMode = 'chant';
    this.baseDamagePerDraw = baseDamagePerDraw;
    this.baseColdDownTurns = coldDownTurns;
    this.listener_ = null;
  }

  get damagePerDraw() {
    // 简单按 power 提升（与普遍卡设计一致）
    return Math.max(this.baseDamagePerDraw + this.power, 0);
  }

  onEnable(player) {
    // 进入咏唱位后开始监听“抽牌”事件
    super.onEnable(player);
    this.listener_ = (_) => {
      try {
        // 确保在战斗中且有敌人
        const gs = backendGameState;
        const enemy = gs?.enemy;
        if (!enemy || !gs || gs.gameStage !== 'battle') return;
        const modPlayer = gs.player.getModifiedPlayer ? gs.player.getModifiedPlayer() : gs.player;
        launchAttack(modPlayer, enemy, this.damagePerDraw);
      } catch (_) { /* 忽略事件期间的动画/时序问题 */ }
    };
    backendEventBus.on(EventNames.Player.SKILL_DRAWN, this.listener_);
  }

  onDisable(player, reason) {
    super.onDisable(player, reason);
    if (this.listener_) {
      backendEventBus.off(EventNames.Player.SKILL_DRAWN, this.listener_);
      this.listener_ = null;
    }
  }

  // 使用时无主动效果（只进入咏唱位）
  use(player, enemy, stage) { return true; }

  regenerateDescription(player) {
    return `抽牌时造成${this.damagePerDraw + (player?.attack ?? 0)}伤害`;
  }
}

// 习武（B-）（武学）
// 造成2伤害
export class PeakMartialArt extends BasicPeakMartialArt {
  constructor() {
    super('习武', SkillTier.B_MINUS, 2);
    this.precessor = '入门';
  }
}

// 精通（B）（武学）
// 造成3伤害，可复用
export class PeakMartialArtExpert extends BasicPeakMartialArt {
  constructor() {
    super('精通', SkillTier.B, 3, 2, 3);
    this.precessor = '习武';
  }
}

// 卓绝（B+）
// 造成4伤害，AP消耗减少1
export class PeakMartialArtMastery extends BasicPeakMartialArt {
  constructor() {
    super('卓绝', SkillTier.B_PLUS, 4, 1, 3);
    this.precessor = '精通';
  }
}

// 超凡（A-）
// 造成6伤害，冷却变成2回合
export class PeakMartialArtTranscendent extends BasicPeakMartialArt {
  constructor() {
    super('盖世武学·至境', SkillTier.A_MINUS, 6, 1, 2);
    this.precessor = '卓绝';
  }
}

// 无双（A）
// 造成9伤害，冷却变成1回合
export class PeakMartialArtSupreme extends BasicPeakMartialArt {
  constructor() {
    super('无双', SkillTier.A, 9, 1, 1);
    this.precessor = '超凡';
  }
}
