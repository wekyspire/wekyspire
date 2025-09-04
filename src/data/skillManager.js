import { PunchKick, Roll, Sleep, KungFu } from './skills/basic.js';
import { Fireshot,Fireball, LargeFireball } from './skills/example.js';

// 技能管理器类
class SkillManager {
  constructor() {
    this.skills = [];
    this.skillRegistry = new Map(); // 新增技能注册表
    
    // 初始化时注册预定义技能
    this.registerSkill('拳打脚踢', PunchKick);
    this.registerSkill('打滚', Roll);
    this.registerSkill('睡觉', Sleep);
    this.registerSkill('功夫', KungFu);
    this.registerSkill('火弹术', Fireshot);
    this.registerSkill('火球术', Fireball);
    this.registerSkill('大火球术', LargeFireball);
  }
  
  // 注册技能
  registerSkill(skillName, SkillClass) {
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
  
  // 重置所有技能的使用次数
  resetAllSkillUses() {
    this.skills.forEach(skill => skill.resetUses());
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
  static getRandomSkills(count, playerSkills = []) {
    const instance = this.getInstance();
    const allSkills = Array.from(instance.skillRegistry.entries()).map(([name, SkillClass]) => {
      // 创建临时实例以获取技能系列名称
      const tempSkill = new SkillClass();
      return {
        name: name,
        series: tempSkill.skillSeriesName
      };
    });
    
    // 获取玩家已有的技能系列
    const playerSkillSeries = playerSkills.map(skill => skill.skillSeriesName);
    
    // 过滤掉玩家已有的技能和同系列的技能
    const availableSkills = allSkills.filter(skill => 
      !playerSkills.some(playerSkill => playerSkill.name === skill.name) &&
      !playerSkillSeries.includes(skill.series)
    );
    
    const selectedSkills = [];
    
    // 确保不会选择超过可用技能数量的技能
    const actualCount = Math.min(count, availableSkills.length);
    
    // 随机选择技能
    for (let i = 0; i < actualCount; i++) {
      const randomIndex = Math.floor(Math.random() * availableSkills.length);
      const skillInfo = availableSkills[randomIndex];
      // console.log('Creating skill with name:', skillInfo.name);
      const skill = this.createSkill(skillInfo.name);
      // console.log('Created skill object:', skill);
      selectedSkills.push(skill);
      
      // 从可用技能中移除已选择的技能
      availableSkills.splice(randomIndex, 1);
    }
    
    // console.log('Selected skills:', selectedSkills);
    return selectedSkills;
  }
}

export default SkillManager;