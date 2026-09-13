import BattleInstruction from '../kernel/BattleInstruction.js';
import { moveCard, swapCostOf, zoneOf } from '../state/battleState.js';
import { createSkillRuntime } from '../state/skillRuntime.js';
import {
  enterBattle, leaveBattle, deactivateChant, effectiveHandCount, handLimitOf,
  overloadLimitOf, pickOverflowVictims,
} from '../skills/helpers.js';
import { ConsumeActionPointsInstruction } from './resources.js';
import { tickCooldownOnEnterDeck } from './skill.js';

// 卡牌指令族。约定：牌库 = FIFO 循环队列（顶 = index 0 = 下次抽的卡；离手卡回尾 =
// 牌库底——无弃牌堆、无重洗）。一切 zone 迁移走 moveCard（数组唯一事实源）。
// 咏唱离手不变量：激活的咏唱卡离开手牌（弃/焚/移/转化）必先熄灭（deactivateChant：
// onDisable + 摘旗 + 注销订阅 + 播报）——「激活只在手牌中成立」由指令层统一保证。

// battle.md §7.3（卡牌移动）：目标区为手牌而加权手牌已达**超载上限**时，改尝试进牌库；
// 仍失败则焚毁。超载是唯一会让"移动失败"的约束（牌库/坟墓无上限）——容量（handLimitOf）
// 不拦移动：容量只约束回合开始抽牌与 P9 尾弃，回合内移动/抽牌可以顶进超载区。
function resolveTargetZone(ctx, toZone) {
  if (toZone === 'hand' && effectiveHandCount(ctx) >= overloadLimitOf(ctx)) {
    return 'deck';
  }
  return toZone;
}

// 抽牌：白名单 ['count']（PRE 可改抽牌数）。
// from: 'top'（默认）| 'bottom'（回旋斩"牌库末抽牌"类机制）。
// reason: 抽牌缘由标记（'turnStart' = 回合开始抽牌），供 filter 区分
// "回合开始抽牌数修正"（龟守/神龟姿态）与技能抽牌。
// 超载判定走加权口径（激活咏唱按咏唱值计多张——咏唱与手牌压力统一，用户定）：
// 顶到超载后不再抽。牌库抽空即落空（FIFO 无重洗——牌库是唯一循环区，无弃牌堆可回收）。
export class DrawCardsInstruction extends BattleInstruction {
  constructor({ count = 1, from = 'top', reason = null }, opts = {}) {
    super(opts);
    this.count = count;
    this.from = from;
    this.reason = reason;
  }

  get modifiablePayload() { return ['count']; }

  buildPayload() { this.payload.count = this.count; }

  execute(ctx) {
    const { zones } = ctx.battleState;
    const drawn = [];
    let blockedByHandLimit = false;   // 加权**超载**挡下（前端据此给"手牌已满"提示）
    let deckEmpty = false;
    for (let i = 0; i < this.payload.count; i++) {
      // 抽牌截断走超载口径：容量只约束回合开始抽牌（turn.js 已按容量房间算好 count），
      // 回合内的抽牌效果允许顶过容量、直到超载——超载空间是抽牌卡的当回合价值空间
      if (effectiveHandCount(ctx) >= overloadLimitOf(ctx)) { blockedByHandLimit = true; break; }
      if (zones.deck.length === 0) { deckEmpty = true; break; }
      const card = this.from === 'bottom' ? zones.deck.pop() : zones.deck.shift();
      zones.hand.push(card);
      drawn.push(card);
    }
    // 两个 break 原因分开记账：前端要区分"抽不下"（要提示玩家）与"牌库空"（无需提示）
    this.result = { drawn, skipped: this.payload.count - drawn.length, blockedByHandLimit, deckEmpty };

    ctx.battleState.history.turn.drawn += drawn.length;
    ctx.battleState.history.battle.drawn += drawn.length;
    ctx.presenter?.cardDrawn?.({
      cards: drawn, from: this.from, skipped: this.result.skipped, blockedByHandLimit, deckEmpty,
    });
    return true;
  }
}

// 焚牌：任意 zone → 焚毁区。手牌中的激活咏唱先熄灭（离手不变量，含焚毁——用户定）。
export class BurnCardInstruction extends BattleInstruction {
  constructor({ uniqueID }, opts = {}) {
    super(opts);
    this.uniqueID = uniqueID;
  }

  execute(ctx) {
    if (zoneOf(ctx.battleState, this.uniqueID) === 'hand') {
      deactivateChant(ctx, ctx.battleState.zones.hand.find(c => c.uniqueID === this.uniqueID), 'leave-hand');
    }
    const card = moveCard(ctx.battleState, this.uniqueID, 'burnt');
    this.result = { card };
    ctx.battleState.history.turn.burnt += 1;
    ctx.battleState.history.battle.burnt += 1;
    ctx.presenter?.cardBurnt?.({ card });
    return true;
  }
}

