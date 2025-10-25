/**
 * AwaitPlayerInputInstruction - 等待玩家输入元语
 * 
 * 暂停结算流程，等待玩家做出选择（核心异步元语）
 * 
 * 支持的输入类型：
 * - selectCard: 从多张卡牌中选择
 * - selectTarget: 选择目标单位
 * - confirm: 确认操作
 * 
 * 设计说明：
 * - 通过Promise + async/await实现协程式暂停
 * - 通过事件总线与前端通信
 * - 元语保存输入结果供后续元语读取
 */

import { BattleInstruction } from '../BattleInstruction.js';
import backendEventBus from '../../../backendEventBus.js';

export class AwaitPlayerInputInstruction extends BattleInstruction {
  /**
   * 构造函数
   * @param {Object} config - 配置对象
   * @param {string} config.inputType - 输入类型（'selectCard'、'selectTarget'、'confirm'）
   * @param {Object} config.options - 输入选项配置
   * @param {BattleInstruction|null} config.parentInstruction - 父元语引用
   */
  constructor({ inputType, options = {}, parentInstruction = null }) {
    super({ parentInstruction });
    
    if (!inputType) {
      throw new Error('AwaitPlayerInputInstruction: inputType is required');
    }
    
    this.inputType = inputType;
    this.options = options;
    
    /**
     * 玩家输入结果
     * @type {any}
     */
    this.result = null;
    
    /**
     * 事件监听器引用
     * @type {Function|null}
     */
    this.eventListener = null;
    
    /**
     * Promise resolve函数
     * @type {Function|null}
     */
    this.resolveFunc = null;
  }

  /**
   * 执行等待玩家输入
   * 
   * 流程：
   * 1. 创建Promise并保存resolve函数
   * 2. 在backendEventBus上监听输入响应事件
   * 3. 向前端发送输入请求事件（触发UI显示）
   * 4. await Promise（阻塞结算流程）
   * 5. 收到玩家输入后，resolve Promise
   * 6. 保存结果到result属性
   * 7. 移除事件监听器
   * 8. 返回true（完成）
   * 
   * @returns {Promise<boolean>} 始终返回true（一次性完成）
   */
  async execute() {
    // 创建Promise用于等待玩家输入
    const inputPromise = new Promise((resolve) => {
      this.resolveFunc = resolve;
      
      // 创建事件监听器
      this.eventListener = (response) => {
        // 检查是否是对应这个元语的响应
        if (response.instructionID === this.uniqueID) {
          resolve(response.result);
        }
      };
      
      // 监听玩家输入响应事件
      backendEventBus.on('PLAYER_INPUT_RESPONSE', this.eventListener);
    });
    
    // 向前端发送输入请求事件
    backendEventBus.emit('REQUEST_PLAYER_INPUT', {
      instructionID: this.uniqueID,
      inputType: this.inputType,
      options: this.options
    });
    
    // 等待玩家输入（协程式暂停）
    this.result = await inputPromise;
    
    // 移除事件监听器
    if (this.eventListener) {
      backendEventBus.off('PLAYER_INPUT_RESPONSE', this.eventListener);
      this.eventListener = null;
    }
    
    // 输入完成
    return true;
  }

  /**
   * 取消等待（覆盖基类方法）
   * 如果正在等待输入，需要清理监听器并resolve Promise
   */
  cancel() {
    super.cancel();
    
    // 清理监听器
    if (this.eventListener) {
      backendEventBus.off('PLAYER_INPUT_RESPONSE', this.eventListener);
      this.eventListener = null;
    }
    
    // 如果有未完成的Promise，resolve为null
    if (this.resolveFunc) {
      this.resolveFunc(null);
      this.resolveFunc = null;
    }
  }

  /**
   * 获取调试信息
   * @returns {string}
   */
  getDebugInfo() {
    return `${super.getDebugInfo()} InputType:${this.inputType} HasResult:${this.result !== null}`;
  }
}
