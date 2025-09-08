import eventBus from "../eventBus";
// 敌人抽象类
class Enemy {
  constructor(name, hp, attack, defense, magic, avatarUrl = '') {
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
    this.type = 'normal'; // normal / special / boss
    this.avatarUrl = avatarUrl; // 敌人头像URL
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
  // @reutrn 
  // {
  //  endTurn: 表示是否结束此回合，否然act会被继续调用，默认为true
  //  latency: 操作间隔，默认为800ms,
  //  promise: 敌人自定义行动延时和异步操作，如果非空，则会被上层应用等待，默认为null
  // }
  act(player, battleLogs) {
    // 子类需要实现具体逻辑
    return {
      endTurn: true,
      latency: 800
    }
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
    
    // 触发效果变化事件
    eventBus.emit('effect-change', {
      target: this, 
      effectName: effectName, 
      deltaStacks: stacks, 
      currStacks: currStacks, 
      previousStacks: previousStacks
    });
  }

  // 移除效果
  removeEffect(effectName, stacks = 1) {
    this.addEffect(effectName, -stacks);
  }
}

export default Enemy;