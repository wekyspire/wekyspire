// battle.js - 战斗阶段逻辑

import EnemyFactory from './enemyFactory.js'
import backendEventBus, { EventNames } from '../backendEventBus.js'
import { addSystemLog, addEnemyActionLog } from './battleLogUtils.js'
import { backendGameState as gameState } from './gameState.js'
import {
  enqueueDelay,
  enqueueLockControl, enqueueState, captureSnapshot
} from './animationInstructionHelpers.js'
import {
  initializeGlobalExecutor,
  submitInstruction,
  runGlobalExecutor,
  cleanupGlobalExecutor
} from './battleInstructions/globalExecutor.js';
import { UseSkillInstruction } from './battleInstructions/core/UseSkillInstruction.js';
import { PlayerTurnStartInstruction } from './battleInstructions/turn/PlayerTurnStartInstruction.js';
import { PlayerTurnEndInstruction } from './battleInstructions/turn/PlayerTurnEndInstruction.js';
import { createAndSubmitDrawSkillCard, createAndSubmitDropSkillCard } from './battleInstructionHelpers.js';
import { ManualStopActivatedSkillInstruction } from './battleInstructions/core/ManualStopActivatedSkillInstruction.js';
import { ProcessStartOfTurnEffectsInstruction } from './battleInstructions/turnEffects/ProcessStartOfTurnEffectsInstruction.js';
import { ProcessEndOfTurnEffectsInstruction } from './battleInstructions/turnEffects/ProcessEndOfTurnEffectsInstruction.js';
import { EnemyActInstruction } from './battleInstructions/enemy/EnemyActInstruction.js';
// 开始战斗
export function enterBattleStage() {
  
  gameState.battleCount++;

  // 生成敌人
  generateEnemy(gameState);

  // 初始化结算执行器
  initializeGlobalExecutor();

  // 战前事件
  backendEventBus.emit(EventNames.Game.PRE_BATTLE, {
    battleCount: gameState.battleCount,
    player: gameState.player,
    enemy: gameState.enemy
  });

  // 切换游戏状态到战斗状态
  gameState.gameStage = 'battle';
  // 马上切换状态，阻塞，但是无延迟
  enqueueState(captureSnapshot(), 0);
  // 小等一下，方便战斗界面组件挂载 特殊类型: mount，依赖挂载的指令可以等待这个类型
  enqueueDelay(300, {tags: ['ui', 'mount']});

  // 进入游戏控制流
  backendEventBus.emit(EventNames.Battle.BATTLE_START);
}

async function startBattle() {
  // 从技能槽克隆技能到战斗技能数组
  console.log('Starting battle with cultivated skills:', gameState.player.cultivatedSkills);
  gameState.player.skills = gameState.player.cultivatedSkills
    .filter(skill => skill !== null)
    .map(skill => cloneSkill(skill));

  // 添加战斗日志
  addSystemLog(`战斗 #${gameState.battleCount} 开始！`);
  addSystemLog(`遭遇了 ${gameState.enemy.name}！`);

  // 初始化前台/后备/坟地技能列表
  gameState.player.backupSkills = [...gameState.player.skills];
  gameState.player.frontierSkills = [];
  gameState.player.burntSkills = [];

  // 打乱后备技能顺序
  gameState.player.backupSkills.sort(() => Math.random() - 0.5);

  const modPlayer = gameState.player.getModifiedPlayer();
  // 重置换卡行动力开销（修正：先获取modPlayer）
  gameState.player.currentShiftSkillActionPointCost = modPlayer.initialShiftSkillActionPointCost;

  // 调用技能的onBattleStart方法
  gameState.player.skills.forEach(skill => {
    skill.onBattleStart();
  });

  console.log(gameState.player.skills);

  // 调用卡牌进入战斗事件
  gameState.player.skills.forEach(skill => {
    skill.onEnterBattle(gameState.player.getModifiedPlayer());
  });

  // 搞定后立刻锁定操作面板
  enqueueLockControl();

  // 初始化前台技能
  const drawCount = Math.min(
    modPlayer.initialDrawFrontierSkills, modPlayer.maxFrontierSkills,
    modPlayer.backupSkills.length);
  // 改为原语抽牌并推进执行器
  createAndSubmitDrawSkillCard(modPlayer, drawCount);
  await runGlobalExecutor();

  enqueueDelay(200); // 动画barrier，防止抽卡动画和后面的抽卡动画重叠播放

  // 开始玩家回合
  backendEventBus.emit(EventNames.Battle.PLAYER_TURN, {});
}