// 弃牌：手牌 → 牌库底（FIFO 循环——弃牌是动作不是区域，无弃牌堆）。
// index 语义在手牌有序数组上（刀背打击"右手边"等由调用方算好 uniqueID）。
// 结算时校验：只弃「手牌中的卡」——卡已被其他结算搬走（过期引用/同卡双弃）时静默落空，
// 不计数不播报（与 target 结算时解析同哲学：过期引用无害）。
export class DiscardCardInstruction extends BattleInstruction {
  constructor({ uniqueID }, opts = {}) {
    super(opts);
    this.uniqueID = uniqueID;
  }

  execute(ctx) {
    if (zoneOf(ctx.battleState, this.uniqueID) !== 'hand') {
      this.result = { card: null };
      return true;
    }
    deactivateChant(ctx, ctx.battleState.zones.hand.find(c => c.uniqueID === this.uniqueID), 'leave-hand');
    const card = moveCard(ctx.battleState, this.uniqueID, 'deck'); // 落牌库底（数组尾）
    this.result = { card };
    ctx.battleState.history.turn.discarded += 1;
    ctx.battleState.history.battle.discarded += 1;
    ctx.presenter?.cardDiscarded?.({ card });
    tickCooldownOnEnterDeck(ctx, card); // 入库冷却（斩专属特性，见 skill.js 钩子头注）
    return true;
  }
}

// P9 清理段·超载尾弃（玩家回合结束后段，turn.js 的 PlayerTurnInstruction 收尾挂载）：
// 从手牌尾部向前弃置非激活卡，直到加权手牌数 ≤ 容量——「回合内抽上来的牌不过夜」，
// 跨回合留存的只有容量内的战略手牌。激活咏唱豁免（付费点亮的咏唱不得被系统掐灭）。
// 弃置 = 回牌库底（Z2 非消耗离手口径），从最尾端开始逐张——FIFO 循环序因此确定可规划。
export class DiscardOverflowInstruction extends BattleInstruction {
  execute(ctx) {
    const victims = pickOverflowVictims(ctx.battleState.zones.hand, ctx);
    for (const uniqueID of victims) {
      ctx.kernel.submitInstruction(new DiscardCardInstruction({ uniqueID }), this);
    }
    this.result = { discarded: victims.length };
    return true;   // 子节点（逐张弃置）作为已完成节点的子节点照常泵完
  }
}

// 移牌：任意 zone → 任意 zone（可选落点 index）。牌库检索抽取（完美飞刀）、
// 回合结束自动回库（开刃/斩灭）、手牌自由换序（刃心）等统一走这里，保证有 PRE/POST 与播报。
export class MoveCardInstruction extends BattleInstruction {
  constructor({ uniqueID, toZone, index = null }, opts = {}) {
    super(opts);
    this.uniqueID = uniqueID;
    this.toZone = toZone;
    this.index = index;
  }

  execute(ctx) {
    const fromZone = zoneOf(ctx.battleState, this.uniqueID);
    if (fromZone === 'hand') {
      deactivateChant(ctx, ctx.battleState.zones.hand.find(c => c.uniqueID === this.uniqueID), 'leave-hand');
    }
    const toZone = resolveTargetZone(ctx, this.toZone); // §7.3：满手改入牌库
    const card = moveCard(ctx.battleState, this.uniqueID, toZone, { index: toZone === this.toZone ? this.index : null });
    this.result = { card, toZone };
    ctx.presenter?.cardMoved?.({ card, toZone });
    // 入库冷却（斩专属特性）：仅「从非牌库区进入牌库」算一次进入（牌库内搬移/换序不算）
    if (toZone === 'deck' && fromZone !== 'deck') tickCooldownOnEnterDeck(ctx, card);
    return true;
  }
}

// 造牌：战斗中创建新卡入场（真空斩/假动作插虚无、一瞬千击增值牌库等）。
// index: null=末尾 | 数字 | 'random'（走种子 rng，可复现）。
export class AddCardInstruction extends BattleInstruction {
  constructor({ defId, overrides = {}, toZone = 'deck', index = null }, opts = {}) {
    super(opts);
    this.defId = defId;
    this.overrides = overrides;
    this.toZone = toZone;
    this.index = index;
  }

  execute(ctx) {
    const card = createSkillRuntime(this.defId, this.overrides);
    const toZone = resolveTargetZone(ctx, this.toZone); // §7.3：满手改入牌库
    const arr = ctx.battleState.zones[toZone];
    let at = this.index;
    if (at === 'random') at = ctx.battleState.rng.int(0, arr.length);
    if (at === null) arr.push(card);
    else arr.splice(at, 0, card);
    enterBattle(ctx, card); // 新卡走"进入战斗"元语：充能初始化 + 常驻订阅注册
    this.result = { card, index: at ?? arr.length - 1, toZone };
    ctx.presenter?.cardAdded?.({ card, toZone, index: this.result.index });
    return true;
  }
}

