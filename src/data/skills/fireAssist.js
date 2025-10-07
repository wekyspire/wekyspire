// 火属辅助类技能

import Skill from '../skill.js';
import {applyHeal, burnSkillCard, dealDamage, drawSkillCard, dropSkillCard, launchAttack} from '../battleUtils.js';
import {enqueueDelay} from "../animationInstructionHelpers";

// 无缘烈焰（C-）
// 丢弃冷却中的技能，自己和敌人各获得3层燃烧
export class UnreasonableFire extends Skill {
  constructor() {
    super('无缘烈焰', 'fire', 1, 0, 2, 1);
    this.baseColdDownTurns = 2;
  }

  get selfStacks() {
    return 3;
  }

  get enemyStacks() {
    return Math.max(3 + 2 * this.power, 1);
  }

  use(player, enemy, stage) {
    if(stage === 0) {
      const toDropSkills = player.frontierSkills.filter(skill => skill.remainingUses === 0 && skill !== this);
      for(let skill of toDropSkills) {
        if(player.frontierSkills.indexOf(skill) > -1) {
          dropSkillCard(player, skill.uniqueID);
          enqueueDelay(200);
        }
      }
      return false;
    } else if(stage === 1){
      player.addEffect('燃烧', this.selfStacks);
      enqueueDelay(500);
      return false;
    } else {
      enemy.addEffect('燃烧', this.enemyStacks);
      return true;
    }
  }

  regenerateDescription(player) {
    if (this.selfStacks === this.enemyStacks) {
      return `丢弃未冷却技能，获得并赋予${this.selfStacks}层/effect{燃烧}`;
    } else {
      return `丢弃未冷却技能，获得${this.selfStacks}层/effect{燃烧}，赋予${this.enemyStacks}层/effect{燃烧}`;
    }
  }
}

// 双发火弹（C-）
// 造成【12 + 灵能】伤害两次
export class DoubleFireshot extends Skill {
  constructor() {
    super('双发火弹', 'fire', 1, 1, 3, 1);
    this.baseColdDownTurns = 3;
    this.baseSlowStart = true;
  }
  get damage() {
    return 12 + this.power * 8;
  }
  getDamage (player) {
    return this.damage + player.magic;
  }
  use(player, enemy, stage) {
    if (stage === 0) {
      launchAttack(player, enemy, this.getDamage(player));
      return false;
    } else {
      enqueueDelay(500);
      launchAttack(player, enemy, this.getDamage(player));
      return true;
    }
  }
  regenerateDescription(player) {
    if (player) {
      return `造成${this.getDamage(player) + player.attack}点伤害，重复一次`;
    }
    return `造成【${this.damage} + /named{灵能}】点伤害，重复一次`;
  }
}

// 激热（C-）
// 造成【10 + 2x灵能】伤害，获得3层燃烧
export class SearingHeat extends Skill {
  constructor() {
    super('激热', 'fire', 1, 0, 2, 1);
    this.baseColdDownTurns = 2;
  }
  get damage() {
    return Math.max(10 + 4 * this.power, 1);
  }
  getDamage (player) {
    return this.damage + player.magic * 2;
  }
  get stacks() {
    return Math.max(3, 1);
  }
  use(player, enemy, stage) {
    if(stage === 0) {
      launchAttack(player, enemy, this.getDamage(player));
      return false;
    } else {
      enqueueDelay(500);
      player.addEffect('燃烧', this.stacks);
      return true;
    }
  }
  regenerateDescription(player) {
    if(player) {
      return `造成${this.getDamage(player) + player.attack}点伤害，获得${this.stacks}层/effect{燃烧}`;
    }
    return `造成【${this.damage} + 2x/named{灵能}】点伤害，获得${this.stacks}层/effect{燃烧}`;
  }
}

