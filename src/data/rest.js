// rest.js - 休整阶段逻辑

import SkillManager from './skillManager.js'
import AbilityManager from './abilityManager.js'
import ItemManager from './itemManager.js'
import backendEventBus, { EventNames } from '../backendEventBus.js'
import { backendGameState as gameState } from './gameState.js'
import { getNextPlayerTier, upgradePlayerTier } from './player.js'
import { enqueueCardAnimation } from '../utils/animationHelpers.js'
import frontendEventBus from '../frontendEventBus.js'

export function spawnSkillRewards() {
  // 新技能奖励（抽3选1）
  let tier = gameState.player.tier;
  if(gameState.rewards.breakthrough) {
    const nextTier = getNextPlayerTier(tier);
    if(nextTier) tier = nextTier;
  }
  gameState.rewards.newSkills = SkillManager.getInstance().getRandomNewSkills(
    3, gameState.player.leino, gameState.player.cultivatedSkills, tier, true
  );
  // 升级候选（抽3个可升级项）
  gameState.rewards.upgradeSkills = SkillManager.getInstance().getRandomUpgradeSkills(
    3, gameState.player.cultivatedSkills, tier
  );
}

export function clearRewards() {
  gameState.rewards.money = 0;
  gameState.rewards.breakthrough = false;
  gameState.rewards.newSkills = [];
  gameState.rewards.upgradeSkills = [];
  gameState.rewards.abilities = [];
}

// 计算奖励
export function spawnRewards() {

  // 计算战斗奖励
  gameState.rewards.money = Math.floor(Math.random() * 20) + 10;

  // 突破奖励
  gameState.rewards.breakthrough = (
    gameState.battleCount === 2 || gameState.enemy.isBoss
  );

  // 总是生成技能奖励
  spawnSkillRewards();

  // boss / 奇数次战斗后获得能力奖励
  const haveAbilityReward = (
    gameState.battleCount % 2 === 1 || gameState.enemy.isBoss
  );
  if(haveAbilityReward) {
    gameState.rewards.abilities = AbilityManager.getInstance().getRandomAbilities(
      0, gameState.player.tier
    );
  } else {
    gameState.rewards.abilities = [];
  }
  // 生成商店物品
  refreshShopItems();
  
  // 发送事件
  backendEventBus.emit(EventNames.Rest.REWARDS_SPAWNED, gameState.rewards);
}

// 领取金钱奖励
export function claimMoney() {
  gameState.player.money += gameState.rewards.money;
  const amount = gameState.rewards.money;
  gameState.rewards.money = 0;
  // 阶段推进
  gotoNextRestStage();
  // 发送事件（已领取）
  backendEventBus.emit(EventNames.Player.MONEY_CLAIMED, amount);
}

// 领取技能奖励（新技能）
export function claimSkillReward(skillID, slotIndex, clearRewardsFlag) {
  if (!skillID) return;
  // 从 newSkills 中找
  const pool = Array.isArray(gameState.rewards.newSkills) ? gameState.rewards.newSkills : [];
  const skill = pool.find(s => s && s.uniqueID === skillID);
  if (!skill) {
    console.warn('尝试领取不存在的新技能奖励：', skillID);
    return;
  }

  // 入队飞行动画：卡牌飞向牌堆并淡出
  try {
    // 第一阶段：飞向牌堆
    const tag1 = enqueueCardAnimation(skill.uniqueID, {
      anchor: 'deck',
      to: { 
        scale: 0.55, 
        rotate: 18 
      },
      duration: 520,
      ease: 'power2.in'
    }, { waitTags: ['all'] });
    
    // 第二阶段：淡出
    enqueueCardAnimation(skill.uniqueID, {
      to: { opacity: 0 },
      duration: 120
    }, { waitTags: [tag1] });
    
    // 触发牌堆震动效果
    setTimeout(() => {
      try { frontendEventBus.emit('rest-deck-bump'); } catch (_) {}
    }, 640);
  } catch (_) {}

  // 计算可用容量
  const capacity = Math.min(gameState.player.maxSkills || 0, gameState.player.cultivatedSkills.length + 1);
  if (typeof slotIndex !== 'number' || slotIndex < 0) slotIndex = gameState.player.cultivatedSkills.length;
  if (slotIndex >= capacity) slotIndex = capacity - 1;
  // 放置/替换
  if(slotIndex >= gameState.player.cultivatedSkills.length) {
    gameState.player.cultivatedSkills.push(skill);
  } else {
    gameState.player.cultivatedSkills[slotIndex] = skill;
  }
  // 无论传入标志如何，都清空新技能奖励池，避免重复进入技能奖励阶段
  gameState.rewards.newSkills = [];
  gotoNextRestStage();
  backendEventBus.emit(EventNames.Player.SKILL_REWARD_CLAIMED, { skill: skill, slotIndex: slotIndex });
}

