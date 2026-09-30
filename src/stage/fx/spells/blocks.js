// 施术演出·基础块 SDK（spellFx 的乐高，2026-09-30 用户定「动画逻辑生成器」架构的
// 底层件——类比 PCG 的 kit→composeRoom：模板生成器从这些块拼装，块是共享词汇）。
//
// 块签名统一：`async (ctx, deps, p) => void`——
//   ctx  = fx/script 的 ScriptContext（tween/wait/spawn + 结构化 kill 语义）
//   deps = 舞台服务袋（BattleStage 装配：scene/particles/cast 灯池/shake/camera…）
//   p    = 纯数据参数（可过 wire 的口径——块与模板的参数面永远纯数据）
// 块纪律：
//   · TA 主笔在 shader（shaders.js 的 TSL——形状/扫掠/渐隐全在 fragment 里算），
//     geometry transform 只做辅助（冲击 punch / 朝向拉伸 / 斜置）；
//   · 自建对象（mesh/材质/几何）一律 ctx.onKill 兜底回收，正常路径也自收；
//   · 借用资产只推参数不持有：粒子走 deps.particles.spawn（爆散）、灯**只借
//     光池 light:fx0/fx1**（演出中途 new 灯 = 全场景着色器重编译 1.2s 冻帧，铁律）；
//   · 块不决定节拍时序——notify 时机（早通告/全落定才通告）归模板编排；
//   · 世界向发光面片一律 additiveLight（rgb 直出、alpha 不占地）+ depthTest:false
//     + renderOrder 50（UnitObject 层级基值：盖立绘(0)、让位状态层(60+)/粒子(70+)）；
//   · 色参用线性三元组 [r,g,b]（shaders.js 尾注的 Color 构造约定）。
import * as THREE from 'three';
import { uniform, uv, vec4, float } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { additiveLight } from '../../post/passes.js';
import { slashShade, darkSlashShade, coreShade } from './shaders.js';

const FX_RENDER_ORDER = 50;   // 施术面片层级（见文件头纪律）
const linearColor = (rgb) => uniform(new THREE.Color(rgb[0], rgb[1], rgb[2]));

/** 卡面起手：HDR 色脉冲过卡面（CardFxLayer.pulse 公共节拍，块只做参数化包装）。 */
export async function cardFlare(ctx, deps, {
  color = 0xffd34c, ms = 240, scale = 1.5,
} = {}) {
  const view = deps.cardView;
  if (!view?.fx?.pulse) return;
  view.fx.pulse({ color, durationMs: ms, scale });
  await ctx.wait(Math.round(ms * 0.6));   // 起手不必等脉冲收尾——亮起来就够了
}

/** 施术面片（shader 主笔件的公共装配）：Node 材质 + colorNode + 层级纪律一把装好。 */
function spellQuad({ shade, width, height, name }) {
  const geo = new THREE.PlaneGeometry(width, height);
  const mat = additiveLight(new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false }));
  const dbg = new URLSearchParams(location.search).get('spelldebug');
  mat.colorNode = shade;
  if (dbg === 'const') mat.colorNode = vec4(1.0, 0.15, 0.05, 1.0);   // 排障：常量红对照
  const quad = new THREE.Mesh(geo, mat);
  quad.name = name;
  quad.renderOrder = FX_RENDER_ORDER;
  return { quad, geo, mat };
}

/**
 * 投射物块：能量核（shader：宽晕+热核 HDR+闪烁）沿抛物弧线从 from 飞到 to。
 * 几何辅助 = mesh 朝速度方向自旋 + 前向拉伸（能量拖长读感）。可选灯拖尾与微粒尾迹。
 */
