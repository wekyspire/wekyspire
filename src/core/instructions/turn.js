import BattleInstruction, { WAIT } from '../kernel/BattleInstruction.js';
import { resetTurnHistory, aliveAllies, aliveEnemies } from '../state/battleState.js';
import { DrawCardsInstruction } from './cards.js';
import { SweepSkillCooldownInstruction } from './skill.js';
import { AddEffectInstruction } from './effects.js';
import { GainManaInstruction } from './resources.js';
import AIActInstruction from './aiAct.js';
import { getAllyDefinition } from '../allies/registry.js';
import { getEnemyDefinition } from '../enemies/registry.js';

// ---- 回合标记指令：本身无结算，是效果订阅的挂载点（回合开始/结束效果 = 其 POST 订阅） ----

export class TurnStartInstruction extends BattleInstruction {
  constructor(side, opts = {}) {
    super(opts);
    this.side = side;   // 燃烧等效果按 side 过滤（自己的回合开始才 tick）
  }
  execute() { return true; }
}

export class TurnEndInstruction extends BattleInstruction {
  constructor(side, opts = {}) {
    super(opts);
    this.side = side;
  }
  execute(ctx) {
    // turn 窗口订阅（如"本回合内丢牌时抽牌"）随回合结束清扫
    ctx.kernel.clearWindow('turn');
    return true;
  }
}

export class PlayerTurnStartInstruction extends TurnStartInstruction {
  constructor(opts = {}) { super('player', opts); }
}
export class EnemyTurnStartInstruction extends TurnStartInstruction {
  constructor(opts = {}) { super('enemy', opts); }
}
export class PlayerTurnEndInstruction extends TurnEndInstruction {
  constructor(opts = {}) { super('player', opts); }
}
export class EnemyTurnEndInstruction extends TurnEndInstruction {
  constructor(opts = {}) { super('enemy', opts); }
}

// 咏唱触发挂载点（battle.md P5「主角咏唱卡触发」）：本身无结算，激活咏唱卡的
// 触发效果 = 其 POST 订阅（activated.subscriptions 注册，owner = 卡牌，熄灭时注销）。
// 「快速咏唱」等价于提前提交一次本指令——同一挂载点复用，触发逻辑单一。
export class ChantTriggerInstruction extends BattleInstruction {
  execute() { return true; }
}

// ---- 玩家回合：阶段机（battle.md §3.1 七阶段映射）----
// P1 回合开始 → P2 冷却推进 → P3 抽牌 → P4 WAIT 玩家操作 → P5 咏唱触发
// → P7 盟友行动 → P6/P8 回合结束结算（主角回合结束与"回合结束类触发"合并为一枚指令：
//   现有机械内容——滞气递减、短暂回库、turn 窗口清扫——全部属于 P8；P6 在本实现里
//   只是"玩家操作结束"的边界，由 P7 之前的位置天然表达）
// 注意：盟友在玩家操作**之后**行动（旧实现的"盟友先行动"已废弃）。
export class PlayerTurnInstruction extends BattleInstruction {
  constructor(opts = {}) {
    super(opts);
    this.endRequested = false;   // 玩家点"结束回合"时由流程层置位
  }

