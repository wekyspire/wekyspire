// 章1 小怪演出内容注册（2026-10-15 敌人演出批）：
// 逐敌登记 act 起手拍（enemyAct）、命中主题（enemyHitFx）、死亡/复苏覆写
// （enemyLifeFx）。通用体态走 families.js 族模板（参数化配色/力度）；种族签名动作
// （甲虫啃食、蟾蜍鼓气、静电链、苔球蔓延、爆囊自爆、穿山甲卷甲）在本文实现。
// 起手拍纪律：攻击族的出手由伤害拍突进承接（_damageHit），本层只加「预告」
// 起手；扎根/远程型注册 noLunge（身体语言由投射物/粒子承担）。
import * as THREE from 'three';
import { isAttackKind, isDebuffKind, isBuffKind } from '../../../../core/intentKinds.js';
import { registerEnemyAct } from '../enemyAct.js';
import {
  registerEnemyHitTheme, registerEnemyNoLunge, registerEnemyLunge, registerEnemyHitBeat, enemyImpactBeat,
} from '../../spells/enemyHitFx.js';
import { registerEnemyDeathBeat, registerEnemySpawnGarnish } from '../../enemyLifeFx.js';
import { fireBurst, impactBurst, groundRing, lampPulse } from '../../spells/blocks.js';
import { runScript } from '../../script.js';
import { zapArc, wailRing, mossCreep, mossGrip, playEdgeSurge, throatPuff, dustLanding, gooCrown, mossBurst, unitH } from './fxPieces.js';
import {
  strikeWindup, spitGlob, hunkerFx, dazeSway, wailFx, trembleWarn,
  rageSwell, gatherFocus, bristleFx, hardenFx, burrowRest,
} from './families.js';

const sOf = (u) => u._baseScale ?? 1;
const has = (kinds, k) => kinds.includes(k);
const isAtk = (kinds) => kinds.some(isAttackKind);
const isDeb = (kinds) => kinds.some(isDebuffKind);
const isBuf = (kinds) => kinds.some(isBuffKind);

// ====== 种族签名动作 ======

// 史莱姆弹性打击（ENEMY_FX.md 迭代#1，1016 二次返简）：老 blob 的节奏骨架
// （快压缩 → 拔长预备）+ 跳扑本体语言。纯姿态演出——地面胶涌与弹射绿闪已按
// 用户反馈删除（闪烁读噪）；高频基础攻击要快而少元素。
async function gelCompress({ ctx, unit }) {
  await ctx.custom(unit.uniqueID, {
    durationMs: 150, ease: 'power2.in',
    onUpdate: (t) => unit.setPose({ squash: 1 - 0.38 * t, widen: 1 + 0.30 * t }),
  });
  // 拔长预备（果冻上提）——出口交棒跳扑
  await ctx.custom(unit.uniqueID, {
    durationMs: 110, ease: 'power2.out',
    onUpdate: (t) => unit.setPose({ squash: 0.62 + 0.76 * t, widen: 1.30 - 0.40 * t }),
  });
}

// 史莱姆蓄势拍（护盾+蓄势）：纯姿态蓄劲一息（压下再弹回）——护盾罩与增益
// 扫描光带由效果结算节拍自播，本拍不加粒子不加形体。
async function gelBrace({ ctx, unit }) {
  ctx.onKill(() => unit.resetPose());
  await ctx.custom(unit.uniqueID, {
    durationMs: 300, ease: 'power2.inOut',
    onUpdate: (t) => unit.setPose({
      squash: 1 - 0.16 * Math.sin(Math.PI * t),
      widen: 1 + 0.14 * Math.sin(Math.PI * t),
    }),
  });
}

// 史莱姆突进覆写「弹射→回巢」：拔长末态（squash≈1.38）弧线跳出 + 快回巢
// （落地压扁 → 一次过冲归中）。契约同通用三段（approach 末帧 = 锋尖抵近；
// onKill 归位归零）。
function slimePounce() {
  return {
    async approach(ctx, deps, { src, sx, sy, sz, ux, uz, reach }) {
      const s = src._baseScale ?? 1;
      ctx.onKill(() => { src.position.x = sx; src.position.y = sy; src.position.z = sz; src.resetPose(); });
      await ctx.custom(src.uniqueID, {
        durationMs: 140, ease: 'power2.in',
        onUpdate: (t) => {
          src.position.x = sx + ux * reach * t;
          src.position.z = sz + uz * reach * t;
          src.position.y = sy + Math.sin(Math.PI * t) * 1.9 * (0.75 + 0.25 * s);
          const st = Math.min(1, t * 1.7);
          src.setPose({ squash: 1.38 + 0.12 * st, widen: 0.90 - 0.06 * st, lean: -Math.sign(ux || 1) * 0.14 * st });
        },
      });
    },
    async recover(ctx, deps, { src, sx, sy, sz, ux, uz, reach }) {
      const cx = sx + ux * reach;
      const cz = sz + uz * reach;
      // 回跳落地压扁
      await ctx.custom(src.uniqueID, {
        durationMs: 150, ease: 'power1.out',
        onUpdate: (t) => {
          src.position.x = cx + (sx - cx) * t;
          src.position.z = cz + (sz - cz) * t;
          src.position.y = sy + Math.sin(Math.PI * t) * 0.8;
          src.setPose({ squash: 1.50 - 0.78 * t, widen: 0.84 + 0.36 * t, lean: 0 });
        },
      });
      // 一次过冲归中（果冻收尾，不做多段振荡）
      await ctx.custom(src.uniqueID, {
        durationMs: 170, ease: 'power2.out',
        onUpdate: (t) => {
          const w = Math.sin(Math.PI * t) * (1 - t * 0.4);
          src.setPose({ squash: 0.72 + 0.28 * t + 0.16 * w, widen: 1.20 - 0.20 * t - 0.14 * w });
        },
      });
    },
  };
}

