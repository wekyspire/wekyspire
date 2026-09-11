import BattleInstruction from '../kernel/BattleInstruction.js';

// 资源指令族：魏启（mana）与行动点（actionPoint）的消耗/获取。
// 白名单均为 ['amount']，费用管线 = 对消耗指令的 PRE 订阅。

export class ConsumeManaInstruction extends BattleInstruction {
  constructor({ amount }, opts = {}) {
    super(opts);
    this.amount = amount;
  }
  get modifiablePayload() { return ['amount']; }
  buildPayload() { this.payload.amount = this.amount; }
  execute(ctx) {
    const before = ctx.player.mana;
    ctx.player.mana = Math.max(ctx.player.mana - this.payload.amount, 0);
    this.result = { consumed: before - ctx.player.mana };
    ctx.presenter?.resource?.({ kind: 'mana', delta: -(before - ctx.player.mana) });
    return true;
  }
}

export class GainManaInstruction extends BattleInstruction {
  constructor({ amount }, opts = {}) {
    super(opts);
    this.amount = amount;
  }
  get modifiablePayload() { return ['amount']; }
  buildPayload() { this.payload.amount = this.amount; }
  execute(ctx) {
    const before = ctx.player.mana;
    ctx.player.mana = Math.min(ctx.player.mana + this.payload.amount, ctx.player.maxMana);
    this.result = { gained: ctx.player.mana - before };
    ctx.presenter?.resource?.({ kind: 'mana', delta: ctx.player.mana - before });
    return true;
  }
}

export class ConsumeActionPointsInstruction extends BattleInstruction {
  constructor({ amount }, opts = {}) {
    super(opts);
    this.amount = amount;
  }
  get modifiablePayload() { return ['amount']; }
  buildPayload() { this.payload.amount = this.amount; }
  execute(ctx) {
    const before = ctx.player.actionPoints;
    ctx.player.actionPoints = Math.max(ctx.player.actionPoints - this.payload.amount, 0);
    this.result = { consumed: before - ctx.player.actionPoints };
    ctx.presenter?.resource?.({ kind: 'actionPoint', delta: -(before - ctx.player.actionPoints) });
    return true;
  }
}

export class GainActionPointsInstruction extends BattleInstruction {
  constructor({ amount }, opts = {}) {
    super(opts);
    this.amount = amount;
  }
  get modifiablePayload() { return ['amount']; }
  buildPayload() { this.payload.amount = this.amount; }
  execute(ctx) {
    // AP 获取不受上限截断（battle.md §6：肾上腺素类的爆发蓄能语义）；
    // 回合开始「回满」= 设回上限值，跨回合不保留超出部分
    const before = ctx.player.actionPoints;
    ctx.player.actionPoints = ctx.player.actionPoints + this.payload.amount;
    this.result = { gained: ctx.player.actionPoints - before };
    ctx.presenter?.resource?.({ kind: 'actionPoint', delta: ctx.player.actionPoints - before });
    return true;
  }
}
