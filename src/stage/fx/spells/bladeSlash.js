// 先锋模板：刀光斩痕（刀法系施术）。演示「小卡」时序口径——短促刀光 200ms 级，
// **全程演完才 notify**（整体 ≤400ms，不值得早通告）。配色与伤害侧 SERIES_THEMES.blade
// 同源（银白冷光——同一个体系的施术/命中要说同一种颜色语言）。
import { cardFlare, slashSweep } from './blocks.js';

export const bladeSlash = {
  defaults: {
    color: 0xeaf2ff,       // 斩痕（银白，同 SERIES_THEMES.blade.flash）
    flareColor: 0xcfd8ea,  // 卡面起手（冷白）
    sparkColor: 0xcfd8ea,  // 落点火花（同 blade 主题火花色）
    ms: 200, staggerMs: 45,
    sparkCount: 10, sparkSpeed: 30, sparkSize: 1.0,
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    return async (ctx, deps, notify) => {
      const targets = deps.targets();
      if (!targets.length) { notify(); return; }
      const flareJob = cardFlare(ctx, deps, { color: prm.flareColor, ms: 200, scale: 1.35 });
      const jobs = targets.map((unit, i) => (async () => {
        await ctx.wait(i * prm.staggerMs);
        await slashSweep(ctx, deps, { at: deps.unitAnchor(unit), color: prm.color, ms: prm.ms, dir: i % 2 ? -1 : 1 });
        deps.particles?.spawn?.(deps.unitAnchor(unit).x, deps.unitAnchor(unit).y, {
          color: prm.sparkColor, count: prm.sparkCount, speed: prm.sparkSpeed,
          size: prm.sparkSize, ttl: 0.4, gravity: -22, z: deps.unitAnchor(unit).z,
        });
      })());
      await Promise.all([flareJob, ...jobs]);
      await ctx.wait(60);
      notify();   // 小卡：全程演完才通告（sequencer 串行锁到最后一刻也无所谓）
    };
  },
};
