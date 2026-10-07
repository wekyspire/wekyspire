// 火雨施术模板（火雨/火瀑）：卡面起手 → 逐目标自天顶掷落流星（起点高位 +
// 平缓弧 = 自上而下的坠感）。**流星离手即 notify**——落地爆炸在伤害节拍
// （damageFx 的 fireburst ground），群伤逐敌落地 = 雨点读感白送。
// 参数：aoe = 群伤件对**全体存活敌**落雨（targets() 按 payload.target 只给选中敌——
// 火雨链是 aoeDamage，施术拍必须拿敌阵全员，否则只有选中敌天上有火球）；
// size 按等阶逐卡覆写（火球体量随等阶涨）。
import { cardFlare, arcProjectile } from './blocks.js';

export const fireRainCast = {
  defaults: {
    color: [1.0, 0.42, 0.14],
    hot: [1.0, 0.86, 0.62],
    core: 0xff9a3d,
    size: 1.8, projMs: 380, arcH: 2.5, dropH: 26,   // dropH：天顶起掷高度
    staggerMs: 70,
    notifyAfterMs: 240,
    aoe: false,
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    return async (ctx, deps, notify) => {
      const targets = prm.aoe ? (deps.allEnemies?.() ?? deps.targets()) : deps.targets();
      if (!targets.length) { notify(); return; }
      const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 240 });
      let lastLaunch = null;
      targets.forEach((unit, i) => {
        const to = deps.unitFeet(unit);
        const from = { x: to.x - 6 - i * 2, y: to.y + prm.dropH, z: to.z };
        lastLaunch = ctx.spawn(async (c) => {
          await c.wait(i * prm.staggerMs);
          await arcProjectile(c, deps, {
            from, to,
            color: prm.color, hot: prm.hot, size: prm.size,
            ms: prm.projMs, arcH: prm.arcH,
            fire: true,
            trail: { color: 0xff7a2d },
          });
        });
      });
      await flareJob;
      if (lastLaunch) await lastLaunch.promise;
      await ctx.wait(prm.notifyAfterMs);
      notify();
    };
  },
};
