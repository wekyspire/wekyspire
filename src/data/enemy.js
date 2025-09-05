// 敌人抽象类
class Enemy {
  constructor(name, hp, attack, defense, magic) {
    this.name = name; // 敌人名称
    this.hp = hp; // 当前生命值
    this.maxHp = hp; // 最大生命值
    this.shield = 0; // 当前护盾
    this.baseAttack = attack; // 基础攻击力
    this.baseDefense = defense; // 基础防御力
    this.baseMagic = magic; // 基础灵能强度
    this.effects = {}; // 效果列表
    this.subtitle = ""; // Boss subtitle
    this.description = '一个面目狰狞的敌人！'; // 敌人描述
    this.isBoss = false;
  }
  
  // 初始化方法
  init() {
    // 初始化逻辑（如果需要）
  }

  // 计算属性
  get attack() {
    return this.baseAttack + (this.effects['力量'] || 0);
  }
  
  get defense() {
    return this.baseDefense + (this.effects['防御'] || 0);
  }
  
  get magic() {
    return this.baseMagic + (this.effects['集中'] || 0);
  }

  // 执行行动
  act(player, battleLogs) {
    // 子类需要实现具体逻辑
  }

  // 添加效果
  addEffect(effectName, stacks = 1) {
    if(stacks == 0) return ;
    const previousStacks = this.effects[effectName] || 0;

    if (this.effects[effectName]) {
      this.effects[effectName] += stacks;
    } else {
      this.effects[effectName] = stacks;
    }

    const currStacks = this.effects[effectName];

    if (this.effects[effectName] == 0) {
      delete this.effects[effectName];
    }
    
    // 触发效果变化事件
    import('../eventBus.js').then(eventBus => {
      eventBus.default.emit('effectChange', {target: 'enemy', effectName: effectName, deltaStacks: stacks, currStacks: currStacks, previousStacks: previousStacks});
    });
  }

  // 移除效果
  removeEffect(effectName, stacks = 1) {
    this.addEffect(effectName, -stacks);
  }
}

export default Enemy;