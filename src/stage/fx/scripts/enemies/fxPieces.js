// 敌演出形体件库（2026-10-16 质量批）：按 pyro 重击基准（shader 形体主体 +
// 双层粒子 + 借池灯 punch + 姿态语言）精工的签名形体件，供 families/chapter1
// 编排调用。TSL 纪律同 shaders.js 头注：色参常量 vec3 烘进 Fn、Fn ≤4 参、
// smoothstep 正向、差值平方一律 x.mul(x) 不写 pow（WGSL 负底 pow 未定义）、
// 中间量禁二次引用、加色混合 alpha 恒 1、核心推过 bloom 阈。
// 「跳变感」技巧：uTime 不做连续累计，由编排每拍离散重掷（电弧换折点读「电在跳」）。
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn, uniform, uv as uvOf, texture as texOf,
  vec2, vec3, vec4, float, pow, abs, sin, cos, length, exp, smoothstep, oneMinus,
  fract, max, atan, clamp,
} from 'three/tsl';
import { spellQuad, lampPulse } from '../../spells/blocks.js';
import { projectileShade } from '../../spells/shaders.js';

// ============ 单位高度锚（高度感知定位，1016 用户裁定）============
// unit.position = 立牌脚下中心，不是身体中心；有效视觉高 = _standeeHeight ×
// _baseScale。一切「身体高度」锚（胸/头/受击中弹位/口部）按 H 比例取——旧固定
// 3.4/4.9×s 只对平均体型成立，大个子会锚到胫骨。
export const unitH = (u) => (u._standeeHeight ?? 22) * (u._baseScale ?? 1);

// ============ 电弧束（静电毛球 zapChain 主体）============
// 竖直 quad 沿航线拉伸。fragment 主笔：中线偏移（双频 sin + uTime 离散跳变）+
// 双层截面（窄热核白蓝 HDR + 宽电晕）+ 行进脉冲波（uProg 一道亮波烧向靶端）+
// 分支细弧 + 端点亮斑。热核色烘常量（白蓝恒定），晕色走参数（主题色）。
export const zapArcShade = Fn(([vUv, uTime, uProg, uColor]) => {
  const p = vUv.sub(vec2(0.5));
  const v = p.y.add(float(0.5));                    // 0(源)→1(靶) 沿轴
  // 中线偏移：双频 sin + 端点锚定包络（sin(πv) 两端归零——弧不脱锚）
  const anchor = sin(v.mul(float(Math.PI)));
  const jit = sin(v.mul(13.7).add(uTime.mul(6.1)))
    .mul(0.62)
    .add(sin(v.mul(29.3).add(uTime.mul(9.7))).mul(0.38));
  const off = jit.mul(anchor).mul(0.16);
  // 截面双层：核（白蓝 HDR）+ 晕（主题色 4 倍宽）
  const dxN = p.x.sub(off);
  const core = exp(dxN.mul(dxN).mul(-1100.0));      // 核宽 ~0.03uv
  const dxH = p.x.sub(off);
  const halo = exp(dxH.mul(dxH).mul(-75.0));        // 晕宽 ~0.115uv
  // 行进脉冲：一道亮波沿 v 烧过去 + 驻留基线
  const dv = v.sub(uProg);
  const wave = exp(dv.mul(dv).mul(-90.0));
  // 分支细弧（第二中线异频低强）：电的「毛边」
  const off2 = sin(v.mul(21.1).add(uTime.mul(13.3))).mul(anchor).mul(0.10);
  const dxB = p.x.sub(off2);
  const branch = exp(dxB.mul(dxB).mul(-2500.0)).mul(float(0.45));
  // 端点亮斑（源端常亮；靶端随抵达点亮）
  const rS = length(vec2(p.x, p.y.add(float(0.5))));
  const rT = length(vec2(p.x, p.y.sub(float(0.5))));
  const tipS = exp(rS.mul(rS).mul(-60.0));
  const tipT = exp(rT.mul(rT).mul(-60.0)).mul(smoothstep(float(0.85), float(1.0), uProg));
  // 边缘熄灭（quad 直边不切亮缝）
  const edge = oneMinus(smoothstep(float(0.36), float(0.50), abs(p.x)))
    .mul(oneMinus(smoothstep(float(0.40), float(0.50), abs(p.y))));
  // 闪烁（uTime 离散跳变已带抖，再加细闪）
  const flick = sin(uTime.mul(47.0)).mul(0.10).add(0.90);
  const body = wave.add(float(0.30));
  const energy = core.mul(body).mul(flick)
    .add(halo.mul(body).mul(0.55))
    .add(branch.mul(wave))
    .add(tipS.mul(1.6))
    .add(tipT.mul(2.2));
  const rgb = uColor.mul(halo.mul(1.8))
    .add(vec3(0.85, 0.93, 1.35).mul(core.mul(4.2)))
    .add(vec3(0.75, 0.85, 1.20).mul(tipT.add(tipS).mul(2.0)));
  return vec4(rgb.mul(energy).mul(edge), float(1.0));
});

/**
 * 电弧束（世界空间，源→靶）。返回 { promise, jolt }——jolt() 由编排每拍调
 * （离散重掷 uTime = 折点换相读「电在跳」），promise 在寿命结束时兑现。
 */
