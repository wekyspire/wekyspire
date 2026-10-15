// 一章小怪起手族模板库（2026-10-15 敌人演出批）：
// 「族」= 同体态/同语义动作共享的编排骨架，配色/力度/粒子逐敌注入。
// 起手拍只演「施法者侧的身体语言」——落点反馈（护盾地环/增益扫描光带/受击）
// 由后续结算节拍承接（battleBeats.js），族模板不重复画结果。
// 姿态纪律：体态一律走 _pose 通道（setPose，出口归中 + onKill 同口径归中）——
// 后续突进（_damageHit 的突进编排）从干净姿态起跳；单位锚点口径与既有敌方
// 特效同源（胸口 3.4×s / 头 4.9×s / 脚 0.6×s，s = _baseScale）。
import * as THREE from 'three';
import { arcProjectile } from '../../spells/blocks.js';
import { playCastConverge, ringTexture } from '../../gainFx.js';

const sOf = (u) => u._baseScale ?? 1;
/** 世界锚点：胸口（k=1）——投射物起点/聚能落点。 */
const chestOf = (u, k = 1) => ({ x: u.position.x, y: u.position.y + 3.4 * sOf(u) * k, z: u.position.z ?? 0 });
const headOf = (u) => ({ x: u.position.x, y: u.position.y + 4.9 * sOf(u), z: u.position.z ?? 0 });
const feetOf = (u) => ({ x: u.position.x, y: u.position.y + 0.6 * sOf(u), z: u.position.z ?? 0 });
/** 朝向玩家的前倾 lean 值符号（右位敌人面向左 = 正；与 _damageHit 的 strikeLean 同口径）。 */
const leanToward = (unit, player, mag) =>
  -Math.sign((player?.position.x ?? unit.position.x - 1) - unit.position.x || -1) * mag;

// 族模板公共收尾：姿态回中（入口快照 → 果冻过冲一段收敛），并挂 kill 归中
// （收拍/拆台不晾半姿态）
function settlePose(ctx, unit, ms = 170) {
  ctx.onKill(() => unit.resetPose());
  const from = { ...unit._pose }; // 入口快照：onUpdate 里读 _pose 会逐帧复合衰减
  return ctx.custom(unit.uniqueID, {
    durationMs: ms, ease: 'power2.out',
    onUpdate: (t) => {
      // 过冲一段再回：squash/widen 越过 1 一次（果冻），lean 直接收敛
      const wob = Math.sin(Math.PI * Math.min(1, t * 1.6));
      unit.setPose({
        squash: (from.squash ?? 1) + (1 - (from.squash ?? 1)) * t + 0.05 * wob * (1 - t),
        widen: (from.widen ?? 1) + (1 - (from.widen ?? 1)) * t - 0.04 * wob * (1 - t),
        lean: (from.lean ?? 0) * (1 - t),
      });
    },
  });
}

/**
 * 攻击起手族（突进前的「预告」）：五种体态。
 *   blob   胶质（史莱姆族）：下压成团 → 向上拔长甩出液滴 → 果冻回落
 *   crouch 兽类（狼/鼹鼠）：伏低后坐 + 蓄力颤 → 回中
 *   rear   虫/甲壳（甲虫/针鼠）：后仰扬头 + 头顶微粒
 *   hover  飞行（嗡嗡虫）：高频扑翼抖 + 翼侧气流粒
 *   lash   藤蔓（刺刺草）：后仰蓄 → 末梢预弹（鞭梢甩出的前半拍）
 * opts: { color, heavy, dropletColor, scale } heavy = 重击档（更长蓄力 + 落地尘 + 微震）
 */
