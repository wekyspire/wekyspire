// 蓄力施术模板（体修·蓄力链：洗入瞬击进牌库——语义是「内聚蓄存」，不是挥拳）：
// N 个气团从主角**贴身**一圈浮现（蓄的是自己的力，起环半径小，与 manaCast 的
// 战场边缘汲取拉开读感）→ 错峰向胸口内聚 → 胸口凝核一闪。
// 入库落点不由本拍演：紧随的 ANIM_CARD_ADDED 节拍逐张生成真卡面飞牌库（蓄力链
// 的「产出了什么」由那些节拍交代）；本拍只演「蓄」。气团数 = 洗入数（等阶分档，
// 逐卡 params.count 给）；toHand 变体（一瞬千击：发现 5 瞬击直接进手）凝核后
// 补一拍向下散气（弹药到手的方向语义），其余同。
import { cardFlare, arcProjectile, impactBurst } from './blocks.js';

export const chargeUpCast = {
  defaults: {
    count: 3,                       // 气团数（= 洗入数，逐卡覆写 2/3/4/5）
    color: [0.88, 0.90, 0.96],      // 体修白气（黑灰白家的白）
    hot: [1.12, 1.12, 1.18],
    core: 0xd8dce8,
    accent: 0xf0d060,               // 凝核爆点掺 AP 黄（瞬击 = 0 费弹药的暗示）
    ringR: 6.0,                     // 气团起环半径（贴身）
    size: 2.6, projMs: 280, staggerMs: 55, arcH: 2.2,
    toHand: false,
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    return async (ctx, deps, notify) => {
      const to = deps.playerAnchor?.();
      const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 230, scale: 1.35 });
      if (!to) { await flareJob; notify(); return; }

      // 贴身环上取 N 个起点（角度错开，起始相位随机——同链多打不撞形）
      const n = Math.max(1, prm.count);
      const phase = Math.random() * Math.PI * 2;
      let last = null;
      for (let i = 0; i < n; i++) {
        const a = phase + (i / n) * Math.PI * 2;
        const from = {
          x: to.x + Math.cos(a) * prm.ringR,
          y: to.y + Math.sin(a) * prm.ringR * 0.7,   // y 压扁成椭圆——绕身不绕头顶
          z: to.z,
        };
        last = ctx.spawn(async (c) => {
          await c.wait(i * prm.staggerMs);
          await arcProjectile(c, deps, {
            from, to,
            color: prm.color, hot: prm.hot, size: prm.size,
            ms: prm.projMs, arcH: prm.arcH, stretch: 1.6, lampIntensity: 0,
          });
        });
      }
      await flareJob;
      if (last) {
        await last.promise;
        // 凝核：胸口一记白气小爆（掺几粒 AP 黄——弹药成形的读感）
        deps.particles?.spawn?.(to.x, to.y, {
          color: prm.accent, count: 5, speed: 8, size: 0.8, ttl: 0.5, gravity: -6, z: to.z,
        });
        await ctx.spawn((c) => impactBurst(c, deps, {
          at: to, color: prm.color, hot: prm.hot, burstColor: prm.core,
          count: 10, speed: 10, size: 0.8, ttl: 0.45, gravity: -4,
          flashSize: 4.6, flashMs: 280, lampIntensity: 420, lampMs: 300,
        })).promise;
      }
      if (prm.toHand) {
        // 弹药到手：凝核向下散出一捧气（世界 y 负向 = 屏幕下方手牌区一带）
        deps.particles?.spawn?.(to.x, to.y - 2, {
          color: prm.core, count: 14, speed: 16, size: 0.9, ttl: 0.5,
          gravity: -26, z: to.z,
        });
      }
      notify();   // 小卡档：全程演完（气团近程，~600ms）
    };
  },
};
