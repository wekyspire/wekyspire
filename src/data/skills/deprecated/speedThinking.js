// 快速思考系列和类似技能，用于提供即刻技能冷却

import Skill from "../skill";

// 快速思考技能
export class FastThinking extends Skill {
  constructor() {
    super('快速思考', 'normal', 1, 0, 1, Infinity, '快速思考', 1);
    this.upgradeTo = '超速思考';
  }

  get coldDownTurns() {
    return Math.max(0, super.coldDownTurns - this.power);
  }

  findSkillToColdDown (player) {
    let coldDownSkill = null;
    let minDistance = Infinity;
    player.frontierSkills.forEach(skill => {
      if (skill !== this && skill.canColdDown()) {
        const distance = Math.abs(skill.getInBattleIndex(player) - this.getInBattleIndex(player));
        if (distance < minDistance) {
          minDistance = distance;
          coldDownSkill = skill;
        }
      }
    });
    return coldDownSkill;
  }

  canUse(player) {
    if(super.canUse(player)) {
      if(this.findSkillToColdDown(player) !== null) return true;
    }
    return false;
  }

  // 使用技能
  use(player, enemy) {
    // 找到最近可以冷却的技能，如果距离一样，先冷却左边的
    let coldDownSkill = this.findSkillToColdDown(player);
    if (coldDownSkill) {
      coldDownSkill.coldDown();
      return true;
    }
    return null;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `/named{冷却}1次/named{最近}可冷却技能`;
  }
}
// 超速思考
// 冷却所有技能一次
export class SpeedThinking extends Skill {
  constructor() {
    super('超速思考', 'normal', 3, 0, 1, 1, "快速思考");
    this.baseColdDownTurns = 1;
    this.upgradeTo = ['灵光一现', '肌肉记忆']
  }
  get times() {
    return Math.max(this.power + 1, 1);
  }
  use(player, enemy, stage) {
    if(stage < this.times) {
      for (const skill of player.frontierSkills) {
        if (skill !== this && skill.canColdDown()) {
          skill.coldDown();
        }
      }
      return false;
    }
    return true;
  }

  regenerateDescription(player) {
    return `/named{冷却}所有/named{前端}技能${this.times}次`;
  }
}

// 灵光一现
// 马上恢复随机前台技能充能
export class SuddenSpeedThinking extends Skill {
  constructor() {
    super('灵光一现', 'normal', 5, 1, 3, 1, "快速思考");
    this.baseColdDownTurns = 1;
  }

  get actionPointCost() {
    return Math.max(1, super.actionPointCost - this.power);
  }

  use(player, enemy, stage) {
    let skillsCanColdDown = player.frontierSkills.filter(skill => skill !== this && skill.canColdDown());
    // 随机选择一个技能立刻冷却
    if (skillsCanColdDown.length > 0) {
      const randomIndex = Math.floor(Math.random() * skillsCanColdDown.length);
      skillsCanColdDown[randomIndex].instantColdDown();
    }
    return true;
  }

  canUse(player) {
    if(super.canUse(player)) {
      let skillsCanColdDown = player.frontierSkills.filter(skill => skill !== this && skill.canColdDown());
      if (skillsCanColdDown.length > 0) return true;
    }
    return false;
  }

  regenerateDescription(player) {
    return `随机/named{前端}技能完成/named{冷却}进程`;
  }
}

// 肌肉记忆
// 获得效果"肌肉记忆"x4
export class MuscleMemory extends Skill {
  constructor() {
    super('肌肉记忆', 'normal', 5, 0, 6, 1, "快速思考");
    this.baseColdDownTurns = 1;
  }

  get stacks() {
    return Math.max(4 + this.power, 1);
  }

  use(player, enemy, stage) {
    player.addEffect('肌肉记忆', this.stacks);
    return true;
  }
  regenerateDescription(player) {
    return `获得${this.stacks}/effect{肌肉记忆}`;
  }
}

// 本能反射
// 恢复所有前端技能1充能
export class InstinctiveReflex extends Skill {
  constructor() {
    super('本能反射', 'normal', 7, 0, 1, 1);
    this.baseColdDownTurns = 7;
  }

  get coldDownTurns() {
    if(this.power > 0) return Math.max(super.coldDownTurns - this.power * 2, 1);
    return 0;
  }

  use(player, enemy, stage) {
    player.frontierSkills.forEach(skill => {
      if (skill !== this && skill.canColdDown()) {
        skill.instantColdDown();
      }
    });
    return true;
  }

  canUse(player) {
    if(super.canUse(player)) {
      let canColdDown = false;
      player.frontierSkills.forEach(skill => {
        if (skill !== this && skill.canColdDown()) {
          canColdDown = true;
        }
      });
      return canColdDown;
    }
    return false;
  }

  regenerateDescription(player) {
    return `所有其它/named{前端}技能完成/named{冷却}进程`;
  }
}
