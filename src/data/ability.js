// 能力抽象类
class Ability {
  constructor(name, description, tier) {
    this.name = name; // 能力名称
    this.description = description; // 能力描述
    this.tier = tier || 1; // 能力等阶，默认为1
  }

  // 应用能力效果
  apply(player) {
    // 子类需要实现具体逻辑
  }
}

// 突破能力
class Breakthrough extends Ability {
  constructor() {
    super('突破', '提升玩家等阶到下一等阶，获得10魏启上限，能获得和使用更高级的技能，并且行动力上限增1。', 5);
  }

  apply(player) {
    // 提升玩家等阶
    const tierUpgrades = { 0: 2, 2: 3, 3: 5, 5: 7, 7: 8, 8: 9 };
    if (tierUpgrades[player.tier] !== undefined) {
      player.tier = tierUpgrades[player.tier];
    }
    
    // 增加魏启上限
    player.maxMana += 10;
    
    // 增加行动力上限
    player.maxActionPoints += 1;
    
    // 恢复行动力
    player.actionPoints = player.maxActionPoints;
  }
}

// 强化能力
class Strengthen extends Ability {
  constructor() {
    super('强化', '玩家攻击力、防御力、灵能各增1。', 3);
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
    super('成长', '攻击力增1，生命值增20。', 2);
  }

  apply(player) {
    player.baseAttack += 1;
    player.maxHp += 20;
    player.hp += 20; // 同时恢复增加的生命值
  }
}

// 修炼能力
class Cultivation extends Ability {
  constructor() {
    super('修炼', '灵能增1，获得7魏启上限，恢复所有魏启。', 4);
  }

  apply(player) {
    player.baseMagic += 1;
    player.maxMana += 7;
    player.mana = player.maxMana; // 恢复所有魏启
  }
}

export { Ability, Breakthrough, Strengthen, Growth, Cultivation };