// 史莱姆命中主题「墨色胶冠溅」：等 approach 抵近（110ms ≈ 突进 140ms 的锋尖帧）
// 再放——punchImpact 灰黑换肤 + gooCrown 墨色液冠 + 双层灰胶珠（gravity 落）。
// 色彩事实源：史莱姆 = 灰黑（2026-10-16 用户定），无绿。
function slimeGooImpact() {
  return async (ctx, deps, args) => {
    await ctx.wait(110);
    const { unit } = args;
    const s = unit._baseScale ?? 1;
    const at = { x: unit.position.x, y: unit.position.y + unitH(unit) * 0.50, z: unit.position.z };
    const crown = gooCrown(ctx, deps, { at, color: [0.30, 0.34, 0.32], size: 9.5, ms: 340 });
    deps.particles?.spawn?.(at.x, at.y, { color: 0x8a908a, count: 9, speed: 14, size: 0.8, ttl: 0.45, gravity: -30, z: at.z });
    deps.particles?.spawn?.(at.x, at.y - 1, { color: 0x4a504c, count: 4, speed: 5, size: 1.3, ttl: 1.0, gravity: -14, z: at.z });
    await Promise.all([
      crown,
      enemyImpactBeat(ctx, deps, {
        ...args,
        pal: {
          color: [0.38, 0.44, 0.42], hot: [0.95, 1.02, 0.98], rim: [0.42, 0.50, 0.47],
          sparkColor: 0xaab2ac, sparkSpeed: 14,
        },
      }),
    ]);
  };
}

// 蟾蜍鼓气（pufferToad 首拍）：深吸气 → 急剧膨胀（撑到变形 + 喉囊逐层充气
// shader 主体：同心泡膜胀大/末圈绷紧/破圈前兆 + 吸气尘 + 借池灯）→ 憋住微颤
// （峰压一圈声波环）→ 泄气回中。
// 与后续 ladder 攻击的 blob 起手构成「越鼓越大」的长线叙事。
async function pufferInflate({ ctx, deps, unit, player }) {
  const s = sOf(unit);
  const throat = { x: unit.position.x, y: unit.position.y + unitH(unit) * 0.42, z: unit.position.z ?? 0 };
  const dir = Math.sign((player?.position.x ?? unit.position.x - 1) - unit.position.x) || 1;
  // 深吸气：先收再涨（蓄气的呼吸节拍）+ 喉囊起胀（泡膜逐层鼓起随呼吸）
  const puff = throatPuff(ctx, deps, {
    at: throat, h: unitH(unit), dir, color: [0.72, 0.95, 0.45],
    ms: 900, lampIntensity: 300,
  });
  await ctx.custom(unit.uniqueID, {
    durationMs: 260, ease: 'power2.inOut',
    onUpdate: (t) => {
      const k = t < 0.45 ? t / 0.45 : 1 - (t - 0.45) / 0.55;
      unit.setPose({ squash: 1 - 0.05 * k, widen: 1 + 0.04 * k });
    },
  });
  // 急剧膨胀：一口气撑大 + 喉部水雾（鼓到漏气）
  deps.particles?.spawn?.(throat.x, throat.y, {
    color: 0xa8d878, count: 8, speed: 6, size: 0.8, ttl: 0.5, gravity: 4, z: throat.z,
  });
  deps.particles?.spawn?.(throat.x, throat.y, {
    color: 0x6a9a4a, count: 5, speed: 2.5, size: 1.4, ttl: 1.1, gravity: 1, z: throat.z,
  });
  await ctx.custom(unit.uniqueID, {
    durationMs: 300, ease: 'back.out(2.5)',
    onUpdate: (t) => unit.setPose({ squash: 1 - 0.24 * t, widen: 1 + 0.3 * t }),
  });
  // 峰压一圈声波环（气压外扩的形体）
  const ring = wailRing(ctx, deps, {
    at: { x: throat.x, y: throat.y + 1, z: throat.z }, color: [0.55, 0.85, 0.40],
    size: 11 * Math.max(0.7, s), ms: 520,
  });
  // 憋住微颤（气压读感）
  await ctx.custom(unit.uniqueID, {
    durationMs: 340, ease: 'none',
    onUpdate: (t) => {
      const q = 1 + 0.015 * Math.sin(t * Math.PI * 9);
      unit.setPose({ squash: 0.76 * q, widen: 1.3 * q });
    },
  });
  await ring;
  // 收尾：泄气回中（姿态连续性——下一拍起手从干净姿态接）
  await ctx.custom(unit.uniqueID, {
    durationMs: 260, ease: 'power2.out',
    onUpdate: (t) => unit.setPose({ squash: 0.76 + 0.24 * t, widen: 1.3 - 0.3 * t }),
  });
  await puff;
}

// 静电链（staticPuff 电击拍）：毛球到玩家一道电弧（zapArc shader 形体：折点跳变
// 热核 + 电晕 + 行进脉冲波 + 端点亮斑）——主弧 + 错峰伴弧成束（主弧抵达后伴弧
// 才起弧 = 读「连闪两记」）+ 借池灯 punch + 蓄势起手。
// 攻击拍本体演出（noLunge——身体语言全在电上）。**高频基础攻击预算**（ENEMY_FX.md
// 迭代#19）：到命中 ≈235ms、弧全程 ≈605ms、同时在场元素 ≤3——靶端迸溅统一归
// 受击主题（enemyHitFx garnish），本拍不再补第二份。
async function zapChainFx({ ctx, deps, unit, player }) {
  const { scene, particles } = deps;
  if (typeof document === 'undefined' || !scene) return;
  const from = { x: unit.position.x, y: unit.position.y + unitH(unit) * 0.52, z: unit.position.z ?? 0 };
  // 靶锚 0.62H = 骑士立牌视觉胸口（4.5v 复核两帧实锤 0.55 落腰腹——立牌头身比
  // 与毛球不同，胸口占比更高）
  const to = player && !player._dead
    ? { x: player.position.x, y: player.position.y + unitH(player) * 0.62, z: player.position.z ?? 0 }
    : null;
  // 起手：毛球蓄电（压实 + 源端电火花迸射）
  await ctx.custom(unit.uniqueID, {
    durationMs: 130, ease: 'power2.out',
    onUpdate: (t) => unit.setPose({ squash: 1 - 0.1 * t, widen: 1 + 0.08 * t }),
  });
  particles?.spawn?.(from.x, from.y, { color: 0xd8ecff, count: 9, speed: 11, size: 0.7, ttl: 0.35, gravity: 0, z: from.z });
  particles?.spawn?.(from.x, from.y, { color: 0x8fb0e0, count: 6, speed: 4, size: 1.0, ttl: 0.9, gravity: -2, z: from.z });
  // 主弧 + 错峰伴弧（连闪）+ 跳变循环（每 85ms 重掷折点相位 = 「电在跳」）
  const MAIN_REACH_MS = 105;
  const arcs = [];
  let companion = null;
  if (to) {
    arcs.push(zapArc(ctx, deps, {
      from, to, color: [0.55, 0.72, 1.30], width: 7.0, lifeMs: 350, reachMs: MAIN_REACH_MS,
    }));
    // 伴弧：主弧抵达后 ~70ms 才起弧（错峰连闪可读），更快抵达、更快熄灭
    companion = ctx.spawn(async (c) => {
      await c.wait(MAIN_REACH_MS + 70);
      const a = zapArc(ctx, deps, {
        from, to, color: [0.45, 0.60, 1.10], width: 4.2, lifeMs: 300, reachMs: 135,
      });
      arcs.push(a);
      await c.wait(85);
      a.jolt();
      await a.promise;
    }).promise;
  }
  // 灯 punch（冷蓝，借池）+ 跳变节拍（主弧活跃期 3×85ms）
  ctx.spawn((c) => lampPulse(c, deps, {
    name: 'light:fx0', at: { x: from.x, y: from.y, z: (from.z ?? 0) + 2 }, color: [0.55, 0.72, 1.30],
    peak: 760, attackMs: 90, decayMs: 380,
  }));
  const jitter = ctx.spawn(async (c) => {
    for (let k = 0; k < 3; k++) {
      for (const a of arcs) a.jolt();
      await c.wait(85);
    }
  });
  await Promise.all([...arcs.map((a) => a.promise), jitter.promise, companion].filter(Boolean));
  // 收势回中
  await ctx.custom(unit.uniqueID, {
    durationMs: 130, ease: 'power2.out',
    onUpdate: (t) => unit.setPose({ squash: 1 - 0.1 * (1 - t), widen: 1 + 0.08 * (1 - t) }),
  });
}

