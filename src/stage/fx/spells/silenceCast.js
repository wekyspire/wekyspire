// 沉默施术模板（爆炎防卡，全卡池唯一主动熄灭咏唱件）：与「点燃」反向的语言——
// 世界骤冷吸气。起手卡面冷脉冲 + 压迫幕快进快出（dreadVeil 的短借用：斩杀预兆的
// 「世界退场」在这里读作「万籁俱寂」）；被摁灭的咏唱逐张熄光拉向主角由
// ANIM_CHANT_TOGGLED(reason:'silenced') 节拍承担（battleBeats.js），盾落点归
// ANIM_SHIELD 通用拍——本拍只演「寂」。
import { cardFlare, dreadVeil } from './blocks.js';

export const silenceCast = {
  defaults: {
    core: 0x8a9bd0,          // 冷靛蓝（比守势灵蓝更灰更哑——不是防御色，是「灭」色）
    veil: 0.62,              // 压暗峰值（0.85=天斩大幅暗淡；沉默要压得住同屏的火焰
                             // 咏唱升温场——0.5 实测在热场上读不出骤冷，抬到 0.62）
    inMs: 180, holdMs: 220, outMs: 430,
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    return async (ctx, deps, notify) => {
      const veil = dreadVeil(ctx, deps);
      const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 260, scale: 1.4 });
      await veil.set(prm.veil, prm.inMs, 'power2.in');   // 吸气：世界迅速哑下去
      await ctx.wait(prm.holdMs);                        // 屏息一瞬
      const closeJob = veil.set(0, prm.outMs, 'power2.out');
      await Promise.all([flareJob, closeJob]);
      notify();   // 小卡档：全程演完（~800ms，0 费消耗件的体量上限）
    };
  },
};
