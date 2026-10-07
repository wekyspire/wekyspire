// 焚燃翻倍模板（burnDoubler：焚烧/星炎——「所有燃烧层数翻 N 倍」，叠炎体系的
// 关键引擎卡，2026-10-07 用户定大幅加强）：「火苗轰成烈焰」升级为**战场级喷发**——
// 每个燃烧点脚下火环炸开 → 焰柱拔地而起 → 火体爆燃（火势随层数），全场再补一拍
// 暖潮星雨回答（引擎卡的 payoff 要读「整个战场的火都被点爆了」）。
// 只点**燃烧中的单位**（deps.effectStacksOf 快照口径）；无人燃烧时退化为卡面
// 红闪（不落假演出）。主角自燃也参与翻倍——主角在列。
// grand（星炎 S ×3）：白热核 + 暖白闪 + 震屏——S 签名顶格档。
import { cardFlare, fireBurst, lightPillar, groundRing, screenFlash } from './blocks.js';
import { push as pushMood } from '../sceneMood.js';

export const burnSurge = {
  defaults: {
    color: [1.0, 0.38, 0.10], hot: [1.2, 0.95, 0.55], ember: [1.0, 0.16, 0.03],
    core: 0xff5a2a,             // 卡面起手（红橙——增幅系比火球更红）
    scale: 1.0,                 // 星炎（×3）走 1.25
    grand: false,               // 星炎签名档：白热核 + 白闪 + 震屏
    staggerMs: 90,
  },
  build(p) {
    const prm = { ...this.defaults, ...p };
    return async (ctx, deps, notify) => {
      const burning = deps.targets().filter(u => (deps.effectStacksOf?.(u, 'burn') ?? 0) > 0);
      const player = deps.playerUnit?.();
      if (player && (deps.effectStacksOf?.(player, 'burn') ?? 0) > 0) burning.push(player);
      if (!burning.length) {
        await cardFlare(ctx, deps, { color: prm.core, ms: 260, scale: 1.4 });
        notify();
        return;
      }
      const hot = prm.grand ? [1.45, 1.30, 0.95] : prm.hot;   // 星炎白热核
      const flareJob = cardFlare(ctx, deps, { color: prm.core, ms: 300, scale: 1.7 });
      // 场景缓变：全场的火被轰起来的一拍暖潮（与火旋风同通道，量级随 grand）
      pushMood('burnSurge', { warmth: prm.grand ? 0.34 : 0.24, exposure: prm.grand ? 1.12 : 1.06 },
        { holdMs: prm.grand ? 900 : 680 });
      // PCG 场景交互：热浪扫过每个喷发点
      for (const unit of burning) {
        const feet = deps.unitFeet(unit);
        deps.notify?.('heat', { at: { x: feet.x, z: feet.z ?? 0 }, temp: 1.4 * prm.scale });
      }
      // —— 逐燃烧点喷发链：火环炸开 → 焰柱拔地 → 火体爆燃（错峰）——
      const jobs = burning.map((unit, i) => ctx.spawn(async (c) => {
        await c.wait(i * prm.staggerMs);
        const stacks = deps.effectStacksOf?.(unit, 'burn') ?? 0;
        const s = prm.scale * (0.9 + Math.min(stacks, 30) / 30 * 0.8);   // 火势随层数
        const feet = deps.unitFeet(unit);
        ctx.spawn((c2) => groundRing(c2, deps, {
          at: feet, size: 13.5 * s, ms: 460, spin: 3.0,
          color: prm.color, hot,
        }));
        ctx.spawn((c2) => lightPillar(c2, deps, {
          at: feet, color: prm.color, hot,
          width: 5.0 * Math.min(1.6, s), height: 26, ms: 650,
        }));
        // 上冲火星双波（拔地而起的「轰」）
        deps.particles?.spawn?.(feet.x, feet.y + 1, {
          color: 0xff8c3a, count: 20, speed: 12, size: 0.95, ttl: 1.2, gravity: 14, z: feet.z,
        });
        ctx.spawn(async (c2) => {
          await c2.wait(140);
          deps.particles?.spawn?.(feet.x, feet.y + 2, {
            color: 0xffc27a, count: 14, speed: 14, size: 0.85, ttl: 1.0, gravity: 16, z: feet.z,
          });
        });
        await fireBurst(c, deps, {
          at: feet, scale: s, ms: 500,
          color: prm.color, hot, ember: prm.ember,
          sparkCount: 24, sparkSpeed: 22,
          linger: { count: 12, speed: 7, ttl: 1.8, size: 0.75, gravity: 7 },
          lampIntensity: prm.grand ? 950 : 750,
        });
      }).promise);
      await Promise.all([flareJob, ...jobs]);
      // —— 全场回答：敌阵上空一拍星雨（增幅后的「火的天空」；无主资产后台散）——
      const form = deps.enemyFormation?.() ?? null;
      if (form) {
        const w = Math.max(10, form.spread + 12);
        for (let k = 0; k < 4; k++) {
          deps.particles?.spawn?.(
            form.center.x + (k - 1.5) * (w / 2.2), form.center.y + 13 + (k % 2) * 2,
            {
              color: 0xffa050, count: 13, speed: 5, size: 0.95, ttl: 1.7,
              gravity: -7, z: form.center.z,
            });
        }
      }
      if (prm.grand) {
        ctx.spawn((c) => screenFlash(c, deps, { intensity: 0.32, ms: 260, color: 0xffe8c0 }));
        deps.shake?.impulse?.(1.4);
      }
      await ctx.wait(200);
      notify();
    };
  },
};
