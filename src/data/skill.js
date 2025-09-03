// 技能抽象类
class Skill {
  constructor(name, type, tier, baseDescription, manaCost, maxUses, skillSeriesName) {
    this.name = name; // 技能名称
    this.type = type; // 技能类型：'normal' 或 'magic'
    this.tier = tier; // 技能等阶
    this.baseDescription = baseDescription; // 技能描述
    this.description = baseDescription;
    this.manaCost = manaCost || 0; // 魏启消耗
    this.maxUses = maxUses || 1; // 回合最大施放次数
    this.remainingUses = this.maxUses; // 回合剩余施放次数
    this.skillSeriesName = skillSeriesName || name; // 技能系列名称
  }

  // 重置回合剩余施放次数
  resetUses() {
    this.remainingUses = this.maxUses;
  }

  // 战斗开始时调用，用于初始化技能
  onBattleStart() {
    // 默认实现，子类可以重写
  }

  // 使用技能
  use() {
    if (this.remainingUses > 0) {
      return true;
    }
    console.log(`${this.name}，错误的调用！`);
    return false;
  }

  // 获取技能描述
  getDescription() {
    return this.description;
  }

  // 重新生成技能描述（根据玩家状态计算具体数值）
  regenerateDescription(player) {
    // 默认实现，子类可以重写
    return this.description;
  }

  // 判断技能是否可用
  canUse(player) {
    // 默认实现：检查行动力和魏启是否足够
    return player.actionPoints > 0 && player.mana >= this.manaCost && this.remainingUses > 0;
  }
}

export default Skill;