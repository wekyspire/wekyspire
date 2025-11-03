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
  claimMoney, claimSkillReward, claimAbilityReward, claimBreakthroughReward, reorderSkills, purchaseItem, spawnRewards, clearRewards, setInitialRestStage, dropCurrentReward, claimUpgradeReward
} from './data/rest.js'

function startGame() {
  // 触发开场事件（通过对话模块触发后端事件，总线隔离）
  dialogues.triggerBeforeGameStart();

  // 为玩家添加初始技能到养成技能列表（写入后端状态）
  const initialSkill1 = SkillManager.getInstance().createSkill('肾上腺素激增');
  const initialSkill2 = SkillManager.getInstance().createSkill('拳');
  const initialSkill3 = SkillManager.getInstance().createSkill('拳');
  const initialSkill4 = SkillManager.getInstance().createSkill('盾');
  const initialSkill5 = SkillManager.getInstance().createSkill('盾');
  const initialSkill6 = SkillManager.getInstance().createSkill('重击');
  const initialSkill7 = SkillManager.getInstance().createSkill('抱头');

  backendGameState.player.cultivatedSkills = [initialSkill1, initialSkill2, initialSkill3,
    initialSkill4, initialSkill5, initialSkill6, initialSkill7];

  // 升满级调试
  // while(backendGameState.player.tier < 9) {
  //   upgradePlayerTier(backendGameState.player);
  // }

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
  backendEventBus.on(EventNames.PlayerOperations.CLAIM_MONEY, () => {
    claimMoney();
  });
  backendEventBus.on(EventNames.PlayerOperations.CLAIM_SKILL, ({ skillID, slotIndex, clearRewards }) => {
    claimSkillReward(skillID, slotIndex, !!clearRewards);
  });
  backendEventBus.on(EventNames.PlayerOperations.CLAIM_UPGRADE, ({ skillID }) => {
    claimUpgradeReward(skillID);
  });
  backendEventBus.on(EventNames.PlayerOperations.CLAIM_ABILITY, ({ ability, clearRewards }) => {
    claimAbilityReward(ability, !!clearRewards);
  });
  backendEventBus.on(EventNames.PlayerOperations.CLAIM_BREAKTHROUGH, () => {
    claimBreakthroughReward();
  });
  backendEventBus.on(EventNames.PlayerOperations.REORDER_SKILLS, ({skillIDs}) => {
    reorderSkills(skillIDs);
  });
  backendEventBus.on(EventNames.PlayerOperations.PURCHASE_ITEM, ({ item }) => {
    const ok = purchaseItem(item);
    if (ok) {
      // TODO 刷新商店物品
    }
  });
  backendEventBus.on(EventNames.PlayerOperations.FINISH, () => {
    backendEventBus.emit(EventNames.Rest.END);
  });
  backendEventBus.on(EventNames.PlayerOperations.DROP_REWARD, () => {
    dropCurrentReward();
  });

  // 休整结束后继续下一场战斗
  backendEventBus.on(EventNames.Rest.END, () => {
    backendEventBus.emit(EventNames.Game.ENTER_BATTLE_STAGE);
  });
}