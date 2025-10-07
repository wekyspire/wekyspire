import backendEventBus, { EventNames } from '../backendEventBus.js'
import Unit from './unit.js'

export function getNextPlayerTier(playerTier) {
  const tierUpgrades = { 0: 1, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9 };
  return tierUpgrades[playerTier];
}

export function upgradePlayerTier (player) {
  const nextTier = getNextPlayerTier(player.tier);
  if (nextTier !== undefined) {
    player.tier = nextTier;
    player.maxMana += 1;
    if (player.tier === 1) {
      // 特殊：第一次升级时多获得一点魏启
      player.maxMana += 1;
    }
    if (player.maxActionPoints < 8) {
      player.maxActionPoints++;
    }
  }
  player.hp = player.maxHp;
  player.mana = player.maxMana;
  backendEventBus.emit(EventNames.Player.TIER_UPGRADED, player);
  return true;
}

export function getPlayerTierFromTierIndex(tierIndex) {
  const tiers = [
    {tier: 0, name: '旅人'},
    {tier: 1, name: '见习灵御'},
    {tier: 2, name: '普通灵御'},
    {tier: 3, name: '中级灵御'},
    {tier: 4, name: '资深灵御'},
    {tier: 5, name: '高级灵御'},
    {tier: 6, name: '准大师灵御'},
    {tier: 7, name: '大师灵御', subtitle: '古往今来，灵御协会所能给出的最高认可'},
    {tier: 8, name: '一代宗师', subtitle: '和独开一代的宗师们并肩而立'},
    {tier: 9, name: '传奇', subtitle: '即便肉身消陨，你的名字也会回荡于传说之中'}
  ];
  return tiers[tierIndex];
}

// 为属性修正系统提供一个便捷的工厂：创建一个“叠加型”的玩家属性修正器
// - 接受一个包含 attack/defense/magic 修正函数的对象
// - 每个函数形如 (baseValue, currentPlayer) => number
// - 返回一个 (player) => wrappedPlayer 的修正器
export function createPlayerStatModifier({ attack, defense, magic } = {}) {
  return function(player) {
    // 仅覆盖需要的 getter；不改变 hp/effects 等引用
    return new Proxy(player, {
      // 仅覆盖需要修改的只读属性，其他全部透传
      get(target, prop, receiver) {
        if (prop === 'attack') {
          const base = Reflect.get(target, 'attack', receiver);
          return typeof attack === 'function' ? attack(base, receiver) : base;
        }
        if (prop === 'defense') {
          const base = Reflect.get(target, 'defense', receiver);
          return typeof defense === 'function' ? defense(base, receiver) : base;
        }
        if (prop === 'magic') {
          const base = Reflect.get(target, 'magic', receiver);
          return typeof magic === 'function' ? magic(base, receiver) : base;
        }
        return Reflect.get(target, prop, receiver);
      }
      // 不提供 set 拦截，保持写入直达底层对象（hp/effects 数据链接不变）
    });
  }
}

// 玩家数据类
export class Player extends Unit {
  constructor() {
    super();
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
    // 技能养成：玩家拥有的总技能上限与顺序（替代 skillSlots）
    this.maxSkills = 20; // 玩家拥有的总技能上限
    this.cultivatedSkills = []; // 已培养技能（顺序即为战斗中的默认顺序）
    // 场上技能与战斗列表
    this.skills = []; // 初始场上技能。在战斗开始前由 cultivatedSkills 深拷贝生成，在战斗结束后清空。
    this.frontierSkills = []; // 前台技能列表，玩家在当前回合可以使用的技能
    this.backupSkills = []; // 后备技能列表，用于存储暂时不可用的技能
    this.burntSkills = []; // 坟地技能列表，存放被焚毁的技能（战斗中完全消耗掉的技能）
    this.maxFrontierSkills = 10; // 最大前台技能数量
    this.drawFrontierSkills = 4; // 每回合抽取前台技能数量
    // effects 由 Unit 初始化
    this.leino = ['normal']; // 灵脉列表，可以包含normal, fire, wind, wood, earth, water, thunder, light, dark
    this.abilities = []; // 玩家能力列表

    this.uniqueID = 'playeruniqueid'; // 玩家唯一ID（用于动画同步等）

    // 属性修正器管线（按顺序应用）
    this.modifiers = [];

    // 咏唱位：当前激活的咏唱型技能
    this.activatedSkills = [];
    this.maxActivatedSkills = 1; // 默认一个咏唱位
  }

  // 计算属性
  // attack/magic 继承自 Unit

  get agility() {
    return (this.effects['敏捷'] || 0);
  }

  // 属性修正系统 API
  addModifier(modifierFn) {
    if (typeof modifierFn === 'function') this.modifiers.push(modifierFn);
    else console.warn('尝试添加非法的属性修正器：应为 function(player)=>player');
  }
  removeModifier(modifierFn) {
    this.modifiers = this.modifiers.filter(m => m !== modifierFn);
  }
  clearModifiers() {
    this.modifiers = [];
  }

  // 获取顺序应用所有修正器后的“修正玩家对象”。
  // 注意：返回值通常是一个 Proxy，hp/effects 等数据链接保持为原对象引用；
  // 仅 attack/defense/magic 等只读计算属性会被覆盖为修正后的值。
  getModifiedPlayer() {
    // 无修正器时，直接返回自身，避免不必要的包装
    if (!this.modifiers || this.modifiers.length === 0) return this;
    let current = this;
    for (const mod of this.modifiers) {
      try {
        const next = mod(current);
        // 允许修正器返回空以“跳过”
        if (next) current = next;
      } catch (e) {
        console.warn('应用属性修正器时发生错误，已跳过：', e);
      }
    }
    return current;
  }

  canDropFirstSkill() {
    return this.frontierSkills.length > 0 && this.remainingActionPoints > 0;
  }

  addBackupSkill (skill) {
    this.backupSkills.push(skill);
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

  gainMana (amount) {
    this.mana += amount;
    this.mana = Math.max(this.mana, 0);
    this.mana = Math.min(this.mana, this.maxMana);
  }

  gainActionPoint (amount) {
    this.remainingActionPoints += amount;
    this.remainingActionPoints = Math.min(this.remainingActionPoints, this.maxActionPoints);
  }

  hasAbility (abilityName) {
    return this.abilities.some(ability => ability.name === abilityName);
  }

  hasFreeActivatedSlot() { return this.activatedSkills.length < this.maxActivatedSkills; }
  getFirstActivatedSkill() { return this.activatedSkills[0] || null; }
}