export function strikeWindup(style, opts = {}) {
  const { color = 0xc8b89a, heavy = false } = opts;
  return async ({ ctx, deps, unit, player }) => {
    const s = sOf(unit);
    const k = heavy ? 1.35 : 1.0; // 重击全身幅度放大
    const feet = feetOf(unit);
    if (style === 'blob') {
      await ctx.custom(unit.uniqueID, {
        durationMs: 150, ease: 'power2.in',
        onUpdate: (t) => unit.setPose({ squash: 1 - 0.28 * k * t, widen: 1 + 0.18 * k * t }),
      });
      // 拔长瞬间甩液滴（胶质甩脱的飞沫）
      deps.particles?.spawn?.(chestOf(unit, 1.2).x, chestOf(unit, 1.2).y, {
        color: opts.dropletColor ?? color, count: 6, speed: 8, size: 0.8, ttl: 0.5, gravity: -18, z: unit.position.z,
      });
      await ctx.custom(unit.uniqueID, {
        durationMs: 120, ease: 'power2.out',
        onUpdate: (t) => unit.setPose({ squash: (1 - 0.28 * k) + (0.28 * k + 0.16 * k) * t, widen: (1 + 0.18 * k) - (0.18 * k + 0.12 * k) * t }),
      });
      await settlePose(ctx, unit, 190);
      return;
    }
    if (style === 'crouch') {
      const lean = leanToward(unit, player, -0.10 * k); // 后坐（远离玩家）
      await ctx.custom(unit.uniqueID, {
        durationMs: 170, ease: 'power2.out',
        onUpdate: (t) => unit.setPose({ squash: 1 - 0.18 * k * t, widen: 1 + 0.08 * k * t, lean: lean * t }),
      });
      // 蓄力颤（小振幅高频——肌肉绷紧读感）
      await ctx.custom(unit.uniqueID, {
        durationMs: heavy ? 190 : 110, ease: 'none',
        onUpdate: (t) => unit.setPose({
          squash: 1 - 0.18 * k, widen: 1 + 0.08 * k,
          lean: lean + 0.012 * Math.sin(t * Math.PI * 6),
        }),
      });
      if (heavy) {
        deps.particles?.spawn?.(feet.x, feet.y, { color, count: 8, speed: 7, size: 1.4, ttl: 0.7, gravity: -7, z: feet.z });
      }
      await settlePose(ctx, unit, 150);
      return;
    }
    if (style === 'rear') {
      const lean = leanToward(unit, player, -0.15 * k); // 后仰扬头
      await ctx.custom(unit.uniqueID, {
        durationMs: 190, ease: 'power2.out',
        onUpdate: (t) => unit.setPose({ lean: lean * t, squash: 1 + 0.08 * k * t }),
      });
      const hd = headOf(unit);
      deps.particles?.spawn?.(hd.x, hd.y, { color, count: 5, speed: 4, size: 0.7, ttl: 0.5, gravity: 5, z: hd.z });
      await ctx.wait(60);
      await settlePose(ctx, unit, 160);
      return;
    }
    if (style === 'hover') {
      // 扑翼高频抖（squash 快速微振）+ 翼侧气流（两翼位各一股）
      await ctx.custom(unit.uniqueID, {
        durationMs: 300, ease: 'none',
        onUpdate: (t) => unit.setPose({ squash: 1 + 0.06 * Math.sin(t * Math.PI * 7), widen: 1 - 0.04 * Math.sin(t * Math.PI * 7) }),
      });
      const ch = chestOf(unit);
      for (const dir of [-1, 1]) {
        deps.particles?.spawn?.(ch.x + dir * 2.2 * s, ch.y + 0.8 * s, {
          color, count: 4, speed: 5, size: 0.6, ttl: 0.35, gravity: -3, z: ch.z,
        });
      }
      await settlePose(ctx, unit, 110);
      return;
    }
    // lash（藤蔓鞭）：后仰蓄 → 末梢预弹（鞭梢先行的前半拍，命中段由伤害拍接）
    const leanBack = leanToward(unit, player, -0.14 * k);
    await ctx.custom(unit.uniqueID, {
      durationMs: 200, ease: 'power2.out',
      onUpdate: (t) => unit.setPose({ lean: leanBack * t, squash: 1 + 0.05 * t }),
    });
    await ctx.custom(unit.uniqueID, {
      durationMs: 80, ease: 'power3.in',
      onUpdate: (t) => unit.setPose({ lean: leanBack + (-leanBack * 1.4) * t, squash: 1.05 - 0.1 * t }),
    });
    const hd = headOf(unit);
    deps.particles?.spawn?.(hd.x, hd.y - 1.5 * s, { color, count: 5, speed: 12, size: 0.6, ttl: 0.3, gravity: 0, z: hd.z });
    await settlePose(ctx, unit, 130);
  };
}

