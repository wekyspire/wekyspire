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
import { uniform, uv, vec3, vec4, float } from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import { additiveLight } from '../../post/passes.js';
import { WORLD_HEIGHT, UI_CAMERA_LOOK_AT_Y } from '../../StageManager.js';
import { slashShade, darkSlashShade, projectileShade, ringFlashShade, punchShade, fireBurstShade, beamShade, veilShade, fireOrbShade, qiGatherShade, groundRingShade } from './shaders.js';

const FX_RENDER_ORDER = 50;   // 施术面片层级（见文件头纪律）
// 色参 → 常量 vec3 节点（烘进 Fn，不走 Color uniform——管线缓存坑，见 shaders.js 头注）
export const linearColor = (rgb) => vec3(rgb[0], rgb[1], rgb[2]);

// 排障开关（?spelldebug=hold/const/shape/energy/color）：模块级解析一次、全 spells 共用
// （原先 10 处内联 `new URLSearchParams(location.search)` 且零守卫）；node 无 location → null。
export const SPELL_DEBUG = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('spelldebug') : null;

// ---- 施术面片管线预热（2026-10-06）-----------------------------------------
// WebGPU 首用管线异步编译 0.3~1.5s，期间 draw 被跳过 = 首施法面片黑一拍/整段
// 缺席（真时间取证三轮实测：同 shader 同色，有的会话可见有的不可见——纯时序）。
// charBurn 预热同款手法：常驻 scratch scene 收代表性 (shade, 常量色字面量) 变体，
// 战斗开场 compileAsync 一次；管线缓存按程序哈希共享，后续同构新材质即时可用。
// ⚠ 常量色是字面量进 WGSL 的——变体必须按模板**真实参数**建（假色 = 白预热）。
const _warmScene = new THREE.Scene();
const _warmKeys = new Set();
export function warmSpellQuad(key, mkQuad) {
  if (_warmKeys.has(key)) return;
  _warmKeys.add(key);
  try {
    const { quad } = mkQuad();
    quad.frustumCulled = false;
    quad.position.set(0, -800, 0);   // 视野外常驻（compile 遍历不裁剪，别渲染进画面）
    _warmScene.add(quad);
  } catch (err) {
    console.warn('[fx/spells] 预热建件异常（忽略）：', err);
  }
}
export function compileWarmSpellQuads(renderer, camera) {
  if (!_warmScene.children.length) return false;
  try {
    const p = renderer?.compileAsync?.(_warmScene, camera);
    if (!p) renderer?.compile?.(_warmScene, camera);
    return true;
  } catch (err) {
    console.warn('[fx/spells] 预热编译异常（忽略）：', err);
    return false;
  }
}

/** 卡面起手：HDR 色脉冲过卡面（CardFxLayer.pulse 公共节拍，块只做参数化包装）。 */
export async function cardFlare(ctx, deps, {
  color = 0xffd34c, ms = 240, scale = 1.5,
} = {}) {
  const view = deps.cardView;
  if (!view?.fx?.pulse) return;
  view.fx.pulse({ color, durationMs: ms, scale });
  await ctx.wait(Math.round(ms * 0.6));   // 起手不必等脉冲收尾——亮起来就够了
}

/** 施术面片（shader 主笔件的公共装配）：Node 材质 + colorNode + 层级纪律一把装好。
 *  导出供模板层拼自定义件（火环/蓄力核等非块级造型）——装配纪律只有这一份。 */
export function spellQuad({ shade, width, height, name }) {
  const geo = new THREE.PlaneGeometry(width, height);
  const mat = additiveLight(new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false }));
  const dbg = SPELL_DEBUG;
  mat.colorNode = shade;
  if (dbg === 'const') mat.colorNode = vec4(1.0, 0.15, 0.05, 1.0);   // 排障：常量红对照
  const quad = new THREE.Mesh(geo, mat);
  quad.name = name;
  quad.renderOrder = FX_RENDER_ORDER;
  // 幂等回收：onKill/onComplete/hold 多路径都会到，二次调用静默落空
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    quad.parent?.remove(quad);
    geo.dispose();
    mat.dispose();
  };
  return { quad, geo, mat, release };
}

