import {countString, signedNumberStringW0} from "@/utils/nameUtils";
import Skill from '@data/skill';
import { createAndSubmitDiscoverSkillCard, createAndSubmitLaunchAttack } from '@data/battleInstructionHelpers.js';
import {SkillTier} from '@/utils/tierUtils';

// 大力一击（D）（生成卡）
// 伤害由构造函数传入，不可自然生成
export class HeavyChargedHit extends Skill {
  constructor(damage, actionPointCost) {
    super('大力一击', 'normal', 0, 0, actionPointCost, 1);
    this.canSpawnAsReward_ = false;
  }
  get damage() {
    return Math.max(14 + 4 * this.power, 7);
  }
  use(player, enemy, stage, ctx) {
    createAndSubmitLaunchAttack(player, enemy, this.damage, ctx?.parentInstruction ?? null);
    return true;
  }
  regenerateDescription(player) {
    return `造成${this.damage + (player?.attack ?? 0)}点伤害`;
  }
}

// 蓄力（D）（蓄力）
// 发现【大力一击】进入牌库
export class ChargedHit extends Skill {
  constructor(name = '蓄力', tier = SkillTier.C_MINUS, apCost = 1, times = 1, spawnedCardCost = 1, consumable = false) {
    super(name, 'normal', tier, 0, apCost, 1, '蓄力');
    this.times = times;
    this.baseColdDownTurns = consumable ? 0 : 2;
    this.spawnedCardCost = spawnedCardCost;
  }
  use(player, enemy, stage, ctx) {
    // 使用 ctx 保存局部阶段状态（避免写到 skill 实例上）
    if (!ctx.spawned) ctx.spawned = 0;

    // 生成一张大力一击并放入牌库
    const skill = new HeavyChargedHit(this.damage, this.spawnedCardCost);
    skill.power = this.power;
    createAndSubmitDiscoverSkillCard(player, skill, 'deck', ctx?.parentInstruction ?? null);
    ctx.spawned += 1;

    // 连续 times 次，返回 false 直到最后一次才返回 true
    return ctx.spawned >= this.times;
  }
  regenerateDescription(player) {
    return `发现${countString(this.times)}/skill{大力一击${signedNumberStringW0(this.power)}}进入牌库`;
  }
}

// 连环击（C+）（蓄力）
// 发现两张，开销增1
export class ComboHit extends ChargedHit {
  constructor() {
    super('连环打击', SkillTier.C_PLUS, 2, 2);
    this.precessor = '蓄力';
  }
}

// 含力（C+）（蓄力）
// 发现一张零开销
export class RapidHit extends ChargedHit {
  constructor() {
    super('含力', SkillTier.C_PLUS, 1, 1, 0);
    this.precessor = '蓄力';
  }
}

// 三重击（B）（蓄力）
// 发现三张
export class TripleHit extends ChargedHit {
  constructor() {
    super('三重击', SkillTier.B, 2, 3);
    this.precessor = ['连环击', '含力'];
  }
}

// 惊鸿连击（A-）
// 发现三张零开销
export class SwiftHit extends ChargedHit {
  constructor() {
    super('惊鸿连击', SkillTier.A_MINUS, 2, 3, 0);
    this.precessor = '三重击';
  }
}

// 一瞬千击（A）
// 发现七张零开销，消耗
export class InstantHit extends ChargedHit {
  constructor() {
    super('一瞬千击', SkillTier.A, 7, 2, 0, true);
    this.precessor = '三重击';
  }
}