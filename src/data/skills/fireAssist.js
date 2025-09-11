// 火属辅助类技能

import Skill from '../skill.js';
import { launchAttack, dealDamage, gainShield } from '../battleUtils.js';
import { addBattleLog } from '../battleLogUtils.js';

// 燃心决（A）
// 获得4层集中和1层燃心
export class DevotionCurse extends Skill {
  constructor() {
    super('燃心决', 'magic', 7, 0, 1, 1);
    this.subtitle = '烈焰焚心';
  }

  get stacks() {
    return Math.max(4 + 2 * this.power, 1);
  }

  use(player, enemy, stage) {
    if(stage == 0) {
        player.addEffect('集中', this.stacks);
        return false;
    } else {
        player.addEffect('燃心', 1);
        return true;
    }
  }

  getDescription(player) {
    return `获得${this.stacks}层/effect{集中}，1层/effect{燃心}`;
  }
}

// 暴怒（B）
// 获得1层暴怒
export class Rage extends Skill {
  constructor() {
    super('暴怒', 'magic', 5, 3, 1, 1);
  }

  get stacks() {
    return Math.max(1 + this.power, 1);
  }

  get burnStacks() {
    return -Math.min(-5 * this.power, 0);
  }

  use(player, enemy, stage) {
    if(stage == 0) {
        player.addEffect('暴怒', this.stacks);
        return this.power >= 0;
    } else {
        player.addEffect('燃烧', this.burnStacks);
        return true;
    }
  }

  getDescription(player) {
    if(this.power >= 0) {
        return `获得${this.stacks}层/effect{暴怒}`;
    } else {
        return `获得${this.stacks}层/effect{暴怒}，${this.burnStacks}层/effect{燃烧}`;
    }
  }
}

// 燃烧弹 (B-)
// 获得高燃弹药
export class FireDance extends Skill {
  constructor() {
    super('燃烧弹', 'magic', 4, 2, 1, 1);
  }

  get burnStacks() {
    return -Math.max(0, this.power);
  }

  get stacks() {
    return 1 + this.power;
  }

  use (player, enemy, stage) {
    if(stage == 0) {
        player.addEffect('高燃弹药', this.stacks);
        return this.power >= 0;
    } else {
        player.addEffect('燃烧', this.burnStacks);
        return true;
    }
  }

  getDescription(player) {
    if(this.power < 0) {
        return `获得${this.burnStacks}层/effect{高燃弹药}和${this.stacks}层/effect{燃烧}`;
    }
    return `获得${this.stacks}层/effect{高燃弹药}`;
  }
}