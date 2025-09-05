
import Skill from "../skill";

// 控火术：灼烧（B-)
export class FireControlI extends Skill {
  constructor() {
    super('控火术:灼烧', 'magic', 3, '敌人获得【2+/named{灵能}】层/effect{燃烧}', 1, 1, "控火术");
    this.upgradeTo = "控火术:炙燃";
  }

  getStacks(player) {
    return 2 + player.magic;
  }

  use(player, enemy) {
    if (super.use()) {
      const stacks = this.getStacks(player);
      enemy.addEffect('燃烧', stacks);
      return true;
    }
    return false;
  }

  regenerateDescription(player) {
    return `敌人获得${this.getStacks(player)}层/effect{燃烧}`;
  }
}

// 控火术：炙燃(B+)
export class FireControlII extends Skill {
  constructor() {
    super('控火术:炙燃', 'magic', 5, '敌人获得【4+/named{灵能}】层/effect{燃烧}，2层/effect{重伤}', 2, 1, "控火术", 1);
    this.upgradeTo = "焚灭";
  }

  getStacks(player) {
    return 4 + player.magic;
  }

  use(player, enemy) {
    if (super.use()) {
      const stacks = this.getStacks(player);
      enemy.addEffect('燃烧', stacks);
      enemy.addEffect('重伤', 2);
      return true;
    }
    return false;
  }

  regenerateDescription(player) {
    return `敌人获得${this.getStacks(player)}层/effect{燃烧}，，2层/effect{重伤}`;
  }
}

// 控火术：焚灭(A+)
export class FireControlIII extends Skill {
  constructor() {
    super('控火术：焚灭', 'magic', 8, '敌人获得【7+/named{灵能}】层/effect{燃烧}，3层/effect{重伤}，2层/effect{焚毁}', 3, 1, "控火术", 2);
    this.upgradeTo = "无上神焰";
  }

  getStacks(player) {
    return 7 + player.magic;
  }

  use(player, enemy) {
    if (super.use()) {
      const stacks = this.getStacks(player);
      enemy.addEffect('燃烧', stacks);
      enemy.addEffect('重伤', 3);
      enemy.addEffect('焚毁', 2);
      return true;
    }
    return false;
  }

  regenerateDescription(player) {
    return `敌人获得${this.getStacks(player)}层/effect{燃烧}，3层/effect{重伤}，2层/effect{焚毁}`;
  }
}


// 控火术: 暖身（C+）
export class FireControlAssistI extends Skill {
  constructor() {
    super('控火术:暖身', 'magic', 2, '随机消除2层负面状态', 1, 1, "控火术");
    this.upgradeTo = "控火术:护体";
  }
  use(player, enemy) {
    if (super.use()) {
      player.removeNegativeEffects(2);
      return true;
    }
    return false;
  }
  regenerateDescription(player) {
    return `随机消除2层负面状态`;
  }
}

// 控火术: 护体（B）
export class FireControlAssistII extends Skill {
  constructor() {
    super('控火术:护体', 'magic', 4, '随机消除4层负面状态，获得1层/effect{坚固}', 2, 1, "控火术", 1);
    this.upgradeTo = ["控火术:集中", "控火术:净化"];
  }
  use(player, enemy) {
    if (super.use()) {
      player.removeNegativeEffects(4);
      player.addEffect('坚固', 1);
      return true;
    }
    return false;
  }
  regenerateDescription(player) {
    return `随机消除4层负面状态，获得1层/effect{坚固}`;
  }
}

// 控火术: 集中（A）
export class FireControlAssistIII1 extends Skill {
  constructor() {
    super('控火术:集中', 'magic', 7, '消除层数最高的负面状态，获得3层/effect{坚固}和3层/effect{炙热}', 3, 1, "控火术", 1);
    this.upgradeTo = "无上神焰";
  }
  use(player, enemy) {
    if (super.use()) {
      player.removeNegativeEffects(1, 'highest-stack-kind');
      player.addEffect('坚固', 3);
      player.addEffect('炙热', 3);
      return true;
    }
    return false;
  }
  regenerateDescription(player) {
    return `随机消除6层负面状态，获得2层/effect{坚固}，1层/named{神焰随身}`;
  }
}

// 控火术: 净化（A）
export class FireControlAssistIII2 extends Skill {
  constructor() {
    super('控火术:净化', 'magic', 7, '消除所有状态，消除最近的/named{诅咒}', 3, 1, "控火术", 1);
    this.upgradeTo = "无上神焰";
  }
  use(player, enemy) {
    if (super.use()) {
      player.removeEffects(999);
      // TODO 这里需要实现移除最近的诅咒
      return true;
    }
    return false;
  }
  regenerateDescription(player) {
    return `消除所有状态，消除最近的/named{诅咒}`;
  }
}

// 无上神焰(S)
export class AuthenticFireControl extends Skill {
  constructor() {
    super('无上神焰', 'magic', 9, '获得【7+/named{灵能}】层/effect{炙热}，1层/named{神焰随身}，此技能变为/skill{控:神焰}', 4, 1, "控火术", 3);
    this.subtitle = "登峰造极";
    this.mode = 'idle';
  }

  onBattleStart() {
    super.onBattleStart();
    this.subtitle = "登峰造极";
    this.mode = 'idle';
  }

  getStacks(player) {
    return 7 + player.magic;
  }

  use(player, enemy) {
    if (super.use()) {
      if(this.mode === 'idle') {
        const stacks = this.getStacks(player);
        player.addEffect('炙热', stacks);
        player.addEffect('神焰随身', 1);
        this.mode = 'active';
        return true;
      } else {
        player.removeEffects(999);
        return true;
      }
    }
    return false;
  }

  regenerateDescription(player) {
    if (this.mode === 'idle') {
      return `获得${this.getStacks(player)}层/effect{炙热}，1层/named{神焰随身}，此技能变为/skill{控:神焰}`;
    } else {
      return `发动神焰燃尽一切，移除所有效果`;
    }
  }
}