/**
 * 借灯 punch（快起慢落；灯池铁律见文件头块纪律——演出中途 new 灯 = 全场景重编译，
 * 一律借 light:fxN 池灯只推参数）。返回 promise：调用方自选 await / spawn / 悬空
 * （无灯 = 降级路径时返回 null，配合 Promise.all([...].filter(Boolean)) 收口）。
 * 起始强度**不归零**：交叠借同一盏（多目标错峰）时归零会把进行中的 pulse 拍断出
 * 跳变——池灯闲置恒 0，无竞争时 tween 起点本就是 0。
 */
export function lampPulse(ctx, deps, {
  name = 'light:fx1', at = null, color = [1, 1, 1], peak = 600, attackMs = 80, decayMs = 320,
} = {}) {
  const lamp = deps.cast?.get?.(name) ?? null;
  if (!lamp) return null;
  lamp.color.setRGB(color[0], color[1], color[2]);
  if (at) lamp.position.set(at.x, at.y, at.z ?? 0);
  const job = (async () => {
    await ctx.tweenRaw(lamp, { intensity: peak }, { durationMs: attackMs, ease: 'power2.out' });
    await ctx.tweenRaw(lamp, { intensity: 0 }, { durationMs: decayMs, ease: 'power2.in' });
  })();
  ctx.onKill(() => { lamp.intensity = 0; });
  return job;
}

/**
 * 投射物块：能量核（shader：宽晕+热核 HDR+闪烁）沿抛物弧线从 from 飞到 to。
 * 几何辅助 = mesh 朝速度方向自旋 + 前向拉伸（能量拖长读感）。可选灯拖尾与微粒尾迹。
 * track = 目标单位：向 deps.projectiles 登记抵达承诺（CPU 权威——伤害拍 await
 * 真实抵达，落定/被杀/正常结束三路径都解决承诺，节拍链不挂）。
 * arcJitter > 0 = 乱射档：弧高与飞行时长逐发随机（arcH × (1±jitter/2)、ms ±12%）。
 */
