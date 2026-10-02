// 火花起手模板（spark 乱射链：火花 C/B/A + 终极火花 S——多段随机小伤）：
// 施术拍只有卡面起手脉冲——投射物归伤害拍自持（damageFx ignition owned：
// 每拍从主角手上弹一发随机弧快弹，落定才爆 + 触发受击）。core 侧逐段随机
// 索敌，投射物因此不能在施术拍预洒（目标真值只在伤害节拍有）。
import { cardFlare } from './blocks.js';

export const sparkCast = {
  defaults: {
    core: 0xffd97a,   // 卡面起手脉冲（饱和亮黄）
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    return async (ctx, deps, notify) => {
      await cardFlare(ctx, deps, { color: prm.core, ms: 200, scale: 1.25 });
      notify();
    };
  },
};