// 开始玩家回合
async function startPlayerTurn() {
  // 使用回合开始元语驱动结算
  const inst = new PlayerTurnStartInstruction({player: gameState.player, enemy: gameState.enemy});
  submitInstruction(inst);
  await runGlobalExecutor();
}

function checkBattleEndAndFireEvent () {
  // 看看玩家是不是逝了
  const isPlayerDead = gameState.player.hp <= 0;
  const isEnemyDead = gameState.enemy.hp <= 0;

  if (isPlayerDead) {
    backendEventBus.emit(EventNames.Battle.BATTLE_VICTORY, false);
    return true;
  }

  // 看看敌人是不是逝了
  if (isEnemyDead) {
    backendEventBus.emit(EventNames.Battle.BATTLE_VICTORY, true);
    return true;
  }

  return false;
}

// 生成敌人
export function generateEnemy() {
  // 根据战斗场次数生成敌人
  const battleIntensity = gameState.battleCount;
  
  // 简单实现：在第2 + 5xn (n = 1, 2, 3, ...）场战斗时生成Boss
  if (gameState.battleCount !== 2 && (gameState.battleCount - 2) % 5 === 0) {
    gameState.enemy = EnemyFactory.generateRandomEnemy(battleIntensity, true);
  } else {
    // 普通敌人
    gameState.enemy = EnemyFactory.generateRandomEnemy(battleIntensity, false);
  }
}

// 手动停止咏唱技能：支付费用 + 再次 use + onDisable + 普通结算（drop/burn）
async function manualStopActivatedSkill(skill) {
  const player = gameState.player;
  // 统一走指令：手动停止咏唱
  const inst = new ManualStopActivatedSkillInstruction({player, skill, enemy: gameState.enemy});
  submitInstruction(inst);
  await runGlobalExecutor();
}

// 监听手动停止事件（前端操作）
backendEventBus.on(EventNames.PlayerOperations.PLAYER_STOP_ACTIVATED_SKILL, async (uniqueID) => {
  const skill = gameState.player.activatedSkills.find(s => s.uniqueID === uniqueID);
  if (skill) await manualStopActivatedSkill(skill);
  else console.warn('未找到要停止的咏唱技能', uniqueID);
});

// 结束玩家回合
async function endPlayerTurn() {
  if (gameState.isEnemyTurn) {
    console.warn('当前不是玩家回合，无法结束玩家回合。');
    return;
  }
  // 马上锁定，防止玩家反复点击结束回合
  enqueueLockControl();

  // 使用回合结束元语
  const inst = new PlayerTurnEndInstruction({player: gameState.player, enemy: gameState.enemy});
  submitInstruction(inst);
  await runGlobalExecutor();

  // 进入敌人回合
  backendEventBus.emit(EventNames.Battle.ENEMY_TURN, {})
}

