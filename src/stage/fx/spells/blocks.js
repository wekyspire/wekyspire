// 施术演出·基础块 SDK（spellFx 的乐高，2026-09-30 用户定「动画逻辑生成器」架构的
// 底层件——类比 PCG 的 kit→composeRoom：模板生成器从这些块拼装，块是共享词汇）。
//
// 块签名统一：`async (ctx, deps, p) => void`——
//   ctx  = fx/script 的 ScriptContext（tween/wait/spawn + 结构化 kill 语义）
//   deps = 舞台服务袋（BattleStage 装配：scene/particles/cast 灯池/shake/camera…）
//   p    = 纯数据参数（可过 wire 的口径——块与模板的参数面永远纯数据）
// 块纪律：
//   · 自建对象（mesh/材质/几何）一律 ctx.onKill 兜底回收，正常路径也自收；
//   · 借用资产只推参数不持有：粒子走 deps.particles.spawn（爆散）、灯**只借
//     光池 light:fx0/fx1**（演出中途 new 灯 = 全场景着色器重编译 1.2s 冻帧，铁律）；
//   · 块不决定节拍时序——notify 时机（早通告/全落定才通告）归模板编排；
//   · 所有世界向发光面片走 additiveLight（rgb 加算、alpha 不占地——RT 合成铁律）。
import * as THREE from 'three';
import { additiveLight } from '../../post/passes.js';

/** 卡面起手：HDR 色脉冲过卡面（CardFxLayer.pulse 公共节拍，块只做参数化包装）。 */
export async function cardFlare(ctx, deps, {
  color = 0xffd34c, ms = 240, scale = 1.5,
} = {}) {
  const view = deps.cardView;
  if (!view?.fx?.pulse) return;
  view.fx.pulse({ color, durationMs: ms, scale });
  await ctx.wait(Math.round(ms * 0.6));   // 起手不必等脉冲收尾——亮起来就够了
}

/**
 * 投射物块：自管加色圆片沿抛物弧线从 from 飞到 to（固定点；目标会动的话由模板
 * 先取好落点）。可选灯拖尾（借光池）与微粒尾迹（burst 门面）。
 */
export async function arcProjectile(ctx, deps, {
  from, to,
  color = 0xff7a2d, size = 1.6, ms = 320, arcH = 7,
  lampName = 'light:fx0', lampIntensity = 700,
  trail = null,   // { color, speed?, size?, ttl? }：沿途微粒尾迹（每 ~70ms 两颗）
} = {}) {
  if (!from || !to) return;
  const geo = new THREE.PlaneGeometry(size, size);
  const mat = additiveLight(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false }));
  const quad = new THREE.Mesh(geo, mat);
  quad.name = 'spellFx:projectile';
  quad.renderOrder = 50;   // 施术面片层级（UnitObject.js 基值约定）：盖立绘(0)、让位状态层(60+)/粒子(70+)
  quad.position.set(from.x, from.y, from.z ?? 0);
  deps.scene.add(quad);
  // 灯拖尾：光池现挂现推强度，结束归零（不摘不删——池灯常驻场景，禁 new）
  const lamp = deps.cast?.get?.(lampName) ?? null;
  if (lamp) { lamp.color.set(color); lamp.intensity = 0; }
  ctx.onKill(() => {
    deps.scene.remove(quad); geo.dispose(); mat.dispose();
    if (lamp) lamp.intensity = 0;
  });
  if (trail) {
    ctx.spawn(async (c) => {   // 尾迹随父本被杀
      for (;;) {
        await c.wait(70);
        if (!quad.parent) break;
        deps.particles?.spawn?.(quad.position.x, quad.position.y, {
          color: trail.color, count: 2, speed: trail.speed ?? 5,
          size: trail.size ?? 0.7, ttl: trail.ttl ?? 0.35, gravity: 0,
          z: quad.position.z,
        });
      }
    });
  }
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'power1.in',
    onUpdate: () => {
      const t = st.t, u = 1 - t;
      quad.position.set(
        u * from.x + t * to.x,
        u * from.y + t * to.y + Math.sin(Math.PI * t) * arcH,
        u * (from.z ?? 0) + t * (to.z ?? 0),
      );
      if (lamp) {
        lamp.position.copy(quad.position);
        lamp.intensity = lampIntensity * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5);
      }
    },
    onComplete: () => {
      deps.scene.remove(quad); geo.dispose(); mat.dispose();
      if (lamp) lamp.intensity = 0;
    },
  });
}

