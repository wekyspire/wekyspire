import Unit from "./unit.js";
// 敌人抽象类
class Enemy extends Unit {
  constructor(name, hp, attack, defense, avatarUrl = '') {
    super();
    this.name = name; // 敌人名称
    this.hp = hp; // 当前生命值
    this.maxHp = hp; // 最大生命值
    this.shield = 0; // 当前护盾
    this.baseAttack = attack; // 基础攻击力
    this.baseDefense = defense; // 基础防御力
    this.baseMagic = 0; // 基础灵能强度
    this.subtitle = ""; // Boss subtitle
    this.description = '一个面目狰狞的敌人！'; // 敌人描述
    this.type = 'normal'; // normal / special / boss
    this.avatarUrl = avatarUrl; // 敌人头像URL
    // 为每个实例生成唯一ID（用于动画同步等）
    this.uniqueID = Math.random().toString(36).substring(2, 10);
  }

  get isBoss () {
    return this.type === 'boss';
  }

  get isSpecial () {
    return this.type === 'special';
  }

  get isNormal () {
    return this.type === 'normal';
  }
  
  // 初始化方法
  init() {
    // 初始化逻辑（如果需要）
  }

  // 执行动作
  act(player) {
    // 子类需要实现具体逻辑
  }

  // 获取下回合意图（用于UI展示）
  // 默认返回空数组；子类应覆盖返回一组意图项：
  // 例如：[{ type:'attack', times:1, damage:6 }, { type:'defend', amount:4 }]
  getIntention() {
    return [];
  }
}

export default Enemy;