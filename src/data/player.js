import SkillManager from './skillManager.js'
import eventBus from '../eventBus.js'
import { processStartOfTurnEffects, processEndOfTurnEffects, processSkillActivationEffects, processDamageTakenEffects, processDamageDealtEffects, processPostAttackEffects } from './effectProcessor.js'
import EnemyFactory from './enemyFactory.js'
import AbilityManager from './abilityManager.js'
import ItemManager from './itemManager.js'

export function upgradePlayerTier (player) {
  const tierUpgrades = { 0: 2, 2: 3, 3: 5, 5: 7, 7: 8, 8: 9 };
  if (tierUpgrades[player.tier] !== undefined) {
    player.tier = tierUpgrades[player.tier];
    player.maxMana += 1;
    if(player.tier == 2) {
      // 特殊：第一次升级时多获得一点魏启
      player.maxMana += 1;
    }
    if(player.maxActionPoints < 8) {
      player.maxActionPoints ++;
    }
    player.hp = player.maxHp;
    player.mana = player.maxMana;
    eventBus.emit('player-tier-upgraded', player);
    return true;
  }
  return false;
}

export function getPlayerTierFromTierIndex(tierIndex) {
  const tiers = [
    {tier: 0, name: '见习灵御'},
    {tier: 2, name: '普通灵御'},
    {tier: 3, name: '准高级灵御'},
    {tier: 5, name: '高级灵御'},
    {tier: 7, name: '准大师灵御'},
    {tier: 8, name: '大师灵御'},
    {tier: 9, name: '传奇灵御'}
  ];
  return tiers[tierIndex];
}

// 玩家数据类
export class Player {
  constructor() {
    this.type = 'player';
    this.name = "你";
    this.hp = 40;
    this.shield = 0;
    this.maxHp = 40;
    this.mana = 0;
    this.maxMana = 0;
    this.baseAttack = 0;
    this.baseMagic = 1;
    this.baseDefense = 0;
    this.remainingActionPoints = 3;
    this.maxActionPoints = 3; // 行动点初始为3
    this.money = 0;
    this.tier = 0; // 等阶
    this.skillSlots = Array(8).fill(null); // 技能槽，这是一个养成概念，和战斗无关。玩家可以在技能槽内保存技能。战斗开始时，从技能槽中保存的技能创建skills，作为玩家在战场上的技能。
    this.skills = []; // 场上技能。skills仅在战斗时有效，用于存储当前战斗中玩家拥有的技能。在战斗开始前由skillSlots生成，在战斗结束后清空。
    this.frontierSkills = []; // 前台技能列表，玩家在当前回合可以使用的技能
    this.backupSkills = []; // 后备技能列表，用于存储暂时不可用的技能
    this.maxFrontierSkills = 4; // 最大前台技能数量
    this.effects = {}; // 效果列表，由一个 效果名称->效果层数 的词典组成。
    // SkillManager仅用于创建技能和保留技能模板，玩家拥有的技能保存在skillSlots内。
    this.skillManager = SkillManager.getInstance();
  }
  
  // 应用治疗
  applyHeal(heal) {
    if (heal > 0) {
      this.hp += heal;
      this.hp = Math.min(this.hp, this.maxHp);
    }
  }
  
  // 计算属性
  get attack() {
    return this.baseAttack + (this.effects['力量'] || 0);
  }

  get agility() {
    return (this.effects['敏捷'] || 0)
  }
  
  get magic() {
    return this.baseMagic + (this.effects['集中'] || 0);
  }
  
  get defense() {
    return this.baseDefense + (this.effects['坚固'] || 0);
  }

  // 随机移除stacks层效果
  removeEffects(stacks) {
    const effectNames = Object.keys(this.effects);
    for (let i = 0; i < stacks; i++) {
      if (effectNames.length === 0) break;
      const randomIndex = Math.floor(Math.random() * effectNames.length);
      const effectName = effectNames[randomIndex];
      this.removeEffect(effectName, 1);
      // 如果效果层数为0，移除效果名称
      if (!this.effects[effectName]) {
        effectNames.splice(randomIndex, 1);
      }
    }
  }

  // 随机移除负面效果
  // mode: 'random' 随机移除, 'highest-stack' 优先层数最高的
  // 'highest-stack-kind' 种类移除，优先层数最高种类
  // 'ramdom-kind' 种类移除，随机种类
  removeNegativeEffets(count, mode = 'random') {
    // TODO
  }
  
  // 添加效果方法
  addEffect(effectName, stacks = 1) {
    if(stacks == 0) return ;
    const previousStacks = this.effects[effectName] || 0;
    if (this.effects[effectName]) {
      this.effects[effectName] += stacks;
    } else {
      this.effects[effectName] = stacks;
    }
    // 触发效果变化事件
    eventBus.emit('effect-change', {
      target: this,
      effectName: effectName,
      deltaStacks: stacks,
      currStacks: this.effects[effectName] || 0,
      previosStacks: previousStacks
    });
  }
  
  // 移除效果方法
  removeEffect(effectName, stacks = 1) {
    this.addEffect(effectName, -stacks);
  }

  clearNegativeEffects () {
    // TODO
  }

  consumeActionPoints (amount) {
    this.remainingActionPoints -= amount;
    this.remainingActionPoints = Math.max(this.remainingActionPoints, 0);
  }

  consumeMana (amount) {
    this.mana -= amount;
    this.mana = Math.max(this.mana, 0);
    this.mana = Math.min(this.mana, this.maxMana);
  }
}

// 导出玩家管理器
export class PlayerManager {
  static getInstance() {
    if (!PlayerManager.instance) {
      PlayerManager.instance = new PlayerManager();
    }
    return PlayerManager.instance;
  }
  
  constructor() {
    this.player = new Player();
  }
  
  getPlayer() {
    return this.player;
  }
  
  resetPlayer() {
    this.player = new Player();
    return this.player;
  }
}