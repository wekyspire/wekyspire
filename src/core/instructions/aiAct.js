import BattleInstruction from '../kernel/BattleInstruction.js';
import { aliveAllies, aliveEnemies } from '../state/battleState.js';
import { getAllyDefinition } from '../allies/registry.js';
import { getEnemyDefinition } from '../enemies/registry.js';

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
    if (this._stage === 0) {
      this._stage = 1;
      if (this.unit.isDead()) return true;
      const def = this.resolveDef(this.unit.defId);
      def.act({ ...ctx, unit: this.unit, def });
      this.unit.actionIndex += 1;
      return false;
    }
    // 行动结算（子节点）落地后刷新全体意图——意图依赖场面实时状态
    //（如大理石哨兵读受创差值），不刷会让玩家看着上一拍的预告做决策。
    refreshIntentions(ctx);
    return true;
  }
}

// AI 单位意图：定义带 getIntention 用之，否则未知
function intentionOf(def, unit, battleState) {
  return def.getIntention ? def.getIntention(unit, battleState) : { kinds: ['unknown'] };
}

// 全量刷新 AI 单位意图（含晕眩覆写：预告 = 实际，其下回合行动必被 veto 跳过）。
// 调用点：敌方回合结束预算（turn.js）、每次 AI 行动结算后（本文件）、
// 玩家每次出牌结算后（skill.js）——三者之外场面不变，意图不会陈旧。
export function refreshIntentions(ctx) {
  for (const e of aliveEnemies(ctx.battleState)) {
    e.intention = e.getEffectStacks('stun') > 0
      ? { kinds: ['stun'], note: '晕眩：跳过行动' }
      : intentionOf(getEnemyDefinition(e.defId), e, ctx.battleState);
  }
  for (const a of aliveAllies(ctx.battleState)) {
    a.intention = a.getEffectStacks('stun') > 0
      ? { kinds: ['stun'], note: '晕眩：跳过行动' }
      : intentionOf(getAllyDefinition(a.defId), a, ctx.battleState);
  }
}