export async function arcProjectile(ctx, deps, {
  from, to,
  color = [1.0, 0.45, 0.18], hot = [1.0, 0.85, 0.63],
  size = 2.4, ms = 320, arcH = 7,
  stretch = 1.35,   // 前向拉伸比（拳风/箭矢类快件拉大读「破空」）
  lampName = 'light:fx0', lampIntensity = 700,
  trail = null,   // { color, speed?, size?, ttl? }：沿途微粒尾迹（每 ~70ms 两颗）
  track = null,   // 目标单位（登记抵达承诺；缺省不登记）
  arcJitter = 0,
  darting = 0,    // 窜天猴摆尾强度 0..1：飞行中垂直于航线随机甩动（双频 sin 叠加
                  // 伪随机感、端点锚定包络）——火花乱射的「窜」读感
  fire = false,   // 火系投射物：换 fireOrbShade（fbm 火面+头尾不对称+破边）——
                  // 平滑高斯「发光团」不够审美线（2026-10-06 审计）
} = {}) {
  let arrive = null;
  if (track) {
    deps.projectiles?.track(track, new Promise((r) => { arrive = r; }));
  }
  if (!from || !to) { arrive?.(); return; }
  if (arcJitter > 0) {
    arcH = arcH * (1 - arcJitter / 2 + Math.random() * arcJitter);
    ms = Math.round(ms * (0.88 + Math.random() * 0.24));
  }
  // 摆尾参数（块级随机——多发不齐步）：幅度/双频/相位
  const dx0 = to.x - from.x, dy0 = to.y - from.y;
  const len0 = Math.hypot(dx0, dy0) || 1;
  const nx = -dy0 / len0, ny = dx0 / len0;   // 航线法向
  const dAmp = darting * 6.5 * (0.7 + Math.random() * 0.6);
  const dF1 = 4.5 + Math.random() * 3.5, dF2 = 9 + Math.random() * 6;
  const dP1 = Math.random() * 6.28, dP2 = Math.random() * 6.28;
  const swayOf = (t) => (Math.sin(t * dF1 * 6.283 + dP1) * 0.62 + Math.sin(t * dF2 * 6.283 + dP2) * 0.38)
    * dAmp * Math.pow(Math.sin(Math.min(1, t * 1.05) * Math.PI), 0.55);   // 端点锚定
  const uPhase = uniform(0.0);
  const uColor = linearColor(color);
  const uHot = linearColor(hot);
  const uSeed = uniform(Math.random() * 6.28 + 0.01);
  const { quad, release } = spellQuad({
    shade: fire
      ? fireOrbShade(uv(), uPhase, uColor, uHot, uSeed)
      : projectileShade(uv(), uPhase, uColor, uHot),
    width: size, height: size, name: 'spellFx:projectile',
  });
  quad.position.set(from.x, from.y, from.z ?? 0);
  deps.scene.add(quad);
  const lamp = deps.cast?.get?.(lampName) ?? null;
  if (lamp) { lamp.color.setRGB(color[0], color[1], color[2]); lamp.intensity = 0; }
  ctx.onKill(() => {
    release();
    if (lamp) lamp.intensity = 0;
    arrive?.();
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
  // hold：定格 t=0.5 弧中点——投射物轨迹/形状的稳定画布（截图不赌时序）。
  // 拉伸与切线自旋也要落（定格帧须与实况同形，否则取证读感失真）
  if (SPELL_DEBUG === 'hold') {
    const t = 0.5;
    quad.position.set(
      0.5 * (from.x + to.x),
      0.5 * (from.y + to.y) + Math.sin(Math.PI * t) * arcH,
      0.5 * ((from.z ?? 0) + (to.z ?? 0)),
    );
    quad.rotation.z = Math.atan2(to.y - from.y, to.x - from.x);
    quad.scale.set(stretch, 1.0, 1);
    uPhase.value = 10;
    await ctx.wait(3000);
    release();
    if (lamp) lamp.intensity = 0;
    arrive?.();   // hold 是排障画布：立即放行节拍，不悬停等待方
    return;
  }
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'power1.in',
    onUpdate: () => {
      const t = st.t, u = 1 - t;
      const s = darting > 0 ? swayOf(t) : 0;
      quad.position.set(
        u * from.x + t * to.x + nx * s,
        u * from.y + t * to.y + Math.sin(Math.PI * t) * arcH + ny * s,
        u * (from.z ?? 0) + t * (to.z ?? 0),
      );
      // 朝速度方向自旋（弧线切线 + 摆尾速度）+ 前向拉伸
      const vx = to.x - from.x;
      const vy = (to.y - from.y) + arcH * Math.PI * Math.cos(Math.PI * t);
      const sx = darting > 0 ? (swayOf(Math.min(1, t + 0.02)) - s) / (0.02 * (ms / 1000)) : 0;
      const sy = darting > 0 ? (swayOf(Math.min(1, t + 0.02)) - s) / (0.02 * (ms / 1000)) : 0;
      quad.rotation.z = Math.atan2(vy + ny * sy, vx + nx * sx);
      quad.scale.set(stretch, 1.0, 1);
      uPhase.value = t * 20;   // shader 闪烁相位（单调即可）
      if (lamp) {
        lamp.position.copy(quad.position);
        lamp.intensity = lampIntensity * Math.sin(Math.min(1, t * 1.6) * Math.PI * 0.5);
      }
    },
    onComplete: () => {
      release();
      if (lamp) lamp.intensity = 0;
      arrive?.();
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
  // 场景交互广播（单向）：爆炸冲击 → PCG 道具物理响应（位移/散架按距离衰减）
  deps.notify?.('impact', { at: { x: at.x, z: at.z ?? 0 }, power: Math.min(1.5, count / 24) });
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
  const uSeed = uniform(Math.random() * 6.28 + 0.01);
  const { quad, release } = spellQuad({
    shade: ringFlashShade(uv(), uProg, uColor, uHot, uSeed),
    width: flashSize, height: flashSize, name: 'spellFx:flash',
  });
  quad.position.set(at.x, at.y, (at.z ?? 0) + 2);
  deps.scene.add(quad);
  ctx.onKill(() => { release(); });
  const st = { t: 0 };
  const flash = ctx.tweenRaw(st, { t: 1 }, {
    durationMs: flashMs, ease: 'power2.out',
    onUpdate: () => {
      uProg.value = st.t;
      const s = 0.45 + 0.75 * st.t;   // 几何辅助：整体微膨（环扩张主体在 shader 里）
      quad.scale.set(s, s, 1);
    },
    onComplete: () => { release(); },
  });
  // 灯 punch（借池）：快起慢落
  const lampJob = lampPulse(ctx, deps, {
    name: lampName, at: { x: at.x, y: at.y, z: (at.z ?? 0) + 2 }, color,
    peak: lampIntensity, attackMs: Math.round(lampMs * 0.35), decayMs: Math.round(lampMs * 0.65),
  });
  if (shakeSeverity > 0) deps.shake?.impulse?.(shakeSeverity);
  await Promise.all([flash, lampJob].filter(Boolean));
}

/**
 * 斩痕扫掠块（shader 主笔）：弓形新月带在目标身上扫过——形状/扫掠头/拖尾/渐隐
 * 全在 slashShade 的 fragment 里算（uProgress 推 uniform）；几何辅助 = 斜置角
 * + 命中一拍的 scale punch。短促刀光语言，300ms 级。
 * 方向语义（伤害节拍驱动，2026-09-30 用户定）：angle 直接给弧度——斩=竖置
 * （≈±1.4）、劈=横置（≈0.1）、默认斜（-0.3）、连击=逐击随机短促。
 * scale 乘 width/height（伤害量越大刀光越大——模板参数化的起效案例）。
 */
export async function slashSweep(ctx, deps, {
  at,
  color = [1.0, 0.98, 0.92], fringe = [0.5, 0.8, 1.6],
  ms = 300, width = 19.0, height = 6.2, arc = 0.14, scale = 1.0,
  yOff = 1.1,
  angle = -0.30, dir = 1, z = 2,
} = {}) {
  if (!at) return;
  width *= scale; height *= scale;   // 伤害量驱动尺寸（弧度不变——新月形状是身份）
  // ⚠ TSL 实测坑之二：uniform(0) 整型字面量有绑定风险（暗层 α 曾无视强度恒为 1）；
  // 数值 uniform 一律写浮点 0.0，暗层强度烘成 float 常量节点（不走 Fn 末参）
  const uProg = uniform(0.0);
  const uColor = linearColor(color);
  const uFringe = linearColor(fringe);
  const uArc = uniform(arc);
  const uDir = uniform(dir);
  // ⚠ 暗层暂缓上线：TSL Fn 管线缓存坑——darkSlashShade 的 alpha 实测恒等于 body 单项
  // （tail/fade/强度全部不生效，α≈1 黑带），换 uniform/常量/硬编码均不触发重编。
  // 根治（Fn 缓存键查明）前暗层**不构造不挂场**（旧版在判定前就建好几何+节点图，
  // 每次挥刀白付一套 JS 构建）；亮刃单层已可读。
  const SPELL_DARK_LAYER = false;
  let dProg = null, dark = null;
  if (SPELL_DARK_LAYER) {
    // 暗切口层：亮敌人上纯加色读不出对比——贴核窄软阴影垫对比。
    // 独立 uniforms/几何（不与亮层共享节点——TSL 中间量跨表达式复用有实测黑屏坑）
    dProg = uniform(0.0);
    const dArc = uniform(arc);
    const dDir = uniform(dir);
    const dGeo = new THREE.PlaneGeometry(width, height);   // 与亮层同尺寸——UV 弧度才共享同一世界弧（不同高度会让两道弧错位脱节）
    const dMat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: false });
    dMat.colorNode = darkSlashShade(uv(), dProg, dArc, dDir);   // 强度旋钮在 shaders.js 字面量（Fn 末参绑定坑）
    dark = new THREE.Mesh(dGeo, dMat);
    dark.name = 'spellFx:slashDark';
    dark.renderOrder = FX_RENDER_ORDER - 1;
    dark.rotation.z = angle * dir;
    dark.position.set(at.x, at.y + yOff, (at.z ?? 0) + z - 0.5);   // yOff：上移避开血条/UI 行
    deps.scene.add(dark);
    ctx.onKill(() => { deps.scene.remove(dark); dark.geometry.dispose(); dark.material.dispose(); });
  }
  const dbgV = SPELL_DEBUG;
  const uDbg = uniform(dbgV === 'color' ? 3.0 : dbgV === 'energy' ? 2.0 : dbgV === 'shape' ? 1.0 : 0.0);
  const { quad, release } = spellQuad({
    shade: slashShade(uv(), uProg, uColor, uFringe, uArc, uDir, uDbg),
    width, height, name: 'spellFx:slash',
  });
  quad.rotation.z = angle * dir;
  quad.position.set(at.x + dir * 0.5, at.y + yOff, (at.z ?? 0) + z);   // 亮刃向头部微嵌——刃是缝的源头（消悬浮断点）
  deps.scene.add(quad);
  ctx.onKill(() => { release(); });
  // hold：定格 uProgress=0.5、跳过 tween/回收——TA 调参的稳定画布（截图不赌时序）
  if (dbgV === 'hold') {
    uProg.value = 0.5; if (dProg) dProg.value = 0.5;
    await ctx.wait(3000);
    release();
    if (dark) { deps.scene.remove(dark); dark.geometry.dispose(); dark.material.dispose(); }
    return;
  }
  // 灯 punch（借光池）：扫掠期间目标被冷白照亮——「刃是光源」的环境证据
  ctx.spawn(async (c) => {
    await lampPulse(c, deps, {
      at: { x: at.x, y: at.y + yOff, z: (at.z ?? 0) + 3 }, color: [0.75, 0.85, 1.0],
      peak: 520, attackMs: Math.round(ms * 0.5), decayMs: Math.round(ms * 0.9),
    });
  });
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'power2.in',   // 加速扫掠（挥刀发力感）
    onUpdate: () => {
      uProg.value = st.t;
      if (dProg) dProg.value = st.t;
      const s = 0.9 + 0.16 * Math.sin(Math.min(1, st.t * 1.6) * Math.PI);   // 命中 punch
      quad.scale.set(s, s, 1);
      if (dark) dark.scale.set(s, s, 1);
    },
    onComplete: () => {
      release();
      if (dark) { deps.scene.remove(dark); dark.geometry.dispose(); dark.material.dispose(); }
    },
  });
}

