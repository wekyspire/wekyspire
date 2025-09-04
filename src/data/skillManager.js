import { PunchKick, Roll, Sleep, KungFu } from './skills/basic.js';
import { CarelessPunchKick, AmateurDefense, OverCarefulDefense,
  PrepareExercise, CarelessBravery, HoldOn } from './skills/basic.js';
import { Fireshot,Fireball, LargeFireball } from './skills/example.js';

import { PurifyWeky, StrongPurifyWeky, VeryWeakRecovery, WeakRecovery } from './skills/cMinus.js';

// 技能管理器类
class SkillManager {
  constructor() {
    this.skills = [];
    this.skillRegistry = new Map(); // 新增技能注册表
    
    // 初始化时注册预定义技能
    this.registerSkill(PunchKick);
    this.registerSkill(Roll);
    this.registerSkill(Sleep);
    this.registerSkill(KungFu);
    this.registerSkill(Fireshot);
    this.registerSkill(Fireball);
    this.registerSkill(LargeFireball);
    this.registerSkill(CarelessPunchKick);
    this.registerSkill(AmateurDefense);
    this.registerSkill(OverCarefulDefense);
    this.registerSkill(PrepareExercise);
    this.registerSkill(CarelessBravery);
    this.registerSkill(HoldOn);

    this.registerSkill(PurifyWeky);
    this.registerSkill(StrongPurifyWeky);
    this.registerSkill(VeryWeakRecovery);
    this.registerSkill(WeakRecovery);
  }
  
  // 注册技能
  registerSkill(SkillClass) {
    const skillName = (new SkillClass()).name;
    this.skillRegistry.set(skillName, SkillClass);
  }
  
  // 添加技能
  addSkill(skill) {
    this.skills.push(skill);
  }
  
  // 移除技能
  removeSkill(skillName) {
    const index = this.skills.findIndex(skill => skill.name === skillName);
    if (index !== -1) {
      this.skills.splice(index, 1);
    }
  }
  
  // 获取技能
  getSkill(skillName) {
    return this.skills.find(skill => skill.name === skillName);
  }
  
  // 获取所有技能
  getAllSkills() {
    return this.skills;
  }
  
  // 冷却所有技能依次
  coldDownAllAllSkills() {
    this.skills.forEach(skill => skill.coldDown());
  }

  // 更新技能状态（确保Vue响应性）
  updateSkill(skill) {
    const index = this.skills.findIndex(s => s.name === skill.name);
    if (index !== -1) {
      // 创建新对象以确保Vue响应性，同时保持原型链
      const newSkill = Object.create(Object.getPrototypeOf(skill));
      Object.assign(newSkill, skill);
      this.skills.splice(index, 1, newSkill);
    }
  }
  
  // 创建技能实例
  static createSkill(skillName) {
    // 使用注册表创建技能实例
    const SkillClass = this.getInstance().skillRegistry.get(skillName);
    if (SkillClass) {
      return new SkillClass();
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
  static getRandomSkills(count, playerSkills = [], playerTier = 0) {
    const instance = this.getInstance();
    const allSkills = Array.from(instance.skillRegistry.entries()).map(([name, SkillClass]) => {
      // 创建临时实例以获取技能系列名称和等阶
      const tempSkill = new SkillClass();
      return {
        name: name,
        series: tempSkill.skillSeriesName,
        tier: tempSkill.tier,
        spawnWeight: tempSkill.spawnWeight
      };
    });
    
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
      
      if (tierDifference <= 0) {
        modifyFactor = 0.04;
      } if (tierDifference <= 1) {
        modifyFactor = 0.08;
      } else if (tierDifference === 2) {
        modifyFactor = 0.14;
      } else if (tierDifference === 3) {
        modifyFactor = 0.28;
      } else if (tierDifference === 4) {
        modifyFactor = 0.55;
      } else if (tierDifference === 5) {
        modifyFactor = 0.90;
      } else if (tierDifference > 7) {
        modifyFactor = 0.15;
      }  else if (tierDifference > 6) {
        modifyFactor = 0.40;
      } else if (tierDifference > 5) {
        modifyFactor = 0.70;
      }
      
      return {
        ...skill,
        weight: skill.spawnWeight * modifyFactor
      };
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