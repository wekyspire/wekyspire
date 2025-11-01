/**
 * BattleInstruction - 战斗结算元语基类
 * 
 * 所有结算元语的抽象基类，提供通用状态管理和执行框架。
 * 元语代表战斗结算过程中的一个原子化操作，可以动态生成子元语形成树状结构。
 * 
 * 核心概念：
 * - 结算过程抽象为对结算树进行深度优先遍历
 * - 每个元语可以在execute中创建并提交子元语
 * - 通过cancelled标志和canExecute检查实现取消传播机制
 * - execute返回true表示完成，false表示需要继续执行（多阶段元语）
 */
export class BattleInstruction {
  /**
   * 构造函数
   * @param {Object} config - 配置对象
   * @param {BattleInstruction|null} config.parentInstruction - 父元语引用，用于取消传播检查
   */
  constructor({ parentInstruction = null } = {}) {
    /**
     * 唯一标识符，用于调试和追踪
     * 格式：时间戳 + 随机数
     */
    this.uniqueID = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    /**
     * 父元语引用，用于取消传播检查
     * 当父元语被取消时，所有子元语也将不可执行
     */
    this.parentInstruction = parentInstruction;
    
    /**
     * 取消标志，标记此元语是否被取消
     * 被取消的元语在isAlive检查时返回false，执行器会自动弹出这些元语
     */
    this.cancelled = false;

    // 子元语管理
        this.children = [];
        this._nextChildIndex = 0;
        this._isCompleted = false;
  }

  /**
   * 执行元语逻辑（抽象方法，子类必须重写）
   * 
   * 子类实现此方法时应遵循以下原则：
   * 1. 修改游戏状态（如修改HP、效果等）
   * 2. 入队动画指令（通过animationSequencer）
   * 3. 可选：创建并提交子元语（通过submitInstruction）
   * 4. 可选：等待异步操作（如用户输入）
   * 5. 返回执行结果：
   *    - true: 此元语及其所有子元语已完成，可以弹出栈
   *    - false: 此元语未完成，保留在栈顶，下次迭代继续执行
   * 
   * @returns {Promise<boolean>} 返回true表示执行完成，false表示需要继续执行
   * @throws {Error} 基类方法不应被调用
   */
  async execute() {
    throw new Error(`BattleInstruction.execute() must be implemented by subclass: ${this.constructor.name}`);
  }

  /**
   * 检查元语是否"存活”
   * 
   * 元语死亡的情况：
   * 1. 自身被取消（this.cancelled === true）
   * 2. 父链中任意元语被取消（递归检查parentInstruction）
   * 
   * 这实现了取消的传播机制：当一个元语被取消时，
   * 其所有子元语（直接或间接）都将死亡。
   * 注意：已经完成（isCompleted）的元语不会被再次执行，但仍然存活
   * 
   * @returns {boolean} 存活返回true，不可执行返回false
   */
  isAlive() {
    // 检查自身是否被取消
    if (this.cancelled) {
      return false;
    }
    
    // 递归检查父链
    if (this.parentInstruction) {
      return this.parentInstruction.isAlive();
    }
    
    // 自身未取消且无父元语（或父链全部可执行）
    return true;
  }

  /**
   * 取消此元语
   * 
   * 取消操作只影响"未执行"的元语，已执行的元语不会回滚状态。
   * 取消会传播到所有子元语（通过isAlive的父链检查机制）。
   * 
   * 使用场景：
   * - 敌人死亡后取消剩余攻击
   * - 条件不满足时取消后续效果
   * - 技能被打断时取消后续结算
   * - ...等等卡牌交叉导致的复杂效果
   */
  cancel() {
    this.cancelled = true;
  }

  /**
   * 获取元语的调试信息
   * 用于日志记录和调试
   * 
   * @returns {string} 调试信息字符串
   */
  getDebugInfo() {
    return `[${this.constructor.name}] ID:${this.uniqueID} Cancelled:${this.cancelled}`;
  }

  /**
   * 添加子元语
   *
   * @param {BattleInstruction} child - 子元语实例
   */
  addChild(child) {
    if (!child) return;
    if (!child.parentInstruction) child.parentInstruction = this;
    this.children.push(child);
  }

  /**
   * 检查是否还有未访问的子元语
   *
   * @returns {boolean} 有未访问的子元语返回true，否则返回false
   */
  hasUnvisitedChildren() {
    return this._nextChildIndex < this.children.length;
  }

  /**
   * 获取下一个未访问的子元语
   *
   * @returns {BattleInstruction|null} 下一个未访问的子元语实例，或null如果没有更多未访问的子元语
   */
  nextUnvisitedChild() {
    if (!this.hasUnvisitedChildren()) return null;
    const c = this.children[this._nextChildIndex];
    this._nextChildIndex += 1;
    return c;
  }

  /**
   * 标记元语为完成状态
   *
   * 完成的元语将不会再被执行，其状态也不会被回滚。
   */
  markCompleted() {
    this._isCompleted = true;
  }

  /**
   * 检查元语是否已完成
   *
   * @returns {boolean} 已完成返回true，否则返回false
   */
  isCompleted() {
    return this._isCompleted;
  }
}
