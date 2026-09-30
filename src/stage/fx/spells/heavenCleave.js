// 天斩模板 v2（2026-10-01 用户定全演出谱，实体锁口径——全程演完才 notify）：
//   ① 压迫段：界面径向压暗渐至大幅暗淡（dreadVeil）+ 相机 fov 拉大（广角压迫）
//     + 镜头持续微震渐强（ScreenShake.sustain）+ 目标处暗光柱垂落预兆；
//   ② 斩落：巨幅白刃一闪而过（slashSweep HDR 白热）+ 全屏白闪 + 大震一记；
//   ③ 顿一拍 → 白金火光在目标身上迸裂（fireBurst 白金调）+ 冲天光柱
//     + 相机/压暗幕复原（fov flyHome、veil 释放）；
//   ④ 若目标在此伤下死亡 → 死亡节拍走「立牌裂成两半」（units.js
//     _unitCleaveSplitBeat；标记由本模板经 deps.markCleaveSplit 挂上）。
// 伤害节拍不补刀光（damageFx 对斩链三卡返回 null——避免双斩）。
// 档位：A（摧山斩）/ S（开天斩）/ X（断神斩·封顶尺度）。
import { cardFlare, slashSweep, lightPillar, fireBurst, dreadVeil, screenFlash } from './blocks.js';

const GRADES = {
  A: { dreadMs: 340, fov: 7,  tremble: 0.13, veil: 0.58, slashScale: 1.9, slashMs: 380, gapMs: 130, pillarMs: 750,  pillarH: 26, flash: 0.5,  burst: 1.3 },
  S: { dreadMs: 560, fov: 11, tremble: 0.20, veil: 0.74, slashScale: 2.5, slashMs: 420, gapMs: 170, pillarMs: 1000, pillarH: 34, flash: 0.75, burst: 1.55 },
  X: { dreadMs: 850, fov: 16, tremble: 0.30, veil: 0.87, slashScale: 3.2, slashMs: 460, gapMs: 200, pillarMs: 1450, pillarH: 46, flash: 0.95, burst: 1.9 },
};

export const heavenCleave = {
  defaults: { grade: 'S' },
  build(p) {
    const prm = { ...this.defaults, ...p };
    const g = GRADES[prm.grade] ?? GRADES.S;
    const X = prm.grade === 'X';
    return async (ctx, deps, notify) => {
      const targets = deps.targets();
      const t0 = targets[0] ?? null;
      const at = t0 ? deps.unitAnchor(t0) : null;
      const feet = t0 ? deps.unitFeet(t0) : null;
      // 断裂标记：这些目标若死于此伤，死亡节拍走「裂成两半」（无死亡则标记随舞台清理）
      deps.markCleaveSplit?.(targets);
      // 复原保险：协程被杀（保险丝/拆台）也必须还相机、停微震
      const cam = deps.camera ?? null;
      ctx.onKill(() => {
        deps.shake?.sustain?.(0);
        cam?.flyHome?.({ durationMs: 300, ease: 'power2.out' });
      });
      // ① 压迫段：幕起 + fov 拉大 + 微震渐强 + 暗柱预兆 + 卡面双脉冲蓄势
      const veil = dreadVeil(ctx, deps);
      const ramp = veil.set(g.veil, g.dreadMs);
      const base = cam?.basePose ?? null;
      if (cam && base) cam.flyTo({ ...base, fov: base.fov + g.fov }, { durationMs: g.dreadMs + 160, ease: 'power2.in' });
      if (feet) ctx.spawn((c) => lightPillar(c, deps, {
        at: feet, color: [0.08, 0.10, 0.14], hot: [0.10, 0.12, 0.16],
        width: X ? 6 : 4, height: g.pillarH, ms: g.dreadMs + 320,
      }));
      if (deps.shake?.sustain) {
        deps.shake.sustain(g.tremble * 0.3);
        await ctx.wait(Math.round(g.dreadMs * 0.4));
        deps.shake.sustain(g.tremble * 0.65);
        await ctx.wait(Math.round(g.dreadMs * 0.6));
        deps.shake.sustain(g.tremble);
      } else {
        await ctx.wait(g.dreadMs);
      }
      await cardFlare(ctx, deps, { color: 0xffffff, ms: Math.round(g.dreadMs * 0.5), scale: X ? 2.4 : 1.8 });
      await cardFlare(ctx, deps, { color: 0xffffff, ms: Math.round(g.dreadMs * 0.4), scale: X ? 3.2 : 2.2 });
      await ramp;
      // ② 斩落：白刃一闪 + 全屏白闪 + 大震一记（微震就此收口）
      deps.shake?.sustain?.(0);
      deps.shake?.impulse?.(X ? 6 : 3.5);
      ctx.spawn((c) => screenFlash(c, deps, { intensity: g.flash, ms: 240 }));
      if (at) {
        await slashSweep(ctx, deps, {
          at, angle: X ? 1.52 : 1.45, ms: g.slashMs,
          scale: g.slashScale, color: [1.0, 1.0, 1.0],
          fringe: X ? [1.8, 2.0, 2.6] : [1.4, 1.6, 2.2],
        });
      }
      // ③ 顿一拍 → 白金迸裂 + 冲天光柱 + 复原（相机/幕并行收回）
      await ctx.wait(g.gapMs);
      if (feet) {
        ctx.spawn((c) => lightPillar(c, deps, {
          at: feet, color: X ? [1.15, 1.05, 0.72] : [0.95, 0.95, 1.1], hot: [2.2, 2.1, 1.7],
          width: X ? 7 : 5, height: g.pillarH, ms: g.pillarMs,
        }));
        ctx.spawn((c) => fireBurst(c, deps, {
          at: feet, scale: g.burst,
          color: [1.0, 0.82, 0.42], hot: [1.8, 1.7, 1.4], ember: [1.2, 0.55, 0.14],
          sparkColor: 0xffe2a8, ms: 520,
        }));
        deps.shake?.impulse?.(4);
      }
      cam?.flyHome?.({ durationMs: 420, ease: 'power2.inOut' });
      // ④ 余韵：光柱燃尽途中放行（实体锁）。spawn 子协程随模板结束被杀（runScript
      //    的结构化取消），settle 覆盖到光柱只剩 ~200ms 尾巴再 notify——避免面片
      //    硬切读感
      await Promise.all([veil.set(0, 480, 'power2.out'), ctx.wait(Math.max(400, g.pillarMs - 200))]);
      notify();
    };
  },
};