export function zapArc(ctx, deps, {
  from, to, color = [0.55, 0.72, 1.30], width = 7.0, lifeMs = 640, reachMs = 200,
}) {
  if (!from || !to) return { promise: Promise.resolve(), jolt: () => {} };
  const uTime = uniform(Math.random() * 100);
  const uProg = uniform(0.0);
  const dx = to.x - from.x, dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;
  const { quad, release } = spellQuad({
    shade: zapArcShade(uvOf(), uTime, uProg, vec3(color[0], color[1], color[2])),
    width, height: dist * 1.15,   // 轴向余量（quad 原点居中，端点各留 7.5%）
    name: 'spellFx:zapArc',
  });
  quad.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, ((from.z ?? 0) + (to.z ?? 0)) / 2 + 1.2);
  quad.rotation.z = Math.atan2(dy, dx) - Math.PI / 2;
  deps.scene.add(quad);
  ctx.onKill(() => { release(); });
  const jolt = () => { uTime.value += 3.7 + Math.random() * 4.1; };  // 离散换相
  const promise = (async () => {
    const st = { t: 0 };
    await ctx.tweenRaw(st, { t: 1 }, {
      durationMs: lifeMs, ease: 'power2.out',
      onUpdate: () => {
        uProg.value = Math.min(1, st.t * (lifeMs / reachMs));
        const fade = st.t > 0.78 ? 1 - (st.t - 0.78) / 0.22 : 1;  // 尾段熄灭
        quad.scale.set(fade, 1, 1);
      },
      onComplete: () => { release(); },
    });
  })();
  return { promise, jolt };
}

// ============ 声波环（wailFx 主体）============
// 竖直 billboard 三道错峰扩散环：半径随 uProg 各相扩张、角向双谐波瓣（声波
// 不是完美圆）、环身行进波纹（读「声音在推」）、边缘熄灭。
export const wailRingShade = Fn(([vUv, uProg, uColor, uSeed]) => {
  const p = vUv.sub(vec2(0.5));
  const r = length(p).mul(2.0);
  const a = atan(p.y, p.x);
  // 三道环展开（相位错开 1/3；JS 循环静态展开——TSL 无控制流纪律不破）
  const ph0 = fract(uProg);
  const ph1 = fract(uProg.add(float(1.0 / 3.0)));
  const ph2 = fract(uProg.add(float(2.0 / 3.0)));
  const ringOf = (ph) => {
    const rr = ph.mul(0.92);
    const dr = r.sub(rr);
    const ring = exp(dr.mul(dr).mul(-340.0));
    const skirt = exp(dr.mul(dr).mul(-60.0));
    const lobed = sin(a.mul(5.0).add(uSeed.mul(7.0))).mul(0.5).add(0.5)
      .mul(sin(a.mul(9.0).sub(uSeed)).mul(0.5).add(0.5)).mul(0.7).add(0.5);
    const ripple = sin(dr.mul(90.0).sub(ph.mul(24.0))).mul(0.5).add(0.5).mul(0.35).add(0.75);
    const fade = oneMinus(pow(ph, float(0.8)));
    return uColor.mul(skirt.mul(1.5).mul(lobed).mul(fade))
      .add(vec3(0.92, 0.97, 1.15).mul(ring.mul(3.2).mul(lobed).mul(ripple).mul(fade)));
  };
  const acc = ringOf(ph0).add(ringOf(ph1)).add(ringOf(ph2));
  const edge = oneMinus(smoothstep(float(0.44), float(0.50), length(p)));
  return vec4(acc.mul(edge), float(1.0));
});

/** 声波环（单位头部，竖直 billboard）。粒子/灯由编排侧叠。 */
export async function wailRing(ctx, deps, { at, color = [0.65, 0.78, 1.10], size = 16.0, ms = 760 }) {
  if (!at) return;
  const uProg = uniform(0.0);
  const uSeed = uniform(Math.random() * 6.28 + 0.01);
  const { quad, release } = spellQuad({
    shade: wailRingShade(uvOf(), uProg, vec3(color[0], color[1], color[2]), uSeed),
    width: size, height: size, name: 'spellFx:wailRing',
  });
  quad.position.set(at.x, at.y, (at.z ?? 0) + 1.4);
  deps.scene.add(quad);
  ctx.onKill(() => { release(); });
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'linear',   // 环速恒定（声波匀速），衰减包络在 fade 里
    onUpdate: () => { uProg.value = st.t; },
    onComplete: () => { release(); },
  });
}

