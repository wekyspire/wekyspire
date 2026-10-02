// 火花连珠模板（spark：火花/终极火花——多段小伤）：N 发亮黄小快弹从主角指尖
// 连珠弹出（小 size + 快飞 + 低弧 + 大拉伸 = 「撒」出去的火花雨）。命中在伤害
// 节拍逐发小火（damageFx spark → ignition）。
import { cardFlare, arcProjectile } from './blocks.js';

export const sparkCast = {
  defaults: {
    color: [1.0, 0.78, 0.30], hot: [1.2, 1.05, 0.55],   // 饱和亮黄（白核吃色相——热核也要带黄，否则读成蓝白）
    core: 0xffd97a,
    shots: 4, size: 1.3, projMs: 170, arcH: 2.5, staggerMs: 100,
    notifyAfterMs: 100,
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    return async (ctx, deps, notify) => {
      const targets = deps.targets();
      if (!targets.length) { notify(); return; }
      const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 200, scale: 1.25 });
      let lastLaunch = null;
      for (let s = 0; s < prm.shots; s++) {
        for (const unit of targets) {
          lastLaunch = ctx.spawn(async (c) => {
            await c.wait(s * prm.staggerMs);
            await arcProjectile(c, deps, {
              from: deps.playerAnchor?.() ?? deps.cardTipWorld(),
              to: deps.unitAnchor(unit),
              color: prm.color, hot: prm.hot, size: prm.size,
              ms: prm.projMs, arcH: prm.arcH, stretch: 2.0, lampIntensity: 0,
              trail: { color: 0xffc95e, count: 1, ttl: 0.22, speed: 3, size: 0.45 },
            });
          });
        }
      }
      await flareJob;
      if (lastLaunch) await lastLaunch.promise;
      await ctx.wait(prm.notifyAfterMs);
      notify();
    };
  },
};
