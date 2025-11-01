// gameState.js - 游戏状态管理（前后端分离）

import { reactive } from 'vue';
import { Player } from './player.js';
import SkillManager from './skillManager.js';

// 工厂方法：创建一个“干净”的游戏状态对象（非响应式）
export function createGameState() {
  return {
    // 游戏阶段: 'start', 'battle', 'rest', 'end'
    gameStage: 'start',

    // 休整界面阶段：'money' | 'breakthrough' | 'skill' | 'ability' | 'shop' | ''（不显示）
    restScreenStage: '',

    // 是否开启了瑞米进行游戏
    isRemiPresent: false,

    // 游戏结果状态
    isVictory: false,

    // 回合控制
    isEnemyTurn: false,

    get isPlayerTurn() {
      return !this.isEnemyTurn;
    },

    // 玩家数据
    player: reactive(new Player()),

    // 敌人数据（在战斗开始时赋值）
    enemy: {},

    // 奖励数据
    rewards: {
      breakthrough: false,
      money: 0,
      newSkills: [],
      upgradeSkills: [],
      abilities: []
    },

    // 当前商店内商品
    shopItems: [],

    // 战斗场次数
    battleCount: 0
  };
}

// 分别创建“显示层状态”和“后端状态”，二者结构一致，但相互独立
export const backendGameState = reactive(createGameState());
export const displayGameState = reactive(createGameState());

// 重置显示层状态
export function resetDisplayGameState() {
  const fresh = createGameState();
  // 保持玩家对象响应式：用 Object.assign 同步字段
  Object.assign(displayGameState, fresh);
  Object.assign(displayGameState.player, fresh.player);
}

// 重置后端状态
export function resetBackendGameState() {
  const fresh = createGameState();
  Object.assign(backendGameState, fresh);
  Object.assign(backendGameState.player, fresh.player);
}

// 同时重置两份状态
export function resetAllGameStates() {
  resetDisplayGameState();
  resetBackendGameState();
}
