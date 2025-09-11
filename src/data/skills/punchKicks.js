import Skill from '../skill.js';
import { launchAttack, dealDamage, gainShield } from '../battleUtils.js';

// 拳打脚踢技能
export class PunchKick extends Skill {
  
  constructor() {
    super('拳打脚踢', 'normal', 0, 0, 1, Infinity, '拳打脚踢', 1);
  }
  
  get damage () {
    return Math.max(4 + this.power, 3);
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
  }

  get coldDownTurns() {
    return Math.max(1 - this.power, 0);
  }

  // 使用技能
  use(player, enemy, stage) {
    if(stage == 0) {
      launchAttack(player, enemy, 10);
      return false;
    } else { 
      dealDamage(player, player, 3);
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
    this.coldDownTurns = 1;
  }

  get damage () {
    return Math.max(9 + 4 * this.power, 5);
  }

  canUse (player) {
    // 看看左边技能有没有充能
    const leftSkill = player.frontierSkills[this.getInBattleIndex(player) - 1];
    const leftHaveUses = leftSkill?.uses > 0;
    // 看看右边技能有没有充能
    const rightSkill = player.frontierSkills[this.getInBattleIndex(player) + 1];
    const rightHaveUses = rightSkill?.uses > 0;
    return super.canUse() && (leftHaveUses || rightHaveUses);
  }

  // 使用技能
  use(player, enemy, stage) {
    // 看看左边技能有没有充能
    const leftSkill = player.frontierSkills[this.getInBattleIndex(player) - 1];
    const leftHaveUses = leftSkill?.uses > 0;
    // 看看右边技能有没有充能
    const rightSkill = player.frontierSkills[this.getInBattleIndex(player) + 1];
    const rightHaveUses = rightSkill?.uses > 0;
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
    this.coldDownTurns = 1;
  }
  
  get damage () {
    return Math.max(10 + 4 * this.power, 6);
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
    this.coldDownTurns = 1;
  }
  
  get damage () {
    return 4 + 3 * this.power;
  }

  // 使用技能
  use(player, enemy, stage) {
    if(stage == 0) {
        const atkPassThroughDamage = launchAttack(player, enemy, this.damage).passThoughDamage;
        if(atkPassThroughDamage > 0) return false;
        return true;
    } else {
        enemy.addEffect('易伤', 1);
        return true;
    }
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `造成${this.damage + (player?.attack ?? 0)}点伤害，赋予/effect{易伤}1`;
  }
}

// 脱力打击
// 造成10伤害，减1力量
export class OffPowerPunchKick extends Skill {
  constructor() {
    super('脱力打击', 'normal', 0, 0, 1, 1);
    this.coldDownTurns = 1;
  }
  
  get damage () {
    return 10 + 3 * this.power;
  }

  // 使用技能
  use(player, enemy, stage) {
    if(stage == 0) {
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
