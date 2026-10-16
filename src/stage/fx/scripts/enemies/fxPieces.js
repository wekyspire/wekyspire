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
  fract, max, min, atan,
} from 'three/tsl';
import { spellQuad, lampPulse } from '../../spells/blocks.js';
import { projectileShade } from '../../spells/shaders.js';

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

// ============ 蔓延雾锋（苔球 spreadGrip 主体）============
// 贴地平躺 quad（单位→玩家方向定向）：行进雾锋（front 锐亮 + 指数拖尾）+
// fbm 起伏（sin 叠读「苔在爬」）+ 双层色（深绿雾体 + 亮绿锋缘唇线）。
export const mossWaveShade = Fn(([vUv, uProg, uColor, uSeed]) => {
  const p = vUv.sub(vec2(0.5));
  const x = p.x.add(float(0.5));                     // 0(单位)→1(玩家向)
  const head = uProg.mul(0.92).add(0.06);
  const rel = head.sub(x);
  const front = smoothstep(float(-0.06), float(0.02), rel);
  const tail = exp(rel.mul(-5.5)).mul(front);
  // fbm 起伏（横纹 × 纵向窜动——雾不是矩形墙）
  const wob = sin(x.mul(19.0).add(uSeed)).mul(0.5).add(0.5)
    .mul(sin(p.y.mul(7.0).sub(uSeed.mul(2.0))).mul(0.5).add(0.5));
  // 纵向包络：中线厚两侧薄
  const ay = p.y.mul(2.0);
  const band = exp(ay.mul(ay).mul(-0.9));
  const body = tail.mul(band.mul(wob.mul(0.55).add(0.45)));
  // 锋缘亮线（最前沿一道亮——「正在漫过来」）
  const lip = exp(rel.mul(rel).mul(-700.0)).mul(front).mul(band);
  const edge = oneMinus(smoothstep(float(0.42), float(0.50), abs(p.x)))
    .mul(oneMinus(smoothstep(float(0.40), float(0.50), abs(p.y))));
  const rgb = uColor.mul(body.mul(1.5))
    .add(vec3(0.62, 0.95, 0.42).mul(lip.mul(2.6)));
  return vec4(rgb.mul(edge), float(1.0));
});

