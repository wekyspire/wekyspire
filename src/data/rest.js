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
  // 技能奖励
  let tier = gameState.player.tier;
  // 如果已经生成了突破奖励，那么生成技能奖励时奖励提升
  if(gameState.rewards.breakthrough) {
    const nextTier = getNextPlayerTier(tier);
    if(nextTier) tier = nextTier;
  }
  gameState.rewards.skills = SkillManager.getInstance().getRandomSkills(
    4, gameState.player.leino, gameState.player.cultivatedSkills, tier, true // 生成高质量奖励
  );
}

export function clearRewards() {
  gameState.rewards.money = 0;
  gameState.rewards.breakthrough = false;
  gameState.rewards.skills = [];
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

// 领取技能奖励
export function claimSkillReward(skillID, slotIndex, clearRewardsFlag) {
  if (!skillID) return;
  const skill = gameState.rewards.skills.find(s => s && s.uniqueID === skillID);
  // 技能不存在或已被领取
  if (!skill) {
    console.warn('尝试领取不存在的技能奖励：', skillID);
    return;
  }
  // 移除upgrade标签
  skill.isUpgradeCandidate = false;
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

  // 如果是升级候选，优先自动查找原技能并替换其槽位
  if (skill.isUpgradeCandidate && skill.upgradedFrom) {
    const idx = gameState.player.cultivatedSkills.findIndex(s => s && s.name === skill.upgradedFrom);
    if (idx !== -1) {
      slotIndex = idx; // 强制替换
    }
  }

  // 计算可用容量（最多 maxSkills 个）
  const capacity = Math.min(gameState.player.maxSkills || 0, gameState.player.cultivatedSkills.length + 1);
  if (typeof slotIndex !== 'number' || slotIndex < 0) slotIndex = gameState.player.cultivatedSkills.length;
  if (slotIndex >= capacity) slotIndex = capacity - 1;

  console.log('领取技能奖励：', skill, '放置于槽位', slotIndex, '（容量', capacity, '）');
  // 放置/替换技能
  if(slotIndex >= gameState.player.cultivatedSkills.length) {
    gameState.player.cultivatedSkills.push(skill);
  } else {
    gameState.player.cultivatedSkills[slotIndex] = skill;
  }

  if(clearRewardsFlag) {
    // 领取一个技能后，清空剩余技能奖励（仅允许领取一次）
    gameState.rewards.skills = [];
  }
  // 阶段推进
  gotoNextRestStage();

  // 发送事件（统一为 Player.SKILL_REWARD_CLAIMED）
  backendEventBus.emit(EventNames.Player.SKILL_REWARD_CLAIMED, { skill: skill, slotIndex: slotIndex });
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
  // 按顺序：money -> breakthrough -> skill -> ability -> shop
  let availableStages = [];
  if (gameState.rewards.money > 0) availableStages.push('money');
  if (gameState.rewards.breakthrough) availableStages.push('breakthrough');
  if (Array.isArray(gameState.rewards.skills) && gameState.rewards.skills.length > 0) availableStages.push('skill');
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
  gotoNextRestStage();
}