/**
 * 拳击冲击块（贴身命中读感）：punchShade 的横向冲击环 + 速度线在目标胸口炸开。
 * 几何辅助 = quad 旋转 π 镜像左右（来向侧偏置——shader 里前向偏置恒在 +x）。
 * 粒子暖白火花 + 微尘；灯 punch 借 fx1 池。多段连击逐拍调用 = 密集小冲击白送。
 */
export async function punchImpact(ctx, deps, {
  at, dir = 1, scale = 1.0,
  color = [1.0, 0.92, 0.78], hot = [1.0, 0.98, 0.92], rim = [0.82, 0.92, 1.25],
  ms = 260, z = 2,
  sparkColor = 0xffe9c8, sparkCount = 14, sparkSpeed = 20,
  lampIntensity = 620,
} = {}) {
  if (!at) return;
  const uProg = uniform(0.0);
  const { quad, release } = spellQuad({
    shade: punchShade(uv(), uProg, linearColor(color), linearColor(hot), linearColor(rim)),
    // 面片要显著大于敌人本体——环的职责是「探出轮廓读冲击」，环半径撑满也出不了
    // 本体 footprint 的话环就永远藏在身体后面（glm-flash 第七轮实测病根）
    width: 16.0 * scale, height: 9.5 * scale, name: 'spellFx:punch',
  });
  quad.position.set(at.x, at.y, (at.z ?? 0) + z);
  quad.rotation.z = dir < 0 ? Math.PI : 0;   // 左右镜像（y 向条带对称，旋转 π 安全）
  deps.scene.add(quad);
  ctx.onKill(() => { release(); });
  const dbgV = SPELL_DEBUG;
  // hold 取在环半径峰值（0.75：环已探出轮廓、白核已衰——取证帧要避开辉光峰值）
  if (dbgV === 'hold') { uProg.value = 0.75; await ctx.wait(3000); release(); return; }
  deps.particles?.spawn?.(at.x, at.y, {
    color: sparkColor, count: Math.round(sparkCount * scale), speed: sparkSpeed,
    size: 0.9, ttl: 0.4, gravity: -30, z: at.z,
  });
  // 灯 punch（借 fx1 池，spawn 悬空——不等灯收完）
  ctx.spawn(async (c) => {
    await lampPulse(c, deps, {
      at: { x: at.x, y: at.y, z: (at.z ?? 0) + z + 1 }, color,
      peak: lampIntensity, attackMs: 70, decayMs: Math.round(ms * 0.9),
    });
  });
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'power2.out',
    onUpdate: () => {
      uProg.value = st.t;
      const s = 0.55 + 0.5 * st.t;   // 几何辅助：整体外扩（环扩张主体在 shader 里）
      quad.scale.set(s, s, 1);
    },
    onComplete: () => { release(); },
  });
}