// 敌人回合
async function enemyTurn() {
  // 敌人行动逻辑
  gameState.isEnemyTurn = true;

  addEnemyActionLog(`/red{${gameState.enemy.name}} 的回合！`);

  enqueueDelay(500);

  // 触发敌人回合开始事件（整合到 Battle 内）
  backendEventBus.emit(EventNames.Battle.ENEMY_TURN_START);

  // 回合开始时结算效果（指令化）
  const startEff = new ProcessStartOfTurnEffectsInstruction({target: gameState.enemy});
  submitInstruction(startEff);
  await runGlobalExecutor();
  const isStunned = !!startEff.isStunned;
  if (checkBattleEndAndFireEvent()) return;

  if (isStunned) {
    addSystemLog('敌人被眩晕，跳过回合！');
  } else {
    // 等待敌人行动完成（包括所有攻击动画），对敌人传入修正后的玩家以包含防御修正
    const actInst = new EnemyActInstruction({enemy: gameState.enemy, player: gameState.player});
    submitInstruction(actInst);
    await runGlobalExecutor();
  }


  if (checkBattleEndAndFireEvent()) return;
  enqueueDelay(500);

  // 触发敌人行动结束事件（整合到 Battle 内）
  backendEventBus.emit(EventNames.Battle.ENEMY_ACTION_END);
  // 结算敌人回合结束效果（指令化）
  submitInstruction(new ProcessEndOfTurnEffectsInstruction({target: gameState.enemy}));
  await runGlobalExecutor();

  if (checkBattleEndAndFireEvent()) return;
  enqueueDelay(500);

  // 触发敌人回合结束事件（整合到 Battle 内）
  backendEventBus.emit(EventNames.Battle.ENEMY_TURN_END);
  // 敌人行动结束后进入玩家回合
  backendEventBus.emit(EventNames.Battle.PLAYER_TURN, {});
}

// 结束战斗
function battleVictory(isVictory) {
  gameState.player.effects = {};
  gameState.player.shield = 0;
  // 结束前清理所有咏唱技能并触发停用
  if (Array.isArray(gameState.player.activatedSkills) && gameState.player.activatedSkills.length) {
    for (const s of [...gameState.player.activatedSkills]) {
      try { s.onDisable(gameState.player, 'battleEnd'); } catch (_) {}
      backendEventBus.emit(EventNames.Player.ACTIVATED_SKILL_DISABLED, { skill: s, reason: 'battleEnd' });
    }
    gameState.player.activatedSkills = [];
    backendEventBus.emit(EventNames.Player.ACTIVATED_SKILLS_UPDATED, { activatedSkills: [] });
  }
  // 卡牌离场
  gameState.player.skills.forEach(skill => {
    try { skill.onLeaveBattle(gameState.player); } catch (_) {}
  });

  gameState.player.skills = [];
  gameState.isEnemyTurn = true;
  
  // 弹出胜利信息
  if (isVictory) {
    addSystemLog("/green{你胜利了！}");
  } else {
    addSystemLog("/red{你失败了！}");
  }

  // 添加延迟，让玩家体验到胜利或失败的感觉
  enqueueDelay(3000);
  // 之后再把前台/后备/坟地技能列表清空
  gameState.player.frontierSkills = [];
  gameState.player.backupSkills = [];
  gameState.player.burntSkills = [];

  // 注意：新动画系统会自动清理，不再需要手动清理卡牌动画

  // 战斗结束事件
  backendEventBus.emit(EventNames.Game.POST_BATTLE, {
    battleCount : gameState.battleCount,
    player: gameState.player,
    enemy: gameState.enemy,
    isVictory: isVictory
  });

  // 清理结算执行器
  cleanupGlobalExecutor();
}