// 火花（C-)
// 获得2层燃烧，抽2张牌
export class Spark extends Skill {
  constructor() {
    super('火花', 'fire', 1, 0, 1, 1);
    this.baseColdDownTurns = 1;
  }
  get cards() {
    return Math.max(2 + this.power, 1);
  }
  get stacks() {
    return 2;
  }
  use(player, enemy, stage) {
    if(stage === 0) {
      player.addEffect('燃烧', this.stacks);
      return false;
    } else {
      drawSkillCard(player, this.cards);
      return true;
    }
  }
  regenerateDescription(player) {
    return `获得${this.stacks}层/effect{燃烧}，抽${this.cards}张牌`;
  }
}

// 玩火（C-）
// 丢弃前方所有牌，每丢一张获得并赋予3层燃烧
export class Firework extends Skill {
  constructor() {
    super('玩火', 'fire', 1, 1, 1, 1);
    this.baseColdDownTurns = 3;
    this.baseSlowStart = true;
    this.subtitle = '小心牢底坐穿';
  }

  get coldDownTurns() {
    return Math.max(super.coldDownTurns - this.power, 1);
  }

  get stacks() {
    return 3;
  }

  use(player, enemy, stage) {
    while (true) {
      const thisCardIndex = player.frontierSkills.indexOf(this);
      if (thisCardIndex === -1 || thisCardIndex === 0) {
        return true;
      }
      const skill = player.frontierSkills[0];
      dropSkillCard(player, skill.uniqueID);
      player.addEffect('燃烧', this.stacks);
      enemy.addEffect('燃烧', this.stacks);
    }
    return true;
  }
  regenerateDescription(player) {
    return `丢弃/named{前方}所有牌，每张获得并赋予${this.stacks}层/effect{燃烧}`;
  }
}

// 运焰（C-）
// 失去4层燃烧，丢2张牌
export class FireTransport extends Skill {
  constructor() {
    super('运焰', 'fire', 1, 0, 1, 1);
    this.baseColdDownTurns = 3;
  }

  get stacks() {
    return Math.max(4 + 2 * this.power, 1);
  }

  get cards() {
    return Math.max(2 + this.power, 1);
  }

  use(player, enemy, stage) {
    if (stage === 0) {
      const burnEffect = player.effects['燃烧'] || 0;
      player.removeEffect('燃烧', Math.min(this.stacks, burnEffect));
      return false;
    } else if (stage === 1) {
      selectSkillCard(player, skill.uniqueID).then(
        (selectedCard) => {
          dropSkillCard(player, selectedCard.uniqueID);
        }
      );
      return false;
    } else {
      selectSkillCard(player, skill.uniqueID).then(
        (selectedCard) => {
          dropSkillCard(player, selectedCard.uniqueID);
        }
      );
      return true;
    }
  }
  regenerateDescription(player) {
    return `失去${this.stacks}层/effect{燃烧}，丢${this.cards}张牌`;
  }
}


// 温暖拥抱（C-）
// 受3伤害，向敌人转移至多9层燃烧
export class WarmHug extends Skill {
  constructor() {
    super('温暖拥抱', 'fire', 1, 0, 1, 2);
  }

  get damage () {
    return 3 - 3 * this.power;
  }
  getStacks(player) {
    const stacks = player.effects['燃烧'] || 0;
    const baseTransferStacks = Math.min(stacks, 9);
    return Math.max(0, baseTransferStacks);
  }

  use(player, enemy, stage) {
    if(stage === 0) {
      if(this.damage > 0) {
        dealDamage(player, player, this.damage);
      } else if(this.damage < 0) {
        applyHeal(player, this.damage);
      }
      enqueueDelay(500);
      return false;
    } else {
      const stacks = this.getStacks(player);
      player.removeEffect('燃烧', Math.min(stacks, player.effects['燃烧'] || 0));
      enemy.addEffect('燃烧', stacks);
      return true;
    }
  }

  get damageText () {
    if(this.damage > 0) {
      return `受到${this.damage}点伤害，`;
    } else if(this.damage < 0) {
      return `治疗${-this.damage}，`;
    } else return '';
  }

  regenerateDescription(player) {
    if(player) {
      return `${this.damageText}向敌人转移${this.getStacks(player)}层/effect{燃烧}`;
    }
    return `${this.damageText}向敌人转移至多9层燃烧`;
  }
}

