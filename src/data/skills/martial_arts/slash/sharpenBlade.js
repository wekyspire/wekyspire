// 开刃：立刻冷却手中所有刀法牌，回合结束时自动进入牌库
import Skill from '@data/skill';
import backendEventBus, { EventNames } from '@/backendEventBus';
import { createAndSubmitSkillListCoolDown, createAndSubmitDropSkillCard } from '@data/battleInstructionHelpers.js';
import {SkillTier} from "@/utils/tierUtils";
import {countString} from "@/utils/nameUtils";

// 开刃（C-）（刀系列）
// 立刻冷却手中所有刀法牌，光滑
export class BasicSharpenBlade extends Skill {
  constructor(name="磨刀", tier = SkillTier.C_MINUS, coldDownTimes = 1, apCost = 0, maxUses = 1, coldDownTurns = 1, smooth = true) {
    super(name, 'normal', tier, 0, apCost, maxUses, '开刃');
    this.baseColdDownTurns = coldDownTurns;
    this.turnListener_ = null;
    this.smooth_ = smooth; // 光滑特性
    this.baseColdDownTimes = coldDownTimes; // 冷却次数
  }
  onEnterBattle(player) {
    super.onEnterBattle(player);
    // 光滑：回合结束自动入库
    if (!this.turnListener_ && this.smooth_) {
      this.turnListener_ = () => {
        if(player.frontierSkills.find(sk=> sk.uniqueID === this.uniqueID))
          createAndSubmitDropSkillCard(player, this.uniqueID);
      };
      backendEventBus.on(EventNames.Battle.POST_PLAYER_TURN_END, this.turnListener_);
    }
  }
  onLeaveBattle(player) {
    super.onLeaveBattle(player);
    if (this.turnListener_) {
      backendEventBus.off(EventNames.Battle.POST_PLAYER_TURN_END, this.turnListener_);
      this.turnListener_ = null;
    }
  }
  get coldDownTimes () {
    return Math.max(this.baseColdDownTimes + this.power, 1);
  }

  use(player, enemy, stage, ctx) {
    const handKnifeSkills = player.frontierSkills.filter(sk=> sk.skillSeriesName.includes('斩'));
    createAndSubmitSkillListCoolDown(handKnifeSkills, this.coldDownTimes, ctx?.parentInstruction ?? null);
    return true;
  }
  regenerateDescription(){ return `冷却手中所有刀法牌${countString(this.coldDownTimes, '次')}${this.smooth_ ? "，/named{光滑}" : ''}`; }
}

// 砺刀（C+）（刀系列）
// 冷却2，ap增1
export class SharpenBlade extends BasicSharpenBlade {
  constructor() {
    super('砺刀', SkillTier.C_PLUS, 2, 1, 1, 1, true);
    this.precessor = '磨刀';
  }
}

// 磨锋（B）（刀系列）
// 冷却3，ap增1
export class HoneEdge extends BasicSharpenBlade {
  constructor() {
    super('磨锋', SkillTier.B, 3, 2, 1, 1, true);
    this.precessor = '砺刀';
  }
}

// 展锐（A-）（刀系列）
// 冷却5，ap增2
export class ExtendEdge extends BasicSharpenBlade {
  constructor() {
    super('展锐', SkillTier.A_MINUS, 5, 4, 1, 1, true);
    this.precessor = '磨锋';
  }
}

// 另一条升级路线：卡牌变成消耗卡，换取AP降低和光滑特性取消
// 练刀（C+）（刀系列）
// 冷却2，消耗
export class PracticeBlade extends BasicSharpenBlade {
  constructor() {
    super('练刀', SkillTier.C_PLUS, 2, 0, 1, 0, false);
    this.precessor = '磨刀';
  }
}

// 精锋（B）（刀系列）
// 冷却3，消耗
export class FineBlade extends BasicSharpenBlade {
  constructor() {
    super('精刀', SkillTier.B, 3, 0, 1, 0, false);
    this.precessor = '练刀';
  }
}

// 掌锐（A-）（刀系列）
// 冷却5，消耗
export class MasterEdge extends BasicSharpenBlade {
  constructor() {
    super('掌锐', SkillTier.A_MINUS, 5, 0, 1, 0, false);
    this.precessor = '精刀';
  }
}

// 开刃（A）（刀系列）
// 冷却6，消耗
export class FinalReveal extends BasicSharpenBlade {
  constructor() {
    super('开刃', SkillTier.A, 6, 0, 1, 0, false);
    this.precessor = ['展锐', '掌锐'];
  }
}