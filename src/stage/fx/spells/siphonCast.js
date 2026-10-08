// 吸焰施术模板（消耗燃烧件的共享模板，2026-10-07 用户定的火系共享原语接线）：
// 燃烧从目标身上被抽走——火滴自胸口升起、划弧汇聚到一点，到达后一簇小闪即熄
// （「火被吸干了」；原语 = fireBlocks.burnSiphon）。
// 参数：from = target（选中敌）| self（主角）| all（全场含主角——火源归一）；
//       to = above（来源上方空中熄灭——燃爆/灭火）| self（汇聚到主角胸口=吸纳）。
// 无人燃烧 = 只起手不落假演出（与 meltCast 同口径）。
import { cardFlare } from './blocks.js';
import { burnSiphon } from './fireBlocks.js';

export const siphonCast = {
  defaults: {
    color: [1.0, 0.45, 0.16], hot: [1.2, 0.95, 0.55],
    core: 0xff7a3d,
    from: 'target',
    to: 'above',
    staggerMs: 110,
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    return async (ctx, deps, notify) => {
      const player = deps.playerUnit?.();
      let sources = [];
      if (prm.from === 'all') {
        sources = (deps.allEnemies?.() ?? []).filter(u => (deps.effectStacksOf?.(u, 'burn') ?? 0) > 0);
        if (player && (deps.effectStacksOf?.(player, 'burn') ?? 0) > 0) sources.push(player);
      } else if (prm.from === 'self') {
        if (player && (deps.effectStacksOf?.(player, 'burn') ?? 0) > 0) sources = [player];
      } else {
        sources = deps.targets().filter(u => (deps.effectStacksOf?.(u, 'burn') ?? 0) > 0);
      }
      const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 240, scale: 1.35 });
      if (!sources.length) { await flareJob; notify(); return; }
      const selfAnchor = player ? deps.unitAnchor(player) : null;
      const jobs = sources.map((unit, i) => ctx.spawn(async (c) => {
        await c.wait(i * prm.staggerMs);
        const chest = deps.unitAnchor(unit);
        const stacks = deps.effectStacksOf?.(unit, 'burn') ?? 0;
        const to = prm.to === 'self' && selfAnchor
          ? selfAnchor
          : { x: chest.x, y: chest.y + 11, z: chest.z };
        await burnSiphon(c, deps, {
          from: chest, to,
          color: prm.color, hot: prm.hot,
          orbs: 2 + Math.min(5, Math.floor(stacks / 4)),
        });
      }).promise);
      await Promise.all([flareJob, ...jobs]);
      await ctx.wait(120);
      notify();
    };
  },
};
