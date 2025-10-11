// 魏启再生系列技能
import Skill from "../skill";
import {launchAttack} from "../battleUtils";
// 纯化
// 魏启再生
export class PurifyWeky extends Skill {
  constructor() {
    super('纯化', 'normal', 1, 1, 1, 1, '纯化');
    this.baseColdDownTurns = 5;
    this.upgradeTo = '超纯化';
  }

  get stack() {
    return Math.max(1, 2 + this.power);
  }

  // 使用技能
  use(player, enemy) {
    if (super.use(player, enemy)) {
      player.addEffect('聚气', this.stack);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `获得${this.stack}/effect{聚气}`;
  }
}

export class StrongPurifyWeky extends Skill {
  constructor() {
    super('超纯化', 'normal', 3, 2, 1, 1, '纯化');
    this.baseColdDownTurns = 5;
  }

  get stack() {
    return Math.max(3, 4 + this.power);
  }

  // 使用技能
  use(player, enemy) {
    if (super.use(player, enemy)) {
      player.addEffect('聚气', this.stack);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `获得${this.stack}/effect{聚气}`;
  }
}

export class IntakeWeky extends Skill {
  constructor() {
    super('萃取', 'normal', 2, 0, 3, 1, '萃取');
    this.baseColdDownTurns = 4;
    this.upgradeTo = '超萃取';
  }

  get coldDownTurns() {
    return Math.max(1, this.baseColdDownTurns - this.power);
  }

  get stack() {
    return 1;
  }

  // 使用技能
  use(player, enemy) {
    if (super.use(player, enemy)) {
      player.addEffect('聚气', this.stack);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `获得${this.stack}/effect{聚气}`;
  }
}

export class SuperIntakeWeky extends Skill {
  constructor() {
    super('超萃取', 'normal', 4, 0, 4, 1, '萃取');
    this.baseColdDownTurns = 5;
  }

  get stack() {
    return 2;
  }

  get coldDownTurns() {
    return Math.max(1, this.baseColdDownTurns - this.power);
  }

  // 使用技能
  use(player, enemy) {
    if (super.use(player, enemy)) {
      player.addEffect('聚气', this.stack);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `获得${this.stack}/effect{聚气}`;
  }
}

// 虹吸
export class SiphonWeky extends Skill {
  constructor() {
    super('虹吸', 'normal', 4, 5, 5, 1, '虹吸');
    this.upgradeTo = '超虹吸';
  }
  get manaCost() {
    return Math.max(super.manaCost - this.power, 1);
  }
  get actionPointCost() {
    return Math.max(super.actionPointCost - this.power, 1);
  }

  get stack() {
    return 1;
  }

  // 使用技能
  use(player, enemy) {
    player.addEffect('泉涌', this.stack);
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `获得${this.stack}/effect{泉涌}`;
  }
}

// 超虹吸
export class SuperSiphonWeky extends Skill {
  constructor() {
    super('超虹吸', 'normal', 6, 5, 5, 1, '虹吸');
  }
  get manaCost() {
    return Math.max(super.manaCost - this.power, 1);
  }
  get actionPointCost() {
    return Math.max(super.actionPointCost - this.power, 1);
  }

  get stack() {
    return 2;
  }

  // 使用技能
  use(player, enemy) {
    player.addEffect('泉涌', this.stack);
    return true;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `获得${this.stack}/effect{泉涌}`;
  }
}

// 索取
export class WeakExploitWeky extends Skill {
  constructor() {
    super('索取', 'normal', 1, 0, 2, 2, '压榨');
    this.upgradeTo = '压榨';
  }

  get stack() {
    return Math.min(Math.max(1, 2 + this.power), 3);
  }

  // 使用技能
  use(player, enemy, stage) {
    if(stage === 0) {
      const result = launchAttack(player, player, 3);
      if(result.hpDamage > 0) return false;
      return true;
    } else {
      player.addEffect('聚气', this.stack);
      return true;
    }
  }

  regenerateDescription(player) {
    if(player) {
      return `攻击自己，造成${3+player.attack}伤害，受伤则获得${this.stack}/effect{聚气}`;
    }
    return `攻击自己，造成3伤害，受伤则获得${this.stack}/effect{聚气}`;
  }
}

// 压榨
export class ExploitWeky extends Skill {
  constructor() {
    super('压榨', 'normal', 3, 0, 2, 2, '压榨');
  }

  get stack() {
    return Math.min(Math.max(2, 3 + this.power), 4);
  }

  // 使用技能
  use(player, enemy, stage) {
    if (stage === 0) {
      const result = launchAttack(player, player, 10);
      if (result.hpDamage > 0) return false;
      return true;
    } else {
      player.gainMana(stack);
      return true;
    }
  }

  regenerateDescription(player) {
    if (player) {
      return `攻击自己，造成${10 + player.attack}伤害，受伤则获得${this.stack}/named{魏启}`;
    }
    return `攻击自己，造成10伤害，受伤则获得${this.stack}/named{魏启}`;
  }
}