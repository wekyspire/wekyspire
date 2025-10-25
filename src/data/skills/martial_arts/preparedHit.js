// 大力一击（D）（生成卡）
// 伤害由构造函数传入，不可自然生成
import {countString, signedNumberStringW0} from "../../../utils/nameUtils";
import Skill from "../../skill";
import {dealDamage, discoverSkillCard, launchAttack} from "../../battleUtils";
import {enqueueDelay} from "../../animationInstructionHelpers";

export class HeavyChargedHit extends Skill {
  constructor(damage, actionPointCost) {
    super('大力一击', 'normal', 0, 0, actionPointCost, 1);
    this.canSpawnAsReward_ = false;
  }
  get damage() {
    return Math.max(14 + 4 * this.power, 7);
  }
  use(player, enemy, stage) {
    launchAttack(player, enemy, this.damage);
    return true;
  }
  regenerateDescription(player) {
    return `造成${this.damage + (player?.attack ?? 0)}点伤害`;
  }
}

// 蓄力（D）（蓄力）
// 发现【大力一击】进入牌库
export class ChargedHit extends Skill {
  constructor(name = '蓄力', tier = 1, times = 1, spawnedCardCost = 1, consumable = false) {
    super(name, 'normal', tier, 0, 1, 1, '蓄力');
    this.times = times;
    this.baseColdDownTurns = consumable ? 0 : 2;
  }
  use(player, enemy, stage) {
    const skill = new HeavyChargedHit(this.damage);
    skill.power = this.power;
    discoverSkillCard(player, skill, 'deck');
    return stage >= (this.times - 1);
  }
  regenerateDescription(player) {
    return `发现${countString(this.times)}/skill{大力一击${signedNumberStringW0(this.power)}}进入牌库`;
  }
}

// 连环击（C+）（蓄力）
// 发现两张
export class ComboHit extends ChargedHit {
  constructor() {
    super('连环打击', 2, 2);
    this.precessor = '蓄力';
  }
}

// 三重击（B）（蓄力）
// 发现三张
export class TripleHit extends ChargedHit {
  constructor() {
    super('三重击', 4, 3);
    this.precessor = '连环击';
  }
}

// 惊鸿连击（A-）
// 发现三张零开销
export class SwiftHit extends ChargedHit {
  constructor() {
    super('惊鸿连击', 6, 3, 0);
    this.precessor = '三重击';
  }
}

// 一瞬千击（A）
// 发现七张零开销，消耗
export class InstantHit extends ChargedHit {
  constructor() {
    super('一瞬千击', 7, 7, 0, true);
    this.precessor = '三重击';
  }
}