// 散火（C-）
// 丢弃前方所有牌，每张失去3层燃烧
export class DisperseFire extends Skill {
  constructor() {
    super('散火', 'fire', 1, 0, 1, 1);
    this.baseColdDownTurns = 3;
  }

  get coldDownTurns() {
    return Math.max(super.coldDownTurns - this.power, 1);
  }

  use(player, enemy, stage) {
    while (player.frontierSkills.length > 0) {
      const skill = player.frontierSkills[0];
      if(skill === this) {
        break;
      }
      dropSkillCard(player, skill.uniqueID);
      const toRemove = Math.min(player.effects['燃烧'], 3);
      enqueueDelay(200);
      player.removeEffect('燃烧', toRemove);
    }
    return true;

  }
  regenerateDescription(player) {
    return `丢弃/named{前方}所有牌，每张移除3层/effect{燃烧}`;
  }
}

// 火爆冲拳（C+）
// 造成7 + 你燃烧层数点伤害
export class FieryPunch extends Skill {
  constructor() {
    super('火爆冲拳', 'fire', 2, 0, 2, 1);
    this.baseColdDownTurns = 2;
  }
  get baseDamage() {
    return Math.max(7 + 5 * this.power, 1);
  }
  getDamage (player) {
    const burnEffect = player.effects['燃烧'] || 0;
    return this.baseDamage + burnEffect;
  }
  use(player, enemy, stage) {
    launchAttack(player, enemy, this.getDamage(player));
    return true;
  }
  regenerateDescription(player) {
    if(player) {
      return `造成${this.getDamage(player) + player.attack}点伤害`;
    }
    return `造成【${this.baseDamage} + /effect{燃烧}层数】点伤害`;
  }
}

// 三发火弹
// 造成【15 + 1x灵能】伤害三次
export class TripleFireshot extends Skill {
  constructor() {
    super('三发火弹', 'fire', 2, 1, 5, 1);
    this.baseColdDownTurns = 4;
    this.baseSlowStart = true;
  }
  get damage() {
    return 15 + this.power * 5;
  }
  getDamage (player) {
    return this.damage + player.magic;
  }
  use(player, enemy, stage) {
    if (stage === 0) {
      launchAttack(player, enemy, this.getDamage(player));
      return false;
    } else if(stage === 1) {
      enqueueDelay(500);
      launchAttack(player, enemy, this.getDamage(player));
      return false;
    } else {
      enqueueDelay(500);
      launchAttack(player, enemy, this.getDamage(player));
      return true;
    }
  }
  regenerateDescription(player) {
    if (player) {
      return `造成${this.getDamage(player) + player.attack}点伤害3次`;
    }
    return `造成【${this.damage} + /named{灵能}】点伤害3次`;
  }
}

// 炽热诅咒（C+）
// 烧掉最近的卡，赋予敌人【6+灵能】层燃烧
export class ScorchingCurse extends Skill {
  constructor() {
    super('炽热诅咒', 'fire', 2, 1, 1, 1);
    this.baseColdDownTurns = 4;
  }

  get stacks() {
    return Math.max(6 + 2 * this.power, 1);
  }

  getClosestSkill(player) {
    let anySkill = null;
    let minDistance = Infinity;
    player.frontierSkills.forEach(skill => {
      if (skill !== this) {
        const distance = Math.abs(skill.getInBattleIndex(player) - this.getInBattleIndex(player));
        if (distance < minDistance) {
          minDistance = distance;
          anySkill = skill;
        }
      }
    });
    return anySkill;
  }

  getStacks(player) {
    return this.stacks + player.magic;
  }

  use(player, enemy, stage) {
    if(stage === 0) {
      const closestSkillID = this.getClosestSkill(player)?.uniqueID;
      burnSkillCard(player, closestSkillID, true);
      return false;
    } else {
      enemy.addEffect('燃烧', this.getStacks(player));
      return true;
    }
  }

