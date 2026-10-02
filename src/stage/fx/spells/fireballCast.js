// 火球施术模板（火球链/蓄热火球链/先发火弹系）：卡面起手（橙脉冲）→ 火弹从
// 主角手上弧线掷向目标（错峰 shots 发）。**末发离手即 notify**——落点爆炸在伤害
// 节拍驱动（damageFx 的 fireburst），投射物逐发 track 登记，伤害拍 await 真实抵达
// （不再猜 impactDelayMs），读感即「弹到 → 炸」。命中侧不在此类。
import { cardFlare, arcProjectile } from './blocks.js';

export const fireballCast = {
  defaults: {
    color: [1.0, 0.42, 0.14],   // 火弹晕环色（线性）
    hot: [1.0, 0.86, 0.62],     // 热核色（暖白）
    core: 0xffb066,             // 卡面起手脉冲（hex）
    size: 5.2, projMs: 300, arcH: 6,   // 战场 1 单位≈7.4px：5.2≈38px 球体（原 2.4≈18px 只有几像素亮核）
    shots: 1, staggerMs: 120,   // 连发：同目标错峰多发（伤害节拍逐发爆炸白送）
    notifyAfterMs: 90,          // 末发离手后的停顿（命中定时归抵达门，不再靠此处压拍）
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    return async (ctx, deps, notify) => {
      const targets = deps.targets();
      if (!targets.length) { notify(); return; }
      const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 240 });
      const launches = [];
      for (let s = 0; s < prm.shots; s++) {
        for (const unit of targets) {
          const launch = ctx.spawn(async (c) => {
            await c.wait(s * prm.staggerMs);
            await arcProjectile(c, deps, {
              from: deps.playerAnchor?.() ?? deps.cardTipWorld(),   // 从主角手上飞出
              to: deps.unitAnchor(unit),
              track: unit,   // 抵达登记：伤害拍（fireburst tracked）await 真实落定
              color: prm.color, hot: prm.hot, size: prm.size,
              ms: prm.projMs, arcH: prm.arcH,
              trail: { color: 0xff7a2d, size: 1.0, ttl: 0.45 },
            });
          });
          launches.push(launch);
        }
      }
      await flareJob;
      await ctx.wait((prm.shots - 1) * prm.staggerMs + prm.notifyAfterMs);   // 末发离手即放行
      notify();
      // 飞行子协程活在本协程内（spawn 随父本收尾连杀）——notify 后仍要等落地方可收尾
      await Promise.all(launches.map(l => l.promise));
    };
  },
};
