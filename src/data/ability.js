import { upgradePlayerTier } from "./player.js";

// 能力抽象类
class Ability {
  constructor(name, description, tier, spawnWeight = 1) {
    this.name = name; // 能力名称
    this.description = description; // 能力描述
    this.tier = tier || 1; // 能力等阶，默认为1
    this.spawnWeight = spawnWeight; // 能力生成权重，默认为1
  }

  // 应用能力效果
  apply(player) {
    // 子类需要实现具体逻辑
  }
}

// 突破能力
class Breakthrough extends Ability {
  constructor() {
    super('额外突破', '再/named{突破}一次！', 5, 0.2);
  }

  apply(player) {
    upgradePlayerTier(player);
  }
}

// 强化能力
class Strengthen extends Ability {
  constructor() {
    super('全面强化', '/named{攻击}、/named{防御}、/named{灵能}各增1。', 5, 0.8);
  }

  apply(player) {
    player.baseAttack += 1;
    player.baseDefense += 1;
    player.baseMagic += 1;
  }
}

// 成长能力
class Growth extends Ability {
  constructor() {
    super('成长', '/named{攻击}增1，/named{生命}上限增10。', 4, 1.0);
  }

  apply(player) {
    player.baseAttack += 1;
    player.maxHp += 10;
    player.hp += 10; // 同时恢复增加的生命值
  }
}

// 小睡
export class NapRest extends Ability {
  constructor() {
    super('小睡', '/named{生命}恢复10%，上限增加5。', 1, 1.0);
  }

  apply(player) {
    player.maxHp += 5;
    player.hp = Math.min(player.maxHp, player.hp + 
      Math.floor(player.maxHp * 0.1)
    );
  }
}

// 休养
export class WellRest extends Ability {
  constructor() {
    super('休养', '/named{生命}恢复40%，上限增加2。', 1, 1.0);
  }

  apply(player) {
    player.maxHp += 2;
    player.hp = Math.min(
      player.maxHp, 
      player.hp + Math.floor(player.maxHp * 0.4));
  }
}

// 锻炼
class Exercise extends Ability {
  constructor() {
    super('锻炼', '/named{生命}上限增8。', 2, 1.0);
  }

  apply(player) {
    player.maxHp += 7;
    player.hp += 7; // 同时恢复增加的生命值
  }
}

// 专业锻炼
class ExpertExercise extends Ability {
  constructor() {
    super('专业锻炼', '/named{生命}上限增15。', 2, 0.5);
  }

  apply(player) {
    player.maxHp += 15;
    player.hp += 15;// 同时恢复增加的生命值
  }
}

// 冥想
class MindExercise extends Ability {
  constructor() {
    super('冥想', '获得1/named{灵能}。', 3, 1.0);
  }

  apply(player) {
    player.baseMagic += 1;
  }
}

// 力量训练
class PowerExercise extends Ability {
  constructor() {
    super('力量训练', '/named{攻击}增1，最大/named{生命}减12。', 3, 1.0);
  }

  apply(player) {
    player.baseAttack += 1;
    player.maxHp = Math.max(1, player.maxHp - 12);
    player.hp = Math.min(player.maxHp, player.hp);
  }
}

// 修炼
class Cultivation extends Ability {
  constructor() {
    super('修炼', '/named{灵能}增1，获得1魏启上限，恢复所有/named{魏启}。', 4, 0.5);
  }

  apply(player) {
    player.baseMagic += 1;
    player.maxMana += 1;
    player.mana = player.maxMana; // 恢复所有魏启
  }
}

export { Ability, Breakthrough, Strengthen, Growth, Cultivation,
   MindExercise, PowerExercise, Exercise, ExpertExercise}

export class BitterCultivation extends Ability {
  constructor() {
    super('苦修', '/named{灵能}增2，/named{攻击}减1。', 3, 1);
  }
  apply(player) {
    player.baseMagic += 2;
    player.baseAttack = Math.max(0, player.baseAttack - 1);
  }
}

export class BitterBodyCultivation extends Ability {
  constructor() {
    super('爆发训练', '/named{攻击}增1，/named{防御}减1。', 3, 1);
  }
  apply(player) {
    player.baseAttack += 1;
    player.baseDefense = Math.max(0, player.baseDefense - 1);
  }
}

export class DefenseCultivation extends Ability {
  constructor() {
    super('防御训练', '/named{防御}增1。', 4, 1);
  }
  apply(player) {
    player.baseDefense += 1;
  }
}

export class SpecialDefenseCultivation extends Ability {
  constructor() {
    super('特化防御训练', '/named{防御}增1，/named{攻击}减1。', 3, 1);
  }
  apply(player) {
    player.baseDefense += 2;
    player.baseAttack = Math.max(0, player.baseAttack - 1);
  }
}