  regenerateDescription(player) {
    if(player) {
      return `/named{焚毁}/named{最近}的技能，赋予敌人${this.getStacks(player)}层/effect{燃烧}`;
    }
    return `/named{焚毁}/named{最近}的技能，赋予敌人【7+/named{灵能}】层/effect{燃烧}`;
  }
}

// 耐热（C+）
// 咏唱：获得6层火焰抗性
export class HeatResistance extends Skill {
  constructor() {
    super('耐热', 'fire', 2, 0, 1, 1);
    this.cardMode = 'chant';
    this.modifier_ = (player) => {
      const self = this;
      return new Proxy(player, {
        get(target, prop) {
          if (prop === 'effects') {
            const effects = {...target.effects};
            effects['火焰抗性'] = (effects['火焰抗性'] || 0) + self.stacks;
            return effects;
          }
          return target[prop];
        }
      });
    };
  }
  get stacks() {
    return Math.max(6 + 3 * this.power, 1);
  }
  use(player, enemy, stage) {
    return true;
  }
  onEnable(player) {
    super.onEnable(player);
    player.addModifier(this.modifier_);
  }
  onDisable(player, reason) {
    super.onDisable(player, reason);
  }
  regenerateDescription(player) {
    return `获得${this.stacks}层/effect{火焰抗性}`;
  }
}

// 烫手（C+）
// 获得5层燃烧，抽4张牌
export class HotHands extends Skill {
  constructor() {
    super('烫手', 'fire', 2, 0, 1, 1);
    this.baseColdDownTurns = 3;
  }
  get cards() {
    return Math.max(4 + 2 * this.power, 1);
  }
  get stacks() {
    return 5;
  }
  use(player, enemy, stage) {
    if(stage === 0) {
      player.addEffect('燃烧', this.stacks);
      return false;
    } else {
      drawSkillCard(player, this.cards);
      return true;
    }
  }
  regenerateDescription(player) {
    return `获得${this.stacks}层/effect{燃烧}，抽${this.cards}张牌`;
  }
}

// 吸热（C+）
// 获得2层吸热
export class HeatAbsorptionI extends Skill {
  constructor() {
    super('吸热', 'fire', 2, 1, 1, 1, '吸热');
  }
  get stacks() {
    return Math.max(2 + this.power, 1);
  }
  use(player, enemy, stage) {
    player.addEffect('吸热', this.stacks);
    return false;
  }
  regenerateDescription(player) {
    return `获得${this.stacks}层/effect{吸热}`;
  }
}

// 火焰伴身（B-）
// 咏唱：每5层燃烧提供1点集中
export class FireAssistance extends Skill {
  constructor() {
    super('火焰伴身', 'fire', 3, 1, 1, 1);
    this.cardMode = 'chant';
    this.modifier_ = (player) => {
      const self = this;
      return new Proxy(player, {
        get(target, prop) {
          if (prop === 'magic') {
            const burnEffect = target.effects['燃烧'] || 0;
            return Math.floor(burnEffect / self.conversionRate) + target.magic;
          }
          return target[prop];
        }
      });
    };
  }
  get conversionRate() {
    return Math.max(5 - this.power, 4);
  }
  use(player, enemy, stage) {
    return true;
  }
  onEnable(player) {
    super.onEnable(player);
    this.baseActionPointCost = 0;
    player.addModifier(this.modifier_);
  }
  onDisable(player, reason) {
    super.onDisable(player, reason);
    player.removeModifier(this.modifier_);
  }
  regenerateDescription(player) {
    return `每${this.conversionRate}层/effect{燃烧}提供1层/effect{集中}`;
  }
}

