// 点火施术模板（点火/热浪 + 群燃件取暖链 + 纳气件焰涌链）：
// 卡面起手 → 火星种子快弧掷向目标（小 size + 快 projMs + 低弧 = 「点」出去的
// 轻物，逐发 track 登记）。末种离手即 notify；落点引燃在伤害/效果节拍
// （damageFx 的 ignition tracked：await 真实抵达——小火 + 蹿升火苗）。
// 参数：all = 逐敌错峰点种（群燃件）；selfSparks = 主角身上同时腾起火星
// （纳气「气归于己」的读感）。
import { cardFlare, arcProjectile } from './blocks.js';

export const igniteCast = {
  defaults: {
    color: [1.0, 0.42, 0.14],
    hot: [1.0, 0.86, 0.62],
    core: 0xffa04a,
    size: 1.2, projMs: 220, arcH: 2,
    all: false, staggerMs: 80,
    selfSparks: false,
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    return async (ctx, deps, notify) => {
      const targets = deps.targets();
      const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 200, scale: 1.2 });
      const list = prm.all ? targets : targets.slice(0, 1);
      const jobs = list.map((unit, i) => ctx.spawn(async (c) => {
        await c.wait(i * prm.staggerMs);
        await arcProjectile(c, deps, {
          from: deps.playerAnchor?.() ?? deps.cardTipWorld(),   // 从主角手上弹出
          to: deps.unitAnchor(unit),
          track: unit,   // 抵达登记：伤害拍（ignition tracked）await 真实落定
          color: prm.color, hot: prm.hot, size: prm.size,
          ms: prm.projMs, arcH: prm.arcH,
          fire: true,
          trail: { color: 0xff8c3a, count: 2, ttl: 0.3 },
        });
      }).promise);
      if (prm.selfSparks) {
        const player = deps.playerUnit?.();
        const feet = player ? deps.unitFeet(player) : null;
        if (feet) {
          deps.particles?.spawn?.(feet.x, feet.y + 1, {
            color: 0xffb066, count: 10, speed: 6, size: 0.6, ttl: 0.9, gravity: 10, z: feet.z,
          });
        }
      }
      await flareJob;
      await ctx.wait((list.length - 1) * prm.staggerMs + 40);   // 末种离手即放行
      notify();
      // 飞行子协程活在本协程内（spawn 随父本收尾连杀）——notify 后等落地方可收尾
      await Promise.all(jobs);
    };
  },
};
