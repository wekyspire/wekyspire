// 先锋模板：余烬爆发（火系施术）。演示「大卡」时序口径——卡面起手（金橙脉冲）
// → 弧线火弹逐目标飞掷（错峰 stagger）→ 落点主爆（粒子+闪光核心+灯 punch+小震屏）
// → **主体落定即 notify**（余烬慢组 ttl 2.4s 后台散尽，不占节拍）。
// 依赖战斗实体的动作（如受击方专属反应）不在此类——那是「全程 hold」档模板的事。
import { cardFlare, arcProjectile, impactBurst } from './blocks.js';

export const emberBurst = {
  defaults: {
    color: [1.0, 0.45, 0.18],   // 火弹/爆心晕环色（线性）
    hot: [1.0, 0.85, 0.63],     // 热核色（暖白）
    burstColor: 0xff7a2d,       // 粒子爆散色（hex）
    core: 0xffd9a0,             // 卡面起手脉冲（hex）
    projMs: 320, arcH: 7, staggerMs: 70,
    count: 24, speed: 26, size: 1.1,
    notifyAfterMs: 200,    // 主体落定后的停顿（notify 前让爆点读完）
    linger: { count: 14, speed: 7, ttl: 2.4, size: 0.8, gravity: -9 },
    shakeSeverity: 2,
  },
  build(p) {
    const prm = { ...this.defaults, ...p, linger: { ...this.defaults.linger, ...(p?.linger ?? {}) } };
    return async (ctx, deps, notify) => {
      const targets = deps.targets();
      if (!targets.length) { notify(); return; }
      // ① 卡面起手（与火弹并行；起手完成即续走，不等脉冲收尾）
      const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 260 });
      // ② 火弹 → ③ 落点主爆（逐目标错峰；每个目标内部串行：弹到才爆）
      const jobs = targets.map((unit, i) => (async () => {
        await ctx.wait(i * prm.staggerMs);
        await arcProjectile(ctx, deps, {
          from: deps.cardTipWorld(), to: deps.unitAnchor(unit),
          color: prm.color, hot: prm.hot, ms: prm.projMs, arcH: prm.arcH,
          trail: { color: prm.burstColor },
        });
        await impactBurst(ctx, deps, {
          at: deps.unitAnchor(unit),
          color: prm.color, hot: prm.hot, burstColor: prm.burstColor,
          count: prm.count, speed: prm.speed, size: prm.size,
          linger: prm.linger,
          shakeSeverity: i === 0 ? prm.shakeSeverity : 0,   // 多目标只震一次
        });
      })());
      await Promise.all([flareJob, ...jobs]);
      await ctx.wait(prm.notifyAfterMs);
      notify();   // 主体完成；余烬（无主资产）后台散尽
    };
  },
};