// 嗡嗡虫振翅（buzzbug 塞粉尘拍）：高频扑翼 + 翼侧两股尘雾喷向牌库方向。
async function wingDust({ ctx, deps, unit, player }) {
  const s = sOf(unit);
  const dir = Math.sign((player?.position.x ?? 0) - unit.position.x) || 1;
  await ctx.custom(unit.uniqueID, {
    durationMs: 520, ease: 'none',
    onUpdate: (t) => {
      const f = Math.sin(t * Math.PI * 16); // 高频扑翼
      unit.setPose({ squash: 1 + 0.05 * f, widen: 1 - 0.06 * f, lean: dir * 0.05 * Math.sin(t * Math.PI * 3) });
    },
  });
  const ch = { x: unit.position.x, y: unit.position.y + unitH(unit) * 0.52, z: unit.position.z ?? 0 };
  deps.particles?.spawn?.(ch.x, ch.y, { color: 0xd8c088, count: 14, speed: 7, size: 0.9, ttl: 0.8, gravity: -3, z: ch.z });
  deps.particles?.spawn?.(ch.x + dir * 2.4 * s, ch.y, { color: 0xc0a860, count: 8, speed: 10, size: 0.7, ttl: 0.6, gravity: -5, z: ch.z });
  deps.particles?.spawn?.(ch.x, ch.y + 1.2, { color: 0xa89058, count: 6, speed: 2, size: 1.4, ttl: 1.5, gravity: -1, z: ch.z }); // 慢速浮尘层
  await ctx.custom(unit.uniqueID, {
    durationMs: 140, ease: 'power2.out',
    onUpdate: (t) => unit.setPose({ lean: dir * 0.05 * (1 - t) }),
  });
}

// 甲虫啃食起手（carrionBeetle 啃牌拍，ENEMY_FX.md 迭代#2）：两记触角点叩
// （朝玩家——要动你的牌了）→ 仰身张颚候餐（卡从上方牌库来）。正餐（焚卡飞口
// 咬碎）由 ANIM_CARD_BURNT 的 _gnawOut 接手。出口轻度候餐位（焚毁被斩 veto
// 时残留不可读为 bug）。
async function gnawAntic({ ctx, deps, unit, player }) {
  const dir = Math.sign((player?.position.x ?? 0) - unit.position.x) || 1;
  ctx.onKill(() => unit.resetPose());
  for (let i = 0; i < 2; i++) {
    await ctx.custom(unit.uniqueID, {
      durationMs: 140, ease: 'power2.out',
      onUpdate: (t) => unit.setPose({ lean: -dir * 0.10 * Math.sin(Math.PI * t) }),
    });
  }
  // 仰身张颚（候餐）：缓开到位保持，交棒飞递
  await ctx.custom(unit.uniqueID, {
    durationMs: 270, ease: 'power2.inOut',
    onUpdate: (t) => unit.setPose({ squash: 1 + 0.04 * t, widen: 1 + 0.10 * t, lean: dir * 0.05 * t }),
  });
}

// 苔球蔓延（mossBall 紧勒拍）：压实一拍（苔自球体挤出）→ 根系沿真实地面向量
// （含 z 纵深）爬向玩家脚底（mossCreep：多根异速 S 弯 + 节点叶片 + 稀疏苔斑，
// 全程无粒子）→ 抵达拍 mossGrip（玩家脚下缠踝藤束 + 落地苔环）。主根终点精确落在
// 玩家脚底；其余根系分叉到两侧——「植物蔓延」不是一条推进线。
async function spreadGrip({ ctx, deps, unit, player }) {
  const feet = { x: unit.position.x, y: unit.position.y + unitH(unit) * 0.06, z: unit.position.z ?? 0 };
  await ctx.custom(unit.uniqueID, {
    durationMs: 200, ease: 'power2.out',
    onUpdate: (t) => unit.setPose({ squash: 1 - 0.1 * t, widen: 1 + 0.12 * t }),
  });
  const MS = 1050;
  const to = player
    ? { x: player.position.x, y: player.position.y + unitH(player) * 0.03, z: player.position.z ?? 0 }
    : null;
  const { promise: wave, arriveU } = mossCreep(ctx, deps, { from: feet, to, ms: MS });
  // 抵达拍：主根爬到玩家脚底（arriveU 与 shader 主根 delay+dur 同步）——脚下缠须
  if (player) {
    ctx.spawn(async (c) => {
      await c.wait(Math.round(arriveU * MS));
      if (c.killed) return;
      const pf = { x: player.position.x, y: player.position.y + unitH(player) * 0.03, z: player.position.z ?? 0 };
      await mossGrip(c, deps, { at: pf, size: 8 * Math.max(0.7, sOf(player)) });
    });
  }
  await wave;
  await ctx.custom(unit.uniqueID, {
    durationMs: 240, ease: 'power2.out',
    onUpdate: (t) => unit.setPose({ squash: 1 - 0.1 * (1 - t), widen: 1 + 0.12 * (1 - t) }),
  });
}

