/**
 * 全局执行器管理
 * 
 * 提供全局单例执行器，简化元语提交逻辑。
 * 
 * 设计理念：
 * - 战斗结算是全局唯一的流程，因此使用单例模式
 * - 元语内部可通过submitInstruction直接提交子元语，无需传递executor参数
 * - 战斗开始时初始化执行器，战斗结束时清理执行器
 */

import { BattleInstructionExecutor } from './BattleInstructionExecutor.js';

/**
 * 全局执行器实例
 * 在战斗开始时通过initializeGlobalExecutor()创建
 */
let globalBattleInstructionExecutor = null;

/**
 * 获取全局执行器实例
 * 
 * 如果执行器尚未初始化，会自动创建一个新实例。
 * 通常应在战斗开始时显式调用initializeGlobalExecutor()。
 * 
 * @returns {BattleInstructionExecutor} 全局执行器实例
 */
export function getGlobalExecutor() {
  if (!globalBattleInstructionExecutor) {
    console.warn('[GlobalExecutor] Executor not initialized, creating new instance');
    globalBattleInstructionExecutor = new BattleInstructionExecutor();
  }
  return globalBattleInstructionExecutor;
}

/**
 * 初始化全局执行器
 * 
 * 应在战斗开始时调用，确保使用全新的执行器实例。
 * 如果已有执行器实例且正在运行，会发出警告。
 * 
 * @returns {BattleInstructionExecutor} 新创建的执行器实例
 */
export function initializeGlobalExecutor() {
  if (globalBattleInstructionExecutor) {
    if (globalBattleInstructionExecutor.isRunning) {
      console.error('[GlobalExecutor] Cannot initialize while executor is running!');
      return globalBattleInstructionExecutor;
    }
    console.log('[GlobalExecutor] Replacing existing executor instance');
  }
  
  globalBattleInstructionExecutor = new BattleInstructionExecutor();
  console.log('[GlobalExecutor] Initialized new executor');
  return globalBattleInstructionExecutor;
}

/**
 * 清理全局执行器
 * 
 * 应在战斗结束时调用，释放执行器资源。
 * 如果执行器正在运行，会发出警告。
 */
export function cleanupGlobalExecutor() {
  if (globalBattleInstructionExecutor) {
    if (globalBattleInstructionExecutor.isRunning) {
      console.warn('[GlobalExecutor] Executor is still running during cleanup!');
    }
    globalBattleInstructionExecutor.reset();
    globalBattleInstructionExecutor = null;
    console.log('[GlobalExecutor] Cleaned up executor');
  }
}

/**
 * 提交元语到全局执行器
 * 
 * 这是最常用的API，由辅助函数和元语内部调用。
 * 自动获取全局执行器并提交元语。
 * 
 * @param {BattleInstruction} instruction - 要提交的元语实例
 */
export function submitInstruction(instruction) {
  const executor = getGlobalExecutor();
  executor.submitInstruction(instruction);
}

/**
 * 运行全局执行器直到结算完成
 * 
 * 由战斗控制层（Battle.js）调用，启动结算流程。
 * 
 * @returns {Promise<Object>} 执行统计信息
 */
export async function runGlobalExecutor() {
  const executor = getGlobalExecutor();
  return await executor.runUntilComplete();
}

/**
 * 获取当前栈顶元语
 * 
 * 用于元语内部获取上下文信息。
 * 
 * @returns {BattleInstruction|null} 栈顶元语
 */
export function getCurrentInstruction() {
  const executor = getGlobalExecutor();
  return executor.getCurrentInstruction();
}

/**
 * 获取全局执行器的调试信息
 * 
 * @returns {Object} 调试信息对象
 */
export function getExecutorDebugInfo() {
  const executor = getGlobalExecutor();
  return {
    isRunning: executor.isRunning,
    stackDepth: executor.instructionStack.length,
    statistics: executor.statistics,
    stack: executor.getStackDebugInfo()
  };
}
