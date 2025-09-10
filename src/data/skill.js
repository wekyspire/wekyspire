// 技能抽象类
class Skill {
  constructor(name, type, tier, manaCost, actionPointCost, maxUses, skillSeriesName = undefined, spawnWeight = undefined) {
    this.name = name; // 技能名称
    this.type = type; // 技能类型：'普通'（非魔法）, '木', '火', '光', '水', '通用'（通用类魔法）, '特殊'，'诅咒'（负面技能卡）
    this.tier = tier; // 技能等阶
    this.inBattleIndex = -1; // 在战斗中，此技能在玩家skill数组中的下标。不在战斗中则无意义。
    this.power = 0; // 技能可能会被弱化或强化，此时，修改此数字（正为强化，负为弱化）
    this.description = ''; // 生成的技能描述
    this.subtitle = ''; // 副标题，一般而言仅有S级或特殊、诅咒技能有
    this.manaCost = manaCost || 0; // 魏启消耗
    this.actionPointCost = actionPointCost || 1; // 行动点消耗，默认为1
    this.maxUses = maxUses || 1; // 最大充能次数，inf代表无需充能，可以随便用
    this.remainingUses = this.maxUses; // 剩余充能次数
    this.skillSeriesName = skillSeriesName || name; // 技能系列名称
    this.upgradeTo = ""; // 如果此技能可以升级，升级后的技能名称。如果有多个升级方向，则为数组。
    this.spawnWeight = spawnWeight || 1; // 技能出现权重，默认为1
    if (!Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(this), 'coldDownTurns'
    )?.get) {
      this.coldDownTurns = 0; // 技能冷却时间, 以回合为单位。如果为0则表示无法自动冷却。
    }
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
  // 此方法会被调用多次，直到返回值是bool类型
  // @param {Player} player: 玩家对象
  // @param {Enemy} enemy: 敌人对象
  // @param {Integer} stage: 此技能的使用阶段，默认为0，简单技能不需要考虑此参数。
  // @return {boolean | object} bool: 是否成功使用技能
  // 如果返回不是bool，表明此技能是一个多阶段使用的技能，此方法会被连续调用且stage递增
  use(player, enemy, stage) {
    return true;
  }

  consumeUses (player) {
    player.consumeActionPoints(this.actionPointCost);
    player.consumeMana(this.manaCost);
    this.remainingUses --;
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
    // 默认实现：检查魏启和行动点是否足够
    return player.mana >= this.manaCost && player.remainingActionPoints >= this.actionPointCost && this.remainingUses > 0;
  }

  // 升级技能，子类可以重写此方法
  upgrade(deltaPower) {
    this.power += deltaPower;
  }
}

export default Skill;