// 体修施术模板（fist/punch 体系默认，2026-10-02）：体修是近身拳师——不发投射物
// （2026-10-02 用户定：「拳系列没必要做成投射物」）。起手 = 主角拳面气劲蓄亮
// （projectileShade 核原地膨胀），落点命中由伤害拍 punchImpact 承担（冲击环+速度线），
// 一前一后无飞行体。四模式（params.mode）：
//   strike  单发直拳（默认）：拳面气劲一闪 + 目标冲击环
//   heavy   重拳（崩/轰/炮/真/虎/蓄满系）：拳面蓄力核收束膨胀 + 微震渐强 →
//           目标大冲击环 + 灯 punch + 小震屏
//   rapid   连击（雨拳/乱拳/千手/万手）：目标身上 N 记小冲击环错峰连闪（贴身快打读感）
//   utility 无打击对象时自动退化（肘击咏唱/抽牌引擎/发现类）——flare + 主角周身气浪
import { getSkillDefinition } from '../../../core/skills/registry.js';
import { cardFlare, punchImpact, spellQuad, linearColor } from './blocks.js';
import { projectileShade } from './shaders.js';
import { uniform, uv } from 'three/tsl';

export const fistCast = {
  defaults: {
    mode: 'strike',
    color: [1.0, 0.93, 0.78],     // 气劲晕色（暖象牙——体修气劲）
    hot: [1.35, 1.28, 1.10],      // 热核色（推过 bloom 阈）
    core: 0xf2e7d2,               // 卡面起手脉冲
    shots: 3, staggerMs: 110,     // rapid 连闪参数
    gatherMs: 420,                // heavy 蓄力时长
    aoe: false,                   // 群伤拳（蓄满一击/全神一击）：全体敌人齐闪
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

      // 拳面气劲核（起手读感：聚气于拳）：原位膨胀 + 闪烁相位推进，收手自收
      const fistGlow = async (c, { size = 3.4, ms = 200, holdOk = false } = {}) => {
        const uProg = uniform(0.0);
        const { quad, geo, mat } = spellQuad({
          shade: projectileShade(uv(), uProg, linearColor(prm.color), linearColor(prm.hot)),
          width: size, height: size, name: 'spellFx:fistGather',
        });
        quad.position.set(origin.x, origin.y, (origin.z ?? 0) + 1);
        deps.scene.add(quad);
        c.onKill(() => { deps.scene.remove(quad); geo.dispose(); mat.dispose(); });
        if (holdOk && new URLSearchParams(location.search).get('spelldebug') === 'hold') {
          uProg.value = 10; quad.scale.set(0.9, 0.9, 1);
          await c.wait(3000);
        } else {
          const st = { t: 0 };
          await c.tweenRaw(st, { t: 1 }, {
            durationMs: ms, ease: 'power2.in',
            onUpdate: () => { uProg.value = st.t * 10; const s = 0.4 + 0.6 * st.t; quad.scale.set(s, s, 1); },
          });
        }
        deps.scene.remove(quad); geo.dispose(); mat.dispose();
      };

      // 目标冲击环（贴身命中的「拳到」读感）——伤害拍还有一记 punchImpact，
      // 这里用更小更短的一记做「起手→命中」的呼应（不打两次大灯）
      const hitFlash = (c, u, { scale, ms, lamp = 0, delay = 0 }) =>
        (async () => {
          if (delay) await ctx.wait(delay);
          const s = u._baseScale ?? 1;
          await punchImpact(c, deps, {
            at: { x: u.position.x, y: u.position.y + 4.9 * s, z: u.position.z },
            dir: 1, scale, ms, lampIntensity: lamp, sparkCount: 8,
          });
        })();

      if (mode === 'heavy') {
        const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 260, scale: 1.5 });
        deps.shake?.sustain?.(0.35);
        ctx.onKill(() => deps.shake?.sustain?.(0));
        await fistGlow(ctx, { size: 4.6, ms: prm.gatherMs, holdOk: true });
        deps.shake?.sustain?.(0);
        deps.shake?.impulse?.(0.8);
        // 重拳：目标大冲击环 + 首目标灯 punch（走廊照亮）
        await Promise.all([flareJob, ...targets.map((u, i) =>
          hitFlash(ctx, u, { scale: 1.15, ms: 300, lamp: i === 0 ? 700 : 0 }))]);
        notify();
        return;
      }

      if (mode === 'rapid') {
        const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 200, scale: 1.3 });
        await fistGlow(ctx, { size: 2.8, ms: 150 });
        const jobs = [];
        for (const u of targets) {
          for (let s = 0; s < prm.shots; s++) {
            jobs.push(hitFlash(ctx, u, { scale: 0.55, ms: 140, delay: s * prm.staggerMs }));
          }
        }
        await Promise.all([flareJob, ...jobs]);
        notify();
        return;
      }

      if (mode === 'strike') {
        const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 200, scale: 1.3 });
        await fistGlow(ctx, { size: 3.4, ms: 180 });
        await Promise.all([flareJob, ...targets.map((u, i) =>
          hitFlash(ctx, u, { scale: 0.8, ms: 220, lamp: i === 0 ? 320 : 0 }))]);
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
