// 一章小怪起手族模板库（2026-10-15 敌人演出批）：
// 「族」= 同体态/同语义动作共享的编排骨架，配色/力度/粒子逐敌注入。
// 起手拍只演「施法者侧的身体语言」——落点反馈（护盾地环/增益扫描光带/受击）
// 由后续结算节拍承接（battleBeats.js），族模板不重复画结果。
// 姿态纪律：体态一律走 _pose 通道（setPose，出口归中 + onKill 同口径归中）——
// 后续突进（_damageHit 的突进编排）从干净姿态起跳；单位锚点口径与既有敌方
// 特效同源（高度感知：胸 0.52H / 头 0.92H / 脚 0.05H，H = 立牌高×scale）。
import { arcProjectile, lampPulse } from '../../spells/blocks.js';
import { glowTexture } from '../../orbs.js';
import {
  wailRing, fuseRing, dustLanding, unitH,
  pulseEdgeSurge, drainVeins, pressureBurst, playEdgeSurge,
} from './fxPieces.js';

const sOf = (u) => u._baseScale ?? 1;
/** 世界锚点（高度感知，unitH 口径）：胸 ≈ 0.52H（k 缩放）、头 ≈ 0.92H、脚 ≈ 0.05H。 */
const chestOf = (u, k = 1) => ({ x: u.position.x, y: u.position.y + unitH(u) * 0.52 * k, z: u.position.z ?? 0 });
const headOf = (u) => ({ x: u.position.x, y: u.position.y + unitH(u) * 0.92, z: u.position.z ?? 0 });
const feetOf = (u) => ({ x: u.position.x, y: u.position.y + unitH(u) * 0.05, z: u.position.z ?? 0 });
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
 * 攻击起手族（突进前的「预告」）：五种体态。**体态拍一律纯体态**（迭代 #9 用户
 * 裁定：粒子不许当水桶——单点全向爆点只换颜色 = 无物理动机 = 不加；crouch 重击
 * 的落地挤尘是唯一保留，那是体重砸地的实物）。
 *   blob   胶质（史莱姆/苔球/蟾蜍）：下压成团 → 向上拔长 → 果冻回落
 *   crouch 兽类（狼/鼹鼠）：伏低后坐 + 蓄力颤 → 回中（heavy = 落地挤尘）
 *   rear   虫/甲壳（甲虫/针鼠）：后仰扬头 + 停顿蓄势
 *   hover  飞行（嗡嗡虫）：高频扑翼抖
 *   lash   藤蔓（刺刺草）：后仰蓄 → 末梢预弹（鞭梢先行的前半拍）
 * opts: { color, heavy, scale } heavy = 重击档（更长蓄力 + 落地挤尘 + 微震）
 */
