// 火系共享特效原语（2026-10-07 用户定：体系内可抽象的动画件收敛进 SDK 复用）：
//   burnSeed    赋予燃烧：焰种自主角手上快弧掷向目标（小 size + 低弧 = 「点」出去
//               的轻物）；落点引燃在伤害/效果节拍（ignition），燃烧本体由 L0 aura
//               接管——本件只演「种下去」。igniteCast 的逐敌点种即本件的批量调用。
//   burnSiphon  消耗燃烧：火滴自目标胸口升起、划弧汇聚到一点，到达后一簇小闪
//               即熄（「火被吸干了」）。适用一切燃烧扣减件：火源归一（全场→己）/
//               燃爆（敌→空中熄灭变现）/ 灭火（己→空中驱散）/ 熔毁（剥离段）。
import { uniform, uv } from 'three/tsl';
import { arcProjectile, spellQuad, linearColor } from './blocks.js';
import { ringFlashShade } from './shaders.js';

/**
 * 焰种点种（赋予燃烧的 shared beat）。unit 缺省不登记抵达（track=null——非
 * ignition 链的消费方没有 tracked 门，登记只会留待下次施术拍 reset 清掉）。
 * 落点带一圈小火环反馈（焰种「砸进去」的读感；本体引燃在伤害拍接管）。
 */
export async function burnSeed(ctx, deps, {
  unit, to = null,
  color = [1.0, 0.42, 0.14], hot = [1.0, 0.86, 0.62],
  size = 1.9, ms = 220, arcH = 2, track = false,
} = {}) {
  const dest = to ?? (unit ? deps.unitAnchor(unit) : null);
  if (!dest) return;
  await arcProjectile(ctx, deps, {
    from: deps.playerAnchor?.() ?? deps.cardTipWorld(),
    to: dest,
    track: track ? unit : null,
    color, hot, size, ms, arcH,
    fire: true,
    trail: { color: 0xff8c3a, count: 3, ttl: 0.4 },
  });
  const uProg = uniform(0.0);
  const { quad, release } = spellQuad({
    shade: ringFlashShade(uv(), uProg, linearColor(color), linearColor(hot), uniform(1.4)),
    width: 3.8, height: 3.8, name: 'spellFx:seedLand',
  });
  quad.position.set(dest.x, dest.y, (dest.z ?? 0) + 1);
  deps.scene.add(quad);
  ctx.onKill(release);
  const st = { t: 0 };
  ctx.spawn(async (c) => {
    await c.tweenRaw(st, { t: 1 }, {
      durationMs: 240, ease: 'power1.out',
      onUpdate: () => { uProg.value = st.t; },
      onComplete: release,
    });
  });
}

/**
 * 吸焰汇聚（消耗燃烧的 shared beat）：orbs 枚火滴自 from 周围散点升起 → 划弧
 * 汇聚到 to → 汇聚点一簇小闪即熄。orbs 按燃烧层数取（2 + min(5, stacks/4)）。
 */
export async function burnSiphon(ctx, deps, {
  from, to,
  color = [1.0, 0.45, 0.16], hot = [1.2, 0.95, 0.55],
  orbs = 4, size = 1.6, ms = 300, arcH = 2.4, staggerMs = 55,
  flicker = true,
} = {}) {
  if (!from || !to) return;
  const jobs = [];
  for (let i = 0; i < orbs; i++) {
    jobs.push(ctx.spawn(async (c) => {
      await c.wait(i * staggerMs);
      await arcProjectile(c, deps, {
        from: {
          x: from.x + (Math.random() - 0.5) * 2.8,
          y: from.y + Math.random() * 1.8 - 0.6,
          z: from.z,
        },
        to,
        color, hot, size, ms, arcH,
        fire: true,
        trail: { color: 0xb44a20, count: 1, ttl: 0.25, speed: 3, size: 0.6 },
      });
    }).promise);
  }
  await Promise.all(jobs);
  if (!flicker) return;
  // 汇聚点一簇小闪即熄（ringFlash 自带 uProgress 渐隐——「句号」不再另写渐隐）
  const uProg = uniform(0.0);
  const { quad, release } = spellQuad({
    shade: ringFlashShade(uv(), uProg, linearColor(color), linearColor(hot), uniform(2.0)),
    width: 6.0, height: 6.0, name: 'spellFx:siphonFlicker',
  });
  quad.position.set(to.x, to.y, (to.z ?? 0) + 1);
  deps.scene.add(quad);
  ctx.onKill(release);
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: 320, ease: 'power1.out',
    onUpdate: () => { uProg.value = st.t; },
    onComplete: release,
  });
}
