import Skill from '../skill.js';
import {launchAttack, dealDamage, gainShield, drawSkillCard, dropSkillCard, burnSkillCard, discoverSkillCard} from '../battleUtils.js';
import {signedNumberString, signedNumberStringW0} from "../../utils/nameUtils";
import {PunchKick} from "./punchKicks";

// 断子绝孙脚（C-）
// 造成6伤害，造成生命伤害则赋予虚弱
export class ElegantKick extends Skill {
  constructor() {
    super('断子绝孙脚', 'normal', 1, 0, 2, 1);
    this.baseColdDownTurns = 3;
  }

  get damage () {
    return Math.max(6 + 3 * this.power, 3);
  }

  // 使用技能
  use(player, enemy) {
    const result = launchAttack(player, enemy, this.damage);
    if(result.hpDamage > 0) {
      enemy.addEffect('虚弱');
    }
    return true;
  }

  regenerateDescription(player) {
    return `造成${this.damage + (player?.attack ?? 0)}伤害，造成生命伤害则赋予/effect{虚弱}`;
  }
}

// 练家子（C-）
// 咏唱：1防御
export class PracticedBody extends Skill {
  constructor() {
    super('练家子', 'normal', 1, 0, 1, 1);
    this.baseColdDownTurns = 1;
    this.cardMode = 'chant';
    this.modifier_ = (player) => {
      const self = this;
      return new Proxy(player, {
        get(target, prop) {
          if (prop === 'defense') {
            return target.defense + 1; // 每次获取 defense 属性时，增加 1
          }
          return target[prop];
        }
      });
    };
  }
  get actionPointCost () {
    return Math.max(super.actionPointCost - this.power, 0);
  }
  onEnable(player) {
    super.onEnable(player);
    player.addModifier(this.modifier_);
  }
  onDisable(player, reason) {
    super.onDisable(player, reason);
    player.removeModifier(this.modifier_);
  }
  regenerateDescription(player) {
    return `获得1防御`;
  }
}

// 贯拳（C-)
// 造成8伤害，若目标有虚弱则多造成4伤害
export class PiercingPunch extends Skill {
  constructor() {
    super('贯拳', 'normal', 2, 0, 2, 1);
    this.baseColdDownTurns = 3;
  }
  get damage () {
    return Math.max(8 + 2 * this.power, 4);
  }
  // 使用技能
  use(player, enemy) {
    let totalDamage = this.damage;
    if(enemy.hasEffect('虚弱')) {
      totalDamage += 4;
    }
    launchAttack(player, enemy, totalDamage);
    return true;
  }
  regenerateDescription(player) {
    return `造成${this.damage + (player?.attack ?? 0)}伤害，对/effect{虚弱}敌人多4伤害`;
  }
}

// 格杀（C-）
// 造成4伤害，获得格挡
export class KillStrike extends Skill {
  constructor() {
    super('格杀', 'normal', 1, 0, 1, 1);
    this.baseColdDownTurns = 2;
  }
  get damage () {
    return Math.max(4 + 2 * this.power, 2);
  }
  // 使用技能
  use(player, enemy) {
    launchAttack(player, enemy, this.damage);
    player.addEffect('格挡');
    return true;
  }
  regenerateDescription(player) {
    return `造成${this.damage + (player?.attack ?? 0)}伤害，获得/effect{格挡}`;
  }
}

// 乱拳（C-）
// 发现2张无开销、/named{消耗}的/skill{拳打脚踢}加入牌库
export class Burst extends Skill {
  constructor() {
    super('乱拳', 'normal', 3, 0, 1, 1);
    this.baseColdDownTurns = 4;
  }
  // 使用技能
  use(player, enemy) {
    for(let i = 0; i < 2; i++) {
      const skill = new PunchKick();
      skill.power = this.power;
      skill.baseColdDownTurns = 0;
      skill.baseActionPointCost = 0;
      discoverSkillCard(player, skill, 'deck');
    }
  }
  regenerateDescription(player) {
    return `发现2张无开销、/named{消耗}的/skill{拳打脚踢${signedNumberStringW0(this.power)}}加入牌库`;
  }
}