/**
 * 火焰爆发块（火球落点 / 爆裂新星）：fireBurstShade 的上倾火体 + 冲击环 + 白热芯。
 * 锚定语义：at = 爆心**落点**（目标脚边）——quad 底部坐在落点上，火向上烧。
 * 粒子火花 + 慢速余烬（无主资产，ttl 后台散尽）；灯 punch 借 fx1 池。
 */
export async function fireBurst(ctx, deps, {
  at, scale = 1.0,
  color = [1.0, 0.42, 0.14], hot = [1.0, 0.86, 0.62], ember = [1.0, 0.18, 0.04],
  ms = 420,
  sparkColor = 0xff8c3a, sparkCount = 22, sparkSpeed = 24,
  linger = { count: 12, speed: 7, ttl: 1.8, size: 0.8, gravity: -6 },
  lampIntensity = 900, shakeSeverity = 0,
} = {}) {
  if (!at) return;
  // 场景交互广播（单向）：火焰落点 → PCG 道具燃烧（部件热量注入，combustion.js）
  deps.notify?.('heat', { at: { x: at.x, z: at.z ?? 0 }, temp: 1.0 * scale });
  // 宽 12：地面冲击环要探出火体/敌人 footprint（9 宽时环全程藏在身体后面）
  const width = 12.0 * scale, height = 12.0 * scale;
  const uProg = uniform(0.0);
  const uSeed = uniform(Math.random() * 6.28 + 0.01);   // 湍流相位（非 0 起，避免多实例同步扭动）
  const { quad, release } = spellQuad({
    shade: fireBurstShade(uv(), uProg, linearColor(color), linearColor(hot), linearColor(ember), uSeed),
    width, height, name: 'spellFx:fireBurst',
  });
  quad.position.set(at.x, at.y + height * 0.34, (at.z ?? 0) + 2);   // 底部坐在落点上
  deps.scene.add(quad);
  ctx.onKill(() => { release(); });
  const dbgV = SPELL_DEBUG;
  // hold 取 0.65（地面环接近峰值、火体进 wane 半衰——取证帧避开辉光峰值）
  if (dbgV === 'hold') { uProg.value = 0.65; await ctx.wait(3000); release(); return; }
  deps.particles?.spawn?.(at.x, at.y + 1.5, {
    color: sparkColor, count: Math.round(sparkCount * Math.sqrt(scale)), speed: sparkSpeed,
    size: 1.0, ttl: 0.55, gravity: -22, z: at.z,
  });
  if (linger) {
    deps.particles?.spawn?.(at.x, at.y + 1, {
      color: linger.color ?? sparkColor, count: linger.count,
      speed: linger.speed, size: linger.size, ttl: linger.ttl,
      gravity: linger.gravity, z: at.z,
    });
  }
  ctx.spawn(async (c) => {
    await lampPulse(c, deps, {
      at: { x: at.x, y: at.y + 2.5, z: (at.z ?? 0) + 3 }, color,
      peak: lampIntensity * scale, attackMs: Math.round(ms * 0.3), decayMs: Math.round(ms * 0.9),
    });
  });
  if (shakeSeverity > 0) deps.shake?.impulse?.(shakeSeverity);
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'power1.out',
    onUpdate: () => {
      uProg.value = st.t;
      const s = 0.7 + 0.4 * Math.min(1, st.t * 2.2);   // 几何辅助：头段快膨（火体膨开主体在 shader 里）
      quad.scale.set(s, s, 1);
    },
    onComplete: () => { release(); },
  });
}

