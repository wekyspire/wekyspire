// 一些单卡

import Skill from '../../skill.js';
import {launchAttack, dealDamage, gainShield, drawSkillCard, dropSkillCard, burnSkillCard, discoverSkillCard} from '../../battleUtils.js';
import {signedNumberString, signedNumberStringW0} from "../../../utils/nameUtils";
import {SkillTier} from "../../../utils/tierUtils";

// 莽撞攻击（D）（莽撞攻击）
export class CarelessPunch extends Skill {
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

// 飞刀（C-）（单卡）
// 攻击并丢弃相邻牌，需要前后都有牌
export class SpeedyPunch extends Skill {
  constructor() {
    super('飞刀', 'normal', SkillTier.C_PLUS, 0, 1, 1);
    this.baseColdDownTurns = 1;
  }

  get damage () {
    return Math.max(16 + 7 * this.power, 5);
  }

  canUse(player) {
    if(super.canUse(player)) {
      const index = this.getInBattleIndex(player);
      if(index > 0 && index < player.frontierSkills.length - 1) {
        return true;
      }
    }
    return false;
  }

  // 使用技能
  use(player, enemy, stage) {
    launchAttack(player, enemy, this.damage);
    // 看看左边技能
    const leftSkill = player.frontierSkills[this.getInBattleIndex(player) - 1];
    if(leftSkill) {
      dropSkillCard(player, leftSkill.uniqueID);
    }
    // 看看右边技能
    const rightSkill = player.frontierSkills[this.getInBattleIndex(player) + 1];
    if(rightSkill) {
      dropSkillCard(player, rightSkill.uniqueID);
    }
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `${this.damage + (player?.attack ?? 0)}伤害，丢弃两侧卡，发动需两侧有卡`;
  }
}

// 狡黠打击（C+）（单卡）
// 造成6伤害，将最左侧牌置入牌堆顶
export class CunningPunch extends Skill {
  constructor() {
    super('狡黠打击', 'normal', SkillTier.C_PLUS, 0, 1, 1);
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
      if(player.frontierSkills.length > 1) {
        const leftSkill = player.frontierSkills[0];
        if(leftSkill.uniqueID !== this.uniqueID)
          dropSkillCard(player, leftSkill.uniqueID, 0);
      }
      return true;
    }
  }
  regenerateDescription(player) {
    return `造成${this.damage + (player?.attack ?? 0)}点伤害，将最左侧牌置入牌堆顶`;
  }
}

// 试探打击（C-）（单卡）
// 造成5伤害，获得1格挡
export class ProbingPunch extends Skill {
  constructor() {
    super('试探打击', 'normal', SkillTier.C_MINUS, 0, 1, 1);
    this.baseColdDownTurns = 1;
  }
  get damage() {
    return Math.max(5 + 3 * this.power, 4);
  }
  use(player, enemy, stage) {
    if(stage === 0) {
      launchAttack(player, enemy, this.damage);
      return false;
    } else {
      player.addEffect('格挡', 1);
      return true;
    }
  }
  regenerateDescription(player) {
    return `造成${this.damage + (player?.attack ?? 0)}点伤害，获得1/effect{格挡}`;
  }
}

// 断子绝孙脚（C-）
// 造成6伤害，造成生命伤害则赋予虚弱
export class ElegantKick extends Skill {
  constructor() {
    super('断子绝孙脚', 'normal', 1, 0, 2, 1);
    this.baseColdDownTurns = 3;
  }

  get damage () {
    return Math.max(6 + 3 * this.power, 3);
  }

  // 使用技能
  use(player, enemy) {
    const result = launchAttack(player, enemy, this.damage);
    if(result.hpDamage > 0) {
      enemy.addEffect('虚弱');
    }
    return true;
  }

  regenerateDescription(player) {
    return `造成${this.damage + (player?.attack ?? 0)}伤害，造成生命伤害则赋予/effect{虚弱}`;
  }
}
