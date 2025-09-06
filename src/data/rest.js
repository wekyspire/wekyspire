// rest.js - 休整阶段逻辑

import SkillManager from './skillManager.js'
import AbilityManager from './abilityManager.js'
import ItemManager from './itemManager.js'
import { upgradePlayerTier } from './player.js'
import eventBus from '../eventBus.js'
import gameState from './gameState.js'

// 计算奖励
export function calculateRewards() {
  // 计算战斗奖励
  gameState.rewards.money = Math.floor(Math.random() * 20) + 10;
  gameState.rewards.skill = true;
  
  // boss / 奇数次战斗后获得能力奖励
  gameState.rewards.ability = (gameState.battleCount % 2 === 1 || gameState.enemy.isBoss);
}

// 领取金钱奖励
export function claimMoney() {
  gameState.player.money += gameState.rewards.money;
  gameState.rewards.money = 0;
}

// 显示能力奖励
export function showAbilityRewards() {
  // 检查能力奖励是否已经被领取过
  if (gameState.abilityRewardClaimed) {
    return;
  }
  // 显示能力奖励面板
  gameState.isAbilityRewardVisible = true;
  // 生成随机能力，根据战斗次数计算abundance值
  let abundance = Math.min(1.0, Math.min(gameState.battleCount * 0.05, 0.5));
  if(gameState.enemy.isBoss) abundance += 0.5;
  gameState.abilityRewards = gameState.player.abilityManager.getRandomAbilities(3, abundance);
  // 如果是boss战，直接提升灵御等阶。
  if(gameState.enemy.isBoss) {
    upgradePlayerTier(gameState.player);
  }
  // 标记能力奖励已显示
  gameState.abilityRewardClaimed = true;
}

// 领取能力奖励
export function claimAbility(ability) {
  // 领取能力奖励
  ability.apply(gameState.player);
  gameState.rewards.ability = false;
  gameState.isAbilityRewardVisible = false;
  gameState.battleLogs.push(`获得了能力：${ability.name}`);
  // 发射玩家领取能力奖励事件
  eventBus.emit('player-claim-ability', { ability: ability });
}

// 关闭能力奖励面板
export function closeAbilityRewards() {
  // 关闭能力奖励面板
  gameState.isAbilityRewardVisible = false;
  gameState.rewards.ability = false;
}

// 显示技能奖励
export function showSkillRewards() {
  // 检查技能奖励是否已经被领取过
  if (gameState.skillRewardClaimed) {
    return;
  }
  
  // 显示技能奖励面板
  gameState.isSkillRewardVisible = true;
  // 生成随机技能，排除玩家已有的技能和同系列的技能
  console.log('Generating skill rewards...');
  gameState.skillRewards = SkillManager.getRandomSkills(3, gameState.player.skillSlots, gameState.player.tier);
  console.log('Generated skill rewards:', gameState.skillRewards);
  // 标记技能奖励已显示
  gameState.skillRewardClaimed = true;
}

// 当玩家在技能奖励面板选择技能时调用
export function onSelectSkillForSlot(skill) {
  gameState.selectedSkillForSlot = skill;
  gameState.isSkillRewardVisible = false;
  gameState.isSkillSlotSelectionVisible = true;
}

// 安装技能到指定技能槽
export function installSkillToSlot(slotIndex, skill) {
  // 检查技能是否已存在于技能槽中
  const existingSkillIndex = gameState.player.skillSlots.findIndex(s => s && s.name === skill.name);
  if (existingSkillIndex !== -1) {
    console.warn('Skill already exists in skill slot:', skill.name);
    // 可以选择不添加重复技能
    // return;
  }
  
  // 移除旧技能（如果存在）
  const oldSkill = gameState.player.skillSlots[slotIndex];
  // 啥都不用干，扔了就是。
  
  // 安装新技能
  const newSkill = SkillManager.createSkill(skill.name);
  gameState.player.skillSlots[slotIndex] = newSkill;
  
  gameState.rewards.skill = false;
  gameState.isSkillSlotSelectionVisible = false;
  gameState.battleLogs.push(`获得了技能：${skill.name}`);
  // 发射玩家领取技能奖励事件
  eventBus.emit('player-claim-skill', { skill: skill, slotIndex: slotIndex });
}

// 关闭技能槽选择面板
export function closeSkillSlotSelection() {
  gameState.isSkillSlotSelectionVisible = false;
  gameState.selectedSkillForSlot = null;
}

// 关闭技能奖励面板
export function closeSkillRewards() {
  // 关闭技能奖励面板
  gameState.isSkillRewardVisible = false;
  gameState.rewards.skill = false;
}

// 结束休整阶段
export function endRest() {
  // 检查是否完成第15场战斗
  if (gameState.battleCount >= 15) {
    gameState.isVictory = true;
    gameState.gameStage = 'end';
  } else {
    // 开始下一场战斗
    gameState.gameStage = 'battle';
    // 注意：不在这里调用startBattle()，而是在GameApp.vue中调用
  }
}