/**
 * 贴地气场环块（架势/旋风地面响应）：quad **平躺**在地（rotation.x = -π/2），
 * 相机俯角自然读椭圆——不是竖直 billboard 的假压扁。groundRingShade 主笔：
 * 扩张环 + 角向破边 + 环流纹（气在绕）+ 内域微光。progress tween 由本块驱动。
 */
export async function groundRing(ctx, deps, {
  at, size = 14.0, ms = 620,
  color = [0.55, 0.75, 1.20], hot = [1.05, 1.20, 1.45],
  spin = 2.0,             // 环流纹角速度（rad/s）
  z = 0.5,
} = {}) {
  if (!at) return;
  const uPhase = uniform(0.0);
  const uProg = uniform(0.0);
  const uSeed = uniform(Math.random() * 6.28 + 0.01);
  const { quad, release } = spellQuad({
    shade: groundRingShade(uv(), uPhase, uProg, linearColor(color), linearColor(hot), uSeed),
    width: size, height: size, name: 'spellFx:groundRing',
  });
  quad.rotation.x = -Math.PI / 2;   // 平躺：真贴地（俯角透视自读椭圆）
  quad.position.set(at.x, (at.y ?? 0) + z, at.z ?? 0);
  deps.scene.add(quad);
  ctx.onKill(() => { release(); });
  if (SPELL_DEBUG === 'hold') {
    uPhase.value = 3.0; uProg.value = 0.55;
    await ctx.wait(3000);
    release();
    return;
  }
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'power2.out',
    onUpdate: () => {
      uProg.value = st.t;
      uPhase.value = st.t * ms * 0.001 * spin;
    },
    onComplete: () => { release(); },
  });
}

