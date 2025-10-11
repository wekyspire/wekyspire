import Skill from '../skill';
// 空系浮空系列技能
// 提供高额闪避，支付攻击手段


// 浮空I
// 浮空，获得3层/effect{闪避}'
export class FloatingI extends Skill {
  constructor() {
    super('浮空I', 'air', 3, 1, 1, 1, "浮空");
    this.baseColdDownTurns = 5;
    this.upgradeTo = "浮空II";
  }

  get stacks() {
    return Math.max(3 + this.power, 1);
  }

  use(player, enemy) {
    player.addEffect('闪避', this.stacks);
    return true;
  }

  regenerateDescription(player) {
    return `浮空，获得${this.stacks}层/effect{闪避}`;
  }
}

// 浮空II
// 浮空，获得4层/effect{闪避}'
export class FloatingII extends Skill {
  constructor() {
    super('浮空II', 'air', 5, 1, 1, 1, "浮空");
    this.baseColdDownTurns = 3;
  }

  get stacks() {
    return Math.max(4 + this.power, 1);
  }

  use(player, enemy) {
    player.addEffect('闪避', this.stacks);
    return true;
  }

  regenerateDescription(player) {
    return `浮空，获得${this.stacks}层/effect{闪避}`;
  }
}

// 飞行
// 获得飞行和2层虚弱
export class Flying extends Skill {
  constructor() {
    super('飞行', 'air', 5, 3, 1, 1);
  }

  get manaCost() {
    return Math.max(super.manaCost - this.power, 0);
  }

  use(player, enemy, stage) {
    if(stage === 0) {
      player.addEffect('飞行', this.stacks);
      return false;
    } else {
      player.addEffect('虚弱', 2);
      return true;
    }
  }

  regenerateDescription(player) {
    return `获得/effect{飞行}和2层/effect{虚弱}`;
  }
}

// 反重力
// 获得3层/effect{飞行}和-2层集中
export class AntiGravity extends Skill {
  constructor() {
    super('反重力', 'air', 7, 3, 1, 1);
  }

  get manaCost() {
    return Math.max(super.manaCost - this.power, 0);
  }

  use(player, enemy, stage) {
    if(stage === 0) {
      player.addEffect('飞行', 3);
      return false;
    } else {
      player.addEffect('集中', -2);
      return true;
    }
  }

  regenerateDescription(player) {
    return `获得3层/effect{飞行}并失去2层/effect{集中}`;
  }
}

