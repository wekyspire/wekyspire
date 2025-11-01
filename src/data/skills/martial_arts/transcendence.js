// 超越
// 获得行动点，但无法再抽牌
import Skill from "@data/skill";
import backendEventBus, {EventNames} from "@/backendEventBus";
import { backendGameState as gameState } from '@data/gameState.js';
import {SkillTier} from "@/utils/tierUtils";
import { createAndSubmitAddEffect } from '@data/battleInstructionHelpers.js';

// 肾上腺素激增（C-）（超越）
// 获得行动点，但无法再抽牌1回合
export class BasicTranscendence extends Skill {
  constructor(name = '肾上腺素激增', tier = SkillTier.C_MINUS,
              maxUses = 1, coldDownTurn = 0, apGain = 1,
              stall = 1) {
    super(name, 'normal', tier, 0, 0, maxUses, '超越');
    this.baseColdDownTurns = coldDownTurn;
    this.apGain = apGain;
    this.stall = stall; // 过热回合数
  }

  get maxUses() {
    return Math.max(1, super.maxUses + this.power);
  }

  use (player, enemy, stage, ctx) {
    player.gainActionPoint(this.apGain);
    if (this.stall > 0) {
      createAndSubmitAddEffect(player, '滞气', this.stall, ctx?.parentInstruction ?? null);
    }
    return true;
  }

  regenerateDescription (player) {
    return `获得${this.apGain}行动点${this.stall > 0 ? `，${this.stall}层/effect{滞气}` : ''}`;
  }
}

// 爆发（C+）（超越）
// 获得2行动点，但无法再抽牌1回合
export class AdvancedTranscendence extends BasicTranscendence {
  constructor() {
    super('爆发', SkillTier.C_PLUS, 1, 0, 2, 1);
    this.precessor = '肾上腺素激增';
  }
}

// 激发（B）（超越）
// 能使用2次
export class SuperiorTranscendence extends BasicTranscendence {
  constructor() {
    super('激发', SkillTier.B, 2, 0, 2, 1);
    this.precessor = '爆发';
  }
}

// 透支（B-）（爆发延伸单卡）
// 能使用2次且每次获得2行动点，但是无法再抽牌2回合
export class Squeezing extends BasicTranscendence {
  constructor() {
    super('透支', SkillTier.B_MINUS, 2, 0, 2, 2);
    this.precessor = '爆发';
  }
}

// 巅峰（A-）（超越）
// 能使用3次
export class Peak extends BasicTranscendence {
  constructor() {
    super('巅峰', SkillTier.A_MINUS, 3, 0, 2, 1);
    this.precessor = '激发';
  }
}

// 超越（A）（超越）
// 能使用3次且每次获得3行动点
export class Transcendence extends BasicTranscendence {
  constructor() {
    super('超越', SkillTier.A, 3, 0, 3, 1);
    this.precessor = '巅峰';
  }
}