/**
 * 光柱块（S/X 斩的封顶一竖）：beamShade 的竖直光束立在落点上，随进度收细熄灭。
 * 独立块不占节拍主链——大卡模板在 notify 前后随意挂（无主资产口径：进度推完自灭）。
 */
export async function lightPillar(ctx, deps, {
  at, color = [0.85, 0.92, 1.0], hot = [1.0, 1.0, 1.0],
  width = 5.0, height = 34.0, ms = 1500, z = 2,
} = {}) {
  if (!at) return;
  const uProg = uniform(0.0);
  const { quad, release } = spellQuad({
    shade: beamShade(uv(), uProg, linearColor(color), linearColor(hot)),
    width, height, name: 'spellFx:pillar',
  });
  quad.position.set(at.x, at.y + height * 0.5 - 2, (at.z ?? 0) + z);   // 底端坐在落点上（略沉入地面）
  deps.scene.add(quad);
  ctx.onKill(() => { release(); });
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'power2.in',
    onUpdate: () => { uProg.value = st.t; },
    onComplete: () => { release(); },
  });
}

// ---- 场景参数演出块（2026-10-01 天斩 v2）：压暗幕 / 全屏白闪 -------------------
// 设计口径：压暗/闪光走 **uiScene 顶层覆盖面**（DamageVignette 同机制——正交 UI
// 视界整幅、renderOrder 1000、深度全关），不改 post pass 参数——零管线重建
// （W2 教训：动 post 链配置会触发 pipeline churn），观战页同屏复用。

