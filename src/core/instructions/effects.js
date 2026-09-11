import BattleInstruction from '../kernel/BattleInstruction.js';
import { getEffectDefinition } from '../effects/registry.js';

// 效果的订阅 owner 标识：一个单位一个效果一份
export function effectOwner(unit, effectId) {
  return `effect:${unit.uniqueID}:${effectId}`;
}

// 施加效果：白名单 ['stacks']（PRE 可改层数，如"效果层数翻倍"）。
// 首次获得效果时挂载其 subscriptions（window:'battle'，owner=单位+效果）；
// 层数扣尽移除时按 owner 注销。本指令不做任何效果名特判。
export class AddEffectInstruction extends BattleInstruction {
  constructor({ target, effectId, stacks = 1 }, opts = {}) {
    super(opts);
    this.target = target;
    this.effectId = effectId;
    this.stacks = stacks;
  }

  get modifiablePayload() { return ['stacks']; }

  buildPayload() { this.payload.stacks = this.stacks; }

  execute(ctx) {
    const had = this.target.getEffect(this.effectId);
    this.target.addEffect(this.effectId, this.payload.stacks);
    const now = this.target.getEffect(this.effectId);
    const owner = effectOwner(this.target, this.effectId);

    if (!had && now) {
      // 首次获得：挂载效果订阅（写轨）
      const subs = getEffectDefinition(this.effectId).subscriptions?.(this.target) ?? [];
      for (const sub of subs) {
        ctx.kernel.addSubscription({ window: 'battle', ...sub, owner });
      }
    } else if (had && !now) {
      // 层数扣尽：注销效果订阅
      ctx.kernel.removeSubscriptionsByOwner(owner);
    }

    this.result = {
      effectId: this.effectId,
      stacks: this.target.getEffectStacks(this.effectId),
    };
    ctx.presenter?.effect?.({
      target: this.target,
      effectId: this.effectId,
      stacks: this.result.stacks,
    });
    return true;
  }
}
