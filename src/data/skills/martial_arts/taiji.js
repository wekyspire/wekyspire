// filepath: d:\cb_6\hineven_wekyspire\wekyspire\src\data\skills\martial_arts\taiji.js
// 太极系列（体修·咏唱）：每打3张牌，抽1张牌

import Skill from '../../skill.js';
import { drawSkillCard } from '../../battleUtils.js';
import backendEventBus, { EventNames } from '../../../backendEventBus.js';
import { backendGameState } from '../../gameState.js';
import { SkillTier } from '../../../utils/tierUtils.js';

// 解力（C+）（太极）
// 机制：进入咏唱后，玩家每打出6张牌，立刻抽1张牌
class BasicTaiji extends Skill {
  constructor(
    name = '解力',
    tier = SkillTier.C_PLUS,
    apCost = 2,
    coldDownTurns = 0,
    playsPerDraw = 6,
    drawCount = 1
  ) {
    super(name, 'normal', tier, 0, apCost, 1, '太极');
    this.cardMode = 'chant';
    this.baseColdDownTurns = coldDownTurns;
    this.playsPerDraw = playsPerDraw;
    this.drawCount = drawCount;
    this.playCounter = 0;
    this.listener_ = null;
    this.isActive = false;
  }

  get actionPointCost() {
    // 保持与其他武学卡一致：power 降低 AP 开销
    return Math.max(super.actionPointCost - this.power, 0);
  }

  onEnable(player) {
    super.onEnable(player);
    this.playCounter = 0;
    this.isActive = true;
    this.listener_ = ({ player: evtPlayer, manualStop }) => {
      try {
        // 仅统计玩家正常打出卡（忽略手动停止咏唱）
        if (manualStop) return;
        const gs = backendGameState;
        if (!gs || gs.gameStage !== 'battle') return;
        if (!evtPlayer || evtPlayer !== gs.player) return;

        this.playCounter += 1;
        if (this.playCounter >= Math.max(1, this.playsPerDraw)) {
          this.playCounter = 0;
          // 直接抽牌（由后端负责动画/状态）
          drawSkillCard(gs.player, Math.max(1, this.drawCount));
        }
      } catch (_) { /* 忽略动画与时序问题 */ }
    };
    backendEventBus.on(EventNames.Player.SKILL_USED, this.listener_);
  }

  onDisable(player, reason) {
    super.onDisable(player, reason);
    if (this.listener_) {
      this.playCounter = 0;
      this.isActive = false;
      backendEventBus.off(EventNames.Player.SKILL_USED, this.listener_);
      this.listener_ = null;
    }
  }

  use(player, enemy, stage) { return true; }

  regenerateDescription(player) {
    const per = Math.max(1, this.playsPerDraw);
    const cnt = Math.max(1, this.drawCount);
    if(this.isActive) {
      return `每打${per}张牌，抽${cnt}牌（已打${this.playCounter}张）`;
    }
    return `每打${per}张牌，抽${cnt}牌`;
  }
}

// 借力（B）（太极）
// 每打5张牌，抽1张牌，不再为消耗卡
export class ApproachingTaiji extends BasicTaiji {
  constructor() {
    super('借力', SkillTier.B, 2, 3, 5, 1);
    this.precessor = '解力';
  }
}

// 化劲（A-）（太极）
// 每打4张牌，抽1张牌，AP降为1
export class NearTaiji extends BasicTaiji {
  constructor() {
    super('化劲', SkillTier.A_MINUS, 1, 3, 4, 1);
    this.precessor = '借力';
  }
}

// 太极（A）
// 每打3张牌，抽1张牌，冷却降为1
export class Taiji extends BasicTaiji {
  constructor() {
    super('太极', SkillTier.A, 1, 1, 3, 1);
    this.precessor = '化劲';
  }
}