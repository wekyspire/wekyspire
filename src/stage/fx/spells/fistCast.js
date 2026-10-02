// 体修施术模板（fist/punch 体系默认，2026-10-02）：卡面起手 +「拳风破空」——
// 拉伸能量核从主角手上直射目标（快、平弧、大 stretch，读突进而非投射物）。
// 命中本体在伤害节拍（damageFx punch：冲击环+速度线），本模板只管「出拳」读感。
// 四模式（params.mode）：
//   strike  单发直拳（默认）
//   heavy   重拳（崩/轰/炮/真/虎/蓄满系）：拳面蓄力核收束膨胀 + 微震渐强 →
//           放一记粗拳风（更大 size/stretch + 灯 punch）
//   rapid   连击（雨拳/乱拳/千手/万手）：N 发细拳风错峰连射（出拳点上下微散）
//   utility 无打击对象时自动退化（targetMode 非 enemy 且非群伤：肘击咏唱/抽牌
//           引擎/发现类）——只留 flare + 主角周身气浪，不发拳风（不误导目标）
import { getSkillDefinition } from '../../../core/skills/registry.js';
import { cardFlare, arcProjectile, spellQuad, linearColor } from './blocks.js';
import { projectileShade } from './shaders.js';
import { uniform, uv } from 'three/tsl';

export const fistCast = {
  defaults: {
    mode: 'strike',
    color: [1.0, 0.93, 0.78],     // 拳风晕色（暖象牙——体修气劲）
    hot: [1.35, 1.28, 1.10],      // 热核色（推过 bloom 阈——拳风要起晕才读得出速度）
    core: 0xf2e7d2,               // 卡面起手脉冲
    arcH: 0.8,
    shots: 3, staggerMs: 95,      // rapid 连射参数
    gatherMs: 420,                // heavy 蓄力时长
    aoe: false,                   // 群伤拳（蓄满一击/全神一击）：拳风扇向全体敌人
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    const def = (() => { try { return getSkillDefinition(p?._defId); } catch { return null; } })();
    return async (ctx, deps, notify) => {
      const origin = deps.playerAnchor?.() ?? deps.cardTipWorld();
      // 目标口径：单攻卡 = 玩家指定目标；群伤卡（aoe）= 全体存活敌；其余 = 无打击对象
      const targeted = def?.targetMode === 'enemy' || prm.aoe;
      const targets = targeted ? deps.targets() : [];
      const mode = (targets.length && origin) ? prm.mode : 'utility';

      const streak = (c, to, { size, ms, stretch, lamp = 0, yOff = 0 }) => arcProjectile(c, deps, {
        from: { x: origin.x, y: origin.y + yOff, z: origin.z }, to,
        color: prm.color, hot: prm.hot, size, ms, arcH: prm.arcH,
        stretch, lampIntensity: lamp,
        trail: { color: 0xffe9c8, count: 2, ttl: 0.25, speed: 4, size: 0.5 },
      });

      if (mode === 'heavy') {
        // ① 蓄力：能量核在主角拳面收束膨胀（projectileShade 闪烁核）+ 微震渐强
        const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 260, scale: 1.5 });
        const uProg = uniform(0.0);
        const { quad, geo, mat } = spellQuad({
          shade: projectileShade(uv(), uProg, linearColor(prm.color), linearColor(prm.hot)),
          width: 4.2, height: 4.2, name: 'spellFx:fistGather',
        });
        quad.position.set(origin.x, origin.y, (origin.z ?? 0) + 1);
        deps.scene.add(quad);
        ctx.onKill(() => { deps.scene.remove(quad); geo.dispose(); mat.dispose(); deps.shake?.sustain?.(0); });
        deps.shake?.sustain?.(0.35);
        // hold：定格蓄力核 t=0.7（调参/取证画布，截图不赌时序）——定完继续走放拳
        // （拳风进 arcProjectile 自己的 hold，两段同框可拍）
        if (new URLSearchParams(location.search).get('spelldebug') === 'hold') {
          uProg.value = 10;
          quad.scale.set(0.9, 0.9, 1);
          await ctx.wait(3000);
        } else {
          const st = { t: 0 };
          await ctx.tweenRaw(st, { t: 1 }, {
            durationMs: prm.gatherMs, ease: 'power2.in',
            onUpdate: () => {
              uProg.value = st.t * 14;
              const s = 0.35 + 0.8 * st.t;         // 收束膨胀（聚气读感）
              quad.scale.set(s, s, 1);
            },
          });
        }
        deps.scene.remove(quad); geo.dispose(); mat.dispose();
        deps.shake?.sustain?.(0);
        // ② 放拳：粗拳风 + 一记小震（灯 punch 把走廊照亮——弹体读感的一半来自灯）
        const jobs = targets.map((u, i) => streak(ctx, deps.unitAnchor(u), {
          size: 5.2, ms: 170, stretch: 3.6, lamp: i === 0 ? 700 : 0,
        }));
        deps.shake?.impulse?.(0.8);
        await Promise.all([flareJob, ...jobs]);
        notify();
        return;
      }

      if (mode === 'rapid') {
        const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 200, scale: 1.3 });
        const offs = [-0.9, 0.7, -0.4, 0.9, -0.7, 0.4];
        const jobs = [];
        for (const u of targets) {
          for (let s = 0; s < prm.shots; s++) {
            jobs.push((async (c) => {
              await ctx.wait(s * prm.staggerMs);
              await streak(ctx, deps.unitAnchor(u), {
                size: 2.4, ms: 150, stretch: 2.4, yOff: offs[s % offs.length],
              });
            })(ctx));
          }
        }
        await Promise.all([flareJob, ...jobs]);
        notify();
        return;
      }

      if (mode === 'strike') {
        const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 200, scale: 1.3 });
        await Promise.all([
          flareJob,
          ...targets.map((u) => streak(ctx, deps.unitAnchor(u), { size: 3.4, ms: 180, stretch: 3.0, lamp: 320 })),
        ]);
        notify();
        return;
      }

      // utility：无打击对象——flare + 主角周身气浪微粒（上下浮动），快进快出
      await cardFlare(ctx, deps, { color: prm.core, ms: 220, scale: 1.3 });
      if (origin) {
        deps.particles?.spawn?.(origin.x, origin.y - 1, {
          color: 0xf2e7d2, count: 10, speed: 6, size: 0.7, ttl: 0.5, gravity: 4, z: origin.z,
        });
      }
      notify();
    };
  },
};