/**
 * 落点爆发块：粒子主爆 + 闪光核心（加色面片快膨胀淡出）+ 灯 punch + 可选小震屏
 * + 可选余烬组（慢速长 ttl——「3 秒才散干净」的背景层，模板可先行 notify）。
 */
export async function impactBurst(ctx, deps, {
  at,
  color = 0xff7a2d, count = 24, speed = 26, size = 1.1, ttl = 0.55, gravity = -26,
  flashSize = 3.2, flashMs = 220,
  lampName = 'light:fx1', lampIntensity = 1100, lampMs = 300,
  linger = null,   // { color?, count?, speed?, ttl?, size?, gravity? }：余烬（后台散尽层）
  shakeSeverity = 0,
} = {}) {
  if (!at) return;
  deps.particles?.spawn?.(at.x, at.y, { color, count, speed, size, ttl, gravity, z: at.z });
  if (linger) {
    deps.particles?.spawn?.(at.x, at.y, {
      color: linger.color ?? color, count: linger.count ?? 14,
      speed: linger.speed ?? 7, size: linger.size ?? 0.8,
      ttl: linger.ttl ?? 2.4, gravity: linger.gravity ?? -9, z: at.z,
    });
  }
  // 闪光核心
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = additiveLight(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false, depthTest: false }));
  const quad = new THREE.Mesh(geo, mat);
  quad.name = 'spellFx:flash';
  quad.renderOrder = 50;
  quad.position.set(at.x, at.y, (at.z ?? 0) + 2);
  deps.scene.add(quad);
  ctx.onKill(() => { deps.scene.remove(quad); geo.dispose(); mat.dispose(); });
  const st = { t: 0 };
  const flash = ctx.tweenRaw(st, { t: 1 }, {
    durationMs: flashMs, ease: 'power2.out',
    onUpdate: () => {
      const s = flashSize * (0.35 + 0.65 * st.t);
      quad.scale.set(s, s, 1);
      mat.opacity = 0.95 * (1 - st.t);
    },
    onComplete: () => { deps.scene.remove(quad); geo.dispose(); mat.dispose(); },
  });
  // 灯 punch（借池）：快起慢落
  const lamp = deps.cast?.get?.(lampName) ?? null;
  let lampJob = null;
  if (lamp) {
    lamp.color.set(color);
    lamp.position.set(at.x, at.y, (at.z ?? 0) + 2);
    lamp.intensity = 0;
    lampJob = (async () => {
      await ctx.tweenRaw(lamp, { intensity: lampIntensity }, { durationMs: Math.round(lampMs * 0.35), ease: 'power2.out' });
      await ctx.tweenRaw(lamp, { intensity: 0 }, { durationMs: Math.round(lampMs * 0.65), ease: 'power2.in' });
    })();
    ctx.onKill(() => { lamp.intensity = 0; });
  }
  if (shakeSeverity > 0) deps.shake?.impulse?.(shakeSeverity);
  await Promise.all([flash, lampJob].filter(Boolean));
}

/**
 * 斩痕扫掠块：长条加色面片斜置，从目标左外侧快速扫到右外侧（短促刀光语言，
 * 200ms 级）。angle 斜置读「挥砍」，dir 翻转扫掠方向（背水斩这类反向卡用）。
 */
export async function slashSweep(ctx, deps, {
  at,
  color = 0xeaf2ff, ms = 200, width = 7, height = 1.15,
  angle = -0.32, dir = 1, z = 2,
} = {}) {
  if (!at) return;
  const geo = new THREE.PlaneGeometry(width, height);
  const mat = additiveLight(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, depthTest: false }));
  const quad = new THREE.Mesh(geo, mat);
  quad.name = 'spellFx:slash';
  quad.renderOrder = 50;
  quad.rotation.z = angle;
  quad.position.set(at.x - dir * width * 0.55, at.y, (at.z ?? 0) + z);
  deps.scene.add(quad);
  ctx.onKill(() => { deps.scene.remove(quad); geo.dispose(); mat.dispose(); });
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'power2.in',
    onUpdate: () => {
      quad.position.x = at.x - dir * width * 0.55 * (1 - st.t * 2);
      mat.opacity = 0.9 * (1 - Math.pow(st.t, 2.2));
    },
    onComplete: () => { deps.scene.remove(quad); geo.dispose(); mat.dispose(); },
  });
}
