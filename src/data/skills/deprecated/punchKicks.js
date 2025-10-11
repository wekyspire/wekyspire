import Skill from '../skill.js';
import {launchAttack, dealDamage, gainShield, drawSkillCard, dropSkillCard, burnSkillCard, discoverSkillCard} from '../battleUtils.js';
import {signedNumberString, signedNumberStringW0} from "../../utils/nameUtils";

// 拳打脚踢技能
export class PunchKick extends Skill {
  
  constructor() {
    super('拳打脚踢', 'normal', 0, 0, 2, Infinity);
  }
  
  get damage () {
    return Math.max(9 + 2 * this.power, 3);
  }

  // 使用技能
  use(player, enemy) {
    launchAttack(player, enemy, this.damage);
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `造成${this.damage + (player?.attack ?? 0)}点伤害`;
  }
}

// 莽撞攻击
export class CarelessPunchKick extends Skill {
  constructor() {
    super('莽撞攻击', 'normal', 0, 0, 1, 1);
    this.baseColdDownTurns = 1;
  }

  get coldDownTurns() {
    return Math.max(super.coldDownTurns - this.power, 0);
  }

  // 使用技能
  use(player, enemy, stage) {
    if(stage === 0) {
      launchAttack(player, enemy, 10);
      return false;
    } else { 
      dealDamage(player, player, 3, true);
      return true;
    }
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if(player) {
      const damage = 10 + (player?.attack ?? 0);
      return `造成${damage}点伤害，受3伤害`;
    }
    return `造成10点伤害，受3伤害`;
  }
}

// 快速打击
// 同时消耗相邻技能充能进行攻击
export class SpeedyPunchKick extends Skill {
  constructor() {
    super('快速打击', 'normal', 0, 0, 1, 1);
    this.baseColdDownTurns = 1;
  }

  get damage () {
    return Math.max(9 + 4 * this.power, 5);
  }

  canUse (player) {
    // 看看左边技能有没有充能
    const leftSkill = player.frontierSkills[this.getInBattleIndex(player) - 1];
    const leftHaveUses = leftSkill?.remainingUses > 0;
    // 看看右边技能有没有充能
    const rightSkill = player.frontierSkills[this.getInBattleIndex(player) + 1];
    const rightHaveUses = rightSkill?.remainingUses > 0;
    return super.canUse(player) && (leftHaveUses || rightHaveUses);
  }

  // 使用技能
  use(player, enemy, stage) {
    // 看看左边技能有没有充能
    const leftSkill = player.frontierSkills[this.getInBattleIndex(player) - 1];
    const leftHaveUses = leftSkill?.remainingUses > 0;
    // 看看右边技能有没有充能
    const rightSkill = player.frontierSkills[this.getInBattleIndex(player) + 1];
    const rightHaveUses = rightSkill?.remainingUses > 0;
    if(leftHaveUses) {
      leftSkill.consumeUses();
    } else if(rightHaveUses) {
      rightSkill.consumeUses();
    }
    launchAttack(player, enemy, this.damage);
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `造成${this.damage + (player?.attack ?? 0)}点伤害，消耗/named{相邻}技能1充能，优先左侧`;
  }
}

// 精准打击
// 此技能只有当此技能前方所有技能都可用时才可用，造成10伤害
export class PrecisePunchKick extends Skill {
  constructor() {
    super('精准打击', 'normal', 0, 0, 1, 1);
    this.baseColdDownTurns = 1;
  }
  
  get damage () {
    return Math.max(8 + 4 * this.power, 6);
  }
  
  canUse (player) {
    const forwardSkills = player.frontierSkills.slice(0, this.getInBattleIndex(player));
    return super.canUse(player) && forwardSkills.every(skill => skill.canUse(player));
  }
  
  use(player, enemy) {
    launchAttack(player, enemy, this.damage);
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `造成${this.damage + (player?.attack ?? 0)}点伤害，/named{前方}所有技能可用时可用`;
  }
}

// 重击
// 消耗2行动点，赋予易伤1，但仅产生4伤害
export class PowerPunchKick extends Skill {
  constructor() {
    super('重击', 'normal', 0, 0, 2, 1);
    this.baseColdDownTurns = 2;
  }
  
  get damage () {
    return 4 + 3 * this.power;
  }

  // 使用技能
  use(player, enemy, stage) {
    if(stage === 0) {
        const atkPassThroughDamage = launchAttack(player, enemy, this.damage).passThoughDamage;
        if(atkPassThroughDamage > 0) return false;
        return true;
    } else {
        enemy.addEffect('易伤', 2);
        return true;
    }
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `造成${this.damage + (player?.attack ?? 0)}点伤害，赋予/effect{易伤}2`;
  }
}

