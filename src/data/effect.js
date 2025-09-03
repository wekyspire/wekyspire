// 简化版效果类
// 仅用作标识，具体逻辑在Player和Enemy对象中处理
class Effect {
  constructor(name, type, stacks) {
    this.name = name; // 效果名称
    this.type = type; // 效果类型：'buff', 'debuff', 'neutral'
    this.stacks = stacks || 0; // 效果层数
  }
}

export default Effect;