// ============ 引线收束圈（爆囊待爆 trembleWarn 主体）============
// 贴地平躺 quad：内向收束暗红环（半径随 uBeat 周期收缩 = 倒计时读感）+
// 环内径向裂纹透光（「要炸开」预兆）。uBeat 由 JS 按双搏包络驱动（与胸口
// fuseGlow 心跳同律——地面圈与体表光同拍搏动）。
export const fuseRingShade = Fn(([vUv, uBeat, uColor, uSeed]) => {
  const p = vUv.sub(vec2(0.5));
  const r = length(p).mul(2.0);
  const a = atan(p.y, p.x);
  const rr = oneMinus(uBeat).mul(0.75).add(0.25);   // 收束半径 1.0→0.25
  const dr = r.sub(rr);
  const ring = exp(dr.mul(dr).mul(-260.0));
  const skirt = exp(dr.mul(dr).mul(-42.0));
  // 裂纹透光：角向稀疏亮缝（幂次锐化成线），环内域加权
  const crackA = sin(a.mul(6.0).add(uSeed)).mul(0.5).add(0.5);
  const crack = pow(crackA, float(6.0)).mul(oneMinus(smoothstep(rr.mul(0.25), rr, r)).mul(0.5).add(0.5));
  const beat = uBeat.mul(uBeat);                     // 主搏亮、间歇暗
  const edge = oneMinus(smoothstep(float(0.42), float(0.50), length(p)));
  const rgb = uColor.mul(skirt.mul(1.4).mul(beat))
    .add(vec3(1.35, 0.62, 0.30).mul(ring.mul(3.4).mul(beat)))
    .add(vec3(1.5, 0.55, 0.25).mul(crack.mul(1.6).mul(beat)));
  return vec4(rgb.mul(edge), float(1.0));
});

/** 贴地引线圈（双搏包络自驱动；durMs = 预警拍时长）。 */
export async function fuseRing(ctx, deps, { at, color = [1.0, 0.30, 0.10], size = 13.0, ms = 620 }) {
  if (!at) return;
  const uBeat = uniform(0.0);
  const uSeed = uniform(Math.random() * 6.28 + 0.01);
  const { quad, release } = spellQuad({
    shade: fuseRingShade(uvOf(), uBeat, vec3(color[0], color[1], color[2]), uSeed),
    width: size, height: size, name: 'spellFx:fuseRing',
  });
  quad.position.set(at.x, at.y + 0.2, (at.z ?? 0) + 0.5);
  quad.rotation.x = -Math.PI / 2;   // 贴地（groundRing 同位法）
  deps.scene.add(quad);
  ctx.onKill(() => { release(); });
  const t0 = performance.now();
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'linear',
    onUpdate: () => {
      // 双搏包络（lub-dub，与 fuseGlow 同式同频）
      const ph = ((performance.now() - t0) / 1000 * 1.5) % 1;
      const lub = Math.exp(-((ph - 0.12) ** 2) / 0.004);
      const dub = 0.55 * Math.exp(-((ph - 0.34) ** 2) / 0.009);
      uBeat.value = Math.min(1, lub + dub);
    },
    onComplete: () => { release(); },
  });
}

// ============ 蔓延爬苔（苔球 spreadGrip 主体，ENEMY_FX.md 迭代#6）============
// 贴地平躺 quad（背缘贴苔球、铺向玩家）：① 前缘「爬行指须」——锋线 x 随 y 双频位移
// 锐化出几根前探指状触须，须尖亮；② 锋后「苔毯沉积」——越过即留 blotch 斑块毯
// （暗色常驻），整件末段 15% 统一退场；③ 锋唇亮线（湿苔反光）。
export const mossCreepShade = Fn(([vUv, uProg, uColor, uSeed]) => {
  const p = vUv.sub(vec2(0.5));
  const x = p.x.add(float(0.5));                     // 0(苔球)→1(玩家向)
  // 爬行指须：锋线 x 随 y 双频位移（fing² 锐化出疏密指状）
  const fing = sin(p.y.mul(9.0).add(uSeed)).mul(0.5).add(0.5);
  const fing2 = sin(p.y.mul(21.0).sub(uSeed.mul(1.7))).mul(0.5).add(0.5);
  const finger = fing.mul(fing).mul(0.055).add(fing2.mul(0.025));
  // 推进段 0→72% 走完全程（爬得快→慢压迫），其后锋面驻留远端——留出「缠上」的读秒
  const adv = clamp(uProg.mul(1.389), 0.0, 1.0);
  const head = adv.mul(0.92).add(0.06).add(finger);
  const rel = head.sub(x);
  // 苔毯沉积：越过即留（blotch 斑块），不再衰减成雾
  const mat = smoothstep(float(-0.10), float(0.02), rel);
  const blotch = sin(x.mul(23.0).add(uSeed)).mul(0.5).add(0.5)
    .mul(sin(p.y.mul(17.0).sub(uSeed.mul(2.3))).mul(0.5).add(0.5))
    .mul(sin(x.mul(9.0).sub(p.y.mul(11.0)).add(uSeed)).mul(0.5).add(0.5));
  // 纵向包络：中线厚两侧薄
  const ay = p.y.mul(2.0);
  const band = exp(ay.mul(ay).mul(-0.9));
  // 整件末段退场（苔干枯消散）
  const fade = oneMinus(smoothstep(float(0.82), float(1.0), uProg));   // 驻留后整件退场
  // 锋唇亮线 + 须尖增亮（只有指状处亮）
  const lip = exp(rel.mul(rel).mul(-260.0)).mul(band).mul(fade);
  const lipGain = fing.mul(0.6).add(0.5);
  const edge = oneMinus(smoothstep(float(0.42), float(0.50), abs(p.x)))
    .mul(oneMinus(smoothstep(float(0.40), float(0.50), abs(p.y))));
  const body = mat.mul(blotch.mul(0.55).add(0.45)).mul(band).mul(fade);
  const rgb = uColor.mul(body.mul(1.15))
    .add(vec3(0.62, 0.95, 0.42).mul(lip.mul(lipGain).mul(2.6)));
  return vec4(rgb.mul(edge), float(1.0));
});