/**
 * 吐弹族（远程削弱/施法）：后仰吸气 → 胸口喷出一枚弧弹 → 落点小爆。
 * 覆盖毒液/虚无/粉尘/粘液等「从身上射出什么」的语义；配色逐敌注入。
 */
export function spitGlob(opts = {}) {
  const {
    color = [0.62, 0.38, 0.95], hot = [0.95, 0.80, 1.30], size = 1.6, ms = 420,
    arcH = 4.5, trailColor = 0x9a5ae0, impactColor = 0xb26ee8, impactCount = 12,
  } = opts;
  return async ({ ctx, deps, unit, player }) => {
    const from = chestOf(unit);
    const to = player ? chestOf(player) : null;
    // 后仰吸气（胸腹鼓起的半拍）
    await ctx.custom(unit.uniqueID, {
      durationMs: 150, ease: 'power2.out',
      onUpdate: (t) => unit.setPose({ lean: leanToward(unit, player, -0.08) * t, widen: 1 + 0.06 * t }),
    });
    settlePose(ctx, unit, 200); // 挂 kill 归中（不 await——与飞行并行回中）
    if (!to) return;
    await arcProjectile(ctx, deps, {
      from, to, color, hot, size, ms, arcH, stretch: 1.2, lampIntensity: 420,
      trail: { color: trailColor, speed: 3, size: 0.55, ttl: 0.3 },
    });
    deps.particles?.spawn?.(to.x, to.y, { color: impactColor, count: impactCount, speed: 8, size: 0.7, ttl: 0.6, gravity: -4, z: to.z });
  };
}

/**
 * 聚能族（自强化/蓄势）：光点环收束进胸口 + 吸气鼓身。payoff（扫描光带）
 * 由效果结算节拍承接，本族只给「聚」的起手。
 */
export function chargeUpFx(opts = {}) {
  const { color = 0xffe0a0, holdMs = 90 } = opts;
  return async ({ ctx, deps, unit }) => {
    playCastConverge(unit, deps.particles, color);
    await ctx.custom(unit.uniqueID, {
      durationMs: 240, ease: 'power2.out',
      onUpdate: (t) => unit.setPose({ squash: 1 - 0.06 * t, widen: 1 + 0.06 * t }),
    });
    await ctx.wait(holdMs);
    await settlePose(ctx, unit, 170);
  };
}

/**
 * 蜷缩防御族：快速伏低（ duck ）+ 一定身 + 过冲回中。护盾地环由结算节拍自播。
 */
export function hunkerFx(opts = {}) {
  const { dustColor = 0, depth = 1 } = opts;
  return async ({ ctx, deps, unit }) => {
    const feet = feetOf(unit);
    await ctx.custom(unit.uniqueID, {
      durationMs: 140, ease: 'power2.out',
      onUpdate: (t) => unit.setPose({ squash: 1 - 0.22 * depth * t, widen: 1 + 0.12 * depth * t }),
    });
    if (dustColor) {
      deps.particles?.spawn?.(feet.x, feet.y, { color: dustColor, count: 7, speed: 6, size: 1.2, ttl: 0.55, gravity: -6, z: feet.z });
    }
    await ctx.wait(130);
    await settlePose(ctx, unit, 200);
  };
}

/**
 * 发呆/晕眩拍：左右摇晃两个来回 + 头顶几颗迷走小光点（读「发懵」，非星星——
 * 星星是真 stun 效果的 aura，语义不混）。
 */
