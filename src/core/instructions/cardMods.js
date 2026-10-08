// 卡牌 modifier 指令族（设计定稿 quest_prompts/CARD_MODIFIERS.md §4）。
// 与 AddEffectInstruction 同范式：挂载序 = 写入实例 → 编译注册订阅 → onAttach；
// 移除序 = 注销订阅 → onDetach（顺序铁律：先拆监听再跑 cleanup，防 cleanup 动作
// 被自己的订阅捕获）。同 modId 重挂 = 原位覆盖 data（存储序不变，订阅先拆再重挂，
// 防双份监听）。过期引用无害：目标卡不在任何 zone 时静默落空（与弃/移同哲学）。
import BattleInstruction from '../kernel/BattleInstruction.js';
import { zoneOf } from '../state/battleState.js';
import {
  attachModifierInstance, detachModifierInstance, registerModifierHooks,
  hasCardModifierDef, getCardModifier,
} from '../skills/cardModifiers.js';
import { makeSkillCtx } from '../skills/helpers.js';

function findCard(ctx, uniqueID) {
  const zone = zoneOf(ctx.battleState, uniqueID);
  if (!zone) return null;
  return ctx.battleState.zones[zone].find(c => c.uniqueID === uniqueID) ?? null;
}

// 挂载：data 为该 modifier 实例的私有数据（钩子经 mod.data 读写）。
export class AddCardModifierInstruction extends BattleInstruction {
  constructor({ uniqueID, modId, data = {}, source = null }, opts = {}) {
    super(opts);
    this.uniqueID = uniqueID;
    this.modId = modId;
    this.data = data;
    this.source = source;
  }

  execute(ctx) {
    const card = findCard(ctx, this.uniqueID);
    if (!card) {
      this.result = { found: false };
      return true;
    }
    const { inst, refreshed } = attachModifierInstance(card, {
      modId: this.modId, data: this.data, source: this.source,
    });
    const owner = `${card.uniqueID}:mod:${this.modId}`;
    if (refreshed) ctx.kernel.removeSubscriptionsByOwner(owner); // 重挂先拆旧监听，防双份
    const sctx = makeSkillCtx(ctx, card);
    registerModifierHooks(ctx, sctx, inst); // 未注册的 modId 在此抛出（定义期错误就地暴露）
    getCardModifier(this.modId).onAttach?.(inst, sctx); // 子节点语境：onAttach 可提交子指令
    this.result = { found: true, card, refreshed };
    ctx.presenter?.cardModAttached?.({ card, modId: this.modId, source: this.source, refreshed });
    return true;
  }
}

// 移除：幂等（未挂载静默落空）。onDetach 在订阅注销之后执行。
export class RemoveCardModifierInstruction extends BattleInstruction {
  constructor({ uniqueID, modId }, opts = {}) {
    super(opts);
    this.uniqueID = uniqueID;
    this.modId = modId;
  }

  execute(ctx) {
    const card = findCard(ctx, this.uniqueID);
    if (!card) {
      this.result = { found: false };
      return true;
    }
    const inst = detachModifierInstance(card, this.modId);
    if (!inst) {
      this.result = { found: true, removed: false };
      return true;
    }
    ctx.kernel.removeSubscriptionsByOwner(`${card.uniqueID}:mod:${this.modId}`);
    const sctx = makeSkillCtx(ctx, card);
    if (hasCardModifierDef(this.modId)) getCardModifier(this.modId).onDetach?.(inst, sctx);
    this.result = { found: true, removed: true };
    ctx.presenter?.cardModRemoved?.({ card, modId: this.modId });
    return true;
  }
}