// 领取升级奖励（从3个可升级项中选1个进行升级替换）
export function claimUpgradeReward(skillID) {
  if (!skillID) return;
  const pool = Array.isArray(gameState.rewards.upgradeSkills) ? gameState.rewards.upgradeSkills : [];
  const upgraded = pool.find(s => s && s.uniqueID === skillID);
  if (!upgraded || !upgraded.isUpgradeCandidate || !upgraded.upgradedFrom) {
    console.warn('尝试领取无效的升级奖励：', skillID);
    return;
  }
  // 找到来源技能并替换
  const idx = gameState.player.cultivatedSkills.findIndex(s => s && s.name === upgraded.upgradedFrom);
  if (idx === -1) {
    console.warn('未找到升级来源技能：', upgraded.upgradedFrom);
    return;
  }
  const oldSkill = gameState.player.cultivatedSkills[idx];
  // 清理升级标记
  upgraded.isUpgradeCandidate = false;
  gameState.player.cultivatedSkills[idx] = upgraded;
  console.log(`技能升级：将 ${oldSkill.name} 升级为 ${upgraded.name}`);
  gotoNextRestStage();
  backendEventBus.emit(EventNames.Player.SKILL_REWARD_CLAIMED, { skill: upgraded, slotIndex: idx });
}

// 领取能力奖励
export function claimAbilityReward(ability, clearRewardsFlag) {
  // 领取能力奖励
  ability.apply(gameState.player);
  gameState.player.abilities.push(ability);
  if(clearRewardsFlag) {
    gameState.rewards.abilities = [];
  }
  // 阶段推进
  gotoNextRestStage();
  // 发送玩家领取能力奖励事件（已领取）
  backendEventBus.emit(EventNames.Player.ABILITY_CLAIMED, { ability: ability });
}

// 领取突破奖励
export function claimBreakthroughReward() {
  if (!gameState.rewards.breakthrough) return;
  gameState.rewards.breakthrough = false;
  upgradePlayerTier(gameState.player);
  // 阶段推进
  gotoNextRestStage();
  backendEventBus.emit(EventNames.Player.TIER_UPGRADED, gameState.player);
}


// 购买物品（后端结算）
export function purchaseItem(item) {
  if (!item) return false;
  if (gameState.player.money < item.price) return false;
  // 扣费并应用物品效果
  item.purchase(gameState.player);
  gameState.player.money -= item.price;
  // 通知UI
  backendEventBus.emit(EventNames.Shop.ITEM_PURCHASED, item);
  return true;
}

// 刷新商店物品
export function refreshShopItems() {
  const itemManager = new ItemManager();
  gameState.shopItems = itemManager.getRandomItems(3, gameState.player.tier);
  backendEventBus.emit(EventNames.Rest.SHOP_REFRESHED, gameState.shopItems);
}

export function reorderSkills(skillUniqueIDs) {
  // 根据传入的技能唯一ID数组，重新排序玩家的 cultivatedSkills
  const skills = gameState.player.cultivatedSkills || [];
  const reordered = skillUniqueIDs.map(id =>
    skills.find(skill => skill && skill.uniqueID === id) || null
  );
  gameState.player.cultivatedSkills = reordered;
  console.log('技能顺序已更新：', reordered);
  backendEventBus.emit(EventNames.Player.SKILLS_REORDERED, reordered);
}

function computeNextRestStage(currentStage = gameState.restScreenStage) {
  // 新顺序：money -> breakthrough -> skill(新技能) -> upgrade(升级) -> ability -> shop
  let availableStages = [];
  if (gameState.rewards.money > 0) availableStages.push('money');
  if (gameState.rewards.breakthrough) availableStages.push('breakthrough');
  if (Array.isArray(gameState.rewards.newSkills) && gameState.rewards.newSkills.length > 0) availableStages.push('skill');
  if (Array.isArray(gameState.rewards.upgradeSkills) && gameState.rewards.upgradeSkills.length > 0) availableStages.push('upgrade');
  if (Array.isArray(gameState.rewards.abilities) && gameState.rewards.abilities.length > 0) availableStages.push('ability');
  if (gameState.shopItems.length > 0) availableStages.push('shop');
  const currentIndex = availableStages.indexOf(currentStage);
  if (currentIndex === -1 || currentIndex === availableStages.length - 1) {
    return availableStages[0] || '';
  } else {
    return availableStages[currentIndex + 1];
  }
}

export function setInitialRestStage() {
  gameState.restScreenStage = computeNextRestStage();
}

export function gotoNextRestStage() {
  gameState.restScreenStage = computeNextRestStage();
}

export function dropCurrentReward(stage = gameState.restScreenStage) {
  // 放弃当前奖励：清空对应池并推进
  if (stage === 'skill') gameState.rewards.newSkills = [];
  else if (stage === 'upgrade') gameState.rewards.upgradeSkills = [];
  else if (stage === 'ability') gameState.rewards.abilities = [];
  else if (stage === 'money') gameState.rewards.money = 0;
  else if (stage === 'breakthrough') gameState.rewards.breakthrough = false;
  gotoNextRestStage();
}
