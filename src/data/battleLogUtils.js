// battleLogUtils.js - 提供战斗日志管理的助手函数

import eventBus from '../eventBus.js';

// 战斗日志类型枚举
export const BattleLogType = {
  PLAYER_ACTION: 'player_action',
  ENEMY_ACTION: 'enemy_action',
  SYSTEM: 'system',
  DAMAGE: 'damage',
  HEAL: 'heal',
  EFFECT: 'effect',
  DEATH: 'death',
  OTHER: 'other'
};

// 添加普通战斗日志
export function addBattleLog(log, type = BattleLogType.OTHER) {
  eventBus.emit('add-battle-log', { log, type });
}

// 添加玩家行动日志
export function addPlayerActionLog(log) {
  addBattleLog(log, BattleLogType.PLAYER_ACTION);
}

// 添加敌人行动日志
export function addEnemyActionLog(log) {
  addBattleLog(log, BattleLogType.ENEMY_ACTION);
}

// 添加系统日志
export function addSystemLog(log) {
  addBattleLog(log, BattleLogType.SYSTEM);
}

// 添加伤害日志
export function addDamageLog(log) {
  addBattleLog(log, BattleLogType.DAMAGE);
}

// 添加治疗日志
export function addHealLog(log) {
  addBattleLog(log, BattleLogType.HEAL);
}

// 添加效果日志
export function addEffectLog(log) {
  addBattleLog(log, BattleLogType.EFFECT);
}

// 添加死亡日志
export function addDeathLog(log) {
  addBattleLog(log, BattleLogType.DEATH);
}

// 清空
export function clearBattleLog() {
  eventBus.emit('clear-battle-log');
}

export default {
  BattleLogType,
  addBattleLog,
  addPlayerActionLog,
  addEnemyActionLog,
  addSystemLog,
  addDamageLog,
  addHealLog,
  addEffectLog,
  addDeathLog
};