export function strikeWindup(style, opts = {}) {
  const { color = 0xc8b89a, heavy = false } = opts;
  return async ({ ctx, deps, unit, player }) => {
    const k = heavy ? 1.35 : 1.0; // 重击全身幅度放大
    if (style === 'blob') {
      // 纯体态（迭代 #9 用户裁定：液滴太小不如不加——体态拍不配粒子）
      await ctx.custom(unit.uniqueID, {
        durationMs: 150, ease: 'power2.in',
        onUpdate: (t) => unit.setPose({ squash: 1 - 0.28 * k * t, widen: 1 + 0.18 * k * t }),
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
      if (heavy) {
        // 落定拍（迭代 #8，与伏低收尾同帧）：体重把尘从身下两侧挤出（#5 同语言——
        // 中心 radial 会从裆下爆出读「拉裤子」）+ 短促暖灯给重量（色随消费者尘色）
        const y0 = unit.position.y;
        const R = (unit._groundRadius ?? 5) * 0.75;
        const z = unit.position.z ?? 0;
        for (const side of [-1, 1]) {
          deps.particles?.spawn?.(unit.position.x + side * R, y0 + 0.6, {
            color, count: 6, speed: 11, size: 0.95, ttl: 0.3, gravity: -9, z,
          });
        }
        deps.particles?.spawn?.(unit.position.x, y0 + 0.4, {
          color, count: 4, speed: 4.5, size: 1.1, ttl: 0.55, gravity: -5, z,
        });
        deps.particles?.spawn?.(unit.position.x, y0 + 0.8, {
          color, count: 2, speed: 2, size: 1.4, ttl: 1.0, gravity: -1.5, z,
        });
        const lr = ((color >> 16) & 255) / 255, lg = ((color >> 8) & 255) / 255, lb = (color & 255) / 255;
        ctx.spawn((c) => lampPulse(c, deps, {
          at: { x: unit.position.x, y: y0 + 0.6, z },
          color: [Math.min(1.25, lr * 1.1 + 0.2), Math.min(1.1, lg + 0.12), Math.min(1.0, lb * 0.9 + 0.06)],
          peak: 220, attackMs: 60, decayMs: 260,
        }));
      }
      // 蓄力颤（小振幅高频——肌肉绷紧读感）
      await ctx.custom(unit.uniqueID, {
        durationMs: heavy ? 190 : 110, ease: 'none',
        onUpdate: (t) => unit.setPose({
          squash: 1 - 0.18 * k, widen: 1 + 0.08 * k,
          lean: lean + 0.012 * Math.sin(t * Math.PI * 6),
        }),
      });
      await settlePose(ctx, unit, 150);
      return;
    }
    if (style === 'rear') {
      const lean = leanToward(unit, player, -0.15 * k); // 后仰扬头
      await ctx.custom(unit.uniqueID, {
        durationMs: 190, ease: 'power2.out',
        onUpdate: (t) => unit.setPose({ lean: lean * t, squash: 1 + 0.08 * k * t }),
      });
      await ctx.wait(60);   // 扬到位的停顿（蓄势一拍）
      await settlePose(ctx, unit, 160);
      return;
    }
    if (style === 'hover') {
      // 扑翼高频抖（squash 快速微振）——纯体态
      await ctx.custom(unit.uniqueID, {
        durationMs: 300, ease: 'none',
        onUpdate: (t) => unit.setPose({ squash: 1 + 0.06 * Math.sin(t * Math.PI * 7), widen: 1 - 0.04 * Math.sin(t * Math.PI * 7) }),
      });
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
    await settlePose(ctx, unit, 130);
  };
}

/** 弹体色（线性 floats）→ 十六进制（×255 近似）：默认拖尾/出口/溅落色从弹体色
 *  派生——拖尾必须与弹体同色系（「绿弹紫尾」为默认值雷，迭代#4 根除）。 */
function hexOf([r, g, b]) {
  const q = (v) => Math.round(Math.max(0, Math.min(1, v)) * 255);
  return (q(r) << 16) | (q(g) << 8) | q(b);
}

/**
 * 吐弹族（毒液/粘液/毒雾，ENEMY_FX.md 迭代#4）：后仰吸气 → 口部成形的**液弹
 * 彗星**（globShade：头圆尾收 + 液面蠕动 + 张力膜环 + 内漩涡）→ 弧线飞向玩家
 * → 落点溅落。出身修正：口部锚 0.60H（吐=从嘴）+ 发射段淡入生长 +
 * 出口雾一撮——不再是身体中线凭空出现的全尺寸光点。拖尾 = 黏稠液珠（默认同色）。
 */
export function spitGlob(opts = {}) {
  const {
    color = [0.35, 0.75, 0.30], hot = [0.70, 1.05, 0.55], size = 4.6, ms = 470,
    arcH = 4.2, trailColor = hexOf(color), impactColor = hexOf(hot), impactCount = 15,
    muzzleK = 0.60,
  } = opts;
  return async ({ ctx, deps, unit, player }) => {
    const from = { x: unit.position.x, y: unit.position.y + unitH(unit) * muzzleK, z: unit.position.z ?? 0 };
    const to = player ? chestOf(player) : null;
    // 后仰吸气（胸腹鼓起的半拍）
    await ctx.custom(unit.uniqueID, {
      durationMs: 150, ease: 'power2.out',
      onUpdate: (t) => unit.setPose({ lean: leanToward(unit, player, -0.08) * t, widen: 1 + 0.06 * t }),
    });
    settlePose(ctx, unit, 200); // 挂 kill 归中（不 await——与飞行并行回中）
    if (!to) return;
    // 出口雾：弹体离体的物理动机（口部一撮短尘）
    deps.particles?.spawn?.(from.x, from.y, {
      color: trailColor, count: 4, speed: 3.5, size: 0.8, ttl: 0.3, gravity: -2, z: from.z,
    });
    await arcProjectile(ctx, deps, {
      from, to, color, hot, size, ms, arcH, stretch: 1.45, lampIntensity: 460,
      trail: { color: trailColor, speed: 2.6, size: 0.75, ttl: 0.42 },
      shape: 'glob', fadeInMs: 100,
    });
    deps.particles?.spawn?.(to.x, to.y, { color: impactColor, count: impactCount, speed: 8, size: 0.8, ttl: 0.6, gravity: -4, z: to.z });
  };
}

/**
 * 咒弹（enemyAct 未注册 debuff 兜底，ENEMY_FX.md 迭代#4）：紫**咒印双环**从施法者
 * 胸口弧线飞向玩家（hexSigilShade：外环三瓣正转 / 内环五瓣反转），发射段淡入生长
 * + 胸口出口雾。
 */
export async function curseBolt(ctx, deps, { unit, player }) {
  const from = { x: unit.position.x, y: unit.position.y + unitH(unit) * 0.56, z: unit.position.z ?? 0 };
  const to = player
    ? { x: player.position.x, y: player.position.y + unitH(player) * 0.52, z: player.position.z }
    : null;
  deps.particles?.spawn?.(from.x, from.y, {
    color: 0x9a5ae0, count: 3, speed: 3, size: 0.75, ttl: 0.28, gravity: -2, z: from.z,
  });
  await arcProjectile(ctx, deps, {
    from, to,
    color: [0.62, 0.38, 0.95], hot: [0.95, 0.80, 1.30],
    size: 4.8, ms: 470, arcH: 4.5, stretch: 1.0,
    lampIntensity: 460,
    trail: { color: 0x9a5ae0, speed: 2.4, size: 0.6, ttl: 0.35 },
    shape: 'sigil', fadeInMs: 110,
  });
  if (to) {
    deps.particles?.spawn?.(to.x, to.y, {
      color: 0xb26ee8, count: 14, speed: 8, size: 0.75, ttl: 0.6, gravity: -4, z: to.z,
    });
  }
}

/**
 * 爆怒族（rage/力量蓄，ENEMY_FX.md 迭代#3）：内压外溢——剪影搏动升温（频率
 * 加速、末段过曝）+ 蓄压段体表火星（头侧/双肩，蒸汽上冒）+ 末拍胸口怒压爆环 +
 * 暖红灯双段。低频签名档（四要素满配）。约 660ms。
 */
export function rageSwell(opts = {}) {
  const { edge = 0xe0705a, vein = [1.0, 0.45, 0.32], ember = 0xe85840 } = opts;
  return async ({ ctx, deps, unit }) => {
    const s = sOf(unit);
    pulseEdgeSurge(unit, edge, { ms: 520 });
    const ch = chestOf(unit);
    // ① 后仰吸气
    await ctx.custom(unit.uniqueID, {
      durationMs: 120, ease: 'power2.out',
      onUpdate: (t) => unit.setPose({ lean: -0.06 * t, squash: 1 + 0.03 * t }),
    });
    // ② 前躬蓄压：颤频随进度爬（与边光加速同律）
    await ctx.custom(unit.uniqueID, {
      durationMs: 280, ease: 'none',
      onUpdate: (t) => unit.setPose({
        squash: 0.94 + 0.012 * Math.sin(t * Math.PI * (4 + 8 * t)),
        widen: 1.10 + 0.010 * Math.sin(t * Math.PI * (4 + 8 * t)),
        lean: -0.06 + 0.10 * t,
      }),
    });
    // 体表火星（头侧+双肩三锚点上冒，非基座）：快层细红 + 慢层暗烟
    for (const ax of [-1.7, 0, 1.7]) {
      const px = ch.x + ax * s;
      const py = ch.y + (ax === 0 ? 1.6 : 0.6) * s;
      deps.particles?.spawn?.(px, py, {
        color: ember, count: 3, speed: 4, size: 0.7, ttl: 0.4, gravity: 8, z: ch.z,
      });
      deps.particles?.spawn?.(px, py - 0.4 * s, {
        color: 0x8a3828, count: 2, speed: 2, size: 1.3, ttl: 1.0, gravity: 3, z: ch.z,
      });
    }
    // ③ 炸开：怒压爆环 + 暖红峰灯 + 展姿一瞬
    const ring = pressureBurst(ctx, deps, { at: ch, color: vein, size: 13 * Math.max(0.7, s), ms: 260 });
    lampPulse(ctx, deps, {
      name: 'light:fx0', at: { x: ch.x, y: ch.y, z: ch.z + 1.5 }, color: vein,
      peak: 300, attackMs: 60, decayMs: 300,
    });
    await ctx.custom(unit.uniqueID, {
      durationMs: 120, ease: 'power3.out',
      onUpdate: (t) => unit.setPose({ widen: 1.22 - 0.10 * t, squash: 0.96 + 0.02 * t, lean: 0.04 * (1 - t) }),
    });
    await Promise.all([ring, settlePose(ctx, unit, 180)]);
  };
}

/**
 * 聚能族（蓄势/蓄力，ENEMY_FX.md 迭代#3）：环境内汇——螺旋汇流纹向胸口焦点
 * 加速收束（焦点阶梯增亮、末拍一闪）+ 体周微尘内飘（随机角非均布）+ 主题色
 * 低峰灯。静与汇：姿态克制（吸气压缩、微低头、静持）。约 560ms。
 */
export function gatherFocus(opts = {}) {
  const { vein = [0.86, 0.80, 0.62], motes = 7, moteColor = 0xd8c8a0, size = 13.0 } = opts;
  return async ({ ctx, deps, unit }) => {
    const s = sOf(unit);
    const ch = chestOf(unit);
    const veins = drainVeins(ctx, deps, { at: ch, color: vein, size: size * Math.max(0.7, s), ms: 560 });
    // 体周微尘内飘：随机角生成、直线直达胸口（ttl = 路程/速度，到达即融入焦点）
    // headless（无 document）跳过——glowTexture 要画布
    if (typeof document !== 'undefined') {
      const tint = '#' + moteColor.toString(16).padStart(6, '0');
      for (let i = 0; i < motes; i++) {
        const a = Math.random() * Math.PI * 2;
        const R = (5.5 + Math.random() * 2.5) * s;
        const x = ch.x + Math.cos(a) * R;
        const y = ch.y + Math.sin(a) * R * 0.6;
        const d = Math.hypot(ch.x - x, ch.y - y) || 1;
        const sp = 3.4 + Math.random() * 1.8;
        deps.particles?.spawnSprite?.(x, y, {
          texture: glowTexture(tint), width: 0.9, height: 0.9,
          vx: ((ch.x - x) / d) * sp, vy: ((ch.y - y) / d) * sp,
          gravity: 0, drag: 0, ttl: d / sp + 0.1, fadeIn: true, z: (ch.z ?? 0) + 0.5,
        });
      }
    }
    lampPulse(ctx, deps, {
      name: 'light:fx1', at: { x: ch.x, y: ch.y, z: ch.z + 1.5 }, color: vein,
      peak: 260, attackMs: 300, decayMs: 320,
    });
    // 姿态：吸气压缩 + 微低头 → 静持（焦点末拍一闪承担视觉收束）
    await ctx.custom(unit.uniqueID, {
      durationMs: 200, ease: 'power2.out',
      onUpdate: (t) => unit.setPose({ squash: 1 - 0.05 * t, widen: 1 + 0.04 * t, lean: 0.04 * t }),
    });
    await ctx.wait(160);
    await Promise.all([veins, settlePose(ctx, unit, 200)]);
  };
}

/**
 * 竖刺族（hedgehog 竖刺/补刺）：剪影边光双波上爬（刺从轮廓里竖起来）+
 * 蓄紧两记微颤。高频轻配，无粒子无灯——边光就是刺。
 */
export function bristleFx(opts = {}) {
  const { color = 0xd8c060 } = opts;
  return async ({ ctx, deps, unit }) => {
    playEdgeSurge(unit, color, { durMs: 560 });
    await ctx.custom(unit.uniqueID, {
      durationMs: 240, ease: 'power2.out',
      onUpdate: (t) => unit.setPose({ squash: 1 - 0.05 * t, widen: 1 + 0.06 * t }),
    });
    await ctx.custom(unit.uniqueID, {
      durationMs: 140, ease: 'none',
      onUpdate: (t) => unit.setPose({
        squash: 0.95 + 0.012 * Math.sin(t * Math.PI * 4),
        widen: 1.06 - 0.008 * Math.sin(t * Math.PI * 4),
      }),
    });
    await settlePose(ctx, unit, 170);
  };
}

/**
 * 硬化族（甲虫B 硬化）：伏低锁壳（hunker 浅档）+ 低亮边光一拍。硬化是壳的
 * 事——不聚能不发光球。
 */
export function hardenFx(opts = {}) {
  const { color = 0xb0a890 } = opts;
  return async (a) => {
    playEdgeSurge(a.unit, color, { durMs: 420 });
    return hunkerFx({ depth: 0.55 })(a);
  };
}

/**
 * 掘洞休整族（鼹鼠掘洞恢复）：下沉蓄 + 挖地扬尘 + 回中。恢复的绿意交给
 * 结算拍 gainSweep（已有）。
 */
export function burrowRest(opts = {}) {
  const { color = 0xa89070 } = opts;
  return async ({ ctx, deps, unit }) => {
    await ctx.custom(unit.uniqueID, {
      durationMs: 180, ease: 'power2.in',
      onUpdate: (t) => unit.setPose({ squash: 1 - 0.12 * t, widen: 1 + 0.08 * t }),
    });
    dustLanding(ctx, deps, { at: feetOf(unit), color, count: 12 });
    await ctx.wait(220);
    await settlePose(ctx, unit, 200);
  };
}

/**
 * 蜷缩防御族（ENEMY_FX.md 迭代#5）：蹲 = 重心砸进地面，尘从被挤压的地面横向挤出。
 * ① 下沉蓄力（压扁 + position.y 同步下沉——纯压扁读不出「蹲」）→ ② 触底拍：两侧
 * 快尘 + 身下小股 + 慢浮尘（与触底同帧，读「体重砸地、尘被挤开」）→ ③ 果冻微回弹
 * → ④ 憋劲静持 → 起身回中 + 过冲收敛。护盾地环由结算节拍自播，本族不抢。
 */
export function hunkerFx(opts = {}) {
  const { dustColor = 0xb0a088, depth = 1 } = opts;
  return async ({ ctx, deps, unit }) => {
    const y0 = unit.position.y;
    const sink = 1.4 * depth;
    const R = (unit._groundRadius ?? 5) * 0.75;
    const z = unit.position.z ?? 0;
    ctx.onKill(() => { unit.position.y = y0; unit.resetPose(); });
    // ① 下沉蓄力（重心掉下去）
    await ctx.custom(unit.uniqueID, {
      durationMs: 120, ease: 'power2.in',
      onUpdate: (t) => {
        unit.position.y = y0 - sink * t;
        unit.setPose({ squash: 1 - 0.24 * depth * t, widen: 1 + 0.10 * depth * t });
      },
    });
    // ② 触底（与下沉收尾同帧）：尘从身体两侧被挤开（快层）+ 身下小股 + 慢浮尘
    for (const side of [-1, 1]) {
      deps.particles?.spawn?.(unit.position.x + side * R, y0 + 0.6, {
        color: dustColor, count: 7, speed: 13, size: 1.0, ttl: 0.32, gravity: -9, z,
      });
    }
    deps.particles?.spawn?.(unit.position.x, y0 + 0.4, {
      color: dustColor, count: 5, speed: 5, size: 1.2, ttl: 0.6, gravity: -5, z,
    });
    deps.particles?.spawn?.(unit.position.x, y0 + 0.8, {
      color: dustColor, count: 3, speed: 2.5, size: 1.6, ttl: 1.1, gravity: -1.5, z,
    });
    // ③ 果冻微回弹 → ④ 憋劲静持
    await ctx.custom(unit.uniqueID, {
      durationMs: 90, ease: 'power2.out',
      onUpdate: (t) => unit.setPose({
        squash: (1 - 0.24 * depth) + 0.05 * depth * t,
        widen: (1 + 0.10 * depth) - 0.02 * depth * t,
      }),
    });
    await ctx.wait(140);
    // ⑤ 起身回中（位置/姿态同步归位）+ 过冲收敛
    await ctx.custom(unit.uniqueID, {
      durationMs: 200, ease: 'power2.out',
      onUpdate: (t) => {
        unit.position.y = y0 - sink * (1 - t);
        unit.setPose({
          squash: (1 - 0.19 * depth) + 0.19 * depth * t,
          widen: (1 + 0.08 * depth) - 0.08 * depth * t,
        });
      },
    });
    await settlePose(ctx, unit, 170);
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
 * 嚎叫族（雪狼嚎/怨灵啸）：仰头 → 头部声波环（shader 形体：三道错峰谐波瓣
 * 扩散环）+ 双层浮游微粒 + 冷色灯 punch → 回中。
 */
export function wailFx(opts = {}) {
  const { color = [0.65, 0.78, 1.10], ringColor, upMotes = 6, rings = 3 } = opts;
  return async ({ ctx, deps, unit, player }) => {
    const lean = leanToward(unit, player, -0.13);
    await ctx.custom(unit.uniqueID, {
      durationMs: 200, ease: 'power2.out',
      onUpdate: (t) => unit.setPose({ lean: lean * t, squash: 1 + 0.07 * t }),
    });
    settlePose(ctx, unit, 260); // 不 await：回中与声波并行
    const hd = headOf(unit);
    const s = sOf(unit);
    // 声波环（shader 形体主体；rings>3 时给更大画布装第三道外圈）
    const ring = wailRing(ctx, deps, {
      at: hd, color: ringColor ?? color,
      size: (14 + rings * 1.6) * Math.max(0.7, s), ms: 620 + rings * 80,
    });
    // 双层微粒：快上浮 + 慢漂尘
    deps.particles?.spawn?.(hd.x, hd.y, { color: 0xd8e6f5, count: upMotes, speed: 6, size: 0.8, ttl: 0.6, gravity: 9, z: hd.z });
    deps.particles?.spawn?.(hd.x, hd.y - 1, { color: 0x9ab5cc, count: Math.round(upMotes * 0.7), speed: 2.5, size: 1.3, ttl: 1.4, gravity: 2, z: hd.z });
    // 冷色灯 punch（借池）
    ctx.spawn((c) => lampPulse(c, deps, {
      name: 'light:fx0', at: { x: hd.x, y: hd.y, z: (hd.z ?? 0) + 2 },
      color: ringColor ?? color, peak: 560, attackMs: 140, decayMs: 560,
    }));
    await ring;
  };
}

/**
 * 震颤预警族（爆囊待爆/引线将尽）：贴地引线收束圈（shader 形体：内向收束暗红环
 * + 裂纹透光，与胸口 fuseGlow 心跳同律搏动）+ 高频碎颤 + 火花随搏外渗。
 */
export function trembleWarn(opts = {}) {
  const { durMs = 620 } = opts;
  return async ({ ctx, deps, unit }) => {
    const ch = chestOf(unit, 1.15);
    const feet = feetOf(unit);
    const ring = fuseRing(ctx, deps, { at: feet, size: 13 * Math.max(0.7, sOf(unit)), ms: durMs });
    ctx.spawn(async (c) => {
      // 火花随心跳加密外渗（搏动节拍两连发 ×2 组）
      for (let g = 0; g < 2; g++) {
        await c.wait(120);
        deps.particles?.spawn?.(ch.x, ch.y, { color: 0xff7a40, count: 4, speed: 7, size: 0.7, ttl: 0.35, gravity: 8, z: ch.z });
        await c.wait(140);
        deps.particles?.spawn?.(ch.x, ch.y, { color: 0xff5a3a, count: 3, speed: 9, size: 0.6, ttl: 0.3, gravity: 12, z: ch.z });
      }
    });
    await ctx.custom(unit.uniqueID, {
      durationMs: durMs, ease: 'none',
      onUpdate: (t) => {
        const j = Math.sin(t * Math.PI * 18); // 高频碎颤
        unit.setPose({ lean: 0.02 * j, squash: 1 + 0.05 * Math.abs(j), widen: 1 + 0.05 * Math.abs(j) });
      },
    });
    await Promise.all([ring, settlePose(ctx, unit, 120)]);
  };
}
