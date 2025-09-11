import Skill from './skill.js';

// 技能管理器类
class SkillManager {
  constructor() {
    this.skills = [];
    this.skillRegistry = new Map(); // 新增技能注册表
    
  }


  // 注册技能
  registerSkill(SkillClass) {
    const skillName = (new SkillClass()).name;
    this.skillRegistry.set(skillName, SkillClass);
  }

  static async loadAllSkills() {
    
    const skillManager = SkillManager.getInstance();

    // 动态导入所有技能文件
    const skillModules = [
      await import('./skills/basic.js'),
      await import('./skills/blast.js'),
      await import('./skills/heal.js'),
      // await import('./skills/remi.js'),
      await import('./skills/cMinus.js'),
      await import('./skills/punchKicks.js'),
      // await import('./skills/firecontrol.js'),
      // await import('./skills/lumi.js')
    ];
    
    // 遍历所有模块并注册其中的技能
    for (const module of skillModules) {
      // 遍历模块中的所有导出
      for (const [key, SkillClass] of Object.entries(module)) {
        // 检查是否为Skill类的子类
        if (typeof SkillClass === 'function' && SkillClass !== Skill && SkillClass.prototype instanceof Skill) {
          try {
            skillManager.registerSkill(SkillClass);
          } catch (error) {
            console.error(`Failed to register skill: ${key}`, error);
          }
        }
      }
    }
  }
  
  // 创建技能实例
  createSkill(skillName) {
    // 使用注册表创建技能实例
    const SkillClass = this.skillRegistry.get(skillName);
    if (SkillClass) {
      const obj = new SkillClass();
      obj.description = obj.regenerateDescription();
      return obj;
    }
    throw new Error(`Unknown skill: ${skillName}`);
  }
  
  // 获取SkillManager实例
  static getInstance() {
    if (!this.instance) {
      this.instance = new SkillManager();
    }
    return this.instance;
  }
  
  // 获取随机技能
  getRandomSkills(count, playerSkillSlots = [], playerTier = 0, bestQuality = false) {
    const allSkills = Array.from(this.skillRegistry.entries()).map(([name, SkillClass]) => {
      // 创建临时实例以获取技能系列名称和等阶
      const tempSkill = new SkillClass();
      return {
        name: name,
        series: tempSkill.skillSeriesName,
        tier: tempSkill.tier,
        spawnWeight: tempSkill.spawnWeight
      };
    });

    const playerNonEmptySkillSlots = playerSkillSlots.filter(skill => skill !== null);
    const playerSkills = playerNonEmptySkillSlots.map(slot => slot);
    console.log(playerSkills);
    
    // 获取玩家已有的技能系列
    const playerSkillSeries = playerSkills.map(skill => skill.skillSeriesName);
    
    // 过滤掉玩家已有的技能和同系列的技能，以及等阶大于玩家等阶的技能
    const availableSkills = allSkills.filter(skill => 
      !playerSkills.some(playerSkill => playerSkill.name === skill.name) &&
      !playerSkillSeries.includes(skill.series) &&
      skill.tier <= playerTier
    );
    
    // 计算每个技能的出现权重
    const weightedSkills = availableSkills.map(skill => {
      const tierDifference = playerTier - skill.tier;
      let modifyFactor = 1;
      
      if (skill.tier >= 8) modifyFactor *= 0.7;
      if (skill.tier >= 5) modifyFactor *= 0.8;
      if (tierDifference > 7) {
        modifyFactor = 0.15;
      }  else if (tierDifference > 6) {
        modifyFactor = 0.40;
      } else if (tierDifference > 5) {
        modifyFactor = 0.70;
      }
      // 增加当前等阶的技能出现权重
      if(tierDifference < 1) modifyFactor *= 1.2;

      // 高质量奖励中，贴近玩家等级上限技能概率大幅提升
      if(bestQuality && tierDifference < 1) modifyFactor *= 5;
      if(bestQuality && tierDifference < 2) modifyFactor *= 3;
      
      return {
        ...skill,
        weight: skill.spawnWeight * modifyFactor
      };
    });
    // 减少已获得技能的出现权重（x0.2）
    weightedSkills.forEach(skill => {
      if (playerSkills.some(playerSkill => playerSkill.name === skill.name)) {
        skill.weight *= 0.2;
      }
    });
    
    const selectedSkills = [];
    
    // 确保不会选择超过可用技能数量的技能
    const actualCount = Math.min(count, weightedSkills.length);
    
    // 带权不放回抽选
    for (let i = 0; i < actualCount; i++) {
      // 计算总权重
      const totalWeight = weightedSkills.reduce((sum, skill) => sum + skill.weight, 0);
      
      // 生成随机数
      const random = Math.random() * totalWeight;
      
      // 选择技能
      let currentWeight = 0;
      let selectedIndex = 0;
      
      for (let j = 0; j < weightedSkills.length; j++) {
        currentWeight += weightedSkills[j].weight;
        if (random <= currentWeight) {
          selectedIndex = j;
          break;
        }
      }
      
      // 获取选中的技能
      const skillInfo = weightedSkills[selectedIndex];
      const skill = this.createSkill(skillInfo.name);
      selectedSkills.push(skill);
      
      // 从可选技能中移除已选择的技能
      weightedSkills.splice(selectedIndex, 1);
    }
    
    return selectedSkills;
  }
}

export default SkillManager;