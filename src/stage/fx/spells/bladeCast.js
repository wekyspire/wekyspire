// 刀法施术模板（blade 体系默认，2026-10-02）：冷白刀光语言，与体修暖象牙拳风、
// 火系橙红爆燃三分色相。命中斩痕在伤害节拍（damageFx slash 按卡名分方向），
// 本模板只管「出刀」读感——刀光飞行体与命中斩痕一前一后（火球链同款结构）。
// 四模式（params.mode，缺省按目标口径自动路由）：
//   slash    单发刀光（默认，enemy 目标）：细长拉伸、低弧、极快——读「出鞘即至」
//   daggers  飞刀链（飞刀/重匕/灭匕/回旋匕/精匕/绝匕）：3 把小刀错峰连投
//   cascade  碎铁雨（ironRain 链）：碎铁自目标天顶泼落
//   self     无打击对象自动退化（刀舞/养刀/吐纳/磨刀/拔刀）：刀光绕身一记 +
//            可选磨刀火星（params.grindSparks）
import { getSkillDefinition } from '../../../core/skills/registry.js';
import { cardFlare, arcProjectile, slashSweep } from './blocks.js';

export const bladeCast = {
  defaults: {
    mode: 'auto',
    color: [0.80, 0.88, 1.15],     // 刀光晕色（冷白蓝——钢铁寒光）
    hot: [1.20, 1.25, 1.35],       // 热核色（过 bloom 阈起晕）
    core: 0xcfd8ea,                // 卡面起手脉冲
    arcH: 0.5,
    grindSparks: false,            // 磨刀链：冷白里掺金橙火星（「打磨」读感）
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    const def = (() => { try { return getSkillDefinition(p?._defId); } catch { return null; } })();
    return async (ctx, deps, notify) => {
      const origin = deps.playerAnchor?.() ?? deps.cardTipWorld();
      const targeted = def?.targetMode === 'enemy';
      const targets = targeted ? deps.targets() : [];
      const mode = prm.mode !== 'auto' ? prm.mode : (targets.length && origin ? 'slash' : 'self');

      const blade = (c, from, to, { size, ms, stretch, arcH, lamp = 0, yOff = 0 }) =>
        arcProjectile(c, deps, {
          from: { x: from.x, y: from.y + yOff, z: from.z }, to,
          color: prm.color, hot: prm.hot, size, ms, arcH,
          stretch, lampIntensity: lamp,
          trail: { color: 0xaec4e8, count: 1, ttl: 0.22, speed: 3, size: 0.45 },
        });

      if (mode === 'daggers') {
        const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 200, scale: 1.3 });
        const offs = [-0.8, 0.6, -0.3];
        const jobs = [];
        for (const u of targets) {
          for (let s = 0; s < 3; s++) {
            jobs.push((async () => {
              await ctx.wait(s * 80);
              await blade(ctx, origin, deps.unitAnchor(u), {
                size: 1.5, ms: 140, stretch: 3.2, arcH: 1.2, yOff: offs[s % offs.length],
              });
            })());
          }
        }
        await Promise.all([flareJob, ...jobs]);
        notify();
        return;
      }

      if (mode === 'cascade') {
        const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 220, scale: 1.35 });
        const jobs = [];
        for (const u of targets) {
          const feet = deps.unitFeet(u);
          for (let s = 0; s < 5; s++) {
            jobs.push((async () => {
              await ctx.wait(s * 60);
              const xJit = ((s * 37) % 5 - 2) * 1.6;   // 确定性散布（-3.2..3.2）
              await blade(ctx, { x: feet.x + xJit, y: feet.y + 24, z: feet.z }, feet, {
                size: 1.4, ms: 230, stretch: 2.6, arcH: 0.5,
              });
            })());
          }
        }
        await Promise.all([flareJob, ...jobs]);
        notify();
        return;
      }

      if (mode === 'slash') {
        const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 190, scale: 1.3 });
        await Promise.all([
          flareJob,
          ...targets.map((u, i) => blade(ctx, origin, deps.unitAnchor(u), {
            size: 2.6, ms: 150, stretch: 4.5, arcH: prm.arcH, lamp: i === 0 ? 300 : 0,
          })),
        ]);
        notify();
        return;
      }

      // self：刀光绕身一记（随机斜率——舞刀读感）+ 可选磨刀火星
      await cardFlare(ctx, deps, { color: prm.core, ms: 230, scale: 1.4 });
      const player = deps.playerUnit?.();
      if (player) {
        await slashSweep(ctx, deps, {
          at: deps.unitAnchor(player),
          angle: (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.7),
          ms: 320, scale: 0.85,
          color: [0.95, 0.99, 1.1], fringe: [0.5, 0.7, 1.5],
          yOff: 0.9,
        });
        if (prm.grindSparks) {
          const feet = deps.unitFeet(player);
          deps.particles?.spawn?.(feet.x, feet.y + 3, {
            color: 0xffc27a, count: 12, speed: 9, size: 0.5, ttl: 0.6, gravity: -16, z: feet.z,
          });
        }
      }
      notify();
    };
  },
};