/**
 * 贴地蔓延爬苔（dir = ±1 漫向）。quad 背缘贴 at（苔球），width = 波程（调用方按
 * 实际间距取——size 不足会让锋面半途消失）。返回 { promise, arriveU }——
 * arriveU = 锋面爬过 dist 对应的 uProg（0..1），抵达拍按此定时刻。
 */
export function mossCreep(ctx, deps, {
  at, dir = 1, color = [0.34, 0.52, 0.22], size = 20.0, ms = 900, dist = null,
}) {
  const arriveU = dist != null && size > 0
    ? Math.min(0.97, Math.max(0.15, (dist / size - 0.06) / 0.92 / 1.389))
    : 0.65;
  if (!at) return { promise: Promise.resolve(), arriveU };
  const uProg = uniform(0.0);
  const uSeed = uniform(Math.random() * 6.28 + 0.01);
  const { quad, release } = spellQuad({
    shade: mossCreepShade(uvOf(), uProg, vec3(color[0], color[1], color[2]), uSeed),
    width: size, height: size * 0.7, name: 'spellFx:mossCreep',
  });
  quad.position.set(at.x + dir * size * 0.5, at.y + 0.2, (at.z ?? 0) + 0.5);
  quad.rotation.x = -Math.PI / 2;
  quad.rotation.z = dir < 0 ? Math.PI : 0;
  deps.scene.add(quad);
  ctx.onKill(() => { release(); });
  const st = { t: 0 };
  const promise = ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'power1.in',   // 越爬越快（压迫感）
    onUpdate: () => { uProg.value = st.t; },
    onComplete: () => { release(); },
  });
  return { promise, arriveU };
}

// ============ 缠踝爬须（苔球抵达拍 mossGrip，ENEMY_FX.md 迭代#6）============
// 竖直 billboard（脚底对齐）：4 根 S 形爬须向上缠升（窄 x 高斯条 + sin 弯 + 向上
// 渐熄 + 底基湿晕）；生长包络前 35% 起、60% 后淡出；单次演出无驻留。
export const mossGripShade = Fn(([vUv, uProg, uColor, uSeed]) => {
  const p = vUv.sub(vec2(0.5, 0.0));                  // p.y: 0(脚底)→1(须顶)
  const grow = smoothstep(float(0.0), float(0.35), uProg);
  const fade = oneMinus(smoothstep(float(0.6), float(1.0), uProg));
  const tend = (i) => {
    const x0 = float((i - 1.5) * 0.22).add(sin(uSeed.add(float(i * 2.1))).mul(0.07));
    const bend = sin(p.y.mul(5.5).add(float(i * 1.9)).add(uSeed)).mul(0.11);
    const dx = p.x.sub(x0).sub(bend);
    const w = float(700.0 - i * 70.0);
    const core = exp(dx.mul(dx).mul(w.mul(-1.0)));
    const top = oneMinus(smoothstep(float(0.50 + i * 0.06), float(0.78 + i * 0.05), p.y));
    return core.mul(top).mul(float(0.95 - i * 0.09));
  };
  const acc = tend(0).add(tend(1)).add(tend(2)).add(tend(3));
  const base = exp(p.y.mul(p.y).mul(-34.0));
  const edge = oneMinus(smoothstep(float(0.42), float(0.50), abs(p.x)))
    .mul(oneMinus(smoothstep(float(0.44), float(0.50), p.y)));   // 顶部熄灭（底缘即地面不切）
  const rgb = uColor.mul(acc.mul(1.9).add(base.mul(0.8))).mul(grow).mul(fade);
  return vec4(rgb.mul(edge), float(1.0));
});

/** 缠踝爬须（竖直 billboard，at = 玩家脚下）。 */
export async function mossGrip(ctx, deps, {
  at, color = [0.45, 0.68, 0.30], size = 8.0, ms = 380,
}) {
  if (!at) return;
  const uProg = uniform(0.0);
  const uSeed = uniform(Math.random() * 6.28 + 0.01);
  const { quad, release } = spellQuad({
    shade: mossGripShade(uvOf(), uProg, vec3(color[0], color[1], color[2]), uSeed),
    width: size, height: size * 1.2, name: 'spellFx:mossGrip',
  });
  quad.position.set(at.x, at.y + size * 0.6, (at.z ?? 0) + 1.2);
  deps.scene.add(quad);
  ctx.onKill(() => { release(); });
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'power1.out',
    onUpdate: () => { uProg.value = st.t; },
    onComplete: () => { release(); },
  });
}

