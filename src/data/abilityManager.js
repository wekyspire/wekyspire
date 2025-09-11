import { Breakthrough, Strengthen, Growth, Cultivation, Exercise, MindExercise, TurtoiseExercise,
   BitterCultivation, BitterBodyCultivation, SpecialDefenseCultivation,
    DefenseCultivation, ExpertExercise, WellRest, NapRest } from './ability.js';

// 能力管理器类
class AbilityManager {
  constructor() {
    this.abilities = [];
    // 初始化时注册预定义能力
    this.registerAbility(Breakthrough);
    this.registerAbility(Strengthen);
    this.registerAbility(Growth);
    this.registerAbility(Cultivation);
    this.registerAbility(NapRest);
    this.registerAbility(WellRest);
    this.registerAbility(Exercise);
    this.registerAbility(MindExercise);
    this.registerAbility(TurtoiseExercise);
    this.registerAbility(ExpertExercise);
    this.registerAbility(BitterCultivation);
    this.registerAbility(BitterBodyCultivation);
    this.registerAbility(DefenseCultivation);
    this.registerAbility(SpecialDefenseCultivation);
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
  
  // 单例
  static getInstance() {
    if (!this.instance) {
      this.instance = new AbilityManager();
    }
    return this.instance;
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
      
      let offset = Math.max(1, abundance * 2);
      const tierFactor = Math.pow(0.6, Math.max(ability.tier - offset, 0));
      const rarityFactor = ability.spawnWeight;

      const weight = tierFactor * rarityFactor;
      
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