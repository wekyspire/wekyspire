// 商品抽象类
class Item {
  constructor(name, description, price, tier = 1, spawnWeight = 1, alwaysPresent = false, stock = Infinity) {
    this.name = name; // 商品名称
    this.description = description; // 商品描述
    this.price = price; // 商品价格
    this.tier = tier || 1; // 商品等阶，默认为1
    this.spawnWeight = spawnWeight; // 商品生成权重，默认为1
    this.alwaysPresent = alwaysPresent; // 是否为常驻商品，默认为false
    this.stock = stock; // 商品库存，Infinity表示无限制
  }

  // 购买商品效果
  purchase(player) {
    // 子类需要实现具体逻辑
    // 在子类中调用super.purchase(player)后，可以减少库存
    if (this.stock !== Infinity) {
      this.stock = Math.max(0, this.stock - 1);
    }
  }
}

// 恢复生命商品
class RestoreHealth extends Item {
  constructor() {
    super('恢复生命', '恢复/green{30}/named{生命}', 13, 1, 1.0, true); // 常驻商品
  }

  purchase(player) {
    player.hp = Math.min(player.maxHp, player.hp + 40);
    super.purchase(player); // 减少库存
  }
}

// 恢复魏启商品
class RestoreMana extends Item {
  constructor() {
    super('恢复魏启', '恢复/purple{3}/named{魏启}', 13, 1, 1.0, true); // 常驻商品
  }

  purchase(player) {
    player.mana = player.maxMana;
    super.purchase(player); // 减少库存
  }
}

// 技能位商品
class SkillSlot extends Item {
  constructor() {
    super('技能位', '增加技能数上限', 80, 3, 0.5, false, 1); // 限制购买1次
  }

  purchase(player) {
    player.maxNumSkills += 1;
    super.purchase(player); // 减少库存
  }
}

export { Item, RestoreHealth, RestoreMana, SkillSlot }