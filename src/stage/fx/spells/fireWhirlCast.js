// 火焰旋风模板（fireWhirl 群伤）：主角周身火焰冲击环外推（旋风过境的地面
// 响应）+ 上升火星旋带——逐敌落地火在伤害节拍（damageFx fireWhirl →
// fireburst ground），施术拍只留「风起于己」。
import { cardFlare, impactBurst } from './blocks.js';

export const fireWhirlCast = {
  defaults: {
    color: [1.0, 0.48, 0.16], hot: [1.0, 0.88, 0.60],
    core: 0xff8c3a,
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    return async (ctx, deps, notify) => {
      const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 240, scale: 1.5 });
      const player = deps.playerUnit?.();
      const feet = player ? deps.unitFeet(player) : null;
      if (feet) {
        // 大冲击环 + 旋带火星（上飘 + 多量——「旋」由扩散环读）
        const ringJob = impactBurst(ctx, deps, {
          at: feet, color: prm.color, hot: prm.hot, burstColor: 0xff8c3a,
          count: 26, speed: 20, size: 0.9, ttl: 0.7, gravity: 6,
          flashSize: 13, flashMs: 420, lampIntensity: 750, lampMs: 380,
          linger: { count: 14, speed: 8, ttl: 1.6, size: 0.7, gravity: 10 },
        });
        await Promise.all([flareJob, ringJob]);
      } else {
        await flareJob;
      }
      notify();
    };
  },
};
