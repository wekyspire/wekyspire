// 资源汲取施术模板（2026-10-02，经济卡语言）：能量流汇向主角胸口——与 resourceDrain
// 的「扣费爆散」反向同色（魏启=蓝 / 行动力=黄，资源色相即 UI 色相）。
// params.from 三态：
//   enemy  萃取链（从敌方向抽出——「取」）
//   around 纳气链（从战场两侧汇聚——「纳」）
//   card   蓝瓶/兴奋剂链（从卡面升起——「饮」）
// params.pillar = true：落体改短光柱封顶（S 级回蓝件——重燃的「余烬复燃」排面）。
import { cardFlare, arcProjectile, impactBurst, lightPillar } from './blocks.js';

export const manaCast = {
  defaults: {
    from: 'card',
    color: [0.42, 0.68, 1.20],     // 魏启蓝
    hot: [0.75, 0.95, 1.35],
    core: 0x6fa8ff,
    streams: 4, size: 4.2, projMs: 300, staggerMs: 65,
    pillar: false,
    fire: false,             // 火调行（重燃/余热/回响烈焰）：流股走 fireOrbShade 火面核
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    return async (ctx, deps, notify) => {
      const to = deps.playerAnchor?.();
      const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 230, scale: 1.35 });
      if (!to) { await flareJob; notify(); return; }

      // 起点解析（三态）。enemy：抽取对象的锚点一带（无指定目标时 = 全体存活敌之首，
      // 「从敌方阵营抽」的读感成立）
      let origins = [];
      if (prm.from === 'enemy') {
        const foe = deps.targets()[0] ?? null;
        if (foe) {
          const a = deps.unitAnchor(foe);
          origins = [0, 1, 2, 3].map(i => ({ x: a.x + (i - 1.5) * 2.4, y: a.y + (i % 2) * 3.0 - 1, z: a.z }));
        }
      } else if (prm.from === 'around') {
        // 世界坐标 y 大 = 屏幕下方（世界相机俯角）；流股从主角上下左右外侧汇入
        origins = [
          { x: to.x - 8, y: to.y - 14, z: to.z },    // 左上（y-14 = 屏幕上）
          { x: to.x - 6, y: to.y + 12, z: to.z },    // 左下
          { x: to.x + 10, y: to.y - 10, z: to.z },   // 右上
          { x: to.x + 8, y: to.y + 14, z: to.z },    // 右下
        ];
      } else {
        const c = deps.cardTipWorld();
        if (c) origins = [0, 1, 2].map(i => ({ x: c.x + (i - 1) * 1.8, y: c.y + (i % 2) * 1.5, z: c.z }));
      }
      if (!origins.length) origins = [{ x: to.x, y: to.y + 8, z: to.z }];   // 兜底：天顶汇入

      let last = null;
      const n = Math.min(prm.streams, origins.length + 1);
      for (let i = 0; i < n; i++) {
        const from = origins[i % origins.length];
        last = ctx.spawn(async (c) => {
          await c.wait(i * prm.staggerMs);
          await arcProjectile(c, deps, {
            from, to,
            color: prm.color, hot: prm.hot, size: prm.size, fire: prm.fire,
            ms: prm.projMs, arcH: 3.2, stretch: 2.2, lampIntensity: 0,
            trail: { color: prm.core, count: 1, ttl: 0.3, speed: 3, size: 0.65 },
          });
        });
      }
      await flareJob;
      if (last) {
        await last.promise;
        if (prm.pillar) {
          ctx.spawn((c) => lightPillar(c, deps, {
            at: { x: to.x, y: to.y - 2, z: to.z }, color: prm.color, hot: prm.hot,
            width: 3.0, height: 15, ms: 620,
          }));
        }
        // 能量落体：胸口小爆（轻反馈不震屏）。等完再 notify——模板结束会结构化
        // 杀掉子协程，半途放行的闪光会被硬切
        await ctx.spawn((c) => impactBurst(c, deps, {
          at: to, color: prm.color, hot: prm.hot, burstColor: prm.core,
          count: 10, speed: 11, size: 0.8, ttl: 0.5, gravity: 3,
          flashSize: 3.8, flashMs: 260, lampIntensity: 480, lampMs: 280,
        })).promise;
      }
      notify();
    };
  },
};