// 穿山甲卷甲蓄力（rockPangolin 蓄力拍）：蜷成球状 + 甲片蓄能边光（edgeSurge
// shader 形体：剪影边缘金线双波上行 + 体表透光）+ 贴地岩尘环（groundRing 土色）
// + 落地双层尘（全域错峰，随身体占地铺开）+ 暖灯 punch。冲锋拍本身走通用突进
// （lunge 即「滚进」）。
async function pangolinCurl({ ctx, deps, unit, player }) {
  const s = sOf(unit);
  const feet = { x: unit.position.x, y: unit.position.y + unitH(unit) * 0.05, z: unit.position.z ?? 0 };
  const dir = Math.sign((player?.position.x ?? unit.position.x - 1) - unit.position.x) || 1;
  const curl = ctx.custom(unit.uniqueID, {
    durationMs: 360, ease: 'power3.inOut',
    onUpdate: (t) => unit.setPose({ squash: 1 - 0.3 * t, widen: 1 + 0.34 * t }),
  });
  // 甲片蓄能边光（蜷甲过程金线爬满全身——能量就位的读感）
  playEdgeSurge(unit, 0xd8a860, { durMs: 620 });
  await curl;
  // 落定：贴地岩尘环 + 全域双层尘 + 暖灯
  const ring = groundRing(ctx, deps, {
    at: feet, size: 15 * Math.max(0.7, s), ms: 520,
    color: [0.72, 0.60, 0.42], hot: [1.05, 0.88, 0.62], lampIntensity: 0,
  });
  dustLanding(ctx, deps, { at: feet, unit, dir, color: 0xb0a088, count: 16, lampIntensity: 420 });
  await Promise.all([ring, ctx.wait(140)]);
}

// 爆囊自爆死亡（blastPod：引线归零）。覆写通用死亡——它不是「倒下」是「炸开」：
// 短促膨胀到极限（白热一拍）→ 轰然爆碎（火球 + 冲击环 + 震屏 + 碎壳）→
// 本体随爆隐藏收殓。14 群伤的受击演出先于本拍各自播过，此处只演爆体本身。
function blastDeath(stage, unit, payload, finish) {
  if (!payload?.tags?.includes('blast')) return false; // 拆弹（被玩家击杀）走通用死亡
  const s = unit._baseScale ?? 1;
  unit.hideIntention();
  unit.hideStatus();
  const { x: px, y: py, z: pz } = unit.position;
  stage.animator.animateCustom(unit.uniqueID, {
    durationMs: 340, ease: 'power3.in',
    onUpdate: (t) => unit.setPose({ squash: 1 - 0.22 * t, widen: 1 + 0.38 * t }),
    onComplete: () => {
      stage._fxRunScript?.((c) => runBlastBurst(c, stage, { x: px, y: py + 3 * s, z: pz }, s));
      unit.setPose({ squash: 1, widen: 1 });
      unit.visible = false; // 随爆消失：收殓语义与通用死亡一致（place/sync 保持隐藏）
      finish();
    },
  });
  return undefined;
}

// 史莱姆融化死亡（slime/slimeB）：塌软成滩而非倒牌——缓慢下塌（squash 到底）→
// 液滴四溅 → 原地液化淡出（材质褪湿色 + alpha 侵蚀收干）。
// 史莱姆融化死亡（灰黑）：塌软成滩而非倒牌——缓慢下塌（squash 到底）+ 湿色浸染
// （深灰）+ 轮廓边缘坠落的深色胶珠（融化从摊开的边缘掉珠，非基座喷点）→
// 原地蒸干淡出。
function slimeMeltDeath(stage, unit, payload, finish) {
  if (payload?.heavy) return false; // 重击致死仍走击退倒牌（力道压过融化）
  unit.hideIntention();
  const bodyMat = unit.body.material;
  bodyMat.transparent = true;
  bodyMat.needsUpdate = true;
  const startColor = bodyMat.color.clone();
  const wetColor = new THREE.Color(0x2e3330);
  const rim = stage.particles;
  const drops = [0.32, 0.46, 0.58, 0.7, 0.82, 0.92]; // 边缘坠珠的摊开进度阈值
  let di = 0;
  stage.animator.animateCustom(unit.uniqueID, {
    durationMs: 620, ease: 'power2.in',
    onUpdate: (t) => {
      unit.setPose({ squash: 1 - 0.68 * t, widen: 1 + 0.55 * t });
      bodyMat.color.copy(startColor).lerp(wetColor, t * 0.65);
      // 融化从摊开的轮缘掉珠（阈值跨越式：帧率无关、总量确定、位置随 widen 外扩）
      while (di < drops.length && t >= drops[di]) {
        const side = di % 2 ? 1 : -1;
        di += 1;
        rim.spawn(unit.position.x + side * (2.0 + t * 2.4), unit.position.y + 0.8, {
          count: 1, color: 0x3a403c, speed: 1.5, size: 1.0, ttl: 1.1, gravity: -14, z: unit.position.z,
        });
      }
    },
    onComplete: () => {
      unit.hideStatus();
      unit.body.castShadow = false;
      stage.animator.animateCustom(unit.uniqueID, {
        durationMs: 460, ease: 'power1.in',
        onUpdate: (t) => { bodyMat.opacity = 1 - t; },
        onComplete: () => {
          bodyMat.color.copy(startColor);
          unit.visible = false;
          finish();
        },
      });
    },
  });
  return undefined;
}

// 复苏 garnish（起立落定后的主题点缀，fire-and-forget）
// 春风系（刺刺草）：嫩绿光点盘旋升起 + 脚下青草环闪。
function springBudGarnish(stage, unit) {
  const { x, y, z } = unit.position;
  stage.particles.spawn(x, y + 0.5, { count: 14, color: 0x9fe07a, speed: 3, size: 0.9, ttl: 1.1, gravity: 7, z });
  stage.particles.spawn(x, y + 0.3, { count: 8, color: 0x6ac86a, speed: 6, size: 1.1, ttl: 0.8, gravity: -2, z });
}
// 腐根系（腐败根须/树心）：暗绿腐气低漫 + 地面根须纹光。
function rotRootGarnish(stage, unit) {
  const { x, y, z } = unit.position;
  stage.particles.spawn(x, y + 0.4, { count: 12, color: 0x7a8a4a, speed: 4, size: 1.2, ttl: 1.0, gravity: 3, z });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.random() * 0.5;
    stage.particles.spawn(x + Math.cos(a) * 1.6, y + 0.2, { count: 3, color: 0x5a7a3a, speed: 5, size: 0.8, ttl: 0.7, gravity: -6, z });
  }
}
// 鼹鼠钻出（掘地鼹鼠 spawn）：脚下土块迸溅（从地下顶出来的读感）。
function moleEmergeGarnish(stage, unit) {
  const { x, y, z } = unit.position;
  stage.particles.spawn(x, y + 0.4, { count: 18, color: 0x9a7a52, speed: 11, ttl: 0.8, gravity: -18, size: 1.5, z });
  stage.particles.spawn(x, y + 0.2, { count: 10, color: 0x6a5238, speed: 7, ttl: 0.5, gravity: -10, size: 1.1, z });
}

