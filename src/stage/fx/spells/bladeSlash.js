// 先锋模板：刀法施术（卡面起手）。刀光本体在**伤害节拍**驱动（units.js
// _damageHit → resolveSlashVariant + slashScaleFor）：伤害量在那里才有真值、
// 方向语义按卡名（斩竖/劈横/刀舞连击随机）、多段伤害逐拍触发 = 连击白送。
// 施术拍只留短起手（冷白脉冲），快进快出不拖节奏。
import { cardFlare } from './blocks.js';

export const bladeSlash = {
  defaults: {
    flareColor: 0xcfd8ea,   // 卡面起手（冷白）
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    return async (ctx, deps, notify) => {
      await cardFlare(ctx, deps, { color: prm.flareColor, ms: 220, scale: 1.35 });
      notify();   // 起手即放行——刀光随伤害节拍走，施术拍不占时序
    };
  },
};
