// battle.js - 战斗阶段逻辑

import EnemyFactory from './enemyFactory.js'
import SkillManager from './skillManager.js'
import eventBus from '../eventBus.js'
import { processStartOfTurnEffects, processEndOfTurnEffects, processSkillActivationEffects, processDamageDealtEffects } from './effectProcessor.js'
import { addBattleLog, addSystemLog, addPlayerActionLog, addEnemyActionLog, addDeathLog } from './battleLogUtils.js'
import { upgradePlayerTier } from './player.js'
import gameState from './gameState.js'
import { clearRewards, spawnRewards } from './rest.js'

// 开始战斗
export function startBattle() {
  
  gameState.battleCount++;
  
  // 生成敌人
  generateEnemy(gameState);

  // 战前事件
  eventBus.emit('before-battle', {
    battleCount: gameState.battleCount,
    player: gameState.player,
    enemy: gameState.enemy
  });
  
  // 从技能槽复制技能到战斗技能数组
  gameState.player.skills = gameState.player.skillSlots.filter(skill => skill !== null);
  // 赋值skill的inBattleIndex
  gameState.player.skills.forEach((skill, index) => {
    skill.inBattleIndex = index;
  });

  // 调用技能的onBattleStart方法
  gameState.player.skills.forEach(skill => {
    skill.onBattleStart();
  });
  
  // 添加战斗日志
  addSystemLog(`战斗 #${gameState.battleCount} 开始！`);
  addSystemLog(`遭遇了 ${gameState.enemy.name}！`);
  
  // 切换游戏状态到战斗状态
  gameState.gameStage = 'battle';

  // 开始玩家游戏回合
  startPlayerTurn(gameState);
}

// 生成敌人
export function generateEnemy() {
  // 根据战斗场次数生成敌人
  const battleIntensity = gameState.battleCount;
  
  // 简单实现：在第7、15场战斗时生成Boss
  if (gameState.battleCount === 7 || gameState.battleCount === 15) {
    gameState.enemy = EnemyFactory.generateRandomEnemy(battleIntensity, true);
  } else {
    // 普通敌人
    gameState.enemy = EnemyFactory.generateRandomEnemy(battleIntensity, false);
  }
  
  // 初始化敌人效果管理器
  gameState.enemy.init();
}

// 开始玩家回合
export function startPlayerTurn() {
  // 确保这是玩家回合
  gameState.isEnemyTurn = false;

  // 补充行动力
  gameState.player.remainingActionPoints = gameState.player.maxActionPoints;

  // 摧毁护盾
  gameState.player.shield = 0;
  
  // 进行技能冷却
  gameState.player.skills.forEach(skill => {
    skill.coldDown();
  });


  // 回合开始时结算效果
  const isStunned = processStartOfTurnEffects(gameState.player);
  if (isStunned) {
    addSystemLog('你被眩晕，跳过回合！');
    endPlayerTurn(gameState);
    return;
  }
  
  // 强制刷新操作面板渲染
  // 注意：在Vue组件中可能需要不同的处理方式
  
  // 等待玩家操作
  // 玩家操作通过BattleScreen组件的事件处理
}

// 使用技能
export function useSkill(skill) {
  // 使用技能逻辑
  addPlayerActionLog(`你使用了 /blue{${skill.name}}！`);

  // 先冻结玩家操作面板
  gameState.controlDisableCount += 1;
  
  // 支付行动力、使用次数和魏启
  skill.consumeUses(gameState.player);
  
  // 技能发动时结算效果
  processSkillActivationEffects(gameState.player);
  
  const promise = new Promise((resolve) => {
    // 执行技能效果
    let stage = 0;
    const executeSkill = () => {
      const result = skill.use(gameState.player, gameState.enemy, stage);
      // 检查敌人是否死亡（技能可能造成了伤害）
      if (gameState.enemy.hp <= 0) {
        addDeathLog(`${gameState.enemy.name} 被击败了！`);
        endBattle(true);
        resolve(result);
        gameState.controlDisableCount -= 1;
      } else if(result !== true && result !== null) {
        // 此技能发动需要连续反复调用
        stage ++;
        setTimeout(executeSkill, 400);
      } else {
        // 技能完成使用，发射事件
        if(result !== null) { // null: canceled
          eventBus.emit('after-skill-use', 
            {player: gameState.player, skill: skill, result: result});
        }
        // 最后提醒UI
        eventBus.emit('update-skill-descriptions');
        // 解冻玩家控制面板
        gameState.controlDisableCount -= 1;
        // 设置结果
        resolve(result);
      }
    }
    executeSkill();
  });
  return promise;
}

