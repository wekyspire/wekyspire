// 熔毁施术模板（melt 系：熔融 B / 熔毁 A——「消耗自身所有燃烧，赋予所有敌人
// 虚弱」）：火从主角身上被**剥离**——脚边火体先熄半拍（火离体的抽离感），
// 化作暗红火流逐敌飞掷；落点不爆火，改落**灰紫沉淀**（虚弱 = 燃势转弱成灰的
// 语义——与火球落点的爆读感刻意分家）。火势（自身燃烧层数）驱动流股粗细。
import { cardFlare, arcProjectile, lampPulse } from './blocks.js';

export const meltCast = {
  defaults: {
    color: [1.0, 0.40, 0.14], hot: [1.15, 0.85, 0.50],
    ashColor: 0x9a86b8,        // 虚弱灰紫（沉淀粒子）
    core: 0xff6a3a,
    size: 2.0, projMs: 260, arcH: 3, staggerMs: 80,
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    return async (ctx, deps, notify) => {
      const player = deps.playerUnit?.();
      const feet = player ? deps.unitFeet(player) : null;
      const targets = deps.targets();
      // 自身燃烧层数 = 火势（流股粗细与灰量）；无燃烧时走小档（演出照常，弱化）
      const burn = player ? (deps.effectStacksOf?.(player, 'burn') ?? 0) : 0;
      const vigor = 0.7 + Math.min(burn, 24) / 24 * 0.6;

      const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 240, scale: 1.4 });
      if (!feet || !targets.length) { await flareJob; notify(); return; }

      // 火剥离：主角脚边火星被「抽起」（逆重力上升的细碎组——火离开身体）
      deps.particles?.spawn?.(feet.x, feet.y + 1, {
        color: 0xff7a3d, count: Math.round(10 * vigor), speed: 7, size: 0.7,
        ttl: 0.7, gravity: 16, z: feet.z,
      });

      const jobs = targets.map((unit, i) => ctx.spawn(async (c) => {
        await c.wait(i * prm.staggerMs);
        await arcProjectile(c, deps, {
          from: { x: feet.x, y: feet.y + 2, z: feet.z },
          to: deps.unitAnchor(unit),
          track: unit,
          color: prm.color, hot: prm.hot,
          size: prm.size * vigor, ms: prm.projMs, arcH: prm.arcH,
          fire: true,
          trail: { color: 0xb44a20, count: 1, ttl: 0.3, speed: 3, size: 0.55 },
        });
        // 落点：灰紫沉淀（慢速下坠的灰烬——虚弱的语言，不爆不闪）
        const at = deps.unitAnchor(unit);
        deps.particles?.spawn?.(at.x, at.y, {
          color: prm.ashColor, count: Math.round(8 * vigor), speed: 6, size: 0.9,
          ttl: 1.2, gravity: -14, z: at.z,
        });
        await lampPulse(c, deps, {
          name: 'light:fx1', at: { x: at.x, y: at.y, z: (at.z ?? 0) + 2 },
          color: [prm.color[0] * 0.7 + 0.25, prm.color[1] * 0.6, prm.color[2] * 0.7 + 0.2],
          peak: 380 * vigor, attackMs: 80, decayMs: 340,
        });
      }).promise);
      await flareJob;
      await Promise.all(jobs);
      await ctx.wait(60);
      notify();
    };
  },
};
