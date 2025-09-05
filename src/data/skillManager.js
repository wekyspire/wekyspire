import { PunchKick, RollPunch, Roll, Sleep, KungFu, FastThinking } from './skills/basic.js';
import { CarelessPunchKick, AmateurDefense, OverCarefulDefense,
  PrepareExercise, CarelessBravery, HoldOn } from './skills/basic.js';
import { Fireshot,Fireball, LargeFireball } from './skills/example.js';

import { ChargePunch, FireControlI, FloatingI, PurifyWeky,
   RockFormationI,
   SpeedThinking,
   StrengthenI, StrongPurifyWeky, SummonRemi, 
  TransformSword, 
  VeryWeakRecovery, WeakenI, WeakRecovery } from './skills/cMinus.js';

// 技能管理器类
class SkillManager {
  constructor() {
    this.skills = [];
    this.skillRegistry = new Map(); // 新增技能注册表
    
    // 初始化时注册预定义技能
    this.registerSkill(PunchKick);
    this.registerSkill(RollPunch);
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

    this.registerSkill(FastThinking);

    this.registerSkill(PurifyWeky);
    this.registerSkill(StrongPurifyWeky);
    this.registerSkill(VeryWeakRecovery);
    this.registerSkill(WeakRecovery);
    this.registerSkill(ChargePunch);
    this.registerSkill(StrengthenI);
    this.registerSkill(WeakenI);
    this.registerSkill(FireControlI);
    this.registerSkill(SummonRemi);
    this.registerSkill(TransformSword);
    this.registerSkill(FloatingI);
    this.registerSkill(RockFormationI);
    this.registerSkill(SpeedThinking);
  }
  
  // 注册技能
  registerSkill(SkillClass) {
    const skillName = (new SkillClass()).name;
    this.skillRegistry.set(skillName, SkillClass);
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
      
      return {
        ...skill,
        weight: skill.spawnWeight * modifyFactor
      };
    });
    // 减少已获得技能的出现权重（x0.3）
    weightedSkills.forEach(skill => {
      if (playerSkills.some(playerSkill => playerSkill.name === skill.name)) {
        skill.weight *= 0.3;
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