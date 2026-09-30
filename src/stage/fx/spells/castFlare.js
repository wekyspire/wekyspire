// 通用起手模板（原 bladeSlash 泛化，2026-09-30）：卡面色脉冲 + 起手即放行。
// 适用口径 =「命中本体全在伤害节拍」的体系（刀法/拳系/爆裂咏唱）：施术拍只留
// 短起手快进快出不拖节奏，颜色由体系行/逐卡行参数化（冷白刀、暖白拳、橙爆裂）。
import { cardFlare } from './blocks.js';

export const castFlare = {
  defaults: {
    flareColor: 0xcfd8ea,   // 缺省冷白（刀法起手）
    ms: 220, scale: 1.35,
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    return async (ctx, deps, notify) => {
      await cardFlare(ctx, deps, { color: prm.flareColor, ms: prm.ms, scale: prm.scale });
      notify();   // 起手即放行——命中演出随伤害节拍走，施术拍不占时序
    };
  },
};