export async function arcProjectile(ctx, deps, {
  from, to,
  color = [1.0, 0.45, 0.18], hot = [1.0, 0.85, 0.63],
  size = 2.4, ms = 320, arcH = 7,
  lampName = 'light:fx0', lampIntensity = 700,
  trail = null,   // { color, speed?, size?, ttl? }：沿途微粒尾迹（每 ~70ms 两颗）
} = {}) {
  if (!from || !to) return;
  const uPhase = uniform(0.0);
  const uColor = linearColor(color);
  const uHot = linearColor(hot);
  const uRing = uniform(0.0);   // 投射物无冲击环
  const { quad, geo, mat } = spellQuad({
    shade: coreShade(uv(), uPhase, uColor, uHot, uRing),
    width: size, height: size, name: 'spellFx:projectile',
  });
  quad.position.set(from.x, from.y, from.z ?? 0);
  deps.scene.add(quad);
  const lamp = deps.cast?.get?.(lampName) ?? null;
  if (lamp) { lamp.color.setRGB(color[0], color[1], color[2]); lamp.intensity = 0; }
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
      // 朝速度方向自旋（弧线切线）+ 前向拉伸
      const vx = to.x - from.x;
      const vy = (to.y - from.y) + arcH * Math.PI * Math.cos(Math.PI * t);
      quad.rotation.z = Math.atan2(vy, vx);
      quad.scale.set(1.35, 1.0, 1);
      uPhase.value = t * 20;   // shader 闪烁相位（单调即可）
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
 * 落点爆发块：粒子主爆 + 冲击闪光（shader：宽晕+热核+扩张冲击环——「冲击波」读感）
 * + 灯 punch + 可选小震屏 + 可选余烬组（慢速长 ttl——「3 秒才散干净」的背景层，
 * 模板可先行 notify）。
 */
export async function impactBurst(ctx, deps, {
  at,
  color = [1.0, 0.45, 0.18], hot = [1.0, 0.85, 0.63],
  burstColor = 0xff7a2d, count = 24, speed = 26, size = 1.1, ttl = 0.55, gravity = -26,
  flashSize = 5.5, flashMs = 300,
  lampName = 'light:fx1', lampIntensity = 1100, lampMs = 300,
  linger = null,   // { color?, count?, speed?, ttl?, size?, gravity? }：余烬（后台散尽层）
  shakeSeverity = 0,
} = {}) {
  if (!at) return;
  deps.particles?.spawn?.(at.x, at.y, { color: burstColor, count, speed, size, ttl, gravity, z: at.z });
  if (linger) {
    deps.particles?.spawn?.(at.x, at.y, {
      color: linger.color ?? burstColor, count: linger.count ?? 14,
      speed: linger.speed ?? 7, size: linger.size ?? 0.8,
      ttl: linger.ttl ?? 2.4, gravity: linger.gravity ?? -9, z: at.z,
    });
  }
  const uProg = uniform(0.0);
  const uColor = linearColor(color);
  const uHot = linearColor(hot);
  const uRing = uniform(1.0);
  const { quad, geo, mat } = spellQuad({
    shade: coreShade(uv(), uProg, uColor, uHot, uRing),
    width: flashSize, height: flashSize, name: 'spellFx:flash',
  });
  quad.position.set(at.x, at.y, (at.z ?? 0) + 2);
  deps.scene.add(quad);
  ctx.onKill(() => { deps.scene.remove(quad); geo.dispose(); mat.dispose(); });
  const st = { t: 0 };
  const flash = ctx.tweenRaw(st, { t: 1 }, {
    durationMs: flashMs, ease: 'power2.out',
    onUpdate: () => {
      uProg.value = st.t;
      const s = 0.45 + 0.75 * st.t;   // 几何辅助：整体微膨（环扩张主体在 shader 里）
      quad.scale.set(s, s, 1);
    },
    onComplete: () => { deps.scene.remove(quad); geo.dispose(); mat.dispose(); },
  });
  // 灯 punch（借池）：快起慢落
  const lamp = deps.cast?.get?.(lampName) ?? null;
  let lampJob = null;
  if (lamp) {
    lamp.color.setRGB(color[0], color[1], color[2]);
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
 * 斩痕扫掠块（shader 主笔）：弓形新月带在目标身上扫过——形状/扫掠头/拖尾/渐隐
 * 全在 slashShade 的 fragment 里算（uProgress 推 uniform）；几何辅助 = 斜置角
 * + 命中一拍的 scale punch。短促刀光语言，300ms 级。dir 翻转扫掠方向。
 */
export async function slashSweep(ctx, deps, {
  at,
  color = [1.0, 0.98, 0.92], fringe = [0.5, 0.8, 1.6],
  ms = 300, width = 19.0, height = 5.0, arc = 0.14,
  yOff = 1.1,
  angle = -0.30, dir = 1, z = 2,
} = {}) {
  if (!at) return;
  // ⚠ TSL 实测坑之二：uniform(0) 整型字面量有绑定风险（暗层 α 曾无视强度恒为 1）；
  // 数值 uniform 一律写浮点 0.0，暗层强度烘成 float 常量节点（不走 Fn 末参）
  const uProg = uniform(0.0);
  const uColor = linearColor(color);
  const uFringe = linearColor(fringe);
  const uArc = uniform(arc);
  const uDir = uniform(dir);
  // 暗切口层：亮敌人上纯加色读不出对比——贴核窄软阴影垫对比。
  // 独立 uniforms/几何（不与亮层共享节点——TSL 中间量跨表达式复用有实测黑屏坑）
  const dProg = uniform(0.0);
  const dArc = uniform(arc);
  const dDir = uniform(dir);
  const dGeo = new THREE.PlaneGeometry(width, height);   // 与亮层同尺寸——UV 弧度才共享同一世界弧（不同高度会让两道弧错位脱节）
  const dMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false });
  dMat.colorNode = darkSlashShade(uv(), dProg, dArc, dDir);   // 强度旋钮在 shaders.js 字面量（Fn 末参绑定坑）
  const dark = new THREE.Mesh(dGeo, dMat);
  dark.name = 'spellFx:slashDark';
  dark.renderOrder = FX_RENDER_ORDER - 1;
  dark.rotation.z = angle * dir;
  dark.position.set(at.x, at.y + yOff, (at.z ?? 0) + z - 0.5);   // yOff：上移避开血条/UI 行
  // ⚠ 暗层暂缓上线：TSL Fn 管线缓存坑——darkSlashShade 的 alpha 实测恒等于 body 单项
  // （tail/fade/强度全部不生效，α≈1 黑带），换 uniform/常量/硬编码均不触发重编。
  // 根治（Fn 缓存键查明）前暗层不挂场景；亮刃单层已可读。
  const SPELL_DARK_LAYER = false;
  if (SPELL_DARK_LAYER) deps.scene.add(dark);
  ctx.onKill(() => { deps.scene.remove(dark); dGeo.dispose(); dMat.dispose(); });
  const dbgV = new URLSearchParams(location.search).get('spelldebug');
  const uDbg = uniform(dbgV === 'color' ? 3.0 : dbgV === 'energy' ? 2.0 : dbgV === 'shape' ? 1.0 : 0.0);
  const { quad, geo, mat } = spellQuad({
    shade: slashShade(uv(), uProg, uColor, uFringe, uArc, uDir, uDbg),
    width, height, name: 'spellFx:slash',
  });
  quad.rotation.z = angle * dir;
  quad.position.set(at.x + dir * 0.5, at.y + yOff, (at.z ?? 0) + z);   // 亮刃向头部微嵌——刃是缝的源头（消悬浮断点）
  deps.scene.add(quad);
  ctx.onKill(() => { deps.scene.remove(quad); geo.dispose(); mat.dispose(); });
  // hold：定格 uProgress=0.5、跳过 tween/回收——TA 调参的稳定画布（截图不赌时序）
  if (dbgV === 'hold') {
    uProg.value = 0.5; dProg.value = 0.5;
    await ctx.wait(3000);
    deps.scene.remove(quad); geo.dispose(); mat.dispose();
    deps.scene.remove(dark); dGeo.dispose(); dMat.dispose();
    return;
  }
  // 灯 punch（借光池）：扫掠期间目标被冷白照亮——「刃是光源」的环境证据
  const lamp = deps.cast?.get?.('light:fx1') ?? null;
  if (lamp) {
    lamp.color.setRGB(0.75, 0.85, 1.0);
    lamp.position.set(at.x, at.y + yOff, (at.z ?? 0) + 3);
    ctx.spawn(async (c) => {
      await c.tweenRaw(lamp, { intensity: 520 }, { durationMs: Math.round(ms * 0.5), ease: 'power2.out' });
      await c.tweenRaw(lamp, { intensity: 0 }, { durationMs: Math.round(ms * 0.9), ease: 'power2.in' });
    });
    ctx.onKill(() => { lamp.intensity = 0; });
  }
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'power2.in',   // 加速扫掠（挥刀发力感）
    onUpdate: () => {
      uProg.value = st.t;
      dProg.value = st.t;
      const s = 0.9 + 0.16 * Math.sin(Math.min(1, st.t * 1.6) * Math.PI);   // 命中 punch
      quad.scale.set(s, s, 1);
      dark.scale.set(s, s, 1);
    },
    onComplete: () => { deps.scene.remove(quad); geo.dispose(); mat.dispose(); deps.scene.remove(dark); dGeo.dispose(); dMat.dispose(); },
  });
}