// 脱力打击
// 造成10伤害，减1力量
export class OffPowerPunchKick extends Skill {
  constructor() {
    super('脱力打击', 'normal', 0, 0, 1, 1);
    this.baseColdDownTurns = 2;
  }
  
  get damage () {
    return 10 + 3 * this.power;
  }

  // 使用技能
  use(player, enemy, stage) {
    if(stage === 0) {
        launchAttack(player, enemy, this.damage);
        return false;
    } else {
        player.addEffect('力量', -1);
        return true;
    }
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `造成${this.damage + (player?.attack ?? 0)}点伤害，/effect{力量}减1`;
  }
}

export class FinalPunchKick extends Skill {
  constructor() {
    super('终极一击', 'normal', 0, 0, 2, 1);
    this.baseColdDownTurns = 10;
  }

  get damage () {
    return Math.max(8, 19 + 6 * this.power);
  }

  use (player, enemy, stage) {
    launchAttack(player, enemy, this.damage);
    return true;
  }

  regenerateDescription (player) {
    return `造成${this.damage + (player?.attack ?? 0)}点伤害`;
  }
}

export class AgilePunchKick extends Skill {
  constructor() {
    super('敏捷打击', 'normal', 0, 0, 1, 1);
    this.baseColdDownTurns = 3;
  }

  get coldDownTurns() {
    return Math.max(super.coldDownTurns - this.power, 1);
  }

  get damage() {
    return Math.max(6 + 3 * this.power, 4);
  }

  // 使用技能
  use(player, enemy, stage) {
    if (stage === 0) {
      const result = launchAttack(player, enemy, this.damage);
      if (result.passThoughDamage > 0) return false;
      return true;
    } else {
      drawSkillCard(player, 1);
      return true;
    }
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `造成${this.damage + (player?.attack ?? 0)}点伤害，造成伤害则抽牌`;
  }
}

// 大力一击
// 伤害由构造函数传入，不可自然生成
export class HeavyPunchKick extends Skill {
  constructor(damage) {
    super('大力一击', 'normal', 0, 0, 1, 1);
    this.canSpawnAsReward_ = false;
  }
  get damage() {
    return Math.max(15 + 5 * this.power, 7);
  }
  use(player, enemy, stage) {
    launchAttack(player, enemy, this.damage);
    return true;
  }
  regenerateDescription(player) {
    return `造成${this.damage + (player?.attack ?? 0)}点伤害`;
  }
}

// 蓄力
// 发现【大力一击】进入牌库
export class ChargePunchKick extends Skill { // 原名 SpeedyPunchKick（与“快速打击”冲突）
  constructor() {
    super('蓄力', 'normal', 0, 0, 1, 1);
    this.baseColdDownTurns = 2;
  }
  use(player, enemy, stage) {
    const skill = new HeavyPunchKick(this.damage);
    skill.power = this.power;
    discoverSkillCard(player, skill, 'deck');
    return true;
  }
  regenerateDescription(player) {
    return `发现/skill{大力一击${signedNumberStringW0(this.power)}}进入牌库`;
  }
}

// 连环打击
// 造成6伤害，丢两张头部卡牌
export class ComboPunchKick extends Skill {
  constructor() {
    super('连环打击', 'normal', 0, 0, 1, 1);
    this.baseColdDownTurns = 3;
  }
  get damage() {
    return Math.max(6 + 3 * this.power, 4);
  }
  use(player, enemy, stage) {
    if(stage === 0) {
      launchAttack(player, enemy, this.damage);
      return false;
    } else {
      if(player.skills.length > 0) dropSkillCard(player, player.skills[0].uniqueID);
      if(player.skills.length > 0) dropSkillCard(player, player.skills[0].uniqueID);
      return true;
    }
  }
  regenerateDescription(player) {
    return `造成${this.damage + (player?.attack ?? 0)}伤害，丢最左侧两张牌`;
  }
}

// 狡黠打击
// 造成6伤害，将最左侧牌置入牌堆顶
export class CunningPunchKick extends Skill {
  constructor() {
    super('狡黠打击', 'normal', 0, 0, 1, 1);
    this.baseColdDownTurns = 2;
  }
  get damage() {
    return Math.max(6 + 3 * this.power, 4);
  }
  use(player, enemy, stage) {
    if(stage === 0) {
      launchAttack(player, enemy, this.damage);
      return false;
    } else {
      if(player.skills.length > 1) {
        const leftSkill = player.skills[0];
        dropSkillCard(player, skillID, 0);
      }
      return true;
    }
  }
}