// ============ 蓄能光球（chargeUp / pufferInflate 喉压主体）============
// projectileShade（径向双层光球）复用 + 涨峰收尺寸包络 + 借池灯 punch。
export async function chargeOrb(ctx, deps, {
  at, color = [1.0, 0.78, 0.40], hot = [1.3, 1.05, 0.65],
  size = 5.0, ms = 420, lampIntensity = 520,
}) {
  if (!at) return;
  const uP = uniform(0.0);
  const { quad, release } = spellQuad({
    shade: projectileShade(uvOf(), uP, vec3(color[0], color[1], color[2]), vec3(hot[0], hot[1], hot[2])),
    width: size, height: size, name: 'spellFx:chargeOrb',
  });
  quad.position.set(at.x, at.y, (at.z ?? 0) + 1.0);
  deps.scene.add(quad);
  ctx.onKill(() => { release(); });
  const lamp = lampPulse(ctx, deps, {
    name: 'light:fx0', at: { x: at.x, y: at.y, z: (at.z ?? 0) + 1.5 }, color,
    peak: lampIntensity, attackMs: Math.round(ms * 0.5), decayMs: ms,
  });
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms + 160, ease: 'power2.out',
    onUpdate: () => {
      uP.value = st.t * 8.0;
      // 涨→峰停→收（0.6 处峰值，回落过冲 55%）
      const grow = st.t < 0.6 ? st.t / 0.6 : 1 - (st.t - 0.6) / 0.4 * 0.55;
      const s = 0.3 + grow * 1.1;
      quad.scale.set(s, s, 1);
    },
    onComplete: () => { release(); },
  });
  await lamp;
}

// ============ 落地尘（hunker / crouch heavy 的地面反馈）============
// 双层粒子配方（迸射粗粒 + 慢速浮尘）+ 可选暖灯 punch；形体环走 blocks.groundRing。
export function dustLanding(ctx, deps, { at, color = 0xb0a088, count = 16, lampIntensity = 0 }) {
  if (!at) return;
  deps.particles?.spawn?.(at.x, at.y, {
    color, count, speed: 13, size: 1.4, ttl: 0.55, gravity: -22, z: at.z,
  });
  deps.particles?.spawn?.(at.x, at.y, {
    color, count: Math.round(count * 0.5), speed: 5, size: 2.0, ttl: 1.3, gravity: -3, z: at.z,
  });
  if (lampIntensity > 0) {
    lampPulse(ctx, deps, {
      name: 'light:fx1', at: { x: at.x, y: at.y + 1, z: (at.z ?? 0) + 1 }, color: [0.85, 0.75, 0.6],
      peak: lampIntensity, attackMs: 60, decayMs: 240,
    });
  }
}

// ============ 汇流纹（聚能 gatherFocus 主体，ENEMY_FX.md 迭代#3）============
// 以胸口焦点为中心的螺旋内流光带：极角随半径偏转（内圈偏转多 = 吸积感）；
// 双频 sin 复合幂次锐化出不等宽亮带（随机相位/频率每实例烘焙——构造期字面量
// 进节点图，严禁等距均布）；亮带只存在于收束头部以内，头部亮唇 + 内向渐亮；
// 焦点小亮核随 uCharge 阶梯增亮。Fn 3 参（vUv/uProg/uCharge），色与相位烘常量。
export function makeDrainVeinsShade([cr, cg, cb], seed, f1, f2, swirlK) {
  return Fn(([vUv, uProg, uCharge]) => {
    const p = vUv.sub(vec2(0.5, 0.40));                 // 焦点：quad 中下（胸口位）
    const r = length(p).mul(2.0);
    const a0 = atan(p.y, p.x);
    const sw = a0.add(float(swirlK).mul(oneMinus(r))); // 螺旋偏转
    const l1 = sin(sw.mul(float(f1)).add(float(seed))).mul(0.5).add(0.5);
    const l2 = sin(sw.mul(float(f2)).sub(float(seed).mul(1.7))).mul(0.5).add(0.5);
    // 乘法锐化（pow 纪律）：l1 四次方出窄脊，l2 平方调制出不等宽
    const lane = l1.mul(l1).mul(l1).mul(l1).mul(l2).mul(l2);
    const head = oneMinus(uProg).mul(0.85).add(0.15);   // 收束头 1.0→0.15
    const inHead = oneMinus(smoothstep(head.sub(float(0.03)), head, r));
    const inward = oneMinus(smoothstep(float(0.02), head, r)); // 内向渐亮
    const d = r.sub(head);
    const lip = exp(d.mul(d).mul(-900.0)).mul(lane);    // 头部亮唇
    // 沿半径的内向行波（读「被吸过去」；单次演出件，非循环）
    const flow = sin(r.mul(float(26.0)).sub(uProg.mul(float(30.0)))).mul(0.5).add(0.5)
      .mul(0.30).add(0.70);
    const band = lane.mul(inHead).mul(inward.mul(0.7).add(0.3)).mul(flow);
    const fade = smoothstep(float(0.0), float(0.12), uProg)
      .mul(oneMinus(smoothstep(float(0.85), float(1.0), uProg)));
    const rr = r.mul(r);
    const core = exp(rr.mul(-900.0)).mul(uCharge.mul(2.6).add(0.3)); // 焦点核
    const edge = oneMinus(smoothstep(float(0.44), float(0.50), length(vUv.sub(vec2(0.5)))));
    const rgb = vec3(cr, cg, cb).mul(band.mul(2.3).mul(fade))
      .add(vec3(cr, cg, cb).mul(lip.mul(1.1).mul(fade)))
      .add(vec3(1.25, 1.12, 0.85).mul(lip.mul(2.0).mul(fade)))
      .add(vec3(cr, cg, cb).mul(core))
      .add(vec3(1.3, 1.2, 1.0).mul(core.mul(0.55)));
    return vec4(rgb.mul(edge), float(1.0));
  });
}