  execute(ctx) {
    switch (this._stage) {
      case 0:
        ctx.battleState.turn.side = 'player';
        ctx.battleState.turn.count += 1;
        resetTurnHistory(ctx.battleState);
        ctx.player.shield = 0;    // 护盾在自己回合开始清零（持续整个敌方回合）
        ctx.player.actionPoints = ctx.player.maxActionPoints;
        // 魏启自然恢复：每回合开始 +1（battle.md §6；走指令——上限截断与 PRE 修饰同管线）
        ctx.kernel.submitInstruction(new GainManaInstruction({ amount: 1 }), this);
        ctx.kernel.submitInstruction(new PlayerTurnStartInstruction(), this);
        return false;
      case 1:
        // 晕眩（效果 'stun'）：本回合跳过行动段（P4）。判定固定在回合开始的这一拍
        // （回合开始效果 tick 之后读层数 + 记旗标 + 层数 -1）——不能放在 case 3：
        // WAIT 续跑（每次出牌后 kernel.resume）会反复重入 case 3，当回合内新获得的
        // 晕眩（如打出午休）会立刻掐断当前回合。AI 单位的晕眩由效果订阅 veto
        // AIActInstruction 实现（content/effects.js）；玩家的「行动」是 WAIT 段，
        // 订阅无法 veto，只能由阶段机按旗标短路。
        this._stunned = ctx.player.getEffectStacks('stun') > 0;
        if (this._stunned) {
          ctx.kernel.submitInstruction(
            new AddEffectInstruction({ target: ctx.player, effectId: 'stun', stacks: -1 }), this);
        }
        ctx.kernel.submitInstruction(new SweepSkillCooldownInstruction(), this);
        return false;
      case 2:
        // 首回合不抽牌：起手牌由 PreBattle 的 initialDraw 发放
        if (ctx.battleState.turn.count > 1) {
          ctx.kernel.submitInstruction(
            new DrawCardsInstruction({
              count: ctx.battleState.config.drawPerTurn, reason: 'turnStart',
            }), this);
        }
        return false;
      case 3:
        if (this._stunned) return false;   // 晕眩：跳过行动段（P5 咏唱/P7 盟友/P8 照常）
        if (this.endRequested) return false;
        return WAIT;
      case 4:
        // P5 咏唱触发：激活咏唱卡的每回合触发效果（无激活咏唱时本指令空转）
        ctx.kernel.submitInstruction(new ChantTriggerInstruction(), this);
        return false;
      case 5:
        // P7 盟友行动（玩家操作之后）
        for (const ally of aliveAllies(ctx.battleState)) {
          ctx.kernel.submitInstruction(
            new AIActInstruction({ unit: ally, resolveDef: getAllyDefinition }), this);
        }
        return false;
      case 6:
        ctx.kernel.submitInstruction(new PlayerTurnEndInstruction(), this);
        return false;
      default:
        return true;
    }
  }
}

// ---- 敌方回合：敌人按数组序依次行动，行动后预算下回合意图 ----
export class EnemyTurnInstruction extends BattleInstruction {
  execute(ctx) {
    switch (this._stage) {
      case 0:
        ctx.battleState.turn.side = 'enemy';
        for (const e of aliveEnemies(ctx.battleState)) e.shield = 0;
        ctx.kernel.submitInstruction(new EnemyTurnStartInstruction(), this);
        return false;
      case 1:
        for (const e of aliveEnemies(ctx.battleState)) {
          ctx.kernel.submitInstruction(
            new AIActInstruction({ unit: e, resolveDef: getEnemyDefinition }), this);
        }
        return false;
      case 2:
        // 下回合意图预算：敌我 AI 单位同刷（盟友行动在玩家回合 P7，此处一并预告）。
        // 带晕眩层数的单位意图覆写为「晕眩」——预告 = 实际（其下回合行动必被
        // veto 跳过，显示脚本意图会误导），也是 'stun' 意图 kind 的通用来源。
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
        ctx.kernel.submitInstruction(new EnemyTurnEndInstruction(), this);
        return false;
      default:
        return true;
    }
  }
}

// ---- 回合循环：交替提交玩家/敌方回合，直到内核终局 abort（战斗结束的唯一出口） ----
export class TurnLoopInstruction extends BattleInstruction {
  execute(ctx) {
    if (this._stage % 2 === 0) {
      ctx.kernel.submitInstruction(new PlayerTurnInstruction(), this);
    } else {
      ctx.kernel.submitInstruction(new EnemyTurnInstruction(), this);
    }
    return false;
  }
}

// AI 单位意图：定义带 getIntention 用之，否则未知
function intentionOf(def, unit, battleState) {
  return def.getIntention ? def.getIntention(unit, battleState) : { kinds: ['unknown'] };
}
