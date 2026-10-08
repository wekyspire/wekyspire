// 火焰上身模板（火系自燃件：燃心决/急燃/可燃血液/火墙/熔岩铠甲/血焰/
// 鬼火/焰愈/涅槃/火焰披风…）：火焰在**主角**身上腾起，暖光 punch 封顶。
// 三形态（params.form，2026-10-06 分化——「一坨雾换色」是实测病根）：
//   burst 火环爆+上升火星（缺省：自燃/急燃/焰愈/庆典——「烧起来」）
//   veil  贴身火帘缓燃（熔岩铠甲/火墙/血焰——「甲与墙」，火根贴地向上裹身）
//   wisp  漂浮小焰上飘（鬼火/可燃血液——轻件，「引而不发」）
// 大卡（涅槃级）任意形态加一道短火柱封顶。主题色参数化：橙 = 自燃通用 /
// 金 = 治愈与庆典 / 青白 = 鬼火 / 深红 = 血焰。
// 粒子预算纪律：buff 卡是高频动作——三层组总预算 ~34（旧版 62 实测糊成噪团）。
import { cardFlare, fireBurst, lightPillar, spellQuad, linearColor, lampPulse, SPELL_DEBUG } from './blocks.js';
import { projectileShade, veilShade } from './shaders.js';
import { uniform, uv } from 'three/tsl';

export const selfFlame = {
  defaults: {
    form: 'burst',
    color: [1.0, 0.45, 0.15], hot: [1.0, 0.88, 0.60], ember: [1.0, 0.20, 0.05],
    core: 0xffa04a,
    scale: 1.05, ms: 520,
    sparks: { color: 0xffb066, count: 12, speed: 9, ttl: 1.5, gravity: 12 },   // 正重力 = 上升
    pillar: false,              // 大卡封顶火柱（涅槃/过大年）
  },
  build(p) {
    const prm = { ...this.defaults, ...p, sparks: { ...this.defaults.sparks, ...(p?.sparks ?? {}) } };
    return async (ctx, deps, notify) => {
      const player = deps.playerUnit?.();
      const feet = player ? deps.unitFeet(player) : null;
      const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 260, scale: 1.4 });
      if (!feet) { await flareJob; notify(); return; }
      if (prm.pillar) {
        ctx.spawn((c) => lightPillar(c, deps, {
          at: feet, color: prm.color, hot: prm.hot, width: 3.2, height: 17, ms: 640,
        }));
      }

      if (prm.form === 'veil') {
        // 贴身火帘：加宽 quad 竖在脚前（身侧双柱要在立牌轮廓外成型——窄幅帘会
        // 被明亮的钢灰甲洗掉），veilShade 主笔（点燃前锋升顶→缓燃→自底收）
        const uProg = uniform(0.0);
        const uSeed = uniform(Math.random() * 6.28 + 0.01);
        const W = 6.8 * prm.scale, H = 13.0 * prm.scale;
        const { quad, release } = spellQuad({
          shade: veilShade(uv(), uProg, linearColor(prm.color), linearColor(prm.hot), uSeed),
          width: W, height: H, name: 'spellFx:fireVeil',
        });
        quad.position.set(feet.x, feet.y + H * 0.5 - 1, (feet.z ?? 0) + 2);
        deps.scene.add(quad);
        ctx.onKill(release);
        if (SPELL_DEBUG === 'hold') {
          uProg.value = 0.62;
          await ctx.wait(3000);
          release();
          await flareJob;
          notify();
          return;
        }
        // 帘下缘的碎火（慢速少量——甲在烧但不撒野）
        deps.particles?.spawn?.(feet.x, feet.y + 0.5, {
          color: prm.sparks.color, count: 8, speed: 5, size: 0.8, ttl: 1.6, gravity: 9, z: feet.z,
        });
        ctx.spawn(async (c) => {
          await lampPulse(c, deps, {
            name: 'light:fx0', at: { x: feet.x, y: feet.y + 5, z: (feet.z ?? 0) + 2 },
            color: prm.color, peak: 620, attackMs: 300, decayMs: 640,
          });
        });
        const st = { t: 0 };
        await ctx.tweenRaw(st, { t: 1 }, {
          durationMs: prm.ms * 1.8, ease: 'sine.inOut',
          onUpdate: () => { uProg.value = st.t; },
          onComplete: () => { release(); },
        });
        await flareJob;
        notify();
        return;
      }

      if (prm.form === 'wisp') {
        // 飘焰：4~6 颗小焰核贴身错峰上飘（左右摇曳），粒子只做点补——「引而不发」
        const n = 5;
        const jobs = [];
        for (let i = 0; i < n; i++) {
          jobs.push(ctx.spawn(async (c) => {
            await c.wait(i * 90);
            const uProg = uniform(0.0);
            const { quad, release } = spellQuad({
              shade: projectileShade(uv(), uProg, linearColor(prm.color), linearColor(prm.hot)),
              width: 1.5, height: 1.5, name: 'spellFx:wisp',
            });
            const bx = feet.x + (Math.random() - 0.5) * 7;
            const by = feet.y + 1 + Math.random() * 2;
            quad.position.set(bx, by, (feet.z ?? 0) + 1.5);
            deps.scene.add(quad);
            c.onKill(release);
            const st = { t: 0 };
            await c.tweenRaw(st, { t: 1 }, {
              durationMs: 900, ease: 'power1.out',
              onUpdate: () => {
                uProg.value = st.t * 14;
                const s = 0.5 + Math.sin(Math.min(1, st.t * 1.5) * Math.PI) * 0.6;
                quad.scale.set(s, s, 1);
                quad.position.x = bx + Math.sin(st.t * 7 + i * 2.1) * 1.4;
                quad.position.y = by + st.t * 6;
              },
              onComplete: () => { release(); },
            });
          }).promise);
        }
        deps.particles?.spawn?.(feet.x, feet.y + 1.5, {
          color: prm.sparks.color, count: 8, speed: 4, size: 0.6, ttl: 1.4, gravity: 8, z: feet.z,
        });
        await Promise.all([flareJob, ...jobs]);
        notify();
        return;
      }

      // burst：脚下火环爆 + 上升火星（sparks 参数化组）+ 暖光 punch
      const burstJob = fireBurst(ctx, deps, {
        at: feet, scale: prm.scale, ms: prm.ms,
        color: prm.color, hot: prm.hot, ember: prm.ember,
        sparkColor: prm.sparks.color, sparkCount: 14, sparkSpeed: 15,
        linger: { count: 10, speed: 5, ttl: 1.8, size: 0.85, gravity: 6 },   // 余烬也上飘
        lampIntensity: 620,
      });
      deps.particles?.spawn?.(feet.x, feet.y + 2, {
        color: prm.sparks.color, count: prm.sparks.count, speed: prm.sparks.speed,
        size: 0.9, ttl: prm.sparks.ttl, gravity: prm.sparks.gravity, z: feet.z,
      });
      await Promise.all([flareJob, burstJob]);
      await ctx.wait(120);
      notify();
    };
  },
};
