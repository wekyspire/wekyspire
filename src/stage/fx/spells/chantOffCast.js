// 咏唱解除施术模板（通用，2026-10-06）：打出**已激活**的咏唱 = 解除——演出语言
// 与激活彻底分家：解除是「撤收」不是「发动」。三段：弱起手（暗调卡面脉冲）→
// 周身一圈微光向胸口**收束**（与蓄力/汇聚反向的快而暗）→ 熄灭脉冲（灰烬散落 +
// 一记短冷光）。主题色继承激活行的 color/hot——各体系的解除都带自家色相。
import { cardFlare, arcProjectile, lampPulse } from './blocks.js';

export const chantOffCast = {
  defaults: {
    color: [0.62, 0.66, 0.78],   // 缺省冷灰（无主题色继承时的中性解除）
    hot: [0.9, 0.95, 1.08],
    core: 0x8f9ab0,
    motes: 4, size: 1.5, projMs: 220, staggerMs: 50, ringR: 6.5,
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    // 解除用暗色（主题色 × 0.62——收走的是余温，不是新火）
    const dim = [prm.color[0] * 0.62, prm.color[1] * 0.62, prm.color[2] * 0.62];
    const dimHot = [prm.hot[0] * 0.62 + 0.1, prm.hot[1] * 0.62 + 0.1, prm.hot[2] * 0.62 + 0.14];
    return async (ctx, deps, notify) => {
      const to = deps.playerAnchor?.() ?? deps.cardTipWorld();
      const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 180, scale: 1.1 });   // 弱起手
      if (!to) { await flareJob; notify(); return; }

      // 收束微光：绕身一圈错峰汇入胸口（快、暗——「能量被撤走」）
      const n = Math.max(1, prm.motes);
      const phase = Math.random() * Math.PI * 2;
      let last = null;
      for (let i = 0; i < n; i++) {
        const a = phase + (i / n) * Math.PI * 2;
        const from = {
          x: to.x + Math.cos(a) * prm.ringR,
          y: to.y + Math.sin(a) * prm.ringR * 0.7,
          z: to.z,
        };
        last = ctx.spawn(async (c) => {
          await c.wait(i * prm.staggerMs);
          await arcProjectile(c, deps, {
            from, to, color: dim, hot: dimHot, size: prm.size,
            ms: prm.projMs, arcH: 1.6, stretch: 1.5, lampIntensity: 0,
          });
        });
      }
      await flareJob;
      if (last) await last.promise;

      // 熄灭脉冲：胸口灰烬一小捧 + 短冷光（一拍即收，不震屏——解除是轻拍不是爆）
      deps.particles?.spawn?.(to.x, to.y, {
        color: 0x8a92a2, count: 10, speed: 7, size: 0.8, ttl: 0.9, gravity: -18, z: to.z,
      });
      ctx.spawn(async (c) => {
        await lampPulse(c, deps, {
          name: 'light:fx0', at: { x: to.x, y: to.y, z: (to.z ?? 0) + 2 },
          color: dimHot, peak: 260, attackMs: 60, decayMs: 280,
        });
      });
      await ctx.wait(60);
      notify();
    };
  },
};
