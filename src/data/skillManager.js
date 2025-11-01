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
      await import('./skills/martial_arts/dissect/block.js'),
      await import('./skills/martial_arts/dissect/breakingMove.js'),
      await import('./skills/martial_arts/dissect/martialArtPose.js'),
      await import('./skills/martial_arts/dissect/preciseDissect.js'),
      await import('./skills/martial_arts/punch/agilePunch.js'),
      await import('./skills/martial_arts/punch/fastPunch.js'),
      await import('./skills/martial_arts/punch/onePunch.js'),
      await import('./skills/martial_arts/punch/peakMartialArt.js'),
      await import('./skills/martial_arts/punch/punch.js'),
      await import('./skills/martial_arts/punch/shapelessPunch.js'),
      await import('./skills/martial_arts/punch/taiji.js'),
      await import('./skills/martial_arts/slash/breathing.js'),
      await import('./skills/martial_arts/slash/flyingDagger'),
      await import('./skills/martial_arts/slash/knifeBackStrike.js'),
      await import('./skills/martial_arts/slash/machete.js'),
      await import('./skills/martial_arts/slash/pullBlade.js'),
      await import('./skills/martial_arts/slash/roundSlash.js'),
      await import('./skills/martial_arts/slash/slash.js'),
      await import('./skills/martial_arts/slash/storeEdge.js'),
      await import('./skills/martial_arts/slash/bladeKeeper.js'),
      await import('./skills/martial_arts/slash/annihilate.js'),
      await import('./skills/martial_arts/heavySmash.js'),
      await import('./skills/martial_arts/misc.js'),
      await import('./skills/martial_arts/shielding.js'),
      await import('./skills/martial_arts/transcendence.js'),
      await import('./skills/martial_arts/slash/sharpenBlade.js'),
      // await import('./skills/blast.js'),
      // await import('./skills/cMinus.js'),
      // await import('./skills/concentration.js'),
      // await import('./skills/fireAssist.js'),
      // await import('./skills/fireControl.js'),
      // await import('./skills/heal.js'),
      // await import('./skills/levitation.js'),
      // await import('./skills/punchKicks.js'),
      // await import('./skills/refuelWeky.js'),
      // await import('./skills/shielding.js'),
      // await import('./skills/speedThinking.js'),
      // await import('./skills/curses.js'),
      // await import('./skills/matialArts')
      // await import('./skills/remi.js'),
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
  getRandomSkills(count, playerLeino= {}, playerSkillSlots = [], playerTier = 0, bestQuality = false) {
    // ---- 收集所有技能的元数据（扩展: precessor, leinoModifiers） ----
    const allSkills = Array.from(this.skillRegistry.entries()).map(([name, SkillClass]) => {
      const tempSkill = new SkillClass();
      return {
        name: name,
        type: tempSkill.type,
        series: tempSkill.skillSeriesName,
        tier: tempSkill.tier,
        canSpawnAsReward_: tempSkill.canSpawnAsReward_,
        spawnWeight: tempSkill.spawnWeight,
        precessor: tempSkill.precessor, // 可能是字符串 / 数组 / null
        leinoModifiers: tempSkill.leinoModifiers // 可能是字符串 / 数组 / null
      };
    });

    const playerNonEmptySkillSlots = playerSkillSlots.filter(skill => skill !== null);
    const playerSkills = playerNonEmptySkillSlots.map(slot => slot);
    // console.log(playerSkills);

    // 获取玩家已有的技能系列
    const playerSkillSeries = playerSkills.map(skill => skill.skillSeriesName);
    const playerSkillNames = playerSkills.map(skill => skill.name);

    // 过滤掉不可生成为奖励的技能，有前置技能的技能，以及等阶大于玩家等阶的技能
    const baseAvailableSkills = allSkills.filter(skill =>
      skill.tier <= playerTier &&
      skill.canSpawnAsReward_ &&
      skill.precessor === null && // 只能是自由出现的技能
      skill.tier >= 0 // 不能是（-1）特殊卡
    );

    // —— 新升级候选逻辑：根据 precessor 反向推导 ——
    // precessor: 表示此技能的前置技能（或前置技能数组）。如果玩家拥有前置技能，则该技能加入奖池
    const upgradeCandidates = [];
    for (const meta of allSkills) {
      if (playerSkillNames.includes(meta.name)) continue; // 已拥有不加入
      if (meta.tier > playerTier) continue; // 等阶限制（保持与旧逻辑一致）
      if (!meta.precessor) continue; // 没有前置技能

      let matchedSource = null;
      if (Array.isArray(meta.precessor)) {
        matchedSource = meta.precessor.find(p => playerSkillNames.includes(p)) || null;
      } else if (typeof meta.precessor === 'string') {
        matchedSource = playerSkillNames.includes(meta.precessor) ? meta.precessor : null;
      }
      if (!matchedSource) continue; // 玩家没有其任意前置技能

      // 避免重复添加（如果之前 baseAvailable 已包含则跳过）
      if (baseAvailableSkills.some(s => s.name === meta.name)) continue;

      upgradeCandidates.push({ ...meta, isUpgradeCandidate: true, upgradedFrom: matchedSource });
    }

    // 合并（升级候选可以绕过“同系列排除”限制）
    const availableSkills = [...baseAvailableSkills];
    for (const u of upgradeCandidates) {
      if (!availableSkills.some(s => s.name === u.name)) availableSkills.push(u);
    }

    // 计算每个技能的出现权重
    const weightedSkills = availableSkills.map(skill => {
      const tierDifference = playerTier - skill.tier;
      let modifyFactor = 1;

      // 高等级技能出现权重降低
      if (skill.tier >= 8) modifyFactor *= 0.7;
      if (skill.tier >= 5) modifyFactor *= 0.8;

      // 等级太低的技能出现权重大幅降低
      if (tierDifference > 7) {
        modifyFactor = 0.15;
      }  else if (tierDifference > 6) {
        modifyFactor = 0.40;
      } else if (tierDifference > 5) {
        modifyFactor = 0.70;
      }

      // 高质量奖励中，贴近玩家等级上限技能概率大幅提升
      if(bestQuality && tierDifference < 1) modifyFactor *= 5;
      if(bestQuality && tierDifference < 2) modifyFactor *= 3;

      // 基础：技能主类型与玩家灵脉的耦合权重
      {
        let leinoFactor = Math.max(playerLeino[skill.type] || 0.2, 0); // 没有该属性时，给予一个较低的基础值
        if (skill.type === 'normal') leinoFactor = Math.max(leinoFactor, 1); // 普通技能（非灵御技能）至少保证有 1 倍权重
        modifyFactor *= leinoFactor;
      }

      // 新增：leinoModifiers 进一步影响（表示此卡受多种灵脉影响）
      if (skill.leinoModifiers) {
        const list = Array.isArray(skill.leinoModifiers) ? skill.leinoModifiers : [skill.leinoModifiers];
        // 采用 “平均值” 模型，避免多元素乘积导致爆炸或极端衰减
        const factors = list.map(key => {
          const v = playerLeino[key];
            // 若玩家该灵脉因子缺失，则视为 1（中性，不放大不缩小）
          return (typeof v === 'number' && v > 0) ? v : 1;
        });
        if (factors.length > 0) {
          const avg = factors.reduce((a,b)=>a+b,0) / factors.length;
          modifyFactor *= avg;
        }
      }

      // 升级候选技能稍微再提升一点（避免被其它随机权重稀释）
      if(skill.isUpgradeCandidate) modifyFactor *= 2;

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
      
      // 如果没有权重可供选择，提前跳出
      if(totalWeight <= 0) break;

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
      if(skillInfo.isUpgradeCandidate) {
        skill.isUpgradeCandidate = true; // 标记（目前 UI 未使用或用于展示）
        if(skillInfo.upgradedFrom) skill.upgradedFrom = skillInfo.upgradedFrom; // 记录来源技能名称
      }
      selectedSkills.push(skill);
      
      // 从可选技能中移除已选择的技能
      weightedSkills.splice(selectedIndex, 1);
    }
    
    return selectedSkills;
  }

  // 新增：仅获取“新技能”奖励（不含升级候选）
  getRandomNewSkills(count, playerLeino = {}, playerSkillSlots = [], playerTier = 0, bestQuality = false) {
    const allSkills = Array.from(this.skillRegistry.entries()).map(([name, SkillClass]) => {
      const tempSkill = new SkillClass();
      return {
        name,
        type: tempSkill.type,
        series: tempSkill.skillSeriesName,
        tier: tempSkill.tier,
        canSpawnAsReward_: tempSkill.canSpawnAsReward_,
        spawnWeight: tempSkill.spawnWeight,
        precessor: tempSkill.precessor,
        leinoModifiers: tempSkill.leinoModifiers
      };
    });
    const playerNonEmptySkillSlots = playerSkillSlots.filter(skill => skill !== null);
    const playerSkills = playerNonEmptySkillSlots.map(slot => slot);

    // 只保留“新技能”
    const baseAvailable = allSkills.filter(meta =>
      meta.tier <= playerTier && meta.canSpawnAsReward_ && meta.precessor === null && meta.tier >= 0
    );

    // 权重
    const weighted = baseAvailable.map(skill => {
      const tierDifference = playerTier - skill.tier;
      let modifyFactor = 1;
      if (skill.tier >= 8) modifyFactor *= 0.7;
      if (skill.tier >= 5) modifyFactor *= 0.8;
      if (tierDifference > 7) modifyFactor = 0.15;
      else if (tierDifference > 6) modifyFactor = 0.40;
      else if (tierDifference > 5) modifyFactor = 0.70;
      if (bestQuality && tierDifference < 1) modifyFactor *= 5;
      if (bestQuality && tierDifference < 2) modifyFactor *= 3;
      // leino 主属性
      let leinoFactor = Math.max(playerLeino[skill.type] || 0.2, 0);
      if (skill.type === 'normal') leinoFactor = Math.max(leinoFactor, 1);
      modifyFactor *= leinoFactor;
      // leino 修饰符
      if (skill.leinoModifiers) {
        const list = Array.isArray(skill.leinoModifiers) ? skill.leinoModifiers : [skill.leinoModifiers];
        const factors = list.map(key => {
          const v = playerLeino[key];
          return (typeof v === 'number' && v > 0) ? v : 1;
        });
        if (factors.length > 0) {
          const avg = factors.reduce((a,b)=>a+b,0) / factors.length;
          modifyFactor *= avg;
        }
      }
      return { ...skill, weight: skill.spawnWeight * modifyFactor };
    });

    const selected = [];
    const actualCount = Math.min(count, weighted.length);
    const pool = [...weighted];
    for (let i = 0; i < actualCount; i++) {
      const totalWeight = pool.reduce((sum, s) => sum + s.weight, 0);
      if (totalWeight <= 0) break;
      const r = Math.random() * totalWeight;
      let acc = 0, idx = 0;
      for (let j = 0; j < pool.length; j++) { acc += pool[j].weight; if (r <= acc) { idx = j; break; } }
      const skillInfo = pool[idx];
      const inst = this.createSkill(skillInfo.name);
      selected.push(inst);
      pool.splice(idx, 1);
    }
    return selected;
  }

  // 新增：仅获取“升级候选”奖励（基于玩家已有技能，返回升级后的新卡）
  getRandomUpgradeSkills(count, playerSkills = [], playerTier = 0) {
    const allSkills = Array.from(this.skillRegistry.entries()).map(([name, SkillClass]) => {
      const tempSkill = new SkillClass();
      return {
        name,
        type: tempSkill.type,
        series: tempSkill.skillSeriesName,
        tier: tempSkill.tier,
        canSpawnAsReward_: tempSkill.canSpawnAsReward_,
        spawnWeight: tempSkill.spawnWeight,
        precessor: tempSkill.precessor,
        leinoModifiers: tempSkill.leinoModifiers
      };
    });
    const playerNames = (playerSkills || []).map(s => s && s.name).filter(Boolean);

    // 收集升级候选
    const upgrades = [];
    for (const meta of allSkills) {
      if (playerNames.includes(meta.name)) continue;
      if (meta.tier > playerTier) continue;
      if (!meta.precessor) continue;
      let matched = null;
      if (Array.isArray(meta.precessor)) {
        matched = meta.precessor.find(p => playerNames.includes(p)) || null;
      } else if (typeof meta.precessor === 'string') {
        matched = playerNames.includes(meta.precessor) ? meta.precessor : null;
      }
      if (!matched) continue;
      upgrades.push({ ...meta, isUpgradeCandidate: true, upgradedFrom: matched });
    }
    if (upgrades.length === 0) return [];

    // 简单按 spawnWeight 抽取（可追加更多加权规则）
    const weighted = upgrades.map(s => ({ ...s, weight: (s.spawnWeight || 1) * 2 }));
    const selected = [];
    const pool = [...weighted];
    const actual = Math.min(count, pool.length);
    for (let i = 0; i < actual; i++) {
      const total = pool.reduce((sum, s) => sum + s.weight, 0);
      if (total <= 0) break;
      const r = Math.random() * total;
      let idx = 0, acc = 0;
      for (let j = 0; j < pool.length; j++) { acc += pool[j].weight; if (r <= acc) { idx = j; break; } }
      const info = pool[idx];
      const inst = this.createSkill(info.name);
      // 标记升级元信息（供后续自动替换槽位）
      inst.isUpgradeCandidate = true;
      inst.upgradedFrom = info.upgradedFrom;
      selected.push(inst);
      pool.splice(idx, 1);
    }
    return selected;
  }
}

export default SkillManager;
