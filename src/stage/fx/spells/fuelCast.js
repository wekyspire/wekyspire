// 焚卡回蓝模板（fuel 添柴、炼化、浇油、背水一战——「烧牌换魏启」）：
// 卡面燃起 → 火星流从卡面世界位置汇向主角胸口（能量入体读感，与 resourceDrain
// 的扣费爆散反向）→ 主角胸前小爆 + 暖光。焚毁的牌自身的焚毁演出归焚卡节拍
// （cardBurnFlight），本模板只管「烧出来的能量去哪儿」。
import { cardFlare, arcProjectile, impactBurst } from './blocks.js';

export const fuelCast = {
  defaults: {
    color: [1.0, 0.55, 0.20], hot: [1.2, 1.0, 0.60],
    core: 0xff7a2d,
    motes: 3, size: 1.4, projMs: 260, arcH: 4, staggerMs: 70,
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    return async (ctx, deps, notify) => {
      const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 240, scale: 1.45 });
      const from = deps.cardTipWorld();
      const to = deps.playerAnchor?.();
      if (!from || !to) { await flareJob; notify(); return; }
      let lastMote = null;
      for (let i = 0; i < prm.motes; i++) {
        lastMote = ctx.spawn(async (c) => {
          await c.wait(i * prm.staggerMs);
          await arcProjectile(c, deps, {
            from, to, color: prm.color, hot: prm.hot, size: prm.size,
            ms: prm.projMs, arcH: prm.arcH, stretch: 1.8, lampIntensity: 0,
            fire: true,
            trail: { color: 0xffa04a, count: 1, ttl: 0.3, speed: 3, size: 0.5 },
          });
        });
      }
      await flareJob;
      if (lastMote) {
        await lastMote.promise;
        // 能量落体：主角胸前小爆（无震屏——回蓝是轻反馈）。全程等完再 notify——
        // 模板结束会结构化杀掉子协程，半途放行的闪光会被硬切
        await ctx.spawn((c) => impactBurst(c, deps, {
          at: to, color: prm.color, hot: prm.hot, burstColor: 0xffa04a,
          count: 10, speed: 12, size: 0.8, ttl: 0.5, gravity: 4,
          flashSize: 3.5, flashMs: 240, lampIntensity: 450, lampMs: 260,
        })).promise;
      }
      notify();
    };
  },
};
