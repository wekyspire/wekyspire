import Skill from '../skill.js';
import { launchAttack, dealDamage, gainShield } from '../../GameApp.vue';

// 拳打脚踢技能
export class PunchKick extends Skill {
  constructor() {
    super('拳打脚踢', 'normal', 0, '造成【1+/named{攻击}】伤害', 0, Infinity, '拳打脚踢', 1);
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
    super('打滚', 'normal', 0, '获得1层/effect{闪避}', 0, 1, '打滚', 1);
    this.stacks = 1;
    this.maxUses = 2;
    this.coldDownTurns = 1;
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      player.addEffect('闪避', this.stacks);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `获得${this.stacks}层/effect{闪避}`;
  }
}

// 睡觉技能
export class Sleep extends Skill {
  constructor() {
    super('睡觉', 'normal', 0, '恢复/green{7}/named{生命}', 0, 1, '睡觉', 1);
    this.heal = 7;
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      player.applyHeal(this.heal);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `恢复/green{${this.heal}}/named{生命}`;
  }
}

// 睡觉技能
export class LargeSleep extends Skill {
  constructor() {
    super('睡大觉', 'normal', 1, '恢复/green{22}/named{生命}，/effect{眩晕}', 0, 1);
    this.heal = 22;
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      player.applyHeal(this.heal);
      player.addEffect('眩晕', 1);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `恢复/green{${this.heal}}/named{生命}，/effect{眩晕}`;
  }
}

// 活动筋骨
export class PrepareExercise extends Skill {
  constructor() {
    super('活动筋骨', 'normal', 0, '获得1层/effect{力量}', 0, 1);
    this.stacks = 1;
    this.maxUses = 4;
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      player.addEffect('力量', this.stack);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `获得${this.stacks}层/effect{力量}`;
  }
}

// 莽撞攻击
export class CarelessPunchKick extends Skill {
  constructor() {
    super('莽撞攻击', 'normal', 0, '造成【6+/named{攻击}】伤害，受1伤害', 0, 1);
    this.baseDamage = 6;
    this.coldDownTurns = 1;
  }


  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      const damage = this.baseDamage + player.attack;
      launchAttack(player, enemy, damage);
      dealDamage(player, player, 1);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      const damage = this.baseDamage + player.attack;
      return `造成${damage}点伤害，受1伤害`;
    }
    return this.description;
  }
}

// 抱头防御
export class AmateurDefense extends Skill {
  constructor() {
    super('抱头防御', 'normal', 0, '获得5护盾', 0, 1);
    this.coldDownTurns = 1;
  }
  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      gainShield(player, player, 5);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      return `获得5护盾`;
    }
    return this.description;
  }
}

// 畏手畏脚
export class OverCarefulDefense extends Skill {
  constructor() {
    super('畏手畏脚', 'normal', 0, '获得2层/effect{坚固}，-1层/effect{力量}', 0, 1);
  }
  // 使用技能
  use(player, enemy) {
    if (!this.used && super.use()) {
      player.addEffect('坚固', 2);
      player.addEffect('力量', -1);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      return `获得2层/effect{坚固}，-1层/effect{力量}`;
    }
    return this.description;
  }
}

// 匹夫之勇
export class CarelessBravery extends Skill {
  constructor() {
    super('匹夫之勇', 'normal', 0, '获得4层/effect{力量}，-3层/effect{坚固}，每场战斗只能用一次', 0, 1);
    this.used = false;
  }
  // 使用技能
  use(player, enemy) {
    if (!this.used && super.use()) {
      player.addEffect('力量', 4);
      player.addEffect('坚固', -3);
      this.used = true;
      return true;
    }
    return false;
  }

  // 战斗开始时调用，重置used属性
  onBattleStart() {
    this.used = false;
  }

  canUse(player) {
    return !this.used && super.canUse(player);
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      return `获得4层/effect{力量}，-3层/effect{坚固}，每场战斗只能用一次`;
    }
    return this.description;
  }
}

// 强撑
export class HoldOn extends Skill {
  constructor() {
    super('强撑', 'normal', 1, '获得4层/effect{坚固}，1层/effect{崩溃}', 0, 1);
  }
  // 使用技能
  use(player, enemy) {
    if (!this.used && super.use()) {
      player.addEffect('坚固', 4);
      player.addEffect('崩溃', 1);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      return `获得4层/effect{坚固}，1层/effect{崩溃}`;
    }
    return this.description;
  }
}

// 功夫技能
export class KungFu extends Skill {
  constructor() {
    super('功夫', 'normal', 1, '造成【2+1.5x/named{攻击}】伤害', 0, Infinity, '拳打脚踢', 1);
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