import Skill from '../skill.js';
import { launchAttack } from '../battleUtils.js';

// 火弹术(C-)
export class Fireshot extends Skill {
  constructor() {
    super('火弹术', 'magic', 1, 1, 1, 1, '火球术');
    this.coldDownTurns = 1;
    this.upgradeTo = "火球术";
  }

  get baseDamage() {
    return Math.max(10 + 3 * this.power, 1);
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

// 火球术(B-)
export class Fireball extends Skill {
  constructor() {
    super('火球术', 'magic', 3, 1, 1, 1, '火球术');
    this.coldDownTurns = 2;
    this.upgradeTo = "大火球术";
  }

  get baseDamage() {
    return Math.max(12 + 4 * this.power, 1);
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

// 大火球术(B+)
export class LargeFireball extends Skill {
  constructor() {
    super('大火球术', 'magic', 5, 2, 1, 1, '火球术');
    this.coldDownTurns = 2;
    this.upgradeTo = "弱卡拉迪亚爆裂术";
  }

  get baseDamage() {
    return Math.max(15 + 5 * this.power, 1);
  }

  getDamage(player) {
    return this.baseDamage + player.magic * 6;
  }

  // 使用技能
  use(player, enemy) {
    launchAttack(player, enemy, this.getDamage(player));
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if(player) return `造成${this.getDamage(player) + (player?.attack ?? 0)}点伤害`;
    return `造成【${this.baseDamage} + 6x/named{灵能}】点伤害`;
  }
}


// 弱卡拉迪亚爆裂术(A)
export class KaradiaBurst extends Skill {
  constructor() {
    super('弱卡拉迪亚爆裂术', 'magic', 7, 3, 1, 1, '火球术');
    this.coldDownTurns = 4;
  }

  get baseDamage() {
      return Math.max(20 + 8 * this.power, 1);
  }

  getDamage(player) {
      return this.baseDamage + player.magic * 12;
  }

  // 使用技能
  use(player, enemy) {
    launchAttack(player, enemy, this.getDamage(player));
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if(player) return `造成${this.getDamage(player) + (player?.attack ?? 0)}点伤害`;
    return `造成【${this.baseDamage} + 12x/named{灵能}】点伤害`;
  }
}

// 齐明天焱(S)
export class SolarBlast extends Skill {
  constructor() {
    super('齐明天焱', 'magic', 9, 5, 1, 1, '火球术');
    this.coldDownTurns = 5;
    this.subtitle = "最纯粹的破坏力";
  }

  get baseDamage() {
    return Math.max(30 + 15 * this.power, 1);
  }

  get multiplier() {
    return 20 + 4 * this.power;
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
    return `造成【${this.baseDamage} + ${this.multipler}x/named{灵能}】点伤害`;
  }
};

// 导出所有技能
export default {
  Fireshot,
  Fireball,
  LargeFireball,
  KaradiaBurst,
  SolarBlast
};