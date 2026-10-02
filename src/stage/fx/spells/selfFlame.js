// 火焰上身模板（火系自燃件：燃心决/急燃/可燃血液/火墙/熔岩铠甲/血焰/
// 鬼火/焰愈/涅槃/火焰披风…）：火焰在**主角**身上腾起——脚下火环爆 + 上升火星
// 缠身 + 暖光 punch；大卡（涅槃级）加一道短火柱封顶。主题色参数化：
// 橙 = 自燃通用 / 金 = 治愈与庆典 / 青白 = 鬼火 / 深红 = 血焰。
import { cardFlare, fireBurst, lightPillar } from './blocks.js';

export const selfFlame = {
  defaults: {
    color: [1.0, 0.45, 0.15], hot: [1.0, 0.88, 0.60], ember: [1.0, 0.20, 0.05],
    core: 0xffa04a,
    scale: 1.3, ms: 520,
    sparks: { color: 0xffb066, count: 22, speed: 9, ttl: 1.5, gravity: 12 },   // 正重力 = 上升
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
      const burstJob = fireBurst(ctx, deps, {
        at: feet, scale: prm.scale, ms: prm.ms,
        color: prm.color, hot: prm.hot, ember: prm.ember,
        sparkColor: prm.sparks.color, sparkCount: 24, sparkSpeed: 16,
        linger: { count: 16, speed: 5, ttl: 2.0, size: 0.9, gravity: 7 },   // 余烬也上飘
        lampIntensity: 800,
      });
      deps.particles?.spawn?.(feet.x, feet.y + 2, {
        color: prm.sparks.color, count: prm.sparks.count, speed: prm.sparks.speed,
        size: 0.9, ttl: prm.sparks.ttl, gravity: prm.sparks.gravity, z: feet.z,
      });
      await Promise.all([flareJob, burstJob]);
      await ctx.wait(140);
      notify();
    };
  },
};