// 弃牌：玩家流程动作（非技能卡）。2026-09-13 改制（用户定）：原「换牌」（弃 1 抽 1）
// 废除——抽到满体系下补给由下一回合的「抽到容量」提供，本动作改为**支付一次阶梯
// 费用（swapCostOf：首 0 逐次 +1，能力可封顶）→ 弃掉手中任意张卡**（回牌库底），
// 作为手牌排出口（打不完/全是打不出的牌时主动清空留手位）。
// 费用走资源指令子节点（PRE 可修饰）；弃置走标准弃牌指令（咏唱离手熄灭等同口径）。
export class DumpCardsInstruction extends BattleInstruction {
  constructor({ uniqueIDs }, opts = {}) {
    super(opts);
    this.uniqueIDs = uniqueIDs;
  }

  execute(ctx) {
    switch (this._stage) {
      case 0: {
        this.cost = swapCostOf(ctx.battleState);
        if (this.cost > 0) {
          ctx.kernel.submitInstruction(new ConsumeActionPointsInstruction({ amount: this.cost }), this);
        }
        return false;
      }
      case 1:
        for (const uniqueID of this.uniqueIDs) {
          ctx.kernel.submitInstruction(new DiscardCardInstruction({ uniqueID }), this);
        }
        return false;
      default:
        ctx.battleState.swapCount += 1;
        this.result = { cost: this.cost, discarded: this.uniqueIDs.length };
        ctx.presenter?.cardsDumped?.({ uniqueIDs: this.uniqueIDs, cost: this.cost });
        return true;
    }
  }
}

// 转化：换绑 defId——uniqueID、power 延续（与焚+造的本质区别）。
// 白名单 ['toDefId']：PRE 可改写转化结果（"转化升阶"类能力）。
// 手牌/牌库来源（结算宾语，如斩进阶的目标卡）走三节拍往返（AGENTS pending 惯例）：
//   ① 离开原区入 pending（cardShowcased：原位 → 场中央展示动画）
//   ② 换绑（leaveBattle → enterBattle：旧 def 订阅注销、新 def 注册，充能按新 def 重置）
//   ③ 回原区原位（cardMoved：中央 → 原位飞行动画；期间被效果另行安置则静默让位）
// 已在结算区（发动卡自我转化——UseSkill stage 1 已入 pending）维持原地换绑。
export class TransformCardInstruction extends BattleInstruction {
  constructor({ uniqueID, toDefId, keepPower = true }, opts = {}) {
    super(opts);
    this.uniqueID = uniqueID;
    this.toDefId = toDefId;
    this.keepPower = keepPower;
  }

  get modifiablePayload() { return ['toDefId']; }

  buildPayload() { this.payload.toDefId = this.toDefId; }

  execute(ctx) {
    switch (this._stage) {
      case 0: {
        const zone = zoneOf(ctx.battleState, this.uniqueID);
        if (!zone) throw new Error(`卡牌 ${this.uniqueID} 不在任何 zone，无法转化`);
        this._roundtrip = zone === 'hand' || zone === 'deck';
        if (!this._roundtrip) return false;
        const arr = ctx.battleState.zones[zone];
        this._fromZone = zone;
        this._fromIndex = arr.findIndex(c => c.uniqueID === this.uniqueID);
        const card = arr[this._fromIndex];
        // 手牌中的激活咏唱先熄灭（旧 def 的 activated 能力随转化终止）
        if (zone === 'hand') deactivateChant(ctx, card, 'leave-hand');
        moveCard(ctx.battleState, this.uniqueID, 'pending'); // 裸迁移：展示演出交给 presenter 节拍
        ctx.presenter?.cardShowcased?.({ card, fromZone: zone });
        return false;
      }
      case 1: {
        const zone = zoneOf(ctx.battleState, this.uniqueID);
        const card = ctx.battleState.zones[zone].find(c => c.uniqueID === this.uniqueID);
        const fromDefId = card.defId;
        leaveBattle(ctx, this.uniqueID);
        card.defId = this.payload.toDefId;
        if (!this.keepPower) card.power = 0;
        enterBattle(ctx, card);
        this.result = { card, fromDefId, toDefId: card.defId };
        ctx.presenter?.cardTransformed?.({ card, fromDefId, toDefId: card.defId });
        return false;
      }
      default: {
        if (!this._roundtrip) return true;
        // 落位校验：期间被效果另行安置（焚毁/迁移）则静默让位（pending 惯例）
        if (zoneOf(ctx.battleState, this.uniqueID) !== 'pending') return true;
        const zones = ctx.battleState.zones;
        const card = zones.pending.find(c => c.uniqueID === this.uniqueID);
        // 回原区原位；手牌位次可能已变（展示期间抽/弃），钳到当前长度内
        const index = Math.min(this._fromIndex, zones[this._fromZone].length);
        moveCard(ctx.battleState, this.uniqueID, this._fromZone, { index });
        ctx.presenter?.cardMoved?.({ card, toZone: this._fromZone });
        return true;
      }
    }
  }
}
