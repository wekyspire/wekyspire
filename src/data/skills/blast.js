import Skill from '../skill.js';
import { launchAttack } from '../battleUtils.js';

// 火矢(C-)
export class Fireshot extends Skill {
  constructor() {
    super('火矢', 'fire', 1, 1, 1, 1, '火球术');
    this.upgradeTo = "强火矢";
    this.baseColdDownTurns = 3;
    this.baseSlowStart = true;
  }


  get baseDamage() {
    return Math.max(14 + 4 * this.power, 1);
  }

  getDamage(player) {
    return this.baseDamage + player.magic * 2;
  }

  // 使用技能
  use(player, enemy) {
    launchAttack(player, enemy, this.getDamage(player));
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if(player) return `造成${this.getDamage(player) + (player?.attack ?? 0)}点伤害`;
    return `造成【${this.baseDamage} + 2x/named{灵能}】点伤害`;
  }
}

// 强火矢(B-)
export class Fireball extends Skill {
  constructor() {
    super('强火矢', 'fire', 3, 1, 1, 1, '火球术');
    this.upgradeTo = "炙火矢";
    this.baseColdDownTurns = 3;
    this.baseSlowStart = true;
  }

  get baseDamage() {
    return Math.max(16 + 6 * this.power, 1);
  }

  getDamage(player) {
    return this.baseDamage + player.magic * 3;
  }

  // 使用技能
  use(player, enemy) {
    launchAttack(player, enemy, this.getDamage(player));
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if(player) return `造成${this.getDamage(player) + (player?.attack ?? 0)}点伤害`;
    return `造成【${this.baseDamage} + 3x/named{灵能}】点伤害`;
  }
}

// 炙火矢(B+)
export class LargeFireball extends Skill {
  constructor() {
    super('炙火矢', 'fire', 5, 3, 1, 1, '火球术');
    this.upgradeTo = "小爆裂术";
    this.baseColdDownTurns = 4;
    this.baseSlowStart = true;
  }

  get baseDamage() {
    return Math.max(28 + 10 * this.power, 1);
  }

  getDamage(player) {
    return this.baseDamage + player.magic * 9;
  }

  // 使用技能
  use(player, enemy) {
    launchAttack(player, enemy, this.getDamage(player));
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if(player) return `造成${this.getDamage(player) + (player?.attack ?? 0)}点伤害`;
    return `造成【${this.baseDamage} + 9x/named{灵能}】点伤害`;
  }
}


// 小爆裂术(A-)
export class TinyKaradiaBurst extends Skill {
  constructor() {
    super('小爆裂术', 'fire', 6, 5, 1, 1, '火球术');
    this.baseColdDownTurns = 5;
    this.baseSlowStart = true;
    this.image = '小爆裂术.png';
  }

  get baseDamage() {
      return Math.max(40 + 25 * this.power, 1);
  }

  getDamage(player) {
      return this.baseDamage + player.magic * 15;
  }

  // 使用技能
  use(player, enemy) {
    launchAttack(player, enemy, this.getDamage(player));
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if(player) return `造成${this.getDamage(player) + (player?.attack ?? 0)}点伤害`;
    return `造成【${this.baseDamage} + 15x/named{灵能}】点伤害`;
  }
}

// 齐明天焱(A+)
export class SolarBlast extends Skill {
  constructor() {
    super('齐明天焱', 'fire', 8, 8, 1, 1, '火球术');
    this.subtitle = "纯粹的破坏力";
    this.baseColdDownTurns = 6;
    this.baseSlowStart = true;
    this.image = '齐明天焱.png';
  }

  get coldDownTurns() {
    return 10;
  }

  get baseDamage() {
    return Math.max(80 + 40 * this.power, 1);
  }

  get multiplier() {
    return 25 + 5 * this.power;
  }

  getDamage(player) {
    return this.baseDamage + player.magic * this.multiplier;
  }

  // 使用技能
  use(player, enemy) {
    launchAttack(player, enemy, this.getDamage(player));
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if(player) return `造成${this.getDamage(player) + (player?.attack ?? 0)}点伤害`;
    return `造成【${this.baseDamage} + ${this.multiplier}x/named{灵能}】点伤害`;
  }
}
