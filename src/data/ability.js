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
    super('突破', '提升到下一/named{等阶}，恢复并获得1/named{魏启}上限，/named{行动力}增1。', 5, 0.2);
  }

  apply(player) {
    // 提升玩家等阶
    const tierUpgrades = { 0: 2, 2: 3, 3: 5, 5: 7, 7: 8, 8: 9 };
    if (tierUpgrades[player.tier] !== undefined) {
      player.tier = tierUpgrades[player.tier];
    }
    
    // 增加魏启上限
    player.maxMana += 1;
    player.mana = player.maxMana; // 恢复所有魏启
    
    // 增加行动力上限
    player.maxActionPoints += 1;
    
    // 恢复行动力
    player.actionPoints = player.maxActionPoints;
  }
}

// 强化能力
class Strengthen extends Ability {
  constructor() {
    super('全面强化', '/named{攻击}、/named{防御}、/named{灵能}各增1。', 3, 0.8);
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
    super('成长', '/named{攻击}增1，/named{生命}上限增15。', 3, 1.0);
  }

  apply(player) {
    player.baseAttack += 1;
    player.maxHp += 15;
    player.hp += 15; // 同时恢复增加的生命值
  }
}

// 锻炼
class Exercise extends Ability {
  constructor() {
    super('锻炼', '/named{生命}上限增7。', 1, 1.0);
  }

  apply(player) {
    player.maxHp += 7;
    player.hp += 7; // 同时恢复增加的生命值
  }
}

// 冥想
class MindExercise extends Ability {
  constructor() {
    super('冥想', '获得1/named{灵能}。', 2, 1.0);
  }

  apply(player) {
    player.baseMagic += 1;
  }
}

// 力量训练
class PowerExercise extends Ability {
  constructor() {
    super('力量训练', '/named{攻击}增1，最大/named{生命}减5。', 1, 1.0);
  }

  apply(player) {
    player.baseAttack += 1;
    player.maxHp = Math.max(1, player.maxHp - 5);
    player.hp = Math.min(player.maxHp, player.hp);
  }
}

// 修炼
class Cultivation extends Ability {
  constructor() {
    super('修炼', '/named{灵能}增1，获得1魏启上限，恢复所有/named{魏启}。', 3, 0.5);
  }

  apply(player) {
    player.baseMagic += 1;
    player.maxMana += 1;
    player.mana = player.maxMana; // 恢复所有魏启
  }
}

export { Ability, Breakthrough, Strengthen, Growth, Cultivation, MindExercise, PowerExercise, Exercise}

export class BitterCultivation extends Ability {
  constructor() {
    super('苦修', '/named{灵能}增2，/named{攻击}减1。', 2, 1);
  }
  apply(player) {
    player.baseMagic += 2;
    player.baseAttack = Math.max(0, player.baseAttack - 1);
  }
}

export class BitterBodyCultivation extends Ability {
  constructor() {
    super('爆发训练', '/named{攻击}增1，/named{防御}减1。', 1, 1);
  }
  apply(player) {
    player.baseAttack += 1;
    player.baseDefense = Math.max(0, player.baseDefense - 1);
  }
}

export class DefenseCultivation extends Ability {
  constructor() {
    super('防御训练', '/named{防御}增1。', 2, 1);
  }
  apply(player) {
    player.baseDefense += 1;
  }
}

export class SpecialDefenseCultivation extends Ability {
  constructor() {
    super('特化防御训练', '/named{防御}增2，/named{攻击}减1。', 1, 1);
  }
  apply(player) {
    player.baseDefense += 2;
    player.baseAttack = Math.max(0, player.baseAttack - 1);
  }
}