// 头槌（C-）
// 造成6伤害，敌人虚弱则获得8护盾
export class Headbutt extends Skill {
  constructor() {
    super('头槌', 'normal', 1, 0, 1, 1);
    this.baseColdDownTurns = 1;
  }
  get damage () {
    return Math.max(6 + 2 * this.power, 4);
  }
  // 使用技能
  use(player, enemy) {
    const result = launchAttack(player, enemy, this.damage);
    if(enemy.hasEffect('虚弱')) {
      gainShield(player, 8);
    }
    return true;
  }
  regenerateDescription(player) {
    return `造成${this.damage + (player?.attack ?? 0)}伤害，敌人/effect{虚弱}则获得8护盾`;
  }
}

// 旋风腿（C+）
// 造成4伤害，每点现有行动力重复一次
export class WhirlwindKick extends Skill {
  constructor() {
    super('旋风腿', 'normal', 2, 0, 1, 1);
    this.baseColdDownTurns = 4;
  }
  get damage () {
    return Math.max(4 + 2 * this.power, 2);
  }
  // 使用技能
  use(player, enemy) {
    const ap = player.remainingActionPoints + this.actionPointCost;
    for(let i = 0; i < ap; i++) {
      launchAttack(player, enemy, this.damage);
    }
    return true;
  }
  regenerateDescription(player) {
    if(player) {
      return `造成${this.damage + (player?.attack ?? 0)}伤害${player.remainingActionPoints}次`;
    }
    return `造成${this.damage + (player?.attack ?? 0)}伤害，每点现有行动力重复一次`;
  }
}

// 爆发（C+）
// 获得1行动力
export class BurstAction extends Skill {
  constructor() {
    super('爆发', 'normal', 2, 0, 1, 2);
  }
  get maxUses () {
    return Math.max(super.maxUses + this.power, 1);
  }
  // 使用技能
  use(player, enemy) {
    player.gainActionPoint(1);
    return true;
  }
  regenerateDescription(player) {
    return `获得1行动力`;
  }
}

// 反击（C+）
// 造成11伤害，虚弱时造成四倍伤害
export class CounterAttack extends Skill {
  constructor() {
    super('反击', 'normal', 2, 0, 1, 1);
    this.baseColdDownTurns = 2;
  }
  get damage () {
    return Math.max(11 + 3 * this.power, 6);
  }
  // 使用技能
  use(player, enemy) {
    let totalDamage = this.damage;
    if(player.hasEffect('虚弱')) {
      totalDamage *= 4;
    }
    launchAttack(player, enemy, totalDamage);
    return true;
  }
  regenerateDescription(player) {
    if(player) {
      if(player.hasEffect('虚弱')) {
        return `造成${(this.damage * 4) + (player?.attack ?? 0)}伤害`;
      }
    }
    return `造成${this.damage + (player?.attack ?? 0)}伤害，/effect{虚弱}时伤害翻4倍`;
  }
}

// 碎击（C+）
// 造成5伤害3次，不触发攻击效果
export class Smash extends Skill {
  constructor() {
    super('碎击', 'normal', 2, 0, 2, 1);
    this.baseColdDownTurns = 3;
  }
  get damage () {
    return Math.max(5 + 2 * this.power, 3);
  }
  // 使用技能
  use(player, enemy) {
    for(let i = 0; i < 3; i++) {
      dealDamage(player, enemy, this.damage, true);
    }
    return true;
  }
  // 重新生成技能描述
  regenerateDescription(player) {
    return `造成${this.damage + (player?.attack ?? 0)}伤害3次，不触发攻击效果`;
  }
}

// 小蛮牛功（C+）
// 咏唱：获得3力量，行动力上限-1
export class Vajra extends Skill {
  constructor() {
    super('小蛮牛功', 'normal', 2, 0, 1, 1);
    this.baseColdDownTurns = 1;
    this.cardMode = 'chant';
    this.modifier_ = (player) => {
      const self = this;
      return new Proxy(player, {
        get(target, prop) {
          if (prop === 'attack') {
            return target.attack + 3; // 每次获取 attack 属性时，增加 3
          }
          if (prop === 'maxActionPoints') {
            return Math.max(target.maxActionPoints - 1, 0); // 每次获取 maxActionPoints 属性时，减少 1
          }
          return target[prop];
        }
      });
    }
  }
  get actionPointCost () {
    return Math.max(super.actionPointCost - this.power, 0);
  }
  onEnable(player) {
    super.onEnable(player);
    player.addModifier(this.modifier_);
  }
  onDisable(player, reason) {
    super.onDisable(player, reason);
    player.removeModifier(this.modifier_);
  }
  regenerateDescription(player) {
    return `获得3攻击，行动力上限-1`;
  }
}