// 爆囊爆碎段（_fxRunScript 协程）：火球 + 冲击环 + 焦黑碎壳
async function runBlastBurst(ctx, stage, at, s) {
  const deps = stage._spellDeps?.() ?? {};
  await Promise.all([
    fireBurst(ctx, deps, {
      at, scale: 1.6 + 0.4 * s, ms: 460, shakeSeverity: 2.2,
      sparkCount: 30, linger: { count: 14, ttl: 1.6 },
    }),
    impactBurst(ctx, deps, {
      at: { x: at.x, y: at.y + 1.5, z: at.z }, color: [1.0, 0.5, 0.2], hot: [1.3, 0.9, 0.6],
      count: 26, speed: 30, size: 1.2, ttl: 0.6, flashSize: 9, flashMs: 240, lampIntensity: 1400,
    }),
  ]);
  stage.particles.spawn(at.x, at.y, { count: 14, color: 0x3a2e24, speed: 18, ttl: 0.9, gravity: -26, size: 1.0, z: at.z });
}

// ====== 逐敌注册 ======

export function registerChapter1EnemyFx() {
  // -- 史莱姆族（胶质：弹性打击全套，ENEMY_FX.md 迭代#1；bigSlime 为章2 接线，
  //    同一物种同一语言）--
  for (const id of ['slime', 'slimeB', 'slimeletA', 'slimeletB', 'bigSlime']) {
    registerEnemyAct(id, async (a) => {
      const { kinds } = a;
      if (isAtk(kinds)) return gelCompress(a);
      if (isDeb(kinds)) return spitGlob({
        color: [0.55, 0.62, 0.58], hot: [0.88, 0.96, 0.92], size: 4.0, ms: 460, arcH: 3.2,
        trailColor: 0x565c58, impactColor: 0x6e7671, impactCount: 12, muzzleK: 0.52,
      })(a); // 塞粘液（灰黑史莱姆本色；迭代#4 液弹彗星）
      if (has(kinds, 'buff')) return gelBrace(a); // 蓄势拍（纯姿态）
      if (has(kinds, 'defend')) return hunkerFx({ depth: 0.85 })(a);
      return 'generic';
    });
    registerEnemyLunge(id, slimePounce());
    registerEnemyHitBeat(id, slimeGooImpact());
    if (id === 'slime' || id === 'slimeB' || id === 'bigSlime') registerEnemyDeathBeat(id, slimeMeltDeath);
  }
  // -- 怨灵（远程：洗虚无/虚弱）--
  for (const id of ['wraithA', 'wraithB']) {
    registerEnemyAct(id, async (a) => {
      if (isDeb(a.kinds)) return wailFx({ theme: 'wraith', rings: 3 })(a); // 怨灵啸（阴波环）
      return 'generic'; // 攻击拍：通用突进（怨灵扑脸即「鬼上身」）
    });
    registerEnemyHitTheme(id, {
      pal: { color: [0.55, 0.42, 0.85], hot: [0.9, 0.8, 1.3], rim: [0.5, 0.4, 0.9], sparkColor: 0xb9a0e8 },
      garnish: (c, d, { at, heavy }) => {
        d.particles?.spawn?.(at.x, at.y, {
          color: 0x9a80c8, count: heavy ? 10 : 6, speed: 5, size: 1.0, ttl: 0.9, gravity: 5, z: at.z,
        });
        d.particles?.spawn?.(at.x, at.y, {
          color: 0x9a80c8, count: Math.round((heavy ? 10 : 6) * 0.5), speed: (5) * 0.4, size: (1.0) * 1.4, ttl: (0.9) * 2.2, gravity: (5) * 0.3, z: at.z,
        });
      },
    });
  }
  // -- 针鼠（荆棘）--
  registerEnemyAct('hedgehog', async (a) => {
    const { kinds } = a;
    if (isAtk(kinds)) return strikeWindup('rear', { color: 0xc8b060 })(a);
    if (isBuf(kinds)) return bristleFx({ color: 0xd8c060 })(a); // 竖刺/补刺
    if (has(kinds, 'defend')) return hunkerFx({ depth: 1.0 })(a);
    return 'generic';
  });
  registerEnemyHitTheme('hedgehog', {
    pal: { sparkColor: 0xd8c060 },
    garnish: (c, d, { at, heavy }) => d.particles?.spawn?.(at.x, at.y, {
      color: 0xc8b060, count: heavy ? 8 : 4, speed: 22, size: 0.5, ttl: 0.35, gravity: -14, z: at.z,
    }), // 针刺飞刺（细快小粒）
  });
  // -- 腐苔球（扎根：紧勒/防御/攻）--
  for (const id of ['mossBallA', 'mossBallB', 'mossBallC']) {
    registerEnemyAct(id, async (a) => {
      const { kinds } = a;
      if (kinds.includes('strongDebuff')) return spreadGrip(a);
      if (isAtk(kinds)) return strikeWindup('blob', { color: 0x7a9a5a })(a);
      if (has(kinds, 'defend')) return hunkerFx({ depth: 0.9 })(a);
      return 'generic';
    });
    registerEnemyNoLunge(id); // 苔球贴地蠕动，不扑人
    // 命中主题「湿苔迸裂」（ENEMY_FX.md 迭代#17）：湿重植物团被打碎——形体件
    // mossBurst（湿苔块重坠 + 断须 + 底部溅幕 + 深绿湿核）＋ 定向双层粒子。
    // 色系与 mossCreep v2 同源：深湿绿派生 + 湿亮边窄用，pal 同步压暗。
    registerEnemyHitTheme(id, {
      // rim 一并压成湿绿（底盘缺省 rim 是暖橙——留橙会在绿冲击上叠一条脏边）
      pal: { color: [0.20, 0.32, 0.15], hot: [0.45, 0.62, 0.30], rim: [0.35, 0.50, 0.28], sparkColor: 0x5a7a42 },
      garnish: (c, d, { at, heavy }) => {
        // 形体件独立短协程：命中 beat 收尾（punchImpact 240ms）会触发父 ctx 的
        // onKill，挂父 ctx 会把仍在坠的苔块提前摘除。本件 ≤430ms 自收尾，
        // 不占节拍时序、失败不进冲击主体。
        runScript((cc) => mossBurst(cc, d, {
          at: { x: at.x, y: at.y + (heavy ? 0.4 : 0), z: at.z },
          size: heavy ? 18.0 : 16.0, ms: heavy ? 430 : 380,
        }));
        // 快层湿苔碎屑（甩脱）：左右两撮定向外抛、重力大、短命——不是中心 radial
        d.particles?.spawn?.(at.x - 0.9, at.y + 0.5, {
          color: 0x3e5228, count: 3, speed: 2.8, size: 0.9, ttl: 0.4,
          gravity: -26, z: at.z, vx: -10.5, vy: 3.5,
        });
        d.particles?.spawn?.(at.x + 0.9, at.y + 0.4, {
          color: 0x465a2e, count: heavy ? 3 : 2, speed: 2.8, size: 0.9, ttl: 0.4,
          gravity: -26, z: at.z, vx: 10.5, vy: 3.0,
        });
        // 慢层孢尘（扬尘）：初速上行 + 轻重力回落（先微扬后缓落），长命漂浮
        d.particles?.spawn?.(at.x, at.y + 0.2, {
          color: 0x6a7a4a, count: 3, speed: 1.8, size: 1.35, ttl: 1.2,
          gravity: -2.4, z: at.z, vy: 3.2,
        });
        if (heavy) {
          d.particles?.spawn?.(at.x + 0.6, at.y - 0.2, {
            color: 0x5c6c40, count: 1, speed: 1.4, size: 1.2, ttl: 1.15,
            gravity: -2.2, z: at.z, vy: 2.6,
          });
        }
      },
    });
  }
  // -- 鼓腹蟾（鼓气/渐强攻）--
  for (const id of ['pufferToadA', 'pufferToadB', 'pufferToadC']) {
    registerEnemyAct(id, async (a) => {
      const { kinds } = a;
      if (kinds.includes('unknown')) return pufferInflate(a); // 鼓气拍
      if (isAtk(kinds)) return strikeWindup('blob', {
        color: 0xa8d878, heavy: kinds.includes('heavy'),
      })(a);
      return 'generic';
    });
    registerEnemyHitTheme(id, {
      pal: { color: [0.6, 0.85, 0.4], hot: [0.95, 1.15, 0.6], sparkColor: 0xb8e070 },
      garnish: (c, d, { at, heavy }) => {
        d.particles?.spawn?.(at.x, at.y, {
          color: 0xc8e080, count: heavy ? 14 : 8, speed: 11, size: 0.9, ttl: 0.6, gravity: -16, z: at.z,
        });
        d.particles?.spawn?.(at.x, at.y, {
          color: 0xc8e080, count: Math.round((heavy ? 14 : 8) * 0.5), speed: (11) * 0.4, size: (0.9) * 1.4, ttl: (0.6) * 2.2, gravity: (-16) * 0.3, z: at.z,
        });
      },
    });
  }
  // -- 爆囊（待爆/缩囊/攻；自爆死亡）--
  for (const id of ['blastPod', 'blastPodB']) {
    registerEnemyAct(id, async (a) => {
      const { kinds } = a;
      if (kinds.includes('unknown')) return trembleWarn({ color: 0xff5a3a })(a); // 待爆拍
      if (isAtk(kinds)) return strikeWindup('blob', { color: 0xe08850 })(a);
      if (has(kinds, 'defend')) return hunkerFx({ depth: 1.0, dustColor: 0x8a6a50 })(a);
      return 'generic';
    });
    registerEnemyDeathBeat(id, blastDeath);
    registerEnemyHitTheme(id, {
      pal: { sparkColor: 0xff9a50 },
      garnish: (c, d, { at, heavy }) => {
        d.particles?.spawn?.(at.x, at.y, {
          color: 0xff8a40, count: heavy ? 12 : 6, speed: 8, size: 0.8, ttl: 0.5, gravity: 6, z: at.z,
        });
        d.particles?.spawn?.(at.x, at.y, {
          color: 0xff8a40, count: Math.round((heavy ? 12 : 6) * 0.5), speed: (8) * 0.4, size: (0.8) * 1.4, ttl: (0.5) * 2.2, gravity: (6) * 0.3, z: at.z,
        });
      },
    });
  }
  // -- 石茧（破茧/蓄势/攻）--
  registerEnemyAct('stoneCocoon', async (a) => {
    const { kinds } = a;
    if (isAtk(kinds)) return strikeWindup('rear', { color: 0xb0a890 })(a);
    if (isBuf(kinds)) return gatherFocus({ vein: [0.85, 0.80, 0.64], moteColor: 0xd8c8a0 })(a); // 蓄势
    if (has(kinds, 'defend')) return hunkerFx({ depth: 1.2, dustColor: 0xb8a98c })(a);
    return 'generic';
  });
  registerEnemyHitTheme('stoneCocoon', {
    pal: { sparkColor: 0xc8bca0 },
    garnish: (c, d, { at, heavy }) => {
      d.particles?.spawn?.(at.x, at.y, {
        color: 0xa8a090, count: heavy ? 12 : 7, speed: 14, size: 0.9, ttl: 0.5, gravity: -28, z: at.z,
      }); // 岩屑崩落（迸射）
      d.particles?.spawn?.(at.x, at.y, {
        color: 0x8a8274, count: Math.round((heavy ? 12 : 7) * 0.5), speed: 5, size: 1.3, ttl: 1.1, gravity: -8, z: at.z,
      }); // 碎块滚落（慢速层）
    },
  });
  // -- 岩螺（缩壳/壳弹连击）--
  registerEnemyAct('rockSnail', async (a) => {
    const { kinds } = a;
    if (isAtk(kinds)) return strikeWindup('rear', { color: 0xb0a890 })(a); // 壳弹起手（连击命中走 rapid）
    if (has(kinds, 'defend') || isBuf(kinds)) return hunkerFx({ depth: 1.1 })(a);
    return 'generic';
  });
  registerEnemyNoLunge('rockSnail');
  registerEnemyHitTheme('rockSnail', {
    pal: { sparkColor: 0xc8bca0 },
    garnish: (c, d, { at, heavy }) => {
      d.particles?.spawn?.(at.x, at.y, {
        color: 0xb0a890, count: 5, speed: 18, size: 0.7, ttl: 0.4, gravity: -26, z: at.z,
      });
      d.particles?.spawn?.(at.x, at.y, {
        color: 0xb0a890, count: Math.round((5) * 0.5), speed: (18) * 0.4, size: (0.7) * 1.4, ttl: (0.4) * 2.2, gravity: (-26) * 0.3, z: at.z,
      });
    },
  });
  // -- 刺刺草（藤鞭/毒液；春风复苏）--
  for (const id of ['thornWeed', 'thornWeedB', 'thornWeedT']) {
    registerEnemyAct(id, async (a) => {
      const { kinds } = a;
      if (isAtk(kinds)) return strikeWindup('lash', { color: 0x8aba60 })(a);
      if (isDeb(kinds)) return spitGlob({
        color: [0.35, 0.75, 0.30], hot: [0.7, 1.05, 0.55], size: 4.6, ms: 480, arcH: 3.8,
        trailColor: 0x5a9a40, impactColor: 0x7aba50, impactCount: 14,
      })(a); // 毒液（迭代#4 液弹彗星）
      return 'generic';
    });
    if (id !== 'thornWeedT') registerEnemySpawnGarnish(id, springBudGarnish); // T 类无复苏
    registerEnemyHitTheme(id, {
      pal: { sparkColor: 0x9aba60 },
    });
  }
  // -- 腐食甲虫（啃食/硬化/攻）--
  for (const id of ['carrionBeetle', 'carrionBeetleB']) {
    registerEnemyAct(id, async (a) => {
      const { kinds } = a;
      if (kinds.includes('strongDebuff')) return gnawAntic(a); // 啃牌起手（正餐在焚毁拍）
      if (isAtk(kinds)) return strikeWindup('rear', { color: 0xb09060 })(a);
      if (isBuf(kinds)) return hardenFx({ color: 0xb0a890 })(a); // B 类硬化
      return 'generic';
    });
    registerEnemyHitTheme(id, {
      pal: { sparkColor: 0xd0a860 },
      garnish: (c, d, { at, heavy }) => {
        d.particles?.spawn?.(at.x, at.y, {
          color: 0x8a7048, count: heavy ? 10 : 5, speed: 16, size: 0.7, ttl: 0.45, gravity: -24, z: at.z,
        }); // 甲壳碎屑（迸射）
        d.particles?.spawn?.(at.x, at.y, {
          color: 0x6a5838, count: Math.round((heavy ? 10 : 5) * 0.5), speed: 6, size: 1.1, ttl: 1.0, gravity: -7, z: at.z,
        }); // 壳片滚落（慢速层）
      },
    });
  }
  // -- 掘地鼹鼠（突袭/掘洞/重击）--
  registerEnemyAct('diggerMole', async (a) => {
    const { kinds } = a;
    if (kinds.includes('heavy')) return strikeWindup('crouch', { color: 0x9a7a52, heavy: true })(a);
    if (isAtk(kinds)) return strikeWindup('crouch', { color: 0x9a7a52 })(a);
    if (has(kinds, 'defend')) return hunkerFx({ depth: 1.1, dustColor: 0x9a7a52 })(a);
    if (isBuf(kinds)) return burrowRest({ color: 0xa89070 })(a); // 掘洞恢复
    return 'generic';
  });
  registerEnemySpawnGarnish('diggerMole', moleEmergeGarnish);
  registerEnemyHitTheme('diggerMole', {
    pal: { sparkColor: 0xc0a070, dustColor: 0x9a7a52 },
  });
  // -- 静电毛球（电击链/防御）--
  for (const id of ['staticPuff', 'staticPuffB']) {
    registerEnemyAct(id, async (a) => {
      const { kinds } = a;
      if (isAtk(kinds)) return zapChainFx(a); // 电击+全员蓄势（电弧是攻击的本体演出）
      if (has(kinds, 'defend')) return hunkerFx({ depth: 0.8 })(a);
      return 'generic';
    });
    registerEnemyNoLunge(id); // 远程电击不突进
    registerEnemyHitTheme(id, {
      pal: { color: [0.55, 0.75, 1.30], hot: [1.0, 1.15, 1.5], rim: [0.5, 0.7, 1.2], sparkColor: 0xbfe0ff },
      // 受击拍（迭代#19）：贴身残弧（主形体，「电流还挂在身上」）+ 迸闪双层火花
      // （快层迸射 / 慢层滞留），旧版双层同色重复收敛。
      garnish: (c, d, { at, unit }) => {
        // 残弧独立短协程：命中 beat 收尾会触发父 ctx 的 onKill，挂父 ctx 会被提前
        // 摘除（同 mossBurst 接法）。两小段竖向电弧错开 40ms 快闪即灭。
        const H = unitH(unit ?? {});
        const half = H * 0.35 * 0.5;
        runScript(async (cc) => {
          const mk = (dx, dy) => zapArc(cc, d, {
            from: { x: at.x + dx, y: at.y - half + dy, z: at.z + 0.6 },
            to: { x: at.x + dx + 0.32, y: at.y + half + dy, z: at.z + 0.6 },
            color: [0.55, 0.75, 1.30], width: 4, lifeMs: 220, reachMs: 45,
          });
          const a1 = mk(-0.55, 0);
          a1.jolt();
          await cc.wait(40);
          const a2 = mk(0.42, -0.05 * H);
          a2.jolt();
          await Promise.all([a1.promise, a2.promise]);
        });
        // 快层：命中瞬间迸射（短命、高速、细）
        d.particles?.spawn?.(at.x, at.y, {
          color: 0xd8ecff, count: 9, speed: 24, size: 0.55, ttl: 0.22, gravity: 0, z: at.z,
        });
        // 慢层：滞留电点（缓、大、长命——与快层分工不叠色）
        d.particles?.spawn?.(at.x, at.y, {
          color: 0x9ab8e8, count: 4, speed: 8, size: 0.8, ttl: 0.6, gravity: 0, z: at.z,
        });
      },
    });
  }
  // -- 嗡嗡虫（振翅塞粉尘/连撞）--
  for (const id of ['buzzbugA', 'buzzbugB']) {
    registerEnemyAct(id, async (a) => {
      const { kinds } = a;
      if (isDeb(kinds)) return wingDust(a);
      if (isAtk(kinds)) return strikeWindup('hover', { color: 0xd8c088 })(a);
      return 'generic';
    });
    registerEnemyHitTheme(id, {
      pal: { sparkColor: 0xe0d0a0 },
      garnish: (c, d, { at, heavy }) => {
        d.particles?.spawn?.(at.x, at.y, {
          color: 0xd8c088, count: 5, speed: 8, size: 0.7, ttl: 0.5, gravity: -6, z: at.z,
        });
        d.particles?.spawn?.(at.x, at.y, {
          color: 0xd8c088, count: Math.round((5) * 0.5), speed: (8) * 0.4, size: (0.7) * 1.4, ttl: (0.5) * 2.2, gravity: (-6) * 0.3, z: at.z,
        });
      },
    });
  }
  // -- 腐败根须/树心（藤拍/蓄力；腐根复苏）--
  for (const id of ['rottenRoot', 'rottenRootB', 'rottenRootT']) {
    registerEnemyAct(id, async (a) => {
      const { kinds } = a;
      if (isAtk(kinds)) return strikeWindup('lash', { color: 0x7a8a4a })(a);
      if (isBuf(kinds)) return gatherFocus({ vein: [0.60, 0.54, 0.35], moteColor: 0x9a8a5a })(a); // 蓄力
      return 'generic';
    });
    if (id !== 'rottenRootT') registerEnemySpawnGarnish(id, rotRootGarnish);
    registerEnemyHitTheme(id, {
      pal: { color: [0.5, 0.6, 0.35], hot: [0.8, 0.9, 0.55], sparkColor: 0x8a9a5a },
    });
  }
  registerEnemyAct('rottenTreeHeart', async (a) => {
    const { kinds } = a;
    if (isAtk(kinds)) return strikeWindup('lash', { color: 0x7a8a4a })(a);
    if (isBuf(kinds)) return gatherFocus({ vein: [0.60, 0.54, 0.35], moteColor: 0x9a8a5a })(a); // 蓄力
    if (has(kinds, 'defend')) return hunkerFx({ depth: 0.7 })(a);
    return 'generic';
  });
  registerEnemySpawnGarnish('rottenTreeHeart', rotRootGarnish);
  registerEnemyHitTheme('rottenTreeHeart', {
    pal: { color: [0.5, 0.6, 0.35], hot: [0.8, 0.9, 0.55], sparkColor: 0x8a9a5a },
  });

  // ====== 章1 精英 ======

  // 雪狼：开局压制（短嚎+伏低）、塞震慑（冰嚎）、攻+盾、三连爪击
  registerEnemyAct('snowwolf', async (a) => {
    const { kinds } = a;
    if (isDeb(kinds) && !isAtk(kinds)) {
      return wailFx({ theme: 'ice', rings: 4, upMotes: 8 })(a); // 塞震慑拍：冰嚎（晶棱环）
    }
    if (isDeb(kinds) && isAtk(kinds)) {
      await wailFx({ theme: 'ice', rings: 2, upMotes: 4 })(a); // 开局压制：短嚎
      return strikeWindup('crouch', { color: 0xc8d8e0 })(a); // → 伏低（咬随伤害拍）
    }
    if (isAtk(kinds)) return strikeWindup('crouch', { color: 0xc8d8e0, heavy: kinds.includes('heavy') })(a);
    return 'generic';
  });
  registerEnemyHitTheme('snowwolf', {
    pal: { color: [0.62, 0.80, 1.05], hot: [1.0, 1.1, 1.35], rim: [0.55, 0.75, 1.1], sparkColor: 0xcfe8f5 },
    garnish: (c, d, { at, heavy }) => {
      d.particles?.spawn?.(at.x, at.y, {
        color: 0xd8ecf8, count: heavy ? 12 : 7, speed: 12, size: 0.8, ttl: 0.55, gravity: -6, z: at.z,
      });
      d.particles?.spawn?.(at.x, at.y, {
        color: 0xd8ecf8, count: Math.round((heavy ? 12 : 7) * 0.5), speed: (12) * 0.4, size: (0.8) * 1.4, ttl: (0.55) * 2.2, gravity: (-6) * 0.3, z: at.z,
      });
    },
  });
  // 沼泽伏击者：扑咬（重档）/毒雾/晕眩发呆
  registerEnemyAct('swampAmbusher', async (a) => {
    const { kinds } = a;
    if (kinds.includes('stun')) return dazeSway({ color: 0xa8c890 })(a);
    if (isDeb(kinds) && !isAtk(kinds)) {
      return spitGlob({
        color: [0.4, 0.7, 0.35], hot: [0.75, 1.0, 0.55], size: 5.0, ms: 510, arcH: 4.2,
        trailColor: 0x5a8a4a, impactColor: 0x7aba5a, impactCount: 18,
      })(a); // 毒雾（迭代#4 大弹彗星——雾弹体积更大）
    }
    if (isAtk(kinds)) return strikeWindup('crouch', { color: 0x7a9a5a, heavy: true })(a);
    if (has(kinds, 'defend')) return hunkerFx({ depth: 1.1 })(a);
    return 'generic';
  });
  registerEnemyHitTheme('swampAmbusher', {
    pal: { sparkColor: 0x8aba60, dustColor: 0x6a7a52 },
  });
  // 碎岩穿山甲：卷甲蓄力 → 冲锋（滚进走通用突进）
  registerEnemyAct('rockPangolin', async (a) => {
    const { kinds } = a;
    if (has(kinds, 'defend') || isBuf(kinds)) return pangolinCurl(a);
    if (isAtk(kinds)) return strikeWindup('crouch', { color: 0xb0a088, heavy: true })(a);
    return 'generic';
  });
  registerEnemyHitTheme('rockPangolin', {
    pal: { sparkColor: 0xd0b880 },
    garnish: (c, d, { at, heavy }) => {
      d.particles?.spawn?.(at.x, at.y, {
        color: 0xa89878, count: heavy ? 14 : 8, speed: 16, size: 1.0, ttl: 0.55, gravity: -26, z: at.z,
      });
      d.particles?.spawn?.(at.x, at.y, {
        color: 0xa89878, count: Math.round((heavy ? 14 : 8) * 0.5), speed: (16) * 0.4, size: (1.0) * 1.4, ttl: (0.55) * 2.2, gravity: (-26) * 0.3, z: at.z,
      });
    },
  });
  // 幼年罗刹：狂乱连爪/力量蓄
  registerEnemyAct('youngRakshasa', async (a) => {
    const { kinds } = a;
    if (isBuf(kinds)) return rageSwell({})(a); // 力量2（爆怒）
    if (isAtk(kinds)) return strikeWindup('crouch', { color: 0xd08868 })(a);
    return 'generic';
  });
  registerEnemyHitTheme('youngRakshasa', {
    pal: { color: [0.9, 0.4, 0.3], hot: [1.3, 0.7, 0.55], sparkColor: 0xf09070 },
  });
}
