// 技能抽象类
class Skill {
  constructor(name, type, tier, baseDescription, manaCost, maxUses, skillSeriesName = undefined, spawnWeight = undefined) {
    this.name = name; // 技能名称
    this.type = type; // 技能类型：'normal' 或 'magic'
    this.tier = tier; // 技能等阶
    this.inBattleIndex = -1; // 在战斗中，此技能在玩家skill数组中的下标。不在战斗中则无意义。
    this.baseDescription = baseDescription; // 技能描述
    this.description = baseDescription;
    this.manaCost = manaCost || 0; // 魏启消耗
    this.maxUses = maxUses || 1; // 最大充能次数，inf代表无需充能，可以随便用
    this.remainingUses = this.maxUses; // 剩余充能次数
    this.skillSeriesName = skillSeriesName || name; // 技能系列名称
    this.upgradeTo = ""; // 如果此技能可以升级，升级后的技能名称
    this.spawnWeight = spawnWeight || 1; // 技能出现权重，默认为1
    this.coldDownTurns = 0; // 技能冷却时间, 以回合为单位。如果为0则表示无法自动冷却。
    this.remainingColdDownTurns = 0; // 回合剩余冷却时间
  }

  canColdDown() {
    if(this.coldDownTurns === 0) return false;
    if(this.remainingUses == this.maxUses) return false;
    return true;
  }

  // 回合开始时或被手动调用时，推进冷却流程
  coldDown() {
    if(this.coldDownTurns !== 0) {
      if(this.remainingUses !== this.maxUses) {
        this.remainingColdDownTurns --;
        if(this.remainingColdDownTurns <= 0) {
          this.remainingColdDownTurns = this.coldDownTurns;
          this.remainingUses = Math.min(this.remainingUses + 1, this.maxUses);
        }
      } else {
        this.remainingColdDownTurns = this.coldDownTurns;
      }
    }
  }

  // 战斗开始时调用，用于初始化技能
  onBattleStart() {
    this.remainingUses = this.maxUses;
    this.remainingColdDown = this.coldDownTurns;
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