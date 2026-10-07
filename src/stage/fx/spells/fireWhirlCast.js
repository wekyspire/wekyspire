// 火焰旋风模板（fireWhirl 群伤，2026-10-07 粒子化重做——圆柱噪声面片方案被用户
// 废弃，换 GPU 粒子火旋风：fx/gpu/fireWhirlOrbit.js，「类太极但更精致」）：主体 =
// 主角周身拔起的粒子龙卷（三族：火芯螺旋/外缘火舌/逆行余焰；涡剪+漏斗+螺旋臂），
// 轴心白热柱与贴地破边火环降为配合件。逐敌落地火仍在伤害节拍（damageFx
// fireWhirl → fireburst ground），施术拍只演「风起于己」。rings = 2（S 焰流飓风）：
// 包络抬到 1.3（更密更快）+ 二段反向地环（叠浪读感）。
import { cardFlare, lightPillar, groundRing, SPELL_DEBUG } from './blocks.js';
import { createFireWhirlLink } from '../gpu/fireWhirlOrbit.js';
import { push as pushMood } from '../sceneMood.js';

export const fireWhirlCast = {
  defaults: {
    color: [1.0, 0.48, 0.16], hot: [1.2, 0.92, 0.55],
    core: 0xff8c3a,
    rings: 1,
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    return async (ctx, deps, notify) => {
      const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 260, scale: 1.5 });
      const player = deps.playerUnit?.();
      const feet = player ? deps.unitFeet(player) : null;
      if (feet) {
        // ① 主体：粒子火旋风（包络 0→peak 急起 → 持续 → 缓收）。池缺位 = null，
        //    退化为柱+地环+火星（与 qiOrbit 同口径）
        const link = createFireWhirlLink(deps.worldPool ?? null);
        const peak = prm.rings >= 2 ? 1.3 : 1.0;
        if (link) {
          link.start();
          link.setAnchor({ x: feet.x, y: feet.y, z: (feet.z ?? 0) + 1, H: 19 });
          ctx.onKill(() => { link.setLevel(0); link.stop(); });
          const st = { v: 0 };
          ctx.spawn(async (c) => {
            await c.tweenRaw(st, { v: peak }, {
              durationMs: 260, ease: 'power2.out',
              onUpdate: () => link.setLevel(st.v),
            });
            await c.wait(prm.rings >= 2 ? 620 : 480);
            await c.tweenRaw(st, { v: 0 }, {
              durationMs: 560, ease: 'sine.in',
              onUpdate: () => link.setLevel(st.v),
            });
            link.stop();
          });
          if (SPELL_DEBUG === 'hold') link.setLevel(peak);
        }
        // ①½ 轴心白热柱：涡芯的径向温度核（粒子涡心的亮轴——穿顶一截）
        ctx.spawn((c) => lightPillar(c, deps, {
          at: { x: feet.x, y: feet.y - 2, z: feet.z }, color: prm.color, hot: prm.hot,
          width: 2.1, height: 20, ms: 800,
        }));
        // ② 辅助：贴地破边火环（起涡一击的地面响应）+ 上升火星；PCG 场景交互广播照旧
        deps.notify?.('impact', { at: { x: feet.x, z: feet.z ?? 0 }, power: prm.rings >= 2 ? 1.2 : 0.9 });
        deps.notify?.('heat', { at: { x: feet.x, z: feet.z ?? 0 }, temp: prm.rings >= 2 ? 1.6 : 1.2 });
        const ringJob = groundRing(ctx, deps, {
          at: feet, size: prm.rings >= 2 ? 17 : 13, ms: 480, spin: 3.4,
          color: prm.color, hot: prm.hot,
        });
        deps.particles?.spawn?.(feet.x, feet.y + 1, {
          color: 0xff8c3a, count: 14, speed: 14, size: 0.85, ttl: 0.6, gravity: 10, z: feet.z,
        });
        const jobs = [ringJob];
        if (prm.rings >= 2) {
          jobs.push((async () => {
            await ctx.wait(200);
            deps.notify?.('impact', { at: { x: feet.x, z: feet.z ?? 0 }, power: 1.0 });
            deps.notify?.('heat', { at: { x: feet.x, z: feet.z ?? 0 }, temp: 1.3 });
            deps.particles?.spawn?.(feet.x, feet.y + 1, {
              color: 0xff8c3a, count: 12, speed: 16, size: 0.85, ttl: 0.6, gravity: 10, z: feet.z,
            });
            return groundRing(ctx, deps, {
              at: feet, size: 19, ms: 520, spin: -2.6,   // 二段反向（叠浪）
              color: prm.color, hot: prm.hot,
            });
          })());
        }
        // ③ 场景缓变：风起带一拍暖潮
        pushMood('fireWhirl', { warmth: prm.rings >= 2 ? 0.30 : 0.20, exposure: prm.rings >= 2 ? 1.10 : 1.05 },
          { holdMs: prm.rings >= 2 ? 750 : 520 });
        if (SPELL_DEBUG === 'hold') await ctx.wait(3000);
        await Promise.all([flareJob, ...jobs]);
        // 主体（地环/柱）落定即放行——粒子余焰 ttl ≤3s 后台散尽（无主资产）
        await ctx.wait(240);
      } else {
        await flareJob;
      }
      notify();
    };
  },
};
