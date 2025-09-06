/**
 * 战斗日志管理器
 * 负责战斗日志的播放、管理和动画效果
 */
class BattleLogManager {
  constructor() {
    this.logs = [];
    this.maxLogs = 100; // 最大日志数量
    this.animationDelay = 300; // 日志动画延迟(ms)
  }

  /**
   * 添加一条日志
   * @param {string} message 日志消息
   * @param {string} type 日志类型 ('player' | 'enemy' | 'system')
   */
  addLog(message, type = 'system') {
    const log = {
      message,
      type,
      timestamp: new Date().getTime()
    };
    
    this.logs.push(log);
    
    // 限制日志数量
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }
    
    return log;
  }

  /**
   * 批量添加日志
   * @param {Array<string>} messages 日志消息数组
   * @param {string} type 日志类型
   */
  addLogs(messages, type = 'system') {
    messages.forEach(message => {
      this.addLog(message, type);
    });
  }

  /**
   * 清空所有日志
   */
  clearLogs() {
    this.logs = [];
  }

  /**
   * 获取所有日志
   * @returns {Array} 日志数组
   */
  getLogs() {
    return this.logs.map(log => log.message);
  }

  /**
   * 获取带类型的日志
   * @returns {Array} 带类型的日志数组
   */
  getTypedLogs() {
    return this.logs;
  }

  /**
   * 播放战斗动画日志
   * @param {Array<Object>} actions 战斗动作数组
   * @param {Function} onUpdate 更新回调
   */
  async playBattleLogs(actions, onUpdate) {
    const logs = [];
    
    for (const action of actions) {
      const actionLogs = this.generateActionLogs(action);
      
      for (const log of actionLogs) {
        logs.push(log);
        
        if (onUpdate) {
          onUpdate([...logs]);
        }
        
        // 添加延迟以创建动画效果
        await this.delay(this.animationDelay);
      }
    }
    
    return logs;
  }

  /**
   * 根据战斗动作生成日志
   * @param {Object} action 战斗动作
   * @returns {Array<string>} 生成的日志消息
   */
  generateActionLogs(action) {
    const logs = [];
    
    switch (action.type) {
      case 'attack':
        if (action.isPlayer) {
          logs.push(`你攻击了${action.targetName}，造成了${action.damage}点伤害！`);
        } else {
          logs.push(`${action.sourceName}攻击了你，造成了${action.damage}点伤害！`);
        }
        break;
        
      case 'defend':
        if (action.isPlayer) {
          logs.push(`你获得了${action.defense}点防御力！`);
        } else {
          logs.push(`${action.sourceName}获得了${action.defense}点防御力！`);
        }
        break;
        
      case 'skill':
        logs.push(`${action.sourceName}使用了技能【${action.skillName}】！`);
        if (action.damage > 0) {
          logs.push(`造成了${action.damage}点伤害！`);
        }
        if (action.heal > 0) {
          logs.push(`恢复了${action.heal}点生命值！`);
        }
        break;
        
      case 'effect':
        if (action.applied) {
          logs.push(`${action.targetName}获得了效果【${action.effectName}】！`);
        } else {
          logs.push(`${action.targetName}的效果【${action.effectName}】消失了！`);
        }
        break;
        
      case 'turn':
        logs.push(`=== ${action.sourceName}的回合 ===`);
        break;
        
      case 'end_turn':
        logs.push(`${action.sourceName}结束了回合`);
        break;
        
      default:
        logs.push(action.message || '未知动作');
    }
    
    return logs;
  }

  /**
   * 延迟函数
   * @param {number} ms 毫秒
   * @returns {Promise}
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 设置动画延迟
   * @param {number} delay 延迟时间(ms)
   */
  setAnimationDelay(delay) {
    this.animationDelay = delay;
  }

  /**
   * 获取日志统计
   * @returns {Object} 统计信息
   */
  getStats() {
    const stats = {
      total: this.logs.length,
      player: this.logs.filter(log => log.type === 'player').length,
      enemy: this.logs.filter(log => log.type === 'enemy').length,
      system: this.logs.filter(log => log.type === 'system').length
    };
    
    return stats;
  }
}

// 创建单例实例
const battleLogManager = new BattleLogManager();

export default battleLogManager;
export { BattleLogManager };