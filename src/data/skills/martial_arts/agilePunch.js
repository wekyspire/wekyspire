
import Skill from "../../skill";
import {drawSkillCard, launchAttack} from "../../battleUtils";

// 敏捷打击（D）（敏捷打击）
// 连续攻击，造成伤害则抽牌
export class AgilePunch extends Skill {
  constructor(name = '敏捷打击', tier = 1, damage = 4, powerMultiplier = 3, times = 1, drawCardCount = 1) {
    super(name, 'normal', tier, 0, 1, 1, '敏捷打击');
    this.baseColdDownTurns = 2;
    this.powerMultiplier = powerMultiplier;
    this.baseDamage = damage;
    this.times = times;
    this.drawCardCount = drawCardCount;
    this.shouldDrawCard_ = false;
  }

  get coldDownTurns() {
    return Math.max(super.coldDownTurns - this.power, 1);
  }

  get damage() {
    return Math.max(this.baseDamage + this.powerMultiplier * this.power, 4);
  }

  // 使用技能
  use(player, enemy, stage) {
    if (stage % 2 === 0) {
      if(stage / 2 >= this.times) return true;
      const result = launchAttack(player, enemy, this.damage);
      this.shouldDrawCard_ = result.passThoughDamage > 0;
      return false;
    } else {
      if(this.shouldDrawCard_) drawSkillCard(player, this.drawCardCount);
      return false;
    }
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    const desc =  `造成${this.damage + (player?.attack ?? 0)}点伤害，造成伤害则抽牌`;
    if(this.times > 1) return `${desc}，重复${this.times - 1}次`;
    return desc;
  }
}

// 敏捷连击（C+）（敏捷打击）
// 攻击两次
export class AgileDoublePunch extends AgilePunch {
  constructor() {
    super('敏捷连击', 2, 5, 4, 2);
    this.precessor = '敏捷打击';
  }
}

// 疾风连击（B）（敏捷打击）
// 攻击三次
export class AgileTriplePunch extends AgilePunch {
  constructor() {
    super('疾风连击', 4, 6, 5, 3);
    this.precessor = '敏捷连击';
  }
}

// 全神击（A-）（敏捷打击）
// 攻击一次，抽3张牌
export class AgileAllPunch extends AgilePunch {
  constructor() {
    super('全神击', 6, 44, 6, 1, 3);
    this.precessor = '疾风连击';
  }
}

// 闪电连击（B+）（敏捷打击）
// 攻击三次，每次抽2张牌
export class AgileLightningPunch extends AgilePunch {
  constructor() {
    super('闪电连击', 5, 6, 6, 3, 2);
    this.precessor = '疾风连击';
  }
}

// 光速连击（A）（敏捷打击）
// 攻击六次
export class ThunderFist extends AgilePunch {
  constructor() {
    super('光速连击', 7, 10, 7, 6);
    this.precessor = '疾风连击';
  }
}