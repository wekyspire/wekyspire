import Skill from '../skill.js';
import { launchAttack, dealDamage, gainShield } from '../battleUtils.js';
import { addBattleLog } from '../battleLogUtils.js';

export class PurifyWeky extends Skill {
  constructor() {
    super('纯化', 'normal', 1, 1, 1, 1, '纯化');
    this.coldDownTurns = 4;
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
    this.coldDownTurns = 4;
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
    super('萃取', 'normal', 2, 0, 3, 1, '纯化');
    this.coldDownTurns = 4;
  }

  get stack() {
    return Math.max(1, 1 + this.power);
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

// 蓄力一击技能
export class ChargePunch extends Skill {
  constructor() {
    super('蓄力一击', 'magic', 2, 1, 1, 1, '蓄力一击');
    this.mode = 'idle';
    this.coldDownTurns = 1;
    this.chargedDamage = 0;
  }

  get damage() {
    return 20 + 4 * this.power;
  }

  getChargedDamage(player) {
    return this.damage + 4 * player.magic;
  }

  // 回合开始时调用，用于初始化技能
  onBattleStart() {
    super.onBattleStart();
    this.mode = 'idle';
    this.chargedDamage = 0;
  }

  // 使用技能
  use(player, enemy) {
    if (super.use(player, enemy)) {
      if(this.mode == 'idle'){
        this.mode = 'charge';
        this.chargedDamage = this.getChargedDamage(player);
      } else if(this.mode == 'charge'){
        this.mode = 'idle';
        launchAttack(player, enemy, this.chargedDamage);
        this.chargedDamage = 0;
      }
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      if(this.mode == 'idle'){
        return `蓄力，准备造成${this.getChargedDamage(player)}伤害`;
      } else if(this.mode == 'charge'){
        return `造成${this.chargedDamage}伤害`;
      }
    }
    return `蓄力，准备造成【${this.damage}+3x/named{灵能}】伤害`;
  }
}


// 增强I技能
export class StrengthenI extends Skill {
  constructor() {
    super('增强I', 'magic', 3, 1, 1, 1, "增强");
  }
  
  get baseMaxStacks() {
    return Math.max(this.power + 3, 1);
  }

  getStacks(player) {
    return Math.min(player.magic, this.baseMaxStacks);
  }
  
  use(player, enemy, stage) {
    if(stage == 0) {
      const stacks = this.getStacks(player);
      player.addEffect('力量', stacks);
      return false;
    } else {
      const stacks = this.getStacks(player);
      player.addEffect('坚固', stacks);
      return true;
    }
  }
  
  regenerateDescription(player) {
    if(player) {
      return `获得${this.getStacks(player)}层/effect{力量}和/effect{坚固}`;
    }
    return `获得/named{灵能}层/effect{力量}和/effect{坚固}，不超过${this.baseMaxStacks}`;
  }
}

// 削弱I技能
// 敌人失去/named{灵能}层/effect{力量}和/effect{坚固}，不超过2
export class WeakenI extends Skill {
  constructor() {
    super('削弱I', 'magic', 3, 1, 1, 1, "削弱");
  }
  get baseMaxStacks() {
    return Math.max(this.power + 2, 1);
  }

  getStacks(player) {
    return Math.min(player.magic, this.baseMaxStacks);
  }
  
  use(player, enemy, stage) {
    if(stage == 0) {
      const stacks = this.getStacks(player);
      enemy.addEffect('力量', -stacks);
      return false;
    } else {
      const stacks = this.getStacks(player);
      enemy.addEffect('坚固', -stacks);
      return true;
    }
  }

  regenerateDescription(player) {
    if(player) {
      return `敌人失去${this.getStacks(player)}层/effect{力量}和/effect{坚固}`;
    }
    return `敌人失去/named{灵能}层/effect{力量}和/effect{坚固}，不超过${this.baseMaxStacks}`;
  }
}

// 化形为剑 
// 获得3/effect{力量}
export class TransformSword extends Skill {
  constructor() {
    super('化形为剑', 'magic', 3, 1, 1, 1, "化形为剑");
  }
  get stacks() {
    return Math.max(3 + this.power, 1);
  }
  use(player, enemy) {

    player.addEffect('力量', this.stacks);
    return true;

  }
  regenerateDescription(player) {
    return `获得${this.stacks}/effect{力量}`;
  }
}

// 浮空I 
// 浮空，获得3层/effect{闪避}'
export class FloatingI extends Skill {
  constructor() {
    super('浮空I', 'magic', 3, 1, 1, 1, "浮空");
    this.coldDownTurns = 3;
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

// 成岩
// 获得4格挡
export class RockFormationI extends Skill {
  constructor() {
    super('成岩I', 'magic', 3, 1, 1, 1, "成岩");
    this.coldDownTurns = 2;
  }
  get stacks() {
    return Math.max(4 + this.power, 1);
  }
  use(player, enemy) {
    player.addEffect('格挡', this.stacks);
    return true;
  }
  regenerateDescription(player) {
    return `获得${this.stacks}层/effect{格挡}`;
  }
}

// 超速思考
// 冷却所有技能一次
export class SpeedThinking extends Skill {
  constructor() {
    super('超速思考', 'magic', 3, 1, 1, Infinity, "超速思考");
    this.coldDownTurns = 1;
  }
  get times() {
    return Math.max(this.power + 1, 1);
  }
  use(player, enemy, stage) {
    if(stage < this.times) {
      for (const skill of player.skills) {
        if (skill !== this && skill.canCoolDown()) {
          skill.coolDown();
        }
      }
      return false;
    }
    return true;
  }

  regenerateDescription(player) {
    return `/named{冷却}所有技能${this.times}次`;
  }
}