export function dazeSway(opts = {}) {
  const { color = 0xd8cf8a } = opts;
  return async ({ ctx, deps, unit }) => {
    const hd = headOf(unit);
    ctx.spawn(async (c) => {
      for (let i = 0; i < 3; i++) {
        deps.particles?.spawn?.(hd.x + (i - 1) * 1.2 * sOf(unit), hd.y + 0.6, {
          color, count: 1, speed: 1.5, size: 0.7, ttl: 0.9, gravity: 2.5, z: hd.z,
        });
        await c.wait(180);
      }
    });
    await ctx.custom(unit.uniqueID, {
      durationMs: 720, ease: 'none',
      onUpdate: (t) => unit.setPose({ lean: 0.085 * Math.sin(t * Math.PI * 4) * (1 - t * 0.55) }),
    });
    await settlePose(ctx, unit, 120);
  };
}

/**
 * 嚎叫族（雪狼嚎/怨灵啸）：仰头 → 头部三道错峰扩散的声波环 + 浮游微粒 → 回中。
 * 声波环 = 世界空间 sprite 扩张淡出（尖啸的「扩散」读感主体）。
 */
export function wailFx(opts = {}) {
  const { color = 0xbfd8ff, rings = 3, upMotes = 6 } = opts;
  return async ({ ctx, deps, unit, player }) => {
    const lean = leanToward(unit, player, -0.13);
    await ctx.custom(unit.uniqueID, {
      durationMs: 200, ease: 'power2.out',
      onUpdate: (t) => unit.setPose({ lean: lean * t, squash: 1 + 0.07 * t }),
    });
    settlePose(ctx, unit, 260); // 不 await：回中与声波并行
    const hd = headOf(unit);
    const jobs = [];
    for (let i = 0; i < rings; i++) {
      jobs.push((async () => {
        await ctx.wait(i * 95);
        if (typeof document === 'undefined') return;
        const mat = new THREE.SpriteMaterial({
          map: ringTexture(), color: new THREE.Color(color).multiplyScalar(1.25),
          blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85, fog: false,
        });
        const spr = new THREE.Sprite(mat);
        spr.position.set(hd.x, hd.y, (hd.z ?? 0) + 1.2);
        spr.scale.set(1.5, 1.5, 1);
        deps.scene?.add?.(spr);
        ctx.onKill(() => { spr.parent?.remove(spr); mat.dispose(); });
        const st = { t: 0 };
        await ctx.tweenRaw(st, { t: 1 }, {
          durationMs: 520, ease: 'power1.out',
          onUpdate: () => {
            const sc = 1.5 + st.t * 11;
            spr.scale.set(sc, sc, 1);
            mat.opacity = 0.85 * (1 - st.t) ** 1.4;
          },
          onComplete: () => { spr.parent?.remove(spr); mat.dispose(); },
        });
      })());
    }
    deps.particles?.spawn?.(hd.x, hd.y, { color, count: upMotes, speed: 4, size: 0.7, ttl: 0.8, gravity: 6, z: hd.z });
    await Promise.all(jobs);
  };
}

/**
 * 震颤预警族（爆囊待爆/引线将尽）：高频碎颤 + 红光点外渗——「要炸了」的体表读感，
 * 与引线 aura（recipes.js blastFuse）叠加成完整倒计时语言。
 */
export function trembleWarn(opts = {}) {
  const { color = 0xff5a3a, durMs = 520 } = opts;
  return async ({ ctx, deps, unit }) => {
    const ch = chestOf(unit, 1.15);
    ctx.spawn(async (c) => {
      for (let i = 0; i < 3; i++) {
        deps.particles?.spawn?.(ch.x, ch.y, { color, count: 3, speed: 5, size: 0.7, ttl: 0.4, gravity: 3, z: ch.z });
        await c.wait(150);
      }
    });
    await ctx.custom(unit.uniqueID, {
      durationMs: durMs, ease: 'none',
      onUpdate: (t) => {
        const j = Math.sin(t * Math.PI * 18); // 高频碎颤
        unit.setPose({ lean: 0.02 * j, squash: 1 + 0.05 * Math.abs(j), widen: 1 + 0.05 * Math.abs(j) });
      },
    });
    await settlePose(ctx, unit, 120);
  };
}
