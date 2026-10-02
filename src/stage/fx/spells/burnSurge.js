// 焚燃翻倍模板（burnDoubler：焚烧/焚天/星炎——「所有燃烧层数翻 N 倍」）：
// 燃烧中的单位脚下火环爆 + 火柱拔地而起 + 火星上冲——「火苗轰成烈焰」的增幅读感。
// 只点**燃烧中的单位**（deps.effectStacksOf 快照口径）；无人燃烧时退化为卡面
// 红闪（不落假演出）。主角自燃也参与翻倍——主角在列。
import { cardFlare, fireBurst, lightPillar } from './blocks.js';

export const burnSurge = {
  defaults: {
    color: [1.0, 0.38, 0.10], hot: [1.2, 0.95, 0.55], ember: [1.0, 0.16, 0.03],
    core: 0xff5a2a,             // 卡面起手（红橙——增幅系比火球更红）
    scale: 1.0,                 // 星炎（×3）走 1.25
    staggerMs: 90,
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    return async (ctx, deps, notify) => {
      const burning = deps.targets().filter(u => (deps.effectStacksOf?.(u, 'burn') ?? 0) > 0);
      const player = deps.playerUnit?.();
      if (player && (deps.effectStacksOf?.(player, 'burn') ?? 0) > 0) burning.push(player);
      if (!burning.length) {
        await cardFlare(ctx, deps, { color: prm.core, ms: 260, scale: 1.4 });
        notify();
        return;
      }
      const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 300, scale: 1.6 });
      const jobs = burning.map((unit, i) => ctx.spawn(async (c) => {
        await c.wait(i * prm.staggerMs);
        const stacks = deps.effectStacksOf?.(unit, 'burn') ?? 0;
        const s = prm.scale * (0.75 + Math.min(stacks, 30) / 30 * 0.7);   // 火势随层数
        const feet = deps.unitFeet(unit);
        ctx.spawn((c2) => lightPillar(c2, deps, {
          at: feet, color: prm.color, hot: prm.hot,
          width: 2.8, height: 15, ms: 520,
        }));
        deps.particles?.spawn?.(feet.x, feet.y + 1, {
          color: 0xff8c3a, count: 12, speed: 9, size: 0.7, ttl: 1.1, gravity: 12, z: feet.z,
        });
        await fireBurst(c, deps, {
          at: feet, scale: s, ms: 460,
          color: prm.color, hot: prm.hot, ember: prm.ember,
          sparkCount: 16, sparkSpeed: 18,
          linger: { count: 10, speed: 6, ttl: 1.6, size: 0.7, gravity: 6 },
          lampIntensity: 700,
        });
      }).promise);
      await Promise.all([flareJob, ...jobs]);
      await ctx.wait(160);
      notify();
    };
  },
};