// 敌人回合
export function enemyTurn() {
  // 敌人行动逻辑
  gameState.isEnemyTurn = true;
  addEnemyActionLog(`/red{${gameState.enemy.name}} 的回合！`);
  
  // 摧毁护盾
  gameState.enemy.shield = 0;

  // 触发敌人回合开始事件
  eventBus.emit('enemy-turn-start');
  
  // 回合开始时结算效果
  const isStunned = processStartOfTurnEffects(gameState.enemy);
  if (isStunned) {
    addSystemLog('敌人被眩晕，跳过回合！');
    setTimeout(() => {
      // 触发敌人回合结束事件，通知BattleScreen组件
      eventBus.emit('enemy-turn-end');
      startNextTurn(gameState);
    }, 800); // 缩短延迟时间
    return;
  }

  // 等待敌人行动完成（包括所有攻击动画）
  const waitForEnemy = () => {
    const enemyActResult = gameState.enemy.act(gameState.player, gameState.battleLogs);
    if(enemyActResult.promise === null || enemyActResult.promise === undefined) {
      enemyActResult.promise = Promise.resolve();
    }
    enemyActResult.promise.then(() => {
        setTimeout(()=> {
        // 看看玩家是不是逝了
        const isPlayerDead = gameState.player.hp <= 0;
        
        if (isPlayerDead) {
          endBattle(false);
          return;
        }
        if(enemyActResult.endTurn === false) {
          // 继续wait
          waitForEnemy();
        } else {
          // 触发敌人行动结束事件，通知BattleScreen组件
          eventBus.emit('enemy-action-end');
          // 结算敌人回合结束效果
          processEndOfTurnEffects(gameState.enemy);
          // 触发敌人回合结束事件，通知BattleScreen组件
          eventBus.emit('enemy-turn-end');
          // 敌人行动结束后开始新回合
          startNextTurn(gameState);
          return;
        }
      }, enemyActResult.latency || 800);
    });
  };
  setTimeout(waitForEnemy, 800);
}

// 结束玩家回合
export function endPlayerTurn() {
  // 回合结束时结算效果
  processEndOfTurnEffects(gameState.player);
  
  // 检查玩家是否死亡
  if (gameState.player.hp <= 0) {
    endBattle(false);
    return;
  }
  
  // 执行敌人回合
  enemyTurn(gameState);
}

// 开始下一回合
export function startNextTurn(gameState) {
  // 检查游戏是否结束
  if (gameState.player.hp <= 0) {
    endBattle(false);
    return;
  }
  
  if (gameState.enemy.hp <= 0) {
    endBattle(true);
    return;
  }
  
  addSystemLog(`你的回合！`);
  // 开始新回合
  startPlayerTurn(gameState);
}

// 结束战斗
export function endBattle(isVictory) {
  // 清空玩家身上的所有效果
  gameState.player.effects = {};
  // 清空玩家身上的护盾
  gameState.player.shield = 0;
  // 清空战斗技能数组
  gameState.player.skills = [];

  // 锁定操作面板
  gameState.isEnemyTurn = true;
  
  // 弹出胜利信息
  if (isVictory) {
    addSystemLog("/green{你胜利了！}");
  } else {
    addSystemLog("/red{你失败了！}");
  }

  // 发送胜利事件
  if(isVictory) eventBus.emit('battle-victory');

  // 添加延迟，让玩家体验到胜利或失败的感觉
  setTimeout(() => {
    // 解锁操作面板
    eventBus.emit('enemy-turn-end');
    
    // 战斗结束事件
    eventBus.emit('after-battle', {
      battleCount : gameState.battleCount,
      player: gameState.player,
      enemy: gameState.enemy,
      isVictory: isVictory
    });
    
    if (isVictory) {
      // 计算奖励
      clearRewards();
      spawnRewards();
      gameState.gameStage = 'rest';
      gameState.isVictory = true;
    } else {
      // 玩家失败
      gameState.isVictory = false;
      gameState.gameStage = 'end';
    }
  }, 3000); // 3秒延迟
}