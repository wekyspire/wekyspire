import Skill from '../skill.js';
import { launchAttack, dealDamage, gainShield } from '../battleUtils.js';

// 拳打脚踢技能
export class PunchKick extends Skill {
  
  constructor() {
    super('拳打脚踢', 'normal', 0, 0, Infinity, '拳打脚踢', 1);
  }
  
  get damage () {
    return Math.max(3 + this.power, 3);
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      launchAttack(player, enemy, this.damage);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `造成${this.damage + (player?.attack ?? 0)}点伤害`;
  }
}

// 王八拳技能
export class RollPunch extends Skill {
  constructor() {
    super('王八拳', 'normal', 0, 0, 1);
    this.coldDownTurns = 1;
  }

  get damage() {
    return Math.max(1 + this.power, 1);
  }

  // 使用技能
  use(player, enemy, stage) {
    if (super.use()) {
      launchAttack(player, enemy, this.damage);
      if(stage < 2) {
        return {};
      } else return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `造成${this.damage + (player?.attack ?? 0)}伤害3次`;
  }
}

// 打滚技能
export class Roll extends Skill {
  constructor() {
    super('打滚', 'normal', 0, 0, 1, '打滚', 1);
    this.maxUses = 2;
  }

  get stacks() {
    return 1;
  }

  get coldDownTurns() {
    return Math.max(3 - this.power, 1);
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
    super('睡觉', 'normal', 0, 0, 1, '睡觉', 1);
    this.baseHeal = 7;
    this.coldDownTurns = 2;
  }

  get heal() {
    return Math.max(this.baseHeal + this.power * 3, 1);
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

// 睡大觉技能
export class LargeSleep extends Skill {
  constructor() {
    super('睡大觉', 'normal', 1, 0, 1);
    this.baseHeal = 22;
    this.coldDownTurns = 2;
  }

  get heal() {
    return Math.max(this.baseHeal + this.power * 20, 1);
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      player.applyHeal(this.baseHeal);
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
    super('活动筋骨', 'normal', 0, 0, 1);
    this.stacks = 1;
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      player.addEffect('力量', this.stack);
      return true;
    }
    return false;
  }

  get coldDownTurns() {
    return Math.max(3 - this.power, 1);
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `获得${this.stacks}层/effect{力量}`;
  }
}

// 莽撞攻击
export class CarelessPunchKick extends Skill {
  constructor() {
    super('莽撞攻击', 'normal', 0, 0, 1);
  }

  get coldDownTurns() {
    return Math.max(1 - this.power, 0);
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      launchAttack(player, enemy, 10);
      dealDamage(player, player, 3);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    const damage = 10 + (player?.attack ?? 0);
    return `造成${damage}点伤害，受3伤害`;
  }
}

// 抱头防御
export class AmateurDefense extends Skill {
  constructor() {
    super('抱头防御', 'normal', 0, 0, 1);
    this.coldDownTurns = 1;
  }

  get shield() {
    return Math.max(5 + 2 * this.power, 1);
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      gainShield(player, player, this.shield);
      return true;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `获得${this.shield + (player?.agility ?? 0)}护盾`;
  }
}

// 畏手畏脚
export class OverCarefulDefense extends Skill {
  constructor() {
    super('畏手畏脚', 'normal', 0, 0, 1);
  }

  get removeStacks() {
    return -1 + this.power;
  }

  // 使用技能
  use(player, enemy, stage) {
    if (!this.used && super.use()) {
      if(stage == 0) {
        player.addEffect('坚固', 2);
        return {};
      } else {
        player.addEffect('力量', this.removeStacks);
        return true;
      }
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `获得2层/effect{坚固}，${this.removeStacks}层/effect{力量}`;
  }
}

// 匹夫之勇
export class CarelessBravery extends Skill {
  constructor() {
    super('匹夫之勇', 'normal', 0, 0, 1);
  }
  // 使用技能
  use(player, enemy, stage) {
    if (super.use()) {
      if(stage == 0) {
        player.addEffect('力量', this.stacks);
        return {};
      } else {
        player.addEffect('坚固', -3);
        return true;
      }
    }
    return false;
  }

  get stacks() {
    return Math.max(1, 3 + this.power);
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    return `获得${this.stacks}层/effect{力量}，-3层/effect{坚固}`;
  }
}

// 强撑
export class HoldOn extends Skill {
  constructor() {
    super('强撑', 'normal', 1, 0, 1);
  }
  // 使用技能
  use(player, enemy, stage) {
    if (super.use()) {
      if(stage == 0) {
        player.addEffect('坚固', stacks);
        return {};
      } else {
        player.addEffect('崩溃', 2);
        return true;
      }
    }
    return false;
  }

  get stacks() {
    return 7 + 2 * this.power;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      return `获得${stacks}层/effect{坚固}，2层/effect{崩溃}`;
    }
    return this.description;
  }
}

// 快速思考技能
export class FastThinking extends Skill {
  constructor() {
    super('快速思考', 'normal', 1, 0, Infinity, '思考', 1);
  }

  get coldDownTurns() {
    return Math.max(0, 1 - this.power);
  }

  findSkillToColdDown (player) {
    let coldDownSkill = null;
    let minDistance = Infinity;
    player.skills.forEach(skill => {
      if (skill.canColdDown()) {
        const distance = Math.abs(skill.inBattleIndex - this.inBattleIndex);
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
      return false;
    }
    return false;
  }

  // 使用技能
  use(player, enemy) {
    if (super.use()) {
      // 找到最近可以冷却的技能，如果距离一样，先冷却左边的
      let coldDownSkill = this.findSkillToColdDown(player);
      if (coldDownSkill) {
        coldDownSkill.coldDown();
        return true;
      }
      return false;
    }
    return false;
  }

  // 重新生成技能描述
  regenerateDescription(player) {
    if (player) {
      return `/named{冷却}1次/named{最近}可冷却技能`;
    }
    return this.description;
  }
}