// 天斩模板（S/X 专属，实体锁口径——全程演完才 notify，sequencer 串行化即锁）：
// 暗光柱垂落预兆（天光瞄准）→ 卡面白炽双脉冲蓄势 → 巨刃竖斩 + 白热爆 +
// 冲天光柱 + 大震 → 余韵 hold。伤害节拍不再补刀光（施术拍已是完整演出，
// damageFx 对这两卡返回 null——避免双斩读感重复）。
// grade 'S'（开天斩）/ 'X'（断神斩·封顶尺度）。
import { cardFlare, slashSweep, lightPillar, fireBurst } from './blocks.js';

export const heavenCleave = {
  defaults: { grade: 'S' },
  build(p) {
    const prm = { ...this.defaults, ...p };
    const X = prm.grade === 'X';
    const chargeMs = X ? 650 : 320;
    const holdMs = X ? 2300 : 1150;   // 总 hold（实体锁时长）
    return async (ctx, deps, notify) => {
      const targets = deps.targets();
      const t0 = targets[0] ?? null;
      const at = t0 ? deps.unitAnchor(t0) : null;
      const feet = t0 ? deps.unitFeet(t0) : null;
      // ① 天光垂落（预兆）：很暗的光柱在目标处渐起（0.1 量级色——阈下，只给「被瞄准」感）
      if (feet) ctx.spawn((c) => lightPillar(c, deps, {
        at: feet, color: [0.10, 0.12, 0.16], hot: [0.14, 0.16, 0.20],
        width: X ? 6 : 4, height: X ? 40 : 30, ms: chargeMs + (X ? 260 : 140),
      }));
      // ② 蓄势：卡面白炽双脉冲（一发比一发亮）
      await cardFlare(ctx, deps, { color: 0xffffff, ms: Math.round(chargeMs * 0.5), scale: X ? 2.4 : 1.8 });
      await cardFlare(ctx, deps, { color: 0xffffff, ms: Math.round(chargeMs * 0.4), scale: X ? 3.2 : 2.2 });
      // ③ 斩落：巨刃竖斩（HDR 白热缘）+ 冲天光柱 + 白热爆 + 大震
      if (at) {
        ctx.spawn((c) => lightPillar(c, deps, {
          at: feet, color: X ? [1.2, 1.3, 1.7] : [0.9, 1.0, 1.3], hot: [2.2, 2.3, 2.8],
          width: X ? 7 : 5, height: X ? 46 : 34, ms: X ? 1800 : 1100,
        }));
        ctx.spawn((c) => fireBurst(c, deps, {
          at: feet, scale: X ? 1.8 : 1.3, color: [0.9, 0.95, 1.1], hot: [1.6, 1.7, 2.0],
          sparkColor: 0xcfe0ff, ms: 500,
        }));
        deps.shake?.impulse?.(X ? 4 : 2.5);
        await slashSweep(ctx, deps, {
          at, angle: X ? 1.52 : 1.45, ms: X ? 460 : 400,
          scale: X ? 3.1 : 2.4, color: [1.0, 1.0, 1.0],
          fringe: X ? [1.8, 2.0, 2.6] : [1.4, 1.6, 2.2],
        });
      }
      // ④ 余韵 hold：光柱燃尽途中才放行（实体锁——受击方不被后续节拍打扰）
      await ctx.wait(Math.max(120, holdMs - chargeMs - (X ? 460 : 400)));
      notify();
    };
  },
};