/** 贴地蔓延雾（dir = ±1 漫向）。 */
export async function mossWave(ctx, deps, {
  at, dir = 1, color = [0.34, 0.52, 0.22], size = 20.0, ms = 900,
}) {
  if (!at) return;
  const uProg = uniform(0.0);
  const uSeed = uniform(Math.random() * 6.28 + 0.01);
  const { quad, release } = spellQuad({
    shade: mossWaveShade(uvOf(), uProg, vec3(color[0], color[1], color[2]), uSeed),
    width: size, height: size * 0.7, name: 'spellFx:mossWave',
  });
  quad.position.set(at.x + dir * size * 0.22, at.y + 0.2, (at.z ?? 0) + 0.5);
  quad.rotation.x = -Math.PI / 2;
  quad.rotation.z = dir < 0 ? Math.PI : 0;
  deps.scene.add(quad);
  ctx.onKill(() => { release(); });
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'power1.in',   // 越漫越快（压迫感）
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

// ============ 胶质压力池（史莱姆蓄压主体，ENEMY_FX.md 迭代#1）============
// 贴地平躺 quad：半径随 uProg 涨缩（蓄压渗胶 / 弹射前收回归体）；角向三频慢漂
// = 有机边缘；体内双层流动焦散 + 三个轨道漂移上升微泡（fract 相位，到顶增亮
// 后消）；外沿亮唇线带呼吸。深绿低亮——胶是渗出物不是能量球，亮度随成形度走。
export const gooPoolShade = Fn(([vUv, uProg, uTime, uSeed]) => {
  const p = vUv.sub(vec2(0.5));
  const r = length(p).mul(2.0);
  const a = atan(p.y, p.x);
  const R = uProg.mul(0.30).add(0.20);
  const wob = sin(a.mul(3.0).add(uSeed)).mul(0.10)
    .add(sin(a.mul(5.0).sub(uTime.mul(0.9))).mul(0.06))
    .add(sin(a.mul(8.0).add(uTime.mul(1.7))).mul(0.04));
  const rw = R.mul(wob.add(1.0));
  const dr = r.sub(rw);
  const body = oneMinus(smoothstep(float(-0.10), float(0.02), dr));
  const ca = sin(a.mul(6.0).add(r.mul(14.0)).sub(uTime.mul(2.1)))
    .mul(sin(a.mul(4.0).sub(r.mul(9.0)).add(uTime.mul(1.3))));
  const rr2 = r.mul(r);
  const causs = ca.mul(ca).mul(exp(rr2.mul(-1.6)));
  const lip = exp(dr.mul(dr).mul(-260.0)).mul(smoothstep(float(-0.04), float(0.02), dr));
  const lipBr = float(1.35).add(sin(uTime.mul(3.1).add(uSeed)).mul(0.4));
  // 微泡 ×3（JS 循环静态展开）：慢轨道漂移 + fract 相位上升，到顶增亮后消
  const bub = (i) => {
    const ph = fract(uTime.mul(0.30).add(float(i * 0.37)).add(uSeed.mul(0.13)));
    const th = uSeed.mul(2.0).add(float(i * 2.1)).add(uTime.mul(0.12));
    const rad = rw.mul(ph.mul(0.50).add(0.15)).mul(0.5);
    const bd = length(p.sub(vec2(cos(th), sin(th)).mul(rad)));
    return exp(bd.mul(bd).mul(-380.0))
      .mul(sin(ph.mul(Math.PI)))
      .mul(ph.mul(0.65).add(0.35))
      .mul(body);
  };
  const bubs = bub(0).add(bub(1)).add(bub(2));
  const dim = smoothstep(float(0.0), float(0.35), uProg);
  const rgb = vec3(0.05, 0.16, 0.06).mul(body.mul(dim))
    .add(vec3(0.10, 0.30, 0.10).mul(causs.mul(dim).mul(2.4)))
    .add(vec3(0.28, 0.85, 0.30).mul(lip.mul(lipBr).mul(dim)))
    .add(vec3(0.50, 1.00, 0.45).mul(bubs.mul(dim).mul(1.6)));
  const edge = oneMinus(smoothstep(float(0.85), float(1.00), r));
  return vec4(rgb.mul(edge), float(1.0));
});

/** 贴地压力池：uProg = 涨→持→收三段（grow/hold/collapse），胶感时间连续驱动。 */
export async function gooPool(ctx, deps, { at, size = 9.5, growMs = 420, holdMs = 40, collapseMs = 130 }) {
  if (!at) return;
  const uProg = uniform(0.0);
  const uTime = uniform(Math.random() * 40);
  const uSeed = uniform(Math.random() * 6.28 + 0.01);
  const { quad, release } = spellQuad({
    shade: gooPoolShade(uvOf(), uProg, uTime, uSeed),
    width: size, height: size, name: 'spellFx:gooPool',
  });
  quad.position.set(at.x, at.y + 0.2, (at.z ?? 0) + 0.5);
  quad.rotation.x = -Math.PI / 2;
  deps.scene.add(quad);
  ctx.onKill(() => release());
  const total = growMs + holdMs + collapseMs;
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: total, ease: 'linear',
    onUpdate: () => {
      uTime.value = performance.now() / 1000;
      const ms = st.t * total;
      uProg.value = ms < growMs ? ms / growMs : ms < growMs + holdMs
        ? 1 : 1 - (ms - growMs - holdMs) / collapseMs;
    },
    onComplete: () => release(),
  });
}

