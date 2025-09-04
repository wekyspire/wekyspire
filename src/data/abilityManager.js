import { Breakthrough, Strengthen, Growth, Cultivation, Exercise, MindExercise, PowerExercise } from './ability.js';

// 能力管理器类
class AbilityManager {
  constructor() {
    this.abilities = [];
    // 初始化时注册预定义能力
    this.registerAbility(Breakthrough);
    this.registerAbility(Strengthen);
    this.registerAbility(Growth);
    this.registerAbility(Cultivation);
    this.registerAbility(Exercise);
    this.registerAbility(MindExercise);
    this.registerAbility(PowerExercise);
  }
  
  // 注册能力
  registerAbility(AbilityClass) {
    const ability = new AbilityClass();
    this.abilities.push({ name: ability.name, AbilityClass, tier: ability.tier, spawnWeight: ability.spawnWeight });
  }
  
  // 获取所有能力
  getAllAbilities() {
    return this.abilities;
  }
  
  // 创建能力实例
  createAbility(abilityName) {
    const ability = this.abilities.find(a => a.name === abilityName);
    if (ability) {
      return new ability.AbilityClass();
    }
    throw new Error(`Unknown ability: ${abilityName}`);
  }
  
  // 随机获取能力
  getRandomAbilities(count = 3, abundance = 1.0) {
    const allAbilities = this.abilities.map(a => ({
      name: a.name,
      tier: a.tier,
      spawnWeight: a.spawnWeight
    }));
    
    // 根据abundance、spawnWeight和tier计算每个能力的权重
    const weightedAbilities = allAbilities.map(ability => {
      // 权重计算公式：基础权重 * (tier的影响) * (spawnWeight的影响) * (abundance的影响)
      
      // 1. tier影响：tier越高，分母越大（指数增长确保高tier有显著优势）
      const tierFactor = Math.pow(1.5, ability.tier - 1);
      
      // 2. spawnWeight影响：spawnWeight越小，分母越大（使用反比关系反映稀有度）
      // 添加一个小常数避免除零错误
      const rarityFactor = 1.0 / (ability.spawnWeight + 0.1);
      
      // 3. abundance影响：直接放大整体权重，并特别增强高tier和低spawnWeight的奖励
      // - 基础影响：直接乘以abundance
      // - 增强影响：对高tier、低spawnWeight的奖励进行额外增强
      const baseAbundanceFactor = abundance;
      const enhancedAbundanceFactor = 1 + (ability.tier - 1) * 0.2 * abundance * rarityFactor;
      
      // 最终权重计算
      const weight = baseAbundanceFactor * enhancedAbundanceFactor / (tierFactor * rarityFactor);
      
      return { ...ability, weight };
    });
    

    // 根据权重随机选择能力
    const selected = [];
    let availableAbilities = weightedAbilities;
    const maxEntries = Math.min(count, availableAbilities.length);
    
    for (let i = 0; i < maxEntries; i++) {
      // 计算总权重
      const totalWeight = availableAbilities.reduce((sum, ability) => sum + ability.weight, 0);
      
      // 生成随机数
      let random = Math.random() * totalWeight;
      
      // 根据随机数选择能力
      let selectedIndex = 0;
      for (let j = 0; j < availableAbilities.length; j++) {
        random -= availableAbilities[j].weight;
        if (random <= 0) {
          selectedIndex = j;
          break;
        }
      }
      
      // 添加选中的能力
      const selectedAbility = this.createAbility(availableAbilities[selectedIndex].name);
      selected.push(selectedAbility);
      
      // 从可选列表中移除已选的能力
      availableAbilities.splice(selectedIndex, 1);
    }
    
    return selected;
  }
}

export default AbilityManager;