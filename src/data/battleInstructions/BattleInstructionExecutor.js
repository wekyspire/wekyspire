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

import backendEventBus, {EventNames} from '../../backendEventBus.js';
import {backendGameState} from "../gameState";
import BackendEventBus from "../../backendEventBus.js";

export class BattleInstructionExecutor {
  constructor() {
    this.instructionStack = [];
    this.isRunning = false;
    this.statistics = { totalExecuted: 0, totalSkipped: 0, totalSubmitted: 0, maxStackDepth: 0 };
    this.rootInstructions = [];
  }
  // 检查战斗结束
  checkBattleEnd () {
    // 看看玩家是不是逝了
    const isPlayerDead = backendGameState.player.hp <= 0;
    const isEnemyDead = backendGameState.enemy.hp <= 0;
    if (isPlayerDead) {
      return true;
    }
    // 看看敌人是不是逝了
    if (isEnemyDead) {
      return true;
    }

    return false;
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
    // 将新指令接到其父亲的children末尾；若无父，则作为新的root
    const parent = instruction.parentInstruction;
    if (parent) {
      parent.addChild(instruction);
    } else {
      this.rootInstructions.push(instruction);
      // 若当前未运行且栈为空，则作为新的起点
      if (!this.isRunning && this.instructionStack.length === 0) {
        this.instructionStack.push(instruction);
      }
    }
    this.statistics.totalSubmitted++;
  }

  /**
   * 获取当前栈顶元语（不弹出）
   * 
   * 用于子元语获取上下文信息（如获取父元语的引用）
   * 
   * @returns {BattleInstruction|null} 栈顶元语，栈为空时返回null
   */
  getCurrentInstruction() {
    if (this.instructionStack.length === 0) return null;
    return this.instructionStack[this.instructionStack.length - 1];
  }

  tryEnqueueNextRoot () {
    if (this.instructionStack.length === 0) {
      while(this.rootInstructions.length > 0) {
        const nextRoot = this.rootInstructions.shift();
        if (nextRoot && nextRoot.isAlive()) {
          this.instructionStack.push(nextRoot);
          break ;
        }
      }
    }
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
    if (this.isRunning) {
      console.warn('[BattleInstructionExecutor] Executor is already running!');
      console.trace();
      return this.statistics;
    }
    this.isRunning = true;
    this.statistics.totalExecuted = 0;
    this.statistics.totalSkipped = 0;
    this.statistics.maxStackDepth = this.instructionStack.length;

    // 若栈为空但有roots，则将roots逐个压栈（按提交顺序）
    if (this.instructionStack.length === 0 && this.rootInstructions.length > 0) {
      this.instructionStack.push(this.rootInstructions[0]);
    }

    backendEventBus.emit('BATTLE_SETTLEMENT_START', {});
    try {
      while (this.instructionStack.length > 0) {
        const node = this.getCurrentInstruction();
        // 若当前节点已经死亡，直接退栈
        if (!node.isAlive()) {
          this.instructionStack.pop();
          this.statistics.totalSkipped++;
          // 当栈清空但还有更多root尚未遍历时，推进到下一个root
          this.tryEnqueueNextRoot();
          continue;
        }
        // 尝试执行当且节点
        if (!node.isCompleted()) {
          console.log(`[Executor] Current stack depth: ${this.instructionStack.length}. Executing: ${node.getDebugInfo()}`);
          let completed = false;
          try {
            backendEventBus.emit(EventNames.Executor.PRE_INSTRUCTION_EXECUTION, {instruction: node});
            completed = await node.execute();
            this.statistics.totalExecuted++;
            backendEventBus.emit(EventNames.Executor.POST_INSTRUCTION_EXECUTION, {instruction: node, completed});
          } catch (error) {
            console.error(`[Executor] Error executing instruction: ${node.getDebugInfo()}`, error);
            // 出错直接标记完成并弹出，继续回退
            completed = true;
          }
          // 此节点执行完成，标记
          if (completed) {
            node.markCompleted();
          }
          // 检查是否战斗结束
          if (this.checkBattleEnd()) {
            console.log('[Executor] Battle ended during execution.');
            // 清空栈以结束执行
            this.instructionStack = [];
            break;
          }
        }
        // DFS优先遍历未访问的子节点
        const child = node.nextUnvisitedChild();
        if (child) {
          this.instructionStack.push(child);
          if (this.instructionStack.length > this.statistics.maxStackDepth) {
            this.statistics.maxStackDepth = this.instructionStack.length;
          }
        } else if (node.isCompleted()) {
          // 没有未访问子节点：若节点已完成，则弹出
          this.instructionStack.pop();
          // 当栈清空但还有更多root尚未遍历时，推进到下一个root
          this.tryEnqueueNextRoot();
          continue;
        } else {
          // 没有可执行儿子节点，但节点未完成执行，保持在栈顶等待下一轮执行
        }

        if (this.instructionStack.length > 1000) {
          console.error('[Executor] Stack depth exceeded 1000! Possible infinite loop.');
          throw new Error('BattleInstructionExecutor: Stack overflow detected');
        }
      }

      backendEventBus.emit('BATTLE_SETTLEMENT_COMPLETE', { statistics: this.statistics });
      console.log('[Executor] Settlement complete:', this.statistics);
    } catch (e) {
      console.log('[Executor] Error settlement complete:', this.statistics);
      throw e;
    } finally {
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
    this.rootInstructions = [];
    this.statistics = { totalExecuted: 0, totalSkipped: 0, totalSubmitted: 0, maxStackDepth: 0 };
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
