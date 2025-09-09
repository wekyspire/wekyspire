// gameState.js - 游戏状态管理

import { reactive } from 'vue';
import { Player } from './player.js';
import SkillManager from './skillManager.js';
import AbilityManager from './abilityManager.js';
import ItemManager from './itemManager.js';

// 创建响应式游戏状态对象
export const gameState = reactive({
  // 游戏阶段: 'start', 'battle', 'rest', 'end'
  gameStage: 'start',
  
  // 是否开启了瑞米进行游戏
  isRemiPresent: false,

  // 游戏结果状态
  isVictory: false,
  
  // 回合控制
  isEnemyTurn: false,

  get isPlayerTurn() {
    return !this.isEnemyTurn;
  },
  
  // 控制是否冻结玩家的控制面板，防止玩家操作
  controlDisableCount: 0,
  
  // 玩家数据
  player: new Player(),
  
  // 敌人数据
  enemy: {
    // 初始为空，因为敌人数据在战斗开始时才会被设置（Enemy类）
  },
  
  // 战斗日志
  battleLogs: [],
  
  // 奖励数据
  rewards: {
    breakthrough: false,
    money: 0,
    skills: [],
    abilities: []
  },
  
  // 当前商店内商品
  shopItems: [],

  // 战斗场次数
  battleCount: 0
});

// 重置游戏状态
export function resetGameState() {
  gameState.gameStage = 'start';
  gameState.isVictory = false;
  gameState.isEnemyTurn = false;
  gameState.controlDisableCount = 0;
  gameState.battleLogs = [];
  gameState.rewards = {
    money: 0,
    skill: false,
    ability: false
  };
  gameState.skillRewardClaimed = false;
  gameState.abilityRewardClaimed = false;
  gameState.battleCount = 0;
  gameState.isAbilityRewardVisible = false;
  gameState.abilityRewards = [];
  gameState.isSkillRewardVisible = false;
  gameState.skillRewards = [];
  gameState.isSkillSlotSelectionVisible = false;
  gameState.selectedSkillForSlot = null;
  
  // 重置玩家状态
  gameState.player.hp = gameState.player.maxHp;
  gameState.player.mana = 0;
  gameState.player.actionPoints = gameState.player.maxActionPoints;
  gameState.player.money = 0;
  gameState.player.skills = [];
  gameState.player.effects = {};
  gameState.player.skillManager = SkillManager.getInstance();
}

export default gameState;