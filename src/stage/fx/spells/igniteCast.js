// 点火施术模板（点火/烈焰/炙焰/热浪）：卡面起手 → 一粒火星种子快弧掷向目标
// （小 size + 快 projMs + 低弧 = 「点」出去的轻物）。落点引燃在伤害节拍
// （damageFx 的 ignition：小火 + 蹿升火苗——燃烧赋予的演出追认）。
import { cardFlare, arcProjectile } from './blocks.js';

export const igniteCast = {
  defaults: {
    color: [1.0, 0.42, 0.14],
    hot: [1.0, 0.86, 0.62],
    core: 0xffa04a,
    size: 1.2, projMs: 220, arcH: 2,
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    return async (ctx, deps, notify) => {
      const targets = deps.targets();
      const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 200, scale: 1.2 });
      const seed = targets.length
        ? arcProjectile(ctx, deps, {
            from: deps.playerAnchor?.() ?? deps.cardTipWorld(),   // 从主角手上弹出
            to: deps.unitAnchor(targets[0]),
            color: prm.color, hot: prm.hot, size: prm.size,
            ms: prm.projMs, arcH: prm.arcH,
            trail: { color: 0xff8c3a, count: 2, ttl: 0.3 },
          })
        : null;
      await Promise.all([flareJob, ...(seed ? [seed] : [])]);
      notify();   // 轻件快进快出；引燃读感在伤害节拍
    };
  },
};
