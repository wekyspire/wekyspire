// 结算指令基类。
// 一场战斗 = 一棵以 BattleInstruction 为根的指令树；DFS 结算。
//
// execute(ctx) 返回值：
//   true        本指令完成（弹出前内核会先结算其 POST 反应子节点）
//   false       多阶段未完成，留栈，下轮以 stage+1 再次执行
//   WAIT        挂起：留栈并暂停内核泵，等待外部 resume（玩家输入/回合等待）
export const WAIT = 'INSTRUCTION_WAIT';

let nextInstructionId = 1;

export default class BattleInstruction {
  constructor({ parentInstruction = null } = {}) {
    this.id = nextInstructionId++;
    this.parentInstruction = parentInstruction;
    this.children = [];
    this._nextChildIndex = 0;
    this._isCompleted = false;
    this._waiting = false;
    this._prepared = false;   // buildPayload + PRE 订阅是否已跑过（只跑一次）
    this._stage = 0;
    this.cancelled = false;
    this.cancelReason = null; // 'victory' | 'defeat' | 'dodged' | 'countered' | ...
    this.result = undefined;  // 结算结果，供 POST 订阅与父指令 inspect
    this.payload = {};        // PRE 修饰用可变载荷（字段受 modifiablePayload 白名单约束）
    this._triggerDepth = 0;   // 由内核在提交反应指令时赋值
  }

  // 白名单：允许 PRE 订阅修饰的 payload 字段名。子类按需覆盖。
  get modifiablePayload() { return []; }

  // 首次执行前由内核调用一次，构建 this.payload。子类按需覆盖。
  buildPayload(ctx) {}

  // PRE 订阅修改 payload 的唯一入口，白名单外一律抛错。
  setPayload(field, value) {
    if (!this.modifiablePayload.includes(field)) {
      throw new Error(
        `[${this.constructor.name}] payload 字段 '${field}' 不在白名单` +
        `（允许：${this.modifiablePayload.join(', ') || '无'}）`
      );
    }
    this.payload[field] = value;
  }

  // 取消沿父链向下传播：任一祖先被取消则整棵子树死亡。
  isAlive() {
    let node = this;
    while (node) {
      if (node.cancelled) return false;
      node = node.parentInstruction;
    }
    return true;
  }

  // 子类覆盖。返回 true / false / WAIT。
  execute(ctx) { return true; }
}
