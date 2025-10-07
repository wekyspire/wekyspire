import backendEventBus, { EventNames } from "./backendEventBus";
import * as dialogues from './data/dialogues'
import SkillManager from './data/skillManager.js'
import {backendGameState as gameState, backendGameState} from './data/gameState.js'
import { upgradePlayerTier } from './data/player.js'
import {
  enterBattleStage,
  initializeBattleFlowListeners
} from './data/battle.js'
import {
  claimMoney, claimSkillReward, claimAbilityReward, claimBreakthroughReward, reorderSkills, purchaseItem, spawnRewards, clearRewards, setInitialRestStage, dropCurrentReward
} from './data/rest.js'

function startGame() {
  // 触发开场事件（通过对话模块触发后端事件，总线隔离）
  dialogues.triggerBeforeGameStart();

  // 为玩家添加初始技能到养成技能列表（写入后端状态）
  const initialSkill1 = SkillManager.getInstance().createSkill('拳打脚踢');
  const initialSkill2 = SkillManager.getInstance().createSkill('活动筋骨');
  const initialSkill3 = SkillManager.getInstance().createSkill('打滚');
  // const initialSkill4 = SkillManager.getInstance().createSkill('奉予烈焰');
  const initialSkill4 = SkillManager.getInstance().createSkill('冲锋盾');
  const initialSkill5 = SkillManager.getInstance().createSkill('敏捷打击');

  backendGameState.player.cultivatedSkills = [initialSkill1, initialSkill2, initialSkill3, initialSkill4, initialSkill5];

  // 升满级调试
  while(backendGameState.player.tier < 9) {
    upgradePlayerTier(backendGameState.player);
  }

  // 以事件驱动开始第一场战斗
  backendEventBus.emit(EventNames.Game.ENTER_BATTLE_STAGE);
}

export function initGameFlowListeners() {
  // 注册后端对话系统监听器
  dialogues.registerListeners();

  // 游戏开始
  backendEventBus.on(EventNames.Game.GAME_START, () => {
    startGame();
  });

  // 开始战斗（统一入口）
  backendEventBus.on(EventNames.Game.ENTER_BATTLE_STAGE, () => {
    enterBattleStage();
  });

  initializeBattleFlowListeners();

  // 战斗结束后的流程编排（胜利进入休整；失败进入结束）
  backendEventBus.on(EventNames.Game.POST_BATTLE, ({ isVictory }) => {
    // 结算战斗结果
    if (isVictory) {
      // 计算奖励
      clearRewards();
      spawnRewards();
      gameState.isVictory = true;
    } else {
      // 玩家失败
      gameState.isVictory = false;
    }
    if (!isVictory) {
      // 失败：宣告游戏结束（UI 监听 game-over 做收尾）
      backendEventBus.emit(EventNames.Game.GAME_OVER, { reason: 'defeat' });
    } else {
      // z胜利：进入休整阶段
      backendEventBus.emit(EventNames.Game.ENTER_REST_STAGE);
    }
  });

  backendEventBus.on(EventNames.Game.GAME_OVER, () => {
    gameState.gameStage = 'end';
  });

  backendEventBus.on(EventNames.Game.ENTER_REST_STAGE, () => {
    gameState.gameStage = 'rest';
    // 由后端控制休整面板阶段
    setInitialRestStage();
  });

  // 休整阶段：事件驱动的后端结算与流程推进
  backendEventBus.on(EventNames.Rest.CLAIM_MONEY, () => {
    claimMoney();
  });
  backendEventBus.on(EventNames.Rest.CLAIM_SKILL, ({ skill, slotIndex, clearRewards }) => {
    claimSkillReward(skill, slotIndex, !!clearRewards);
  });
  backendEventBus.on(EventNames.Rest.CLAIM_ABILITY, ({ ability, clearRewards }) => {
    claimAbilityReward(ability, !!clearRewards);
  });
  backendEventBus.on(EventNames.Rest.CLAIM_BREAKTHROUGH, () => {
    claimBreakthroughReward();
  });
  backendEventBus.on(EventNames.Rest.REORDER_SKILLS, ({skillIDs}) => {
    reorderSkills(skillIDs);
  });
  backendEventBus.on(EventNames.Rest.PURCHASE_ITEM, ({ item }) => {
    const ok = purchaseItem(item);
    if (ok) {
      // TODO 刷新商店物品
    }
  });
  backendEventBus.on(EventNames.Rest.FINISH, () => {
    backendEventBus.emit(EventNames.Rest.END);
  });
  backendEventBus.on(EventNames.Rest.DROP_REWARD, () => {
    dropCurrentReward();
  });

  // 休整结束后继续下一场战斗
  backendEventBus.on(EventNames.Rest.END, () => {
    backendEventBus.emit(EventNames.Game.ENTER_BATTLE_STAGE);
  });
}