/** 汇流纹（竖直 billboard，at = 胸口焦点）。uCharge 由编排阶梯推进（末拍尖峰）。 */
export async function drainVeins(ctx, deps, {
  at, color = [0.86, 0.80, 0.62], size = 13.0, ms = 560, focusPeak = 1.5,
}) {
  if (!at) return;
  const uProg = uniform(0.0);
  const uCharge = uniform(0.0);
  const shade = makeDrainVeinsShade(
    color,
    Math.random() * 6.28,
    5.2 + Math.random() * 1.2,   // 亮带数（每圈脊线 ≈ f1）
    3.0 + Math.random() * 0.8,   // 宽度调制（不等宽）
    2.2 + Math.random() * 0.9,   // 螺旋卷绕
  );
  const { quad, release } = spellQuad({ shade: shade(uvOf(), uProg, uCharge), width: size, height: size * 1.05, name: 'spellFx:drainVeins' });
  quad.position.set(at.x, at.y, (at.z ?? 0) + 1.2);
  deps.scene.add(quad);
  ctx.onKill(() => release());
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'power1.in',   // 收束加速（吸积越近越快）
    onUpdate: () => {
      uProg.value = st.t;
      // 焦点阶梯增亮（三档），末拍尖峰一闪
      const q = st.t < 0.3 ? 0.25 : st.t < 0.62 ? 0.55 : st.t < 0.86 ? 0.85 : focusPeak;
      uCharge.value = q;
    },
    onComplete: () => release(),
  });
}

// ============ 怒压爆环（爆怒 rageSwell 末拍主体，ENEMY_FX.md 迭代#3）============
// 胸口横向椭圆单环急速外扩（单拍）：角向 12 尖毛刺调制环宽（爆开的不稳定边）+
// 环脊白热 HDR，随 uProg 扩张同步熄灭。横向压扁由 quad 高宽比给（横向气压）。
export const pressureBurstShade = Fn(([vUv, uProg, uColor, uSeed]) => {
  const p = vUv.sub(vec2(0.5));
  const r = length(p).mul(2.0);
  const a = atan(p.y, p.x);
  const R = uProg.mul(0.70).add(0.16);                  // 环半径 0.16→0.86
  const dr = r.sub(R);
  const spike = sin(a.mul(12.0).add(uSeed)).mul(0.5).add(0.5);
  const w = float(42.0).add(spike.mul(150.0));          // 尖处环更宽（毛刺边）
  const ring = exp(dr.mul(dr).mul(w).mul(-1.0));
  const fade = oneMinus(uProg).mul(uProg.mul(6.0).clamp(0.0, 1.0)); // 快入快出
  const edge = oneMinus(smoothstep(float(0.42), float(0.50), length(p)));
  const rgb = uColor.mul(ring.mul(2.8).mul(fade))
    .add(vec3(1.4, 0.9, 0.6).mul(ring.mul(ring).mul(3.2).mul(fade)));
  return vec4(rgb.mul(edge), float(1.0));
});

/** 怒压爆环（竖直 billboard 横椭圆，at = 胸口）。 */
export async function pressureBurst(ctx, deps, {
  at, color = [1.0, 0.45, 0.32], size = 13.0, ms = 260,
}) {
  if (!at) return;
  const uProg = uniform(0.0);
  const uSeed = uniform(Math.random() * 6.28 + 0.01);
  const { quad, release } = spellQuad({
    shade: pressureBurstShade(uvOf(), uProg, vec3(color[0], color[1], color[2]), uSeed),
    width: size, height: size * 0.6, name: 'spellFx:pressureBurst',
  });
  quad.position.set(at.x, at.y, (at.z ?? 0) + 1.2);
  deps.scene.add(quad);
  ctx.onKill(() => release());
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'power2.out',
    onUpdate: () => { uProg.value = st.t; },
    onComplete: () => release(),
  });
}

// ============ 胶冠溅（史莱姆命中主体）============
// 竖直 billboard：6 瓣异速外抛液滴（拉长泪滴、头亮尾细）+ 底部溅幕椭圆 + 首 30%
// 白绿热核闪。uProg 走 power2.out（液滴减速外抛）。
export const gooCrownShade = Fn(([vUv, uProg, uColor, uSeed]) => {
  const p = vUv.sub(vec2(0.5));
  const r = length(p).mul(2.0);
  const lobe = (i) => {
    const A = float((i - 2.5) * 0.55).add(sin(uSeed.add(float(i * 1.7))).mul(0.15));
    const dir = vec2(sin(A), cos(A));
    const sp = uProg.mul(float(0.55 + 0.18 * Math.sin(i * 1.3))).mul(0.85).add(0.15);
    const d = length(p.sub(dir.mul(sp.mul(0.5))));
    const dd = d.mul(d);
    const blob = exp(dd.mul(float(-240.0).add(uProg.mul(150.0))));
    const head = exp(dd.mul(float(-960.0).add(uProg.mul(600.0))));
    const fd = pow(oneMinus(uProg), float(1.2));
    return uColor.mul(blob.mul(1.5))
      .add(vec3(0.82, 0.88, 0.84).mul(head.mul(1.9))).mul(fd);
  };
  const lobes = lobe(0).add(lobe(1)).add(lobe(2)).add(lobe(3)).add(lobe(4)).add(lobe(5));
  const py = p.y.add(0.22);
  const sheet = exp(py.mul(py).mul(-26.0)).mul(exp(p.x.mul(p.x).mul(-7.0)))
    .mul(pow(oneMinus(uProg), float(2.0))).mul(0.55);
  const core = exp(r.mul(r).mul(-90.0))
    .mul(oneMinus(smoothstep(float(0.0), float(0.30), uProg)));
  const edge = oneMinus(smoothstep(float(0.42), float(0.50), length(p)));
  const rgb = lobes
    .add(uColor.mul(sheet))
    .add(vec3(0.90, 0.95, 0.92).mul(core.mul(2.2)));
  return vec4(rgb.mul(edge), float(1.0));
});