// 奉予烈焰
// 抽牌焚毁，赋予【3 + 灵能】层燃烧，重复
export class GiveFire extends Skill {
  constructor() {
    super('奉予烈焰', 'fire', 3, 1, 1, 1);
    this.baseColdDownTurns = 4;
  }
  get stacks() {
    return Math.max(3 + 2 * this.power, 1);
  }
  getStacks(player) {
    return this.stacks + player.magic;
  }
  use(player, enemy, stage) {
    for(let i = 0; i < 2; i ++) {
      const card = drawSkillCard(player);
      enqueueDelay(400);
      if (card) {
        burnSkillCard(player, card.uniqueID);
        enqueueDelay(400);
      }
      enemy.addEffect('燃烧', this.getStacks(player));
      enqueueDelay(400);
    }
    return true;
  }
  regenerateDescription(player) {
    if(player) {
      return `抽牌焚毁，赋予${this.getStacks(player)}层/effect{燃烧}，重复`;
    }
    return `抽牌焚毁，赋予【3 + /named{灵能}】层/effect{燃烧}，重复`;
  }
}


// 燃心决（A）
// 获得6层集中和1层燃心
export class DevotionCurse extends Skill {
  constructor() {
    super('燃心决', 'fire', 7, 0, 1, 1);
    this.subtitle = '"我已做出了抉择"';
    this.image = '燃心决.png';
  }

  get stacks() {
    return Math.max(6 + 3 * this.power, 1);
  }

  use(player, enemy, stage) {
    if(stage === 0) {
        player.addEffect('集中', this.stacks);
        enqueueDelay(500);
        return false;
    } else {
        player.addEffect('燃心', 1);
        return true;
    }
  }

  regenerateDescription(player) {
    return `获得${this.stacks}层/effect{集中}，1层/effect{燃心}`;
  }
}


// 俱焚（B）
// 获得并赋予【12 + 3*灵能】层燃烧
export class DualExtinction extends Skill {
  constructor() {
    super('俱焚', 'fire', 4, 2, 1, 1);
  }

  get stacks() {
    return Math.max(12 + 8 * this.power, 1);
  }

  getStacks(player) {
    return this.stacks + player.magic * 3;
  }

  use(player, enemy, stage) {
    if(stage === 0) {
      player.addEffect('燃烧', this.getStacks(player));
      enqueueDelay(500);
      return false;
    } else {
      enemy.addEffect('燃烧', this.getStacks(player));
      return true;
    }
  }

  regenerateDescription(player) {
    if(player) {
      return `获得并赋予${this.getStacks(player)}层/effect{燃烧}`;
    }
    return `获得并赋予【${this.stacks} + 3*/named{灵能}】层/effect{燃烧}`;
  }
}

// 暴怒（B）
// 获得1层暴怒
export class Rage extends Skill {
  constructor() {
    super('暴怒', 'buff', 5, 3, 1, 1);
  }

  get stacks() {
    return Math.max(1 + this.power, 1);
  }

  get burnStacks() {
    return -Math.min(-5 * this.power, 0);
  }

  use(player, enemy, stage) {
    if(stage === 0) {
        player.addEffect('暴怒', this.stacks);
        return this.power >= 0;
    } else {
        player.addEffect('燃烧', this.burnStacks);
        return true;
    }
  }

  regenerateDescription(player) {
    if(this.power >= 0) {
        return `获得${this.stacks}层/effect{暴怒}`;
    } else {
        return `获得${this.stacks}层/effect{暴怒}，${this.burnStacks}层/effect{燃烧}`;
    }
  }
}

// 燃烧弹 (B-)
// 获得高燃弹药
export class FlameableAmmo extends Skill {
  constructor() {
    super('燃烧弹', 'boss-buff', 4, 2, 1, 1);
  }

  get burnStacks() {
    return -Math.max(0, this.power);
  }

  get stacks() {
    return 1 + this.power;
  }

  use (player, enemy, stage) {
    if(stage === 0) {
        player.addEffect('高燃弹药', this.stacks);
        enqueueDelay(500);
        return this.power >= 0;
    } else {
        player.addEffect('燃烧', this.burnStacks);
        return true;
    }
  }

  regenerateDescription(player) {
    if(this.power < 0) {
        return `获得${this.burnStacks}层/effect{高燃弹药}和${this.stacks}层/effect{燃烧}`;
    }
    return `获得${this.stacks}层/effect{高燃弹药}`;
  }
}