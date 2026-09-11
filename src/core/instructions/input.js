import BattleInstruction, { WAIT } from '../kernel/BattleInstruction.js';

// 结算期玩家输入（选牌/确认等）。挂在结算树上 WAIT，由流程层 respondInput 应答。
// 技能多阶段用法：stage N 提交本指令并 return false，stage N+1 读其 result.selection。
export default class AwaitPlayerInputInstruction extends BattleInstruction {
  constructor({ request }, opts = {}) {
    super(opts);
    this.request = request;        // { kind: 'selectHandCard'|'confirm'|..., count?, ... }
    this.selection = undefined;    // 流程层应答时填入
  }

  execute(ctx) {
    if (this.selection !== undefined) {
      this.result = { selection: this.selection };
      ctx.battleState.pendingInput = null;
      return true;
    }
    ctx.battleState.pendingInput = { instruction: this, request: this.request };
    ctx.presenter?.requestInput?.({ request: this.request });
    return WAIT;
  }
}
