import Skill from '../skill.js';
import { launchAttack, dealDamage, gainShield, addBattleLog } from '../../GameApp.vue';

export class PurifyWeky extends Skill {
  constructor() {
    super('纯化', 'normal', 1, '获得【2】/effect{聚气}', 1, 3);
    this.stack = 2;
    this.coldDownTurns = 2;
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      player.addEffect('聚气', this.stack);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      return `获得${this.stack}/effect{聚气}`;
    }
    return this.description;
  }
}

export class StrongPurifyWeky extends Skill {
  constructor() {
    super('超纯化', 'normal', 4, '获得【2+/named{灵能}】/effect{聚气}', 2, 3);
    this.stack = 2;
    this.coldDownTurns = 2;
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      const stack = this.stack + player.magic;
      player.addEffect('聚气', stack);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      const stack = this.stack + player.magic;
      return `获得${stack}/effect{聚气}`;
    }
    return this.description;
  }
}

// 恢复I 技能
export class VeryWeakRecovery extends Skill {
  constructor() {
    super('恢复I', '木', 1, '获得【3+/named{灵能}】/effect{再生}', 1, 3);
    this.stack = 3;
    this.coldDownTurns = 2;
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      player.addEffect('再生', this.stack + player.magic);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      const stack = this.stack + player.magic;
      return `获得${stack}/effect{再生}`;
    }
    return this.description;
  }
}

// 恢复II 技能
export class WeakRecovery extends Skill {
  constructor() {
    super('恢复II', '木', 3, '获得【7+/named{灵能}】/effect{再生}', 2, 2);
    this.stack = 7;
    this.coldDownTurns = 2;
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      const stack = this.stack + player.magic;
      player.addEffect('再生', this.stack);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      const stack = this.stack + player.magic;
      return `获得${stack}/effect{再生}`;
    }
    return this.description;
  }
}

// 蓄力一击技能
export class ChargePunch extends Skill {
  constructor() {
    super('蓄力一击', 'magic', 2, '蓄力，准备造成【/named{攻击}+3x/named{灵能}】伤害', 1);
    this.mode = 'idle';
    this.chargedDamage = 0;
    this.coldDownTurns = 1;
  }

  getChargeDamage(player) {
    return player.attack + 3 * player.magic;
  }

  // 回合开始时调用，用于初始化技能
  onBattleStart() {
    super.onBattleStart();
    this.mode = 'idle';
    this.chargedDamage = 0;
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      if(this.mode == 'idle'){
        this.mode = 'charge';
        this.chargedDamage = this.getChargeDamage(player);
      } else if(this.mode == 'charge'){
        this.mode = 'idle';
        launchAttack(player, enemy, this.chargedDamage);
      }
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      if(this.mode == 'idle'){
        return `蓄力，准备造成${this.getChargeDamage(player)}伤害`;
      } else if(this.mode == 'charge'){
        return `造成${this.chargedDamage}伤害`;
      }
    }
    return this.description;
  }
}


// 增强I技能
export class StrengthenI extends Skill {
  constructor() {
    super('增强I', 'magic', 3, '获得/named{灵能}层/effect{力量}和/effect{坚固}，不超过3', 1, 1, "增强");
  }
  
  getStacks(player) {
    return Math.min(player.magic, 3);
  }
  
  use(player, enemy) {
    if (super.use()) {
      const stacks = this.getStacks(player);
      player.addEffect('力量', stacks);
      player.addEffect('坚固', stacks);
      return true;
    }
    return false;
  }
  
  regenerateDescription(player) {
    return `获得${this.getStacks(player)}层/effect{力量}和/effect{坚固}`;
  }
}

// 削弱I技能
export class WeakenI extends Skill {
  constructor() {
    super('削弱I', 'magic', 3, '敌人失去/named{灵能}层/effect{力量}和/effect{坚固}，不超过2', 1, 1, "削弱");
  }
  
  getStacks(player) {
    return Math.min(player.magic, 2);
  }
  
  use(player, enemy) {
    if (super.use()) {
      const stacks = this.getStacks(player);
      enemy.addEffect('力量', -stacks);
      enemy.addEffect('坚固', -stacks);
      return true;
    }
    return false;
  }
  
  regenerateDescription(player) {
    return `敌人失去${this.getStacks(player)}层/effect{力量}和/effect{坚固}`;
  }
}

// 控火术：灼烧
export class FireControlI extends Skill {
  constructor() {
    super('控火术:灼烧', 'magic', 3, '敌人获得【2+/named{灵能}】层/effect{燃烧}', 1, 1, "控火术:灼烧");
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

// 瑞米召唤术
export class SummonRemi extends Skill {
  constructor() {
    super('瑞米召唤术', 'magic', 3, '召唤瑞米，它会听从你的指令！', 1, 1, "瑞米");
    this.used = false;
  }
  
  use(player, enemy) {
    if (super.use()) {
      addBattleLog('你召唤了...瑞米！');
      this.used = true;
      return true;
    }
    return false;
  }

  regenerateDescription(player) {
    if(this.used) return '这技能他妈的卵用没有！';
    return '召唤瑞米，它会听从你的指令！';
  }
}

// 化形为剑 
export class TransformSword extends Skill {
  constructor() {
    super('化形为剑', 'magic', 3, '获得3/effect{力量}，战斗中只能使用一次', 1, 1, "化形为剑");
    this.stacks = 3;
    this.used = false;
  }
  
  canUse(player) {
    return super.canUse(player) && !this.used;
  }

  use(player, enemy) {
    if (!this.used && super.use()) {
      player.addEffect('力量', this.stacks);
      this.used = true;
      return true;
    }
    return false;
  }

  regenerateDescription(player) {
    return `获得${this.stacks}/effect{力量}，战斗中只能使用一次`;
  }
}

// 浮空I （获得3层闪避）
export class FloatingI extends Skill {
  constructor() {
    super('浮空I', 'magic', 3, '浮空，获得3层/effect{闪避}', 2, 1, "浮空I");
    this.stacks = 4;
    this.coldDownTurns = 3;
  }

  use(player, enemy) {
    if (!this.used && super.use()) {
      player.addEffect('闪避', this.stacks);
      return true;
    }
    return false;
  }

  regenerateDescription(player) {
    return `浮空，获得${this.stacks}层/effect{闪避}`;
  }
}

// 成岩（获得4格挡）
export class RockFormationI extends Skill {
  constructor() {
    super('成岩I', 'magic', 3, '形成岩石掩体，获得4层/effect{格挡}', 1, 1, "成岩");
    this.stacks = 4;
    this.coldDownTurns = 3;
  }

  use(player, enemy) {
    if (!this.used && super.use()) {
      player.addEffect('格挡', this.stacks);
      return true;
    }
    return false;
  }

  regenerateDescription(player) {
    return `形成岩石掩体，获得${this.stacks}层/effect{格挡}`;
  }
}

// 超速思考（冷却所有可冷却的技能一次）
export class SpeedThinking extends Skill {
  constructor() {
    super('超速思考', 'magic', 3, '冷却所有可冷却的技能一次', 1, 1, "超速思考");
    this.coldDownTurns = 1;
  }
  
  use(player, enemy) {
    if (super.use()) {
      for (const skill of player.skills) {
        if (skill !== this && skill.canCoolDown()) {
          skill.coolDown();
        }
      }
      return true;
    }
    return false;
  }

  regenerateDescription(player) {
    return `冷却所有可冷却的技能一次`;
  }
}