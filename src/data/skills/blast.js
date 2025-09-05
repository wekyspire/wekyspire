import Skill from '../skill.js';
import { launchAttack } from '../../GameApp.vue';

// 示例技能：火弹术(C-)
export class Fireshot extends Skill {
  constructor() {
    super('火弹术', 'magic', 1, '造成【2+2x/named{灵能}】伤害', 1, 1, '火弹术', 1);
    this.baseDamage = 2;
    this.upgradeTo = "火球术";
    this.coldDownTurns = 1;
  }

  getDamage(player) {
    return this.baseDamage + player.magic * 2;
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      launchAttack(player, enemy, this.getDamage(player));
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      return `造成${this.getDamage(player)}点伤害`;
    }
    return this.description;
  }
}

// 火球术(B-)
export class Fireball extends Skill {
  constructor() {
    super('火球术', 'magic', 3, '造成【3+3x/named{灵能}】伤害', 1, 1, '火球术', 1);
    this.baseDamage = 3;
    this.upgradeTo = "大火球术";
    this.coldDownTurns = 2;
  }

  getDamage(player) {
    return this.baseDamage + player.magic * 3;
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      launchAttack(player, enemy, this.getDamage(player));
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      return `造成${this.getDamage(player)}点伤害`;
    }
    return this.description;
  }
}

// 大火球术(B+)
export class LargeFireball extends Skill {
  constructor() {
    super('大火球术', 'magic', 5, '造成【5+6x/named{灵能}】伤害', 2, 1, '火球术', 1);
    this.baseDamage = 5;
    this.coldDownTurns = 2;
    this.upgradeTo = "卡拉迪亚爆裂术";
  }

  getDamage(player) {
    return this.baseDamage + player.magic * 6;
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      launchAttack(player, enemy, this.getDamage(player));
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      return `造成${this.getDamage(player)}点伤害`;
    }
    return this.description;
  }
}


// 弱卡拉迪亚爆裂术(A+)
export class KaradiaBurst extends Skill {
    constructor() {
        super('弱卡拉迪亚爆裂术', 'magic', 8, '造成【10+12x/named{灵能}】伤害', 3, 1, '火球术', 1);
        this.baseDamage = 10;
        this.coldDownTurns = 4;
    }

    getDamage(player) {
        return this.baseDamage + player.magic * 12;
    }

    // 使用技能
    use(player, enemy) {
        if (super.use()) {
        launchAttack(player, enemy, this.getDamage(player));
        return true;
        }
        return false;
    }

    // 重新生成技能描述
    regenerateDescription(player) {
        if (player) {
        return `造成${this.getDamage(player)}点伤害`;
        }
        return this.description;
    }
}

// 齐明天焱(S)
export class GigaFlameBlast extends Skill {
  constructor() {
    super('齐明天焱', 'magic', 9, '造成【15+20x/named{灵能}】伤害', 5, 1, '火球术', 1);
    this.baseDamage = 15;
    this.coldDownTurns = 5;
    this.subtitle = "最纯粹的破坏力";
  }

  getDamage(player) {
    return this.baseDamage + player.magic * 20;
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      launchAttack(player, enemy, this.getDamage(player));
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      return `造成${this.getDamage(player)}点伤害`;
    }
    return this.description;
  }
};

// 导出所有技能
export default {
  Fireshot,
  Fireball,
  LargeFireball,
  KaradiaBurst,
  GigaFlameBlast
};