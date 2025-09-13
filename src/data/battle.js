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
  
  // 从技能槽克隆技能到战斗技能数组
  gameState.player.skills = gameState.player.skillSlots
    .filter(skill => skill !== null)
    .map(skill => cloneSkill(skill));


  // 初始化前台和后备技能列表
  gameState.player.backupSkills = [...gameState.player.skills];
  gameState.player.frontierSkills = [];
  
  // 填充前台技能
  fillFrontierSkills(gameState.player);

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
  
  // 简单实现：在第2 + 5xn (n = 1, 2, 3, ...）场战斗时生成Boss
  if (gameState.battleCount !== 2 && (gameState.battleCount - 2) % 5 === 0) {
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
  
  // 进行技能冷却
  gameState.player.skills.forEach(skill => {
    skill.coldDown();
  });

  // 填充前台技能
  fillFrontierSkills(gameState.player);

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
  skill.consumeResources(gameState.player);
  
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
          
          // 处理技能使用后的逻辑
          handleSkillAfterUse(skill);
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


// 玩家放弃最左侧技能
export function dropSkill() {
  // 消耗1个行动力
  gameState.player.consumeActionPoints(1);
  // 从前台技能中移除最左侧技能
  const droppedSkill = gameState.player.frontierSkills.shift();
  if (droppedSkill) {
    // 左侧技能进入后备技能
    gameState.player.backupSkills.push(droppedSkill);
    // 触发技能丢弃事件
    eventBus.emit('skill-dropped', { skill: droppedSkill });
    // 刷新操作面板
    eventBus.emit('update-skill-descriptions');
  }
}

// 敌人回合
export function enemyTurn() {
  // 敌人行动逻辑
  gameState.isEnemyTurn = true;
  addEnemyActionLog(`/red{${gameState.enemy.name}} 的回合！`);

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


function fillFrontierSkills(player) {
  // 从后备技能列表头部取技能，直到前台技能数量达到最大值
  while (player.frontierSkills.length < player.maxFrontierSkills && player.backupSkills.length > 0) {
    const skill = player.backupSkills.shift();
    player.frontierSkills.push(skill);
  }
  
  // 触发技能列表更新事件
  eventBus.emit('frontier-skills-updated', {
    frontierSkills: player.frontierSkills,
    backupSkills: player.backupSkills
  });
}

// 处理技能使用后的逻辑
function handleSkillAfterUse(skill) {
  // 如果技能剩余使用次数为0
  if (skill.remainingUses <= 0) {
    // 查找技能在前台技能列表中的位置
    const index = gameState.player.frontierSkills.findIndex(s => s === skill);
    if (index !== -1) {
      // 从前台技能列表中移除
      gameState.player.frontierSkills.splice(index, 1);
      
      if (skill.coldDownTurns !== 0) {
        // 如果是可充能技能，移动到后备技能列表尾部
        gameState.player.backupSkills.push(skill);
        addSystemLog(`/blue{${skill.name}} 进入后备。`);
      } else {
        // 如果是不可充能技能，直接从技能列表中移除
        const skillsIndex = gameState.player.skills.findIndex(s => s === skill);
        if (skillsIndex !== -1) {
          gameState.player.skills.splice(skillsIndex, 1);
        }
        addSystemLog(`/blue{${skill.name}} 已耗尽。`);
      }
      
      // 触发技能列表更新事件
      eventBus.emit('frontier-skills-updated', {
        frontierSkills: gameState.player.frontierSkills,
        backupSkills: gameState.player.backupSkills
      });
    }
  }
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