// 初始化战斗流程监听器
export function initializeBattleFlowListeners() {
  // 战斗开始
  backendEventBus.on(EventNames.Battle.BATTLE_START, async () => {
    await startBattle();
  });

  // 玩家回合开始
  backendEventBus.on(EventNames.Battle.PLAYER_TURN, async () => {
    await startPlayerTurn();
  });


  // 玩家使用技能（前端操作）
  backendEventBus.on(EventNames.PlayerOperations.PLAYER_USE_SKILL, async (uniqueID) => {
    const skill = gameState.player.frontierSkills.find(s => s.uniqueID === uniqueID);
    console.log('使用技能：', skill);
    if (skill) {
      // 额外检查一次技能是否能使用，因为前端是异步动画，所以如果玩家操作过快则可能会尝试发动无法使用的技能
      if (gameState.gameStage === 'battle' && gameState.isPlayerTurn && skill.canUse(gameState.player)) {
        // 使用新的指令式结算流
        const inst = new UseSkillInstruction({player: gameState.player, skill, enemy: gameState.enemy});
        submitInstruction(inst);
        // 运行执行器
        await runGlobalExecutor();
        checkBattleEndAndFireEvent();
      } else {
        console.warn(`技能使用失败：技能 ${skill.name} 当前无法使用。`);
      }
    } else {
      console.warn(`技能使用失败：前台技能列表中未找到id为 ${uniqueID} 的技能`);
      console.log(gameState.player.frontierSkills);
    }
  });

  // 玩家丢弃最左侧技能（前端操作）
  backendEventBus.on(EventNames.PlayerOperations.PLAYER_SHIFT_SKILL, async () => {
    const modPlayer = gameState.player.getModifiedPlayer ? gameState.player.getModifiedPlayer() : gameState.player;
    if (modPlayer.frontierSkills.length === 0) {
      console.warn('前台技能列表为空，无法丢弃技能。');
      return;
    }
    if (modPlayer.remainingActionPoints < modPlayer.currentShiftSkillActionPointCost) {
      console.warn('行动力不足，无法丢弃技能。');
      return;
    }
    // 丢弃最左侧技能，抽一张卡
    gameState.player.consumeActionPoints(modPlayer.currentShiftSkillActionPointCost);
    // 增加开销
    modPlayer.currentShiftSkillActionPointCost++;
    const leftID = gameState.player.frontierSkills[0]?.uniqueID;
    if (leftID) createAndSubmitDropSkillCard(modPlayer, leftID, -1);
    createAndSubmitDrawSkillCard(modPlayer, 1);
    await runGlobalExecutor();
  });

  // 玩家结束回合（前端操作）
  backendEventBus.on(EventNames.PlayerOperations.PLAYER_END_TURN, async () => {
    await endPlayerTurn();
  });

  // 敌人回合开始
  backendEventBus.on(EventNames.Battle.ENEMY_TURN, async () => {
    await enemyTurn();
  })

  // 战斗结束
  backendEventBus.on(EventNames.Battle.BATTLE_VICTORY, (isVictory) => {
    battleVictory(isVictory);
  });
}

// 克隆技能对象
function cloneSkill(skill) {
  // 获取技能的原型
  const skillPrototype = Object.getPrototypeOf(skill);
  
  // 创建一个新的技能实例
  const clonedSkill = Object.create(skillPrototype);
  
  // 复制所有可枚举的属性
  for (const key in skill) {
    if (skill.hasOwnProperty(key)) {
      const value = skill[key];
      
      // 对于基础数据类型，直接复制
      if (value === null || 
          typeof value === 'undefined' || 
          typeof value === 'boolean' || 
          typeof value === 'number' || 
          typeof value === 'string' || 
          typeof value === 'symbol' || 
          value instanceof Date) {
        clonedSkill[key] = value;
      }
      // 对于函数，保持引用（通常不需要克隆函数）
      else if (typeof value === 'function') {
        clonedSkill[key] = value;
      }
      // 对于数组，创建新数组并递归克隆元素
      else if (Array.isArray(value)) {
        clonedSkill[key] = value.map(item => 
          typeof item === 'object' && item !== null ? cloneSkill(item) : item
        );
      }
      // 对于对象，递归克隆
      else if (typeof value === 'object') {
        clonedSkill[key] = cloneSkill(value);
      }
      // 其他情况直接复制
      else {
        clonedSkill[key] = value;
      }
    }
  }
  
  return clonedSkill;
}