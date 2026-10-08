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
      // 敌方行动起手播报（fx 五模板通配）：意图快照（kinds/hits 标量）→ 舞台剧本
      // 按模板分流（攻击类不演、施法类起手）。瑞米等盟友（side 'player'）不报；
      // 晕眩行动被 PRE veto 在本 stage 之前，播报天然不发。
      if (this.unit.side === 'enemy' && ctx.presenter?.playScript) {
        const it = this.unit.intention ?? {};
        ctx.presenter.playScript({
          script: 'enemyAct',
          unit: this.unit.uniqueID,
          kinds: [...(it.kinds ?? [])],
          hits: it.hits ?? 0,
        });
      }
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

// 意图数值口径要吃 PRE 修饰族里「结算前可预知」的部分：蓄势对该单位所有非固定伤害
// +层数（effects.js PRE 订阅），getIntention 的 damage 不含它的话预告系统性偏低
// （0929 试玩实报：石茧意图 13 实打 17）。攻击类数值统一加当前蓄势层数。
// 注：蓄势受生命伤害会掉层，玩家打完后实打可能低于预告——预报口径与既有一致。
export function withMomentumBonus(unit, intention) {
  const stacks = unit.getEffectStacks?.('momentum') ?? 0;
  if (stacks > 0 && typeof intention?.damage === 'number' && intention.kinds?.includes('attack')) {
    return { ...intention, damage: intention.damage + stacks };
  }
  return intention;
}

// 全量刷新 AI 单位意图（含晕眩覆写：预告 = 实际，其下回合行动必被 veto 跳过）。
// 调用点：敌方回合结束预算（turn.js）、每次 AI 行动结算后（本文件）、
// 玩家每次出牌结算后（skill.js）——三者之外场面不变，意图不会陈旧。
export function refreshIntentions(ctx) {
  for (const e of aliveEnemies(ctx.battleState)) {
    e.intention = e.getEffectStacks('stun') > 0
      ? { kinds: ['stun'], note: '晕眩：跳过行动' }
      : withMomentumBonus(e, intentionOf(getEnemyDefinition(e.defId), e, ctx.battleState));
  }
  for (const a of aliveAllies(ctx.battleState)) {
    a.intention = a.getEffectStacks('stun') > 0
      ? { kinds: ['stun'], note: '晕眩：跳过行动' }
      : withMomentumBonus(a, intentionOf(getAllyDefinition(a.defId), a, ctx.battleState));
  }
}
