// 虚形拳施术模板（S 签名「虚」）：冷白压暗 + 七道虚影细流自周身环布汇聚入体。
// 后手成立则随后七牌入手（虚影「兑现」为实牌——ANIM_CARD_DRAWN 节拍逐张交代）；
// 不成立则散作虚无。模板不预判后手（normal 卡在施术拍处理时自身已离手，手牌
// 快照判不准；且虚形语言的要点就是暧昧）——似有所成，成与不成看后手。
// 与蓄力链（chargeUpCast 气团凝核成形）的分野：虚影细流**入体无形**——抵达不爆、
// 不凝核，汇聚即消散。
import { cardFlare, arcProjectile, dreadVeil } from './blocks.js';

export const voidFistCast = {
  defaults: {
    veil: 0.42,                    // 冷场压暗
    inMs: 300, outMs: 380,
    streams: 7,                    // 七影（预-echo 抽 7 的量感——不承诺，只暗示）
    staggerMs: 55, streamMs: 300,
    core: 0xdde8f8,                // 卡面起手脉冲（冷白）
    color: [0.82, 0.88, 1.05],     // 虚影体色（阈下哑光——虚）
    hot: [1.15, 1.20, 1.35],       // 核微亮（不过火——不是实气）
    ringR: 9,                      // 起环半径（四面八方来——比蓄力的贴身环开）
    size: 1.5,                     // 细流（蓄力气团 2.6 的对位：虚比实细）
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    return async (ctx, deps, notify) => {
      const to = deps.playerAnchor?.() ?? null;
      const veil = dreadVeil(ctx, deps);
      const ramp = veil.set(prm.veil, prm.inMs, 'sine.in');
      const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 240, scale: 1.35 });
      await ramp;
      if (to) {
        // 环布起点：角度错开 + 起始相位随机（同链多打不撞形）；y 压扁成椭圆
        const phase = Math.random() * Math.PI * 2;
        let last = null;
        for (let i = 0; i < prm.streams; i++) {
          const a = phase + (i / prm.streams) * Math.PI * 2;
          const from = {
            x: to.x + Math.cos(a) * prm.ringR,
            y: to.y + Math.sin(a) * prm.ringR * 0.55 + 1.5,
            z: (to.z ?? 0) + 3,
          };
          last = ctx.spawn(async (c) => {
            await c.wait(i * prm.staggerMs);
            await arcProjectile(c, deps, {
              from, to,
              color: prm.color, hot: prm.hot, size: prm.size,
              ms: prm.streamMs, arcH: 1.2, arcJitter: 0.5, stretch: 2.2, lampIntensity: 0,
            });
          });
        }
        if (last) await last.promise;
        // 入体无形：抵达处只留一息白雾（不爆不凝——虚影散入经脉）
        deps.particles?.spawn?.(to.x, to.y, {
          color: 0xe8eefb, count: 8, speed: 3, size: 1.2, ttl: 0.8, gravity: 2, z: to.z,
        });
      }
      await Promise.all([veil.set(0, prm.outMs, 'power2.out'), flareJob]);
      notify();   // 大卡档：虚影落定、幕收即放行（尾雾 ttl 后台散尽）
    };
  },
};
