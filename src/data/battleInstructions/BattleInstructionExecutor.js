/**
 * BattleInstructionExecutor - 战斗结算执行器
 * 
 * 管理元语栈，驱动结算树的深度优先遍历。
 * 核心职责：
 * 1. 维护元语栈（instructionStack）
 * 2. 按DFS顺序执行元语
 * 3. 跳过被取消的元语
 * 4. 支持异步等待（用户输入等）
 * 
 * 执行流程：
 * 1. 外部通过submitInstruction提交初始元语
 * 2. 调用runUntilComplete启动执行协程
 * 3. 循环处理栈顶元语直到栈为空
 * 4. 每个元语的execute可能创建新的子元语（通过submitInstruction）
 * 5. execute返回true时弹出栈，返回false时保留在栈顶
 */

import { backendEventBus } from '../../backendEventBus.js';

export class BattleInstructionExecutor {
  constructor() {
    /**
     * 元语栈，用于DFS遍历
     * 栈顶元素是当前要执行的元语
     */
    this.instructionStack = [];
    
    /**
     * 执行器运行状态标志
     * 用于防止并发执行（同一时间只能有一个结算协程运行）
     */
    this.isRunning = false;
    
    /**
     * 执行统计信息（用于调试和性能监控）
     */
    this.statistics = {
      totalExecuted: 0,
      totalSkipped: 0,
      totalSubmitted: 0,
      maxStackDepth: 0
    };
  }

  /**
   * 提交元语到栈顶
   * 
   * 可以在以下场景调用：
   * 1. 外部提交初始元语（如Battle.js提交UseSkillInstruction）
   * 2. 元语内部提交子元语（通过辅助函数间接调用）
   * 
   * 注意：新提交的元语会被压入栈顶，优先执行（DFS特性）
   * 
   * @param {BattleInstruction} instruction - 要提交的元语实例
   */
  submitInstruction(instruction) {
    if (!instruction) {
      console.error('[BattleInstructionExecutor] Cannot submit null instruction');
      return;
    }
    
    this.instructionStack.push(instruction);
    this.statistics.totalSubmitted++;
    
    // 更新最大栈深度
    if (this.instructionStack.length > this.statistics.maxStackDepth) {
      this.statistics.maxStackDepth = this.instructionStack.length;
    }
    
    // 调试日志（可选，生产环境可关闭）
    // console.log(`[Executor] Submitted: ${instruction.getDebugInfo()}, Stack depth: ${this.instructionStack.length}`);
  }

  /**
   * 获取当前栈顶元语（不弹出）
   * 
   * 用于子元语获取上下文信息（如获取父元语的引用）
   * 
   * @returns {BattleInstruction|null} 栈顶元语，栈为空时返回null
   */
  getCurrentInstruction() {
    if (this.instructionStack.length === 0) {
      return null;
    }
    return this.instructionStack[this.instructionStack.length - 1];
  }

  /**
   * 运行结算协程直到栈为空
   * 
   * 执行逻辑：
   * 1. 检查并发保护（isRunning标志）
   * 2. 发送结算开始事件
   * 3. 循环执行：
   *    - 取栈顶元语
   *    - 检查canExecute（跳过被取消的）
   *    - 调用execute（可能await异步操作）
   *    - 根据返回值决定是否弹出栈
   * 4. 发送结算完成事件
   * 5. 返回执行统计信息
   * 
   * @returns {Promise<Object>} 执行统计信息
   */
  async runUntilComplete() {
    // 并发保护
    if (this.isRunning) {
      console.warn('[BattleInstructionExecutor] Executor is already running!');
      return this.statistics;
    }
    
    this.isRunning = true;
    
    // 重置统计信息
    this.statistics.totalExecuted = 0;
    this.statistics.totalSkipped = 0;
    this.statistics.maxStackDepth = this.instructionStack.length;
    
    // 发送结算开始事件
    backendEventBus.emit('BATTLE_SETTLEMENT_START', {});
    
    try {
      // 主执行循环
      while (this.instructionStack.length > 0) {
        const currentInstruction = this.getCurrentInstruction();
        
        // 检查是否可执行（取消传播机制）
        if (!currentInstruction.canExecute()) {
          // 元语被取消，直接丢弃
          this.instructionStack.pop();
          this.statistics.totalSkipped++;
          
          // 调试日志
          // console.log(`[Executor] Skipped (cancelled): ${currentInstruction.getDebugInfo()}`);
          continue;
        }
        
        // 执行元语（可能await异步操作）
        let completed = false;
        try {
          completed = await currentInstruction.execute();
          this.statistics.totalExecuted++;
          
          // 发送元语执行完成事件（可用于调试和监控）
          backendEventBus.emit('INSTRUCTION_EXECUTED', {
            instruction: currentInstruction,
            completed: completed
          });
          
        } catch (error) {
          // 捕获元语执行错误
          console.error(`[Executor] Error executing instruction: ${currentInstruction.getDebugInfo()}`, error);
          
          // 错误处理策略：弹出出错的元语，继续执行
          // 可根据需求调整（如终止整个结算流程）
          this.instructionStack.pop();
          continue;
        }
        
        // 根据完成状态决定是否弹出栈
        if (completed) {
          this.instructionStack.pop();
          // console.log(`[Executor] Completed: ${currentInstruction.getDebugInfo()}`);
        } else {
          // 未完成，保留在栈顶，下次迭代继续执行
          // console.log(`[Executor] Pending: ${currentInstruction.getDebugInfo()}`);
        }
        
        // 栈深度安全检查（防止无限递归）
        if (this.instructionStack.length > 1000) {
          console.error('[Executor] Stack depth exceeded 1000! Possible infinite loop.');
          throw new Error('BattleInstructionExecutor: Stack overflow detected');
        }
      }
      
      // 发送结算完成事件
      backendEventBus.emit('BATTLE_SETTLEMENT_COMPLETE', {
        statistics: this.statistics
      });
      
      console.log('[Executor] Settlement complete:', this.statistics);
      
    } finally {
      // 确保isRunning标志被重置
      this.isRunning = false;
    }
    
    return this.statistics;
  }

  /**
   * 清空执行器状态（用于战斗结束或重置）
   */
  reset() {
    if (this.isRunning) {
      console.warn('[Executor] Cannot reset while running!');
      return;
    }
    
    this.instructionStack = [];
    this.statistics = {
      totalExecuted: 0,
      totalSkipped: 0,
      totalSubmitted: 0,
      maxStackDepth: 0
    };
    
    console.log('[Executor] Reset complete');
  }

  /**
   * 获取当前栈状态（用于调试）
   * 
   * @returns {Array<string>} 栈中所有元语的调试信息
   */
  getStackDebugInfo() {
    return this.instructionStack.map(inst => inst.getDebugInfo());
  }
}