/** 压迫幕贴图（模块级单例）：径向渐变，中心留可视、四周沉入冷黑（斩杀预兆的
 * 「世界退场」感——与受击渐晕的暗红不同调，冷蓝黑）。 */
let _dreadTexture = null;
function dreadTexture() {
  if (_dreadTexture) return _dreadTexture;
  if (typeof document === 'undefined') return null;   // node：退化纯色面
  const S = 512;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d');
  const c = S / 2;
  const grad = ctx.createRadialGradient(c, c, 0, c, c, c);
  grad.addColorStop(0, 'rgba(4, 6, 12, 0)');
  grad.addColorStop(0.42, 'rgba(4, 6, 12, 0.05)');
  grad.addColorStop(0.68, 'rgba(3, 5, 10, 0.42)');
  grad.addColorStop(1, 'rgba(2, 3, 7, 0.97)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, S, S);
  _dreadTexture = new THREE.CanvasTexture(canvas);
  _dreadTexture.colorSpace = THREE.SRGBColorSpace;
  return _dreadTexture;
}

/**
 * 压迫幕（句柄式资产块——非 await 型：模板分阶段驱动 level）。
 * 返回 { set(level, ms, ease?) → Promise, level() }；模板负责收尾 set(0)，
 * 协程被杀时 onKill 自动摘除。level 语义 = 覆盖强度 0..1（0.85 ≈ 大幅暗淡）。
 */
export function dreadVeil(ctx, deps) {
  const mat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0, depthTest: false, depthWrite: false,
    color: _dreadTexture ? 0xffffff : 0x04060c,   // node 退化底色（无贴图）
    map: dreadTexture(), fog: false,
  });
  const W = WORLD_HEIGHT * 1.18 * (16 / 9);
  const H = WORLD_HEIGHT * 1.18;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
  quad.name = 'spellFx:dreadVeil';
  quad.position.set(0, UI_CAMERA_LOOK_AT_Y, 490);
  quad.renderOrder = 1000;
  quad.visible = false;
  deps.uiScene?.add(quad);
  const state = { v: 0 };
  const apply = () => { mat.opacity = state.v; quad.visible = state.v > 0.005; };
  ctx.onKill(() => { deps.uiScene?.remove(quad); quad.geometry.dispose(); mat.dispose(); });
  return {
    set: (level, ms, ease = 'power2.in') =>
      ctx.tweenRaw(state, { v: Math.max(0, level) }, { durationMs: ms, ease, onUpdate: apply }),
    level: () => state.v,
  };
}

/**
 * 全屏白闪（斩落一瞬的曝光读感）：uiScene 纯色覆盖面，attackMs 内爬到峰值、指数落。
 * attackMs=0 = 瞬亮（旧口径）；>0 给一条短攻击沿（高级斩的爆发 smooth in）。
 */
export async function screenFlash(ctx, deps, {
  intensity = 0.9, ms = 220, color = 0xffffff, attackMs = 0,
} = {}) {
  const mat = new THREE.MeshBasicMaterial({
    transparent: true, opacity: 0, depthTest: false, depthWrite: false, color, fog: false,
  });
  const W = WORLD_HEIGHT * 1.18 * (16 / 9);
  const H = WORLD_HEIGHT * 1.18;
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
  quad.name = 'spellFx:screenFlash';
  quad.position.set(0, UI_CAMERA_LOOK_AT_Y, 489);
  quad.renderOrder = 999;
  deps.uiScene?.add(quad);
  ctx.onKill(() => { deps.uiScene?.remove(quad); quad.geometry.dispose(); mat.dispose(); });
  const state = { v: 0 };
  const apply = () => { mat.opacity = state.v; quad.visible = state.v > 0.005; };
  if (attackMs > 0) {
    await ctx.tweenRaw(state, { v: intensity }, { durationMs: attackMs, ease: 'power1.in', onUpdate: apply });
  } else {
    state.v = intensity; apply();
  }
  await ctx.tweenRaw(state, { v: 0 }, {
    durationMs: ms, ease: 'power2.out', onUpdate: apply,
  });
  deps.uiScene?.remove(quad); quad.geometry.dispose(); mat.dispose();
}