/** 命中液冠（竖直 billboard，命中点）。 */
export async function gooCrown(ctx, deps, { at, color = [0.20, 0.50, 0.16], size = 12.0, ms = 460 }) {
  if (!at) return;
  const uProg = uniform(0.0);
  const uSeed = uniform(Math.random() * 6.28 + 0.01);
  const { quad, release } = spellQuad({
    shade: gooCrownShade(uvOf(), uProg, vec3(color[0], color[1], color[2]), uSeed),
    width: size, height: size * 0.78, name: 'spellFx:gooCrown',
  });
  quad.position.set(at.x, at.y, (at.z ?? 0) + 1.3);
  deps.scene.add(quad);
  ctx.onKill(() => release());
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'power2.out',
    onUpdate: () => { uProg.value = st.t; },
    onComplete: () => release(),
  });
}

// ============ 剪影蓄能边光（穿山甲卷甲 / 硬化类 buff 的形体主体）============
// 挂 _standee 采样本体纹理：alpha 过渡带 = 剪影边缘 → 沿边缘的暖金亮线双波
// 上行（能量从脚爬到头）+ 体表底透光。贴体铁律：挂 standee 吃姿态通道；
// 生命周期自清（gainSweep 同范式：addTick 驱动、p≥1 或单位死亡即摘）。
export function playEdgeSurge(unit, colorHex = 0xd8a860, { durMs = 560 } = {}) {
  if (typeof document === 'undefined' || !unit || unit._dead) return false;
  const bodyMesh = unit._body;
  const map = bodyMesh.material.map;
  if (!map?.image) return false;   // 无立绘无从采边（早退不画整面）
  const texNode = texOf(map);
  const uPulse = uniform(-0.3);    // 波前从体外淡入
  const c = new THREE.Color(colorHex).multiplyScalar(1.5);
  const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  mat.blending = THREE.AdditiveBlending;
  mat.colorNode = (() => {
    const vUv = uvOf();
    const a = texNode.sample(vUv).a;
    // 剪影边缘带：alpha 0.25→0.55 上升沿减 0.55→0.80 下降沿（立绘 AA 边即边线）
    const edgeBand = smoothstep(float(0.25), float(0.55), a)
      .mul(oneMinus(smoothstep(float(0.55), float(0.80), a)));
    // 双波上行（0.35 相位差：第二道波追着第一道爬）——窄浪纪律：波间静默，
    // 只读到「亮波在爬」，不做整身罩染（软边立绘的宽边缘带会读成染色）
    const d1 = vUv.y.sub(uPulse);
    const w1 = exp(d1.mul(d1).mul(-240.0));
    const d2 = vUv.y.sub(fract(uPulse.add(float(0.35))));
    const w2 = exp(d2.mul(d2).mul(-240.0));
    // 体表底透光（甲片缝隙感，非纯边线）
    const inner = smoothstep(float(0.80), float(0.95), a).mul(0.16);
    const rgb = vec3(c.r, c.g, c.b).mul(edgeBand.mul(max(w1, w2).mul(3.2).add(0.12)))
      .add(vec3(1.2, 0.9, 0.45).mul(edgeBand.mul(w1).mul(2.2)))
      .add(vec3(c.r, c.g, c.b).mul(inner));
    return vec4(rgb, float(1.0));
  })();
  const mesh = new THREE.Mesh(bodyMesh.geometry, mat);
  mesh.name = 'edgeSurge';
  mesh.position.copy(bodyMesh.position);
  mesh.position.z += 0.9;
  mesh.renderOrder = 1;
  unit._standee.add(mesh);
  let el = 0;
  const untick = unit.addTick((dt) => {
    el += dt;
    const p = Math.min(1, el / (durMs / 1000));
    uPulse.value = -0.3 + p * 1.6;
    if (p >= 1 || unit._dead) {
      untick();
      mesh.parent?.remove(mesh);
      mat.dispose();
    }
  });
  return true;
}

