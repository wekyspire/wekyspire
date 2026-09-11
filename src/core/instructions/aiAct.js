import BattleInstruction from '../kernel/BattleInstruction.js';

// AI 单位行动：敌人与我方队友（瑞米）共用一条指令，
// 行为定义由 resolveDef 注入（敌方回合传敌人注册表，友方行动传队友注册表）。
// 行动序列推进 = actionIndex++；固定序列逻辑在 def.act 内按 actionIndex 分支。
export default class AIActInstruction extends BattleInstruction {
  constructor({ unit, resolveDef }, opts = {}) {
    super(opts);
    this.unit = unit;             // AIUnit（Enemy | Ally）
    this.resolveDef = resolveDef; // (defId) => definition
  }

  execute(ctx) {
    if (this.unit.isDead()) return true;
    const def = this.resolveDef(this.unit.defId);
    def.act({ ...ctx, unit: this.unit, def });
    this.unit.actionIndex += 1;
    return true;
  }
}