// ============ 粘弹胶丝（史莱姆弹射断裂主体）============
// 竖直 quad（height=1、scale.y=距离实时摆）：双细丝中段随拉伸掐细（uProg=伸长
// 比），uSnap 驱动断裂——颈点渐宽熄灭 + 残珠下坠缩径 + 整丝淡出。pre-snap 颈线
// 本就是最细处（顺势读「将断」）。
export const gooStrandShade = Fn(([vUv, uProg, uSnap, uColor]) => {
  const p = vUv.sub(vec2(0.5));
  const v = p.y.add(0.5);
  const pinch = min(uProg.mul(1.4), float(1.0)).mul(sin(v.mul(Math.PI)));
  const th = float(0.100).add(sin(v.mul(Math.PI)).mul(0.038))
    .mul(float(1.0).sub(pinch.mul(0.72)));
  const dx1 = p.x.sub(0.20).div(th);
  const f1 = exp(dx1.mul(dx1).mul(-5.0));
  const c1 = exp(dx1.mul(dx1).mul(-18.0));
  const dx2 = p.x.add(0.20).div(th);
  const f2 = exp(dx2.mul(dx2).mul(-5.0));
  const c2 = exp(dx2.mul(dx2).mul(-18.0));
  const gap = uSnap.mul(0.35);
  const keep = smoothstep(gap, gap.add(0.08), abs(v.sub(0.48)));
  const bv = v.sub(float(0.48).sub(uSnap.mul(0.25)));
  const bead = exp(bv.mul(bv).mul(-320.0))
    .mul(exp(p.x.mul(p.x).mul(-240.0))).mul(uSnap).mul(2.6);
  const fade = pow(oneMinus(uSnap), float(0.7))
    .mul(smoothstep(float(0.0), float(0.08), v));
  const edge = oneMinus(smoothstep(float(0.38), float(0.50), abs(p.x)))
    .mul(oneMinus(smoothstep(float(0.40), float(0.50), abs(p.y))));
  const rgb = uColor.mul(f1.add(f2).mul(2.2))
    .add(vec3(0.72, 1.05, 0.50).mul(c1.add(c2).mul(2.6)))
    .add(vec3(0.85, 1.15, 0.60).mul(bead));
  return vec4(rgb.mul(keep).mul(fade).mul(edge), float(1.0));
});

/**
 * 粘弹胶丝（from 池位 → 身体实时跟随）。返回 { update(to), snap() }：
 * update 在飞行 onUpdate 里逐帧调（重摆 midpoint/rotation/scale.y）；
 * snap() 演断裂（130ms 后自清）。未被 snap 时 lifeMs 兜底自清。
 */
export function gooStrand(ctx, deps, { from, color = [0.30, 0.85, 0.32], refLen = 5.0, lifeMs = 460 }) {
  if (!from) return { update: () => {}, snap: async () => {} };
  const uProg = uniform(0.0);
  const uSnap = uniform(0.0);
  const { quad, release } = spellQuad({
    shade: gooStrandShade(uvOf(), uProg, uSnap, vec3(color[0], color[1], color[2])),
    width: 3.4, height: 1, name: 'spellFx:gooStrand',
  });
  deps.scene.add(quad);
  ctx.onKill(() => release());
  const cur = { x: from.x, y: from.y, z: from.z ?? 0 };
  const place = () => {
    const dx = cur.x - from.x;
    const dy = cur.y - from.y;
    const d = Math.hypot(dx, dy) || 0.001;
    quad.position.set((from.x + cur.x) / 2, (from.y + cur.y) / 2, ((from.z ?? 0) + (cur.z ?? 0)) / 2 + 1.1);
    quad.rotation.z = Math.atan2(dy, dx) - Math.PI / 2;
    quad.scale.set(1, d, 1);
    uProg.value = Math.min(1, d / refLen);
  };
  place();
  ctx.spawn(async (c) => { await c.wait(lifeMs); release(); });
  return {
    update(to) { cur.x = to.x; cur.y = to.y; cur.z = to.z ?? 0; place(); },
    async snap() {
      const s = { k: 0 };
      await ctx.tweenRaw(s, { k: 1 }, {
        durationMs: 130, ease: 'power1.in',
        onUpdate: () => { uSnap.value = s.k; },
        onComplete: () => release(),
      });
    },
  };
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
      .add(vec3(0.75, 1.08, 0.55).mul(head.mul(1.9))).mul(fd);
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
    .add(vec3(0.88, 1.18, 0.72).mul(core.mul(2.2)));
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
    // 双波上行（0.35 相位差：第二道波追着第一道爬）
    const d1 = vUv.y.sub(uPulse);
    const w1 = exp(d1.mul(d1).mul(-120.0));
    const d2 = vUv.y.sub(fract(uPulse.add(float(0.35))));
    const w2 = exp(d2.mul(d2).mul(-120.0));
    // 体表底透光（甲片缝隙感，非纯边线）
    const inner = smoothstep(float(0.80), float(0.95), a).mul(0.28);
    const rgb = vec3(c.r, c.g, c.b).mul(edgeBand.mul(max(w1, w2).mul(3.0).add(0.6)))
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