// ============ 怒意搏动边光（爆怒 rageSwell 主体①，ENEMY_FX.md 迭代#3）============
// playEdgeSurge 的搏动版：不是双波上爬，而是全轮廓亮度按搏动驱动、频率加速
// （JS 侧相位积分，2→5.5Hz ramp——怒在积攒），末段 sin 脉冲过曝（血往头上涌）。
export function pulseEdgeSurge(unit, colorHex = 0xe0705a, { ms = 520 } = {}) {
  if (typeof document === 'undefined' || !unit || unit._dead) return false;
  const bodyMesh = unit._body;
  const map = bodyMesh.material.map;
  if (!map?.image) return false;
  const texNode = texOf(map);
  const uBeat = uniform(0.0);
  const uBurst = uniform(0.0);
  const c = new THREE.Color(colorHex).multiplyScalar(1.8);
  const mat = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, fog: false });
  mat.blending = THREE.AdditiveBlending;
  mat.colorNode = (() => {
    const vUv = uvOf();
    const a = texNode.sample(vUv).a;
    const edgeBand = smoothstep(float(0.28), float(0.58), a)
      .mul(oneMinus(smoothstep(float(0.58), float(0.82), a)));
    const inner = smoothstep(float(0.80), float(0.95), a);
    const lift = uBeat.mul(0.85).add(uBurst.mul(2.2)).add(0.20); // 谷底也留亮（怒意不熄）
    // 内透只给微暖 + 末拍爆闪——边光才是主体（整身染色读成「粉红泡泡」）
    const core = uBeat.mul(0.35).add(uBurst.mul(2.4)).add(0.05);
    const rgb = vec3(c.r, c.g, c.b).mul(edgeBand.mul(lift).mul(3.2))
      .add(vec3(1.3, 0.55, 0.35).mul(edgeBand.mul(lift).mul(1.6)))
      .add(vec3(c.r, c.g, c.b).mul(inner.mul(core).mul(0.30)));
    return vec4(rgb, float(1.0));
  })();
  const mesh = new THREE.Mesh(bodyMesh.geometry, mat);
  mesh.name = 'pulseEdgeSurge';
  mesh.position.copy(bodyMesh.position);
  mesh.position.z += 0.9;
  mesh.renderOrder = 1;
  unit._standee.add(mesh);
  let el = 0;
  let phase = 0;
  const untick = unit.addTick((dt) => {
    el += dt;
    const p = Math.min(1, el / (ms / 1000));
    phase += dt * (2.0 + 3.5 * p);                      // 频率 ramp（积分相位纪律）
    const b = Math.sin(phase * Math.PI * 2);
    uBeat.value = b > 0 ? b * Math.sqrt(b) : 0;         // 半波整流（搏动非振荡）
    const bp = (p - 0.82) / 0.18;                        // 末段过曝脉冲
    uBurst.value = bp > 0 ? Math.sin(Math.min(bp, 1) * Math.PI) : 0;
    if (p >= 1 || unit._dead) {
      untick();
      mesh.parent?.remove(mesh);
      mat.dispose();
    }
  });
  return true;
}

// ============ 纸屑迸裂（甲虫啃牌咬碎主体，ENEMY_FX.md 迭代#2）============
// 竖直 billboard：8 瓣旋转局部系里的带锥度矩形纸片（两瓣暗金点缀）随 uProg
// 异速外抛 + 各自转，单次迸裂单调淡出——无循环项、无呼吸，一次性力度件。
export const shredBurstShade = Fn(([vUv, uProg, uColor, uSeed]) => {
  const p = vUv.sub(vec2(0.5));
  const shard = (i, tone) => {
    const dirA = float((i - 3.5) * 0.38).add(sin(uSeed.add(float(i * 2.3))).mul(0.12));
    const dir = vec2(sin(dirA), cos(dirA));
    const sp = float(0.50 + 0.20 * Math.sin(i * 1.7));
    const c = dir.mul(uProg.mul(sp).mul(0.42).add(0.06));
    const q = p.sub(c);
    const th = uSeed.add(float(i * 1.9)).add(uProg.mul(float((i % 2 ? 1 : -1) * 5.0)));
    const ct = cos(th);
    const st = sin(th);
    const qx = q.x.mul(ct).add(q.y.mul(st));
    const qy = q.y.mul(ct).sub(q.x.mul(st));
    const lenMask = exp(qx.mul(qx).mul(-80.0));            // 轴向半长 ~0.11
    const taper = float(0.7).add(abs(qx).mul(2.6));        // 端部更宽的叶形纸片
    const widMask = exp(qy.mul(qy).mul(float(-450.0).div(taper)));
    return tone.mul(lenMask.mul(widMask));
  };
  const cream = uColor;
  const gold = uColor.mul(vec3(0.80, 0.68, 0.45));         // 两瓣暗金点缀
  const acc = shard(0, cream).add(shard(1, cream)).add(shard(2, gold))
    .add(shard(3, cream)).add(shard(4, cream)).add(shard(5, gold))
    .add(shard(6, cream)).add(shard(7, cream));
  const fd = pow(oneMinus(uProg), float(1.1));
  const edge = oneMinus(smoothstep(float(0.42), float(0.50), length(p)));
  return vec4(acc.mul(1.4).mul(fd).mul(edge), float(1.0));
});

/** 咬碎纸屑迸裂（一次性）。size/ms 分大小档（第一口小、第二口大）。 */
export async function shredBurst(ctx, deps, { at, size = 9.5, ms = 340, color = [0.85, 0.78, 0.62] }) {
  if (!at) return;
  const uProg = uniform(0.0);
  const uSeed = uniform(Math.random() * 6.28 + 0.01);
  const { quad, release } = spellQuad({
    shade: shredBurstShade(uvOf(), uProg, vec3(color[0], color[1], color[2]), uSeed),
    width: size, height: size * 0.8, name: 'spellFx:shredBurst',
  });
  quad.position.set(at.x, at.y, (at.z ?? 0) + 1.2);
  deps.scene.add(quad);
  ctx.onKill(() => release());
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'power2.out',
    onUpdate: () => { uProg.value = st.t; },
    onComplete: () => release(),
  });
}
