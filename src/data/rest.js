// rest.js - 休整阶段逻辑

import SkillManager from './skillManager.js'
import AbilityManager from './abilityManager.js'
import ItemManager from './itemManager.js'
import { upgradePlayerTier } from './player.js'
import eventBus from '../eventBus.js'
import gameState from './gameState.js'
import { generateEnemy, startBattle } from './battle.js'

// 计算奖励
export function spawnRewards() {
  // 计算战斗奖励
  gameState.rewards.money = Math.floor(Math.random() * 20) + 10;

  // 突破奖励
  const haveBreakthroughReward = (
    true || gameState.enemy.isBoss
  );
  gameState.rewards.breakthrough = haveBreakthroughReward;

  // 技能奖励
  gameState.rewards.skills = SkillManager.getInstance().getRandomSkills(
    3, gameState.player.skillSlots, gameState.player.tier
  );
  
  // boss / 奇数次战斗后获得能力奖励
  const haveAbilityReward = (
    gameState.battleCount % 2 === 1 || gameState.enemy.isBoss
  );
  if(haveAbilityReward) {
    gameState.rewards.abilities = AbilityManager.getInstance().getRandomAbilities(
      1, gameState.player.tier
    );
  } else {
    gameState.rewards.abilities = [];
  }
  // 发射事件
  eventBus.emit('rewards-spawned', gameState.rewards);
}

// 领取金钱奖励
export function claimMoney() {
  gameState.player.money += gameState.rewards.money;
  gameState.rewards.money = 0;
}

// 领取技能奖励
export function claimSkillReward(skill, slotIndex, clearRewards) {
  gameState.player.skillSlots[slotIndex] = skill;
  if(clearRewards) {
    gameState.rewards.skills = [];
  }
  // 发射事件
  eventBus.emit('skill-reward-claimed', { skill: skill, slotIndex: slotIndex });
}

// 领取能力奖励
export function claimAbilityReward(ability, clearRewards) {
  // 领取能力奖励
  ability.apply(gameState.player);
  if(clearRewards) {
    gameState.rewards.ability = [];
  }
  // 发射玩家领取能力奖励事件
  eventBus.emit('player-claim-ability', { ability: ability });
}

// 结束休整阶段
export function endRestStage() {
  // 检查是否完成第15场战斗
  if (gameState.battleCount >= 15) {
    gameState.isVictory = true;
    gameState.gameStage = 'end';
  } else {
    // 发射事件
    eventBus.emit('rest-end');
    // 开始下一场战斗
    startBattle();
  }
}