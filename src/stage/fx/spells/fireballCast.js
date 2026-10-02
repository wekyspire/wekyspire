// 火球施术模板（火球链/蓄热火球链/先发火弹系）：卡面起手（橙脉冲）→ 火弹从
// 卡尖弧线掷向目标（错峰 shots 发）。**主体落定即 notify**——落点爆炸在伤害
// 节拍驱动（damageFx 的 fireburst），投射物飞行期与节拍推进重叠，读感即
// 「弹到 → 炸」。命中侧不在此类。
import { cardFlare, arcProjectile } from './blocks.js';

export const fireballCast = {
  defaults: {
    color: [1.0, 0.42, 0.14],   // 火弹晕环色（线性）
    hot: [1.0, 0.86, 0.62],     // 热核色（暖白）
    core: 0xffb066,             // 卡面起手脉冲（hex）
    size: 5.2, projMs: 300, arcH: 6,   // 战场 1 单位≈7.4px：5.2≈38px 球体（原 2.4≈18px 只有几像素亮核）
    shots: 1, staggerMs: 120,   // 连发：同目标错峰多发（伤害节拍逐发爆炸白送）
    notifyAfterMs: 220,         // 末发离手后的停顿（notify 前让弹道读出来）
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    return async (ctx, deps, notify) => {
      const targets = deps.targets();
      if (!targets.length) { notify(); return; }
      const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 240 });
      let lastLaunch = null;
      for (let s = 0; s < prm.shots; s++) {
        for (const unit of targets) {
          const launch = ctx.spawn(async (c) => {
            await c.wait(s * prm.staggerMs);
            await arcProjectile(c, deps, {
              from: deps.playerAnchor?.() ?? deps.cardTipWorld(),   // 从主角手上飞出
              to: deps.unitAnchor(unit),
              color: prm.color, hot: prm.hot, size: prm.size,
              ms: prm.projMs, arcH: prm.arcH,
              trail: { color: 0xff7a2d, size: 1.0, ttl: 0.45 },
            });
          });
          lastLaunch = launch;   // 循环序 = 时间序，末发即最后一枚
        }
      }
      await flareJob;
      if (lastLaunch) await lastLaunch.promise;   // 末发离手（不等飞抵——落点在伤害节拍）
      await ctx.wait(prm.notifyAfterMs);
      notify();
    };
  },
};
