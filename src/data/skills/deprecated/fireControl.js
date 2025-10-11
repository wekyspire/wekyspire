// 控火术系列技能

import Skill from "../skill";

// 控火术：灼烧（B-)
export class FireControlI extends Skill {
  constructor() {
    super('控火术:灼烧', 'fire', 3, 1, 1, 1, "控火术");
    this.baseColdDownTurns = 4;
    this.upgradeTo = "控火术:炙燃";
  }

  get stack() {
    return Math.max(2 + this.power, 0);
  }

  getStacks(player) {
    return this.stack + player.magic;
  }

  use(player, enemy) {
    const stacks = this.getStacks(player);
    enemy.addEffect('燃烧', stacks);
    return true;
  }

  regenerateDescription(player) {
    if(player) {
      return `敌人获得${this.getStacks(player)}层/effect{燃烧}`;
    }
    return `敌人获得【${this.stack}+/named{灵能}】层/effect{燃烧}`;
  }
}

// 控火术：炙燃(B+)
export class FireControlII extends Skill {
  constructor() {
    super('控火术:炙燃', 'fire', 5, 3, 1, 1, "控火术");
    this.baseColdDownTurns = 5;
    this.upgradeTo = "控火术:焚灭";
  }

  get stack() {
    return Math.max(6 + 2 * this.power, 0);
  }

  getStacks(player) {
    return this.stack + player.magic;
  }

  use(player, enemy, stage) {
    if (stage === 0) {
      const stacks = this.getStacks(player);
      enemy.addEffect('燃烧', stacks);
      return false;
    } else {
      enemy.addEffect('重伤', 2);
    }
    return true;
  }

  regenerateDescription(player) {
    if(!player) {
      return `敌人获得【${this.stack}+/named{灵能}】层/effect{燃烧}，2层/effect{重伤}`;
    }
    return `敌人获得${this.getStacks(player)}层/effect{燃烧}，，2层/effect{重伤}`;
  }
}

// 控火术：焚灭(A)
export class FireControlIII extends Skill {
  constructor() {
    super('控火术:焚灭', 'fire', 7, 3, 1, 1, "控火术");
    this.baseColdDownTurns = 6;
    this.upgradeTo = "无上神焰";
  }

  get stack() {
    return Math.max(7 + this.power, 0);
  }

  getStacks(player) {
    return this.stack + player.magic;
  }

  use(player, enemy, stage) {
    if (stage === 0) {
      const stacks = this.getStacks(player);
      enemy.addEffect('燃烧', stacks);
      return false;
    } else if(stage === 1) {
      enemy.addEffect('重伤', 3);
    } else if(stage === 2) {
      enemy.addEffect('焚毁', 1);
    }
    return false;
  }

  regenerateDescription(player) {
    if(!player) {
      return `敌人获得【${this.stack}+/named{灵能}】层/effect{燃烧}，3层/effect{重伤}，1层/effect{焚毁}`;
    }
    return `敌人获得${this.getStacks(player)}层/effect{燃烧}，3层/effect{重伤}，1层/effect{焚毁}`;
  }
}

// 控火术: 暖身（C+）
export class FireControlAssistI extends Skill {
  constructor() {
    super('控火术:暖身', 'fire', 2, 0, 1, 1, "控火术");
    this.baseColdDownTurns = 3;
    this.upgradeTo = "控火术:护体";
  }
  get stack () {
    return Math.max(2 + this.power, 1);
  }

  use(player, enemy) {
    player.removeNegativeEffects(this.stack);
    return true;
  }
  regenerateDescription(player) {
    return `消除${this.stack}层负面效果`;
  }
}

// 控火术: 护体（B）
export class FireControlAssistII extends Skill {
  constructor() {
    super('控火术:护体', 'fire', 4, 1, 1, 1, "控火术");
    this.baseColdDownTurns = 3;
    this.upgradeTo = ["控火术:集中", "控火术:净化"];
  }

  get stack() {
    return Math.max(4 + 2 * this.power, 1);
  }

  use(player, enemy, stage) {
    if (stage === 0) {
      player.removeNegativeEffects(this.stack);
      return false;
    }
    player.addEffect('坚固', 1);
    return true;
  }
  regenerateDescription(player) {
    return `消除${this.stack}层负面效果，获得1层/effect{坚固}`;
  }
}

// 控火术: 集中（B+）
export class FireControlAssistIII1 extends Skill {
  constructor() {
    super('控火术:集中', 'magic', 6, 2, 1, 1, "控火术");
    this.baseColdDownTurns = 5;
    this.upgradeTo = "无上神焰";
  }
  get stack() {
    return Math.max(2 + this.power, 1);
  }
  use(player, enemy, stage) {
    if (stage === 0) {
      player.addEffect('坚固', this.stack);
      return false;
    }
    player.addEffect('炙热', this.stack);
    return true;
  }
  regenerateDescription(player) {
    return `获得${this.stack}层/effect{坚固}和/effect{炙热}`;
  }
}

// 控火术: 净化（A）
export class FireControlAssistIII2 extends Skill {
  constructor() {
    super('控火术:净化', 'fire', 7, 3, 1, 1, "控火术");
    this.upgradeTo = "无上神焰";
  }

  get manaCost() {
    return Math.max(super.manaCost - this.power, 0);
  }

  use(player, enemy, stage) {
    if(stage === 0) {
      player.removeEffects(999, 'random-kind');
      return false;
    } else {
      const frontierCurse = player.frontierSkills.find((skill) => skill.type === 'curse');
      if(frontierCurse) {
        player.frontierSkills.splice(player.frontierSkills.indexOf(frontierCurse), 1);
        return false;
      } else {
        const backupCurse = player.backupSkills.find((skill) => skill.type === 'curse');
        if (backupCurse) {
          player.backupSkills.splice(player.backupSkills.indexOf(backupCurse), 1);
          return false;
        }
        return true;
      }
    }
  }
  regenerateDescription(player) {
    return `消除所有状态和/named{诅咒}`;
  }
}

// 无上神焰(S)
export class AuthenticFireControl extends Skill {
  constructor() {
    super('无上神焰', 'fire', 9, 1, 1, Infinity, "控火术");
    this.subtitle = "登峰造极";
    this.mode = 'idle';
  }

  get manaCost() {
    return this.mode === 'idle' ? (super.manaCost + 4) : Math.max(super.manaCost - this.power, 0);
  }

  use(player, enemy) {
    if(this.mode === "idle") {
      this.mode = "active";
      this.name = '控:神焰';
      player.removeEffects(999, 'random-kind');
      return true;
    } else {
      // TODO
    }
    return true;
  }

  regenerateDescription(player) {
    if (this.mode === 'idle') {
      return `燃尽一切，移除所有效果，变为/skill{控:神焰}`;
    } else {
      return `随机一张/named{免费}、/named{消耗}的控火术进入/named{后备}`;
    }
  }
}