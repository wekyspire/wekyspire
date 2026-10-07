// 终极火花起手模板（spark 链 S 档：ultimateSpark——随机小伤 ×7）：伤害拍的
// 乱射弧弹归 damageFx（ignition owned，逐发自持）；施术拍演「弹药上膛」——
// 主角手上 7 颗火星核**逐颗点亮**（错峰微闪，预演七连射的密度）再一记轻聚。
// 不指目标（core 侧逐段随机索敌，真值只在伤害节拍——预闪全在手上，不预判落点）。
import { cardFlare, spellQuad, linearColor, SPELL_DEBUG } from './blocks.js';
import { projectileShade } from './shaders.js';
import { uniform, uv } from 'three/tsl';

export const sparkSalvo = {
  defaults: {
    count: 7,                    // 连射数（与卡面 ×N 对齐）
    color: [1.0, 0.72, 0.24], hot: [1.30, 1.10, 0.60],
    core: 0xffd97a,
    size: 1.8, staggerMs: 65, holdMs: 280,
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    return async (ctx, deps, notify) => {
      const origin = deps.playerAnchor?.() ?? deps.cardTipWorld();
      const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 240, scale: 1.5 });
      if (!origin) { await flareJob; notify(); return; }

      // 手前一小扇面上排开 N 颗火星核：逐颗点亮 → 齐亮一拍 → 同步熄灭放行
      const n = Math.max(1, prm.count);
      const spread = Math.min(9, 1.6 + n * 0.9);
      const cores = [];
      for (let i = 0; i < n; i++) {
        const uProg = uniform(0.0);
        const { quad, release } = spellQuad({
          shade: projectileShade(uv(), uProg, linearColor(prm.color), linearColor(prm.hot)),
          width: prm.size, height: prm.size, name: 'spellFx:sparkCharge',
        });
        const t = n === 1 ? 0.5 : i / (n - 1);
        quad.position.set(
          origin.x + (t - 0.5) * spread,
          origin.y + Math.sin(t * Math.PI) * 1.2,
          (origin.z ?? 0) + 1,
        );
        deps.scene.add(quad);
        ctx.onKill(release);
        cores.push({ quad, uProg, release, i });
      }
      const disposeAll = () => { for (const c of cores) c.release(); };
      if (SPELL_DEBUG === 'hold') {
        for (const c of cores) { c.uProg.value = 8 + c.i; c.quad.scale.set(1.0, 1.0, 1); }
        await ctx.wait(3000);
        disposeAll();
        await flareJob;
        notify();
        return;
      }
      // 逐颗点亮（相位推进 = 闪烁核活性）
      const lightJobs = cores.map((c) => ctx.spawn(async (sub) => {
        await sub.wait(c.i * prm.staggerMs);
        const st = { v: 0 };
        await sub.tweenRaw(st, { v: 1 }, {
          durationMs: 130, ease: 'power2.out',
          onUpdate: () => {
            c.uProg.value = st.v * 10;
            const s = 0.25 + st.v * 0.75;
            c.quad.scale.set(s, s, 1);
          },
        });
      }).promise);
      await Promise.all(lightJobs);
      // 齐亮一拍（弹药就绪）→ 同步熄灭
      const st = { v: 1 };
      await ctx.tweenRaw(st, { v: 0 }, {
        durationMs: prm.holdMs, ease: 'power2.in',
        onUpdate: () => {
          for (const c of cores) {
            c.uProg.value = 10 + st.v * 6;
            const s = 0.3 + st.v * 0.85;
            c.quad.scale.set(s, s, 1);
          }
        },
        onComplete: disposeAll,
      });
      await flareJob;
      notify();
    };
  },
};
