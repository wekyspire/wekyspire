import Skill from '../skill.js';
import { launchAttack } from '../../GameApp.vue';

// 拳打脚踢技能
export class PunchKick extends Skill {
  constructor() {
    super('拳打脚踢', 'normal', 0, '造成【1+/named{攻击}】伤害', 0, Infinity, '拳打脚踢');
    this.baseDamage = 1;
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      const damage = this.baseDamage + player.attack;
      launchAttack(player, enemy, damage);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      const damage = this.baseDamage + player.attack;
      return `造成${damage}点伤害`;
    }
    return this.description;
  }
}

// 打滚技能
export class Roll extends Skill {
  constructor() {
    super('打滚', 'normal', 0, '获得2层/effect{防御}', 0, 1, '打滚');
    this.stacks = 2;
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      player.addEffect('防御', this.stacks);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `获得${this.stacks}层/effect{防御}`;
  }
}

// 睡觉技能
export class Sleep extends Skill {
  constructor() {
    super('睡觉', 'normal', 0, '恢复/green{10}/named{生命值}，每场战斗仅能用1次', 0, 1, '睡觉');
    this.used = false; // 每场战斗只能使用一次
    this.heal = 10;
  }

  // 重写 canUse
  canUse(player) {
    return !this.used && super.canUse(player);
  }

  // 战斗开始时调用，重置used属性
  onBattleStart() {
    this.used = false;
  }

  // 使用技能
  use(player, enemy) {
    if (!this.used && super.use()) {
      player.applyHeal(this.heal);
      this.used = true;
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `恢复/green{${this.heal}}点生命值，每场战斗仅能用1次`;
  }
}

// 功夫技能
export class KungFu extends Skill {
  constructor() {
    super('功夫', 'normal', 1, '造成【2+1.5x/named{攻击}】伤害', 0, Infinity, '拳打脚踢');
    this.baseDamage = 2;
    this.multiplier = 1.5;
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      const damage = this.baseDamage + Math.floor(this.multiplier * player.attack);
      launchAttack(player, enemy, damage);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      const damage = this.baseDamage + Math.floor(this.multiplier * player.attack);
      return `造成${damage}点伤害`;
    }
    return this.description;
  }
}