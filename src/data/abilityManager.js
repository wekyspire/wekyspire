import { Breakthrough, Strengthen, Growth, Cultivation } from './ability.js';

// 能力管理器类
class AbilityManager {
  constructor() {
    this.abilities = [];
  }
  
  // 添加能力
  addAbility(ability) {
    this.abilities.push(ability);
  }
  
  // 获取所有能力
  getAllAbilities() {
    return this.abilities;
  }
  
  // 创建预定义能力
  static createAbility(abilityName) {
    switch (abilityName) {
      case '突破':
        return new Breakthrough();
      case '强化':
        return new Strengthen();
      case '成长':
        return new Growth();
      case '修炼':
        return new Cultivation();
      default:
        throw new Error(`Unknown ability: ${abilityName}`);
    }
  }
  
  // 随机获取能力
  static getRandomAbilities(count = 3) {
    const allAbilities = ['突破', '强化', '成长', '修炼'];
    const selected = [];
    
    // 确保不会选择重复的能力
    const shuffled = [...allAbilities].sort(() => 0.5 - Math.random());
    
    for (let i = 0; i < Math.min(count, shuffled.length); i++) {
      selected.push(this.createAbility(shuffled[i]));
    }
    
    return selected;
  }
}

export default AbilityManager;