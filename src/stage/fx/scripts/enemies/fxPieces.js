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
  fract, max, min, atan, clamp, floor,
} from 'three/tsl';
import { spellQuad, lampPulse } from '../../spells/blocks.js';

// ============ 单位高度锚（高度感知定位，1016 用户裁定）============
// unit.position = 立牌脚下中心，不是身体中心；有效视觉高 = _standeeHeight ×
// _baseScale。一切「身体高度」锚（胸/头/受击中弹位/口部）按 H 比例取——旧固定
// 3.4/4.9×s 只对平均体型成立，大个子会锚到胫骨。
export const unitH = (u) => (u._standeeHeight ?? 22) * (u._baseScale ?? 1);

// ============ 电弧束（静电毛球 zapChain 主体）============
// **世界 Y 截面 ribbon 沿 3D 航线**（四顶点直写世界坐标，quad 变换恒等）——
// 旧版是 XY 平面 quad 按 atan2(dy,dx) 只转 z：那只对「同一 z 面上的两点」成立。
// 真实战斗的敌我纵深差有 ~75 世界单位（dungeon slots: 敌 z=-60 / 玩家 z=15），
// 平面 quad 既算短了（dist 只用 dx/dy，gallery 里 34.1 vs 真实 77.7）又只能停在
// 中点 z 上——屏幕上读成「横在连线中点、两端都不接」（用户报的朝向 bug 实体是
// 这个：任何相机角度都不贴连线）。改法同 scaleDust：顶点直写世界坐标，截面取
// 与航线垂直的「尽量世界 Y」方向（近竖直航线回落世界 X）。
// fragment 主笔：中线偏移（双频 sin + uTime 离散跳变）+
// 双层截面（窄热核白蓝 HDR + 宽电晕）+ 行进脉冲波（uProg 一道亮波烧向靶端）+
// 分支细弧 + 端点亮斑。热核色烘常量（白蓝恒定），晕色走参数（主题色）。
// uState = vec2(行进脉冲, 尾段熄灭)——Fn 4 参纪律，两标量打包。
export const zapArcShade = Fn(([vUv, uTime, uState, uColor]) => {
  const uProg = uState.x;
  const uFade = uState.y;
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
  // 行进脉冲：一道亮波沿 v 烧过去 + 驻留基线（迭代#19：σ -90→-140 加锐、
  // 基线 0.30→0.22——抵达后读「亮线」不「亮带」）
  const dv = v.sub(uProg);
  const wave = exp(dv.mul(dv).mul(-140.0));
  // 分支细弧（第二中线异频低强）：电的「毛边」
  const off2 = sin(v.mul(21.1).add(uTime.mul(13.3))).mul(anchor).mul(0.10);
  const dxB = p.x.sub(off2);
  const branch = exp(dxB.mul(dxB).mul(-2500.0)).mul(float(0.45));
  // 端点亮斑（源端常亮；靶端随抵达点亮）
  const rS = length(vec2(p.x, p.y.add(float(0.5))));
  const rT = length(vec2(p.x, p.y.sub(float(0.5))));
  const tipS = exp(rS.mul(rS).mul(-60.0));
  // （迭代#19：靶端亮斑 2.2→2.6 落点更响；起坡 0.85→0.70——105ms 行进窗里
  // 亮斑提前挂亮，抵达拍不会被尾段熄灭吞掉（4.5v 复核 f02 靶端无闪的修法））
  const tipT = exp(rT.mul(rT).mul(-60.0)).mul(smoothstep(float(0.70), float(1.0), uProg));
  // 边缘熄灭（quad 直边不切亮缝）
  const edge = oneMinus(smoothstep(float(0.36), float(0.50), abs(p.x)))
    .mul(oneMinus(smoothstep(float(0.40), float(0.50), abs(p.y))));
  // 闪烁（uTime 离散跳变已带抖，再加细闪；迭代#19：47→69——短寿命里「电在跳」）
  const flick = sin(uTime.mul(69.0)).mul(0.10).add(0.90);
  const body = wave.add(float(0.22));
  const energy = core.mul(body).mul(flick)
    .add(halo.mul(body).mul(0.42))
    .add(branch.mul(wave))
    .add(tipS.mul(1.6))
    .add(tipT.mul(2.6));
  const rgb = uColor.mul(halo.mul(1.8))
    .add(vec3(0.85, 0.93, 1.35).mul(core.mul(4.2)))
    .add(vec3(0.75, 0.85, 1.20).mul(tipT.add(tipS).mul(2.0)));
  return vec4(rgb.mul(energy).mul(edge).mul(uFade), float(1.0));
});

/**
 * 电弧束（世界空间，源→靶，3D ribbon）。返回 { promise, jolt }——jolt() 由编排
 * 每拍调（离散重掷 uTime = 折点换相读「电在跳」），promise 在寿命结束时兑现。
 */
export function zapArc(ctx, deps, {
  from, to, color = [0.55, 0.72, 1.30], width = 7.0, lifeMs = 640, reachMs = 200,
}) {
  if (!from || !to) return { promise: Promise.resolve(), jolt: () => {} };
  const uTime = uniform(Math.random() * 100);
  const uState = uniform(new THREE.Vector2(0.0, 1.0));
  // 端点带 z（缺省 0）+ 统一 +1.2 前移（旧版 quad 的同一前移量：depthTest:false 下
  // 只为让投影略靠镜头，不改变贴附读感）
  const a = { x: from.x, y: from.y, z: (from.z ?? 0) + 1.2 };
  const b = { x: to.x, y: to.y, z: (to.z ?? 0) + 1.2 };
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const dist = Math.hypot(dx, dy, dz) || 1;
  // 轴向 7.5% 余量（旧版 height=dist*1.15 的同一余量）：shader 的 |p.y| 直边熄灭
  // 在 uv 端头归零，不留余量会让可见热核到不了角色胸口、两端各留一小段空。
  const ext = dist * 0.075;
  const ux = dx / dist, uy = dy / dist, uz = dz / dist;
  a.x -= ux * ext; a.y -= uy * ext; a.z -= uz * ext;
  b.x += ux * ext; b.y += uy * ext; b.z += uz * ext;
  const { quad, geo, mat, release } = spellQuad({
    shade: zapArcShade(uvOf(), uTime, uState, vec3(color[0], color[1], color[2])),
    width: 1, height: 1,   // 真实几何在下面直写（plane 仅提供 4 顶点/uv）
    name: 'spellFx:zapArc',
  });
  // 截面轴：世界 Y 去掉航线分量（近竖直航线退化为世界 X）——截面始终与航线垂直
  let cx = -ux * uy, cy = 1 - uy * uy, cz = -uz * uy;
  if (Math.hypot(cx, cy, cz) < 0.3) { cx = 1 - ux * ux; cy = -uy * ux; cz = -uz * ux; }
  const cl = Math.hypot(cx, cy, cz) || 1;
  cx /= cl; cy /= cl; cz /= cl;
  const h = width / 2;
  // PlaneGeometry 行序：顶点 0/1 是 v=1（靶端），2/3 是 v=0（源端）；列 0/1 = u 0/1。
  // 顶点绕序照原 plane（0→2→1 法线 +Z）：u=0 取 +截面，保证典型机位（+Z 侧）正面朝镜头；
  // 再加 DoubleSide 兜住相机绕到背面的点播角度（加色混合无双面叠亮问题）。
  const pos = geo.attributes.position;
  pos.setXYZ(0, b.x + cx * h, b.y + cy * h, b.z + cz * h);
  pos.setXYZ(1, b.x - cx * h, b.y - cy * h, b.z - cz * h);
  pos.setXYZ(2, a.x + cx * h, a.y + cy * h, a.z + cz * h);
  pos.setXYZ(3, a.x - cx * h, a.y - cy * h, a.z - cz * h);
  pos.needsUpdate = true;
  mat.side = THREE.DoubleSide;
  // 顶点铺到世界端点，plane 自身的包围球会把整件裁掉——关视锥剔除（scaleDust 同法）
  quad.frustumCulled = false;
  deps.scene.add(quad);
  ctx.onKill(() => { release(); });
  const jolt = () => { uTime.value += 3.7 + Math.random() * 4.1; };  // 离散换相
  const promise = (async () => {
    const st = { t: 0 };
    await ctx.tweenRaw(st, { t: 1 }, {
      durationMs: lifeMs, ease: 'power2.out',
      onUpdate: () => {
        const prog = Math.min(1, st.t * (lifeMs / reachMs));
        const fade = st.t > 0.78 ? 1 - (st.t - 0.78) / 0.22 : 1;  // 尾段熄灭
        uState.value.set(prog, fade);
      },
    });
    // tweenRaw 统一收账会覆盖本函数的 onComplete——自持释放必须在这里显式收尾
    // （否则 mesh 要等父剧本结束才被 onKill 摘除，寿命预算失真，迭代#19）
    release();
  })();
  return { promise, jolt };
}

// ============ 声波环族（wailFx 主体，迭代 #11 主题分家）============
// 竖直 billboard 三道错峰扩散环。**环 = 全向广播语义专用**（嚎叫/气压/威慑）；
// 攻击性声波禁用环（无指向性像施法）——要走定向波前模板。三 mode 构图期分支
// （色/相位/瓣形烘常量进节点图，运行时无控制流）：
//   plain   气压谐波环（短嚎/蟾蜍峰压/通用）
//   crystal 冰晶棱面（高频角向瓣幂次锐化 + 密纹波 + 冷白亮唇）
//   wraith  阴波荡开（环缘角向行波 + 软缘宽裙 + 内芯扣暗）
export function makeWailRingShade([cr, cg, cb], seed, mode = 'plain') {
  const col = vec3(cr, cg, cb);
  const hot = mode === 'crystal' ? vec3(0.85, 0.95, 1.30)
    : mode === 'wraith' ? vec3(0.98, 0.90, 1.25)
    : vec3(0.92, 0.97, 1.15);
  return Fn(([vUv, uProg]) => {
    const p = vUv.sub(vec2(0.5));
    const r = length(p).mul(2.0);
    const a = atan(p.y, p.x);
    // 错峰相位（迭代 #12 淡入淡出）：各环带出生延迟 + 生命期钳制——首帧只有环 0
    // 从零淡入，收尾所有环包络归零后才 release（旧版 fract 相位环绕 = 首帧两环
    // 已满亮凭空出现、末帧回绕中心硬切消失）。驱动 uProg 0→1.22（= 末环走完）。
    const ringOf = (delay) => {
      const life = uProg.sub(float(delay));              // <0 = 未出生
      const ph = clamp(life.mul(float(1 / 0.68)), 0.0, 1.0);
      const born = smoothstep(0.0, 0.03, life);          // 出生前完全不可见
      const fadeIn = smoothstep(0.0, 0.35, ph);          // 出生淡入（约前1/3生命）
      const rr = ph.mul(0.92);
      const dr = r.sub(rr);
      const ring = exp(dr.mul(dr).mul(-340.0));
      const skirt = exp(dr.mul(dr).mul(mode === 'wraith' ? -38.0 : -60.0));
      // 瓣形按 mode 构图期定型
      let lobed;
      if (mode === 'crystal') {
        lobed = sin(a.mul(7.0).add(float(seed * 7.0))).mul(0.5).add(0.5).pow(2.2)
          .mul(sin(a.mul(13.0).sub(float(seed))).mul(0.5).add(0.5).pow(1.6))
          .mul(1.15).add(0.28); // 星芒棱面：瓣间深谷 + 尖峰
      } else if (mode === 'wraith') {
        lobed = sin(a.mul(3.0).add(uProg.mul(9.0)).add(float(seed * 7.0))).mul(0.5).add(0.5)
          .mul(0.45).add(0.55); // 角向行波：环缘边扩边荡
      } else {
        lobed = sin(a.mul(5.0).add(float(seed * 7.0))).mul(0.5).add(0.5)
          .mul(sin(a.mul(9.0).sub(float(seed))).mul(0.5).add(0.5)).mul(0.7).add(0.5);
      }
      const ripple = mode === 'crystal'
        ? sin(dr.mul(110.0).sub(ph.mul(30.0))).mul(0.5).add(0.5).mul(0.4).add(0.7)
        : mode === 'wraith'
          ? sin(dr.mul(50.0).sub(ph.mul(14.0))).mul(0.5).add(0.5).mul(0.25).add(0.8)
          : sin(dr.mul(90.0).sub(ph.mul(24.0))).mul(0.5).add(0.5).mul(0.35).add(0.75);
      const fadeOut = oneMinus(pow(ph, float(0.8)));
      const env = born.mul(fadeIn).mul(fadeOut);
      return col.mul(skirt.mul(mode === 'wraith' ? 1.9 : 1.5).mul(lobed))
        .add(hot.mul(ring.mul(mode === 'wraith' ? 2.1 : 3.2).mul(lobed).mul(ripple)))
        .mul(env);
    };
    const acc = ringOf(0).add(ringOf(0.27)).add(ringOf(0.54));
    // 阴波内芯扣暗：环心一团墨色（怨灵啸的「吸走」读感）——同样淡入淡出包络
    const dark = mode === 'wraith'
      ? oneMinus(smoothstep(float(0.06), float(0.20), r)).mul(vec3(0.05, 0.03, 0.10))
        .mul(smoothstep(0.0, 0.20, uProg)).mul(oneMinus(uProg.mul(0.8)))
      : vec3(0.0, 0.0, 0.0);
    const edge = oneMinus(smoothstep(float(0.44), float(0.50), length(p)));
    return vec4(acc.add(dark).mul(edge), float(1.0));
  });
}

/** 声波环（单位头部，竖直 billboard）。mode 见 makeWailRingShade；粒子/灯由编排侧叠。 */
export async function wailRing(ctx, deps, { at, color = [0.65, 0.78, 1.10], size = 16.0, ms = 760, mode = 'plain' }) {
  if (!at) return;
  const uProg = uniform(0.0);
  const seed = Math.random() * 6.28 + 0.01;
  const { quad, release } = spellQuad({
    shade: makeWailRingShade(color, seed, mode)(uvOf(), uProg),
    width: size, height: size, name: 'spellFx:wailRing',
  });
  quad.position.set(at.x, at.y, (at.z ?? 0) + 1.4);
  deps.scene.add(quad);
  ctx.onKill(() => { release(); });
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1.22 }, {   // 末环（延迟 0.54 + 生命 0.68）走完包络归零
    durationMs: ms, ease: 'linear',   // 环速恒定（声波匀速），衰减包络在 env 里
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

// ============ 蔓延爬苔（苔球 spreadGrip 主体，ENEMY_FX.md 迭代#6 v2）============
// 贴地平躺 quad（背缘贴苔球、铺向玩家）。v2 材料重审（用户终审：v1 亮绿 + 匀称
// 波形 = 读「毒雾」不读「苔」）：
//   ① 前缘 = 6 根**独立指瓣**（cell hash 定中心/宽/长/推进相位；max 融合），指间
//      保留真缝（基线在指根之后）；指端湿孢小亮斑——非周期侵占，不是 sin 波。
//   ② 苔毯 = cell hash 双尺度值噪声（大斑 3×3 + 小斑 9×9，双线性插值 → 阈值化有机
//      斑块；覆盖率不均），锋后新苔略亮（生长差）、越过沉为暗毯。
//   ③ 色压湿墨绿：主色 [0.16,0.24,0.11]，亮度层次全给斑块明暗差；湿唇窄亮一线 +
//      孢尖小亮斑。**输出最大通道压 ≤0.5**（HDR 直出值，进 tone map 前；体 + 亮斑
//      叠加后统一保色缩放收口）——不推 bloom 阈、无荧光感。
//   ④ 推进律与 arriveU 口径不动（adv=uProg×1.389、head=adv×0.92+0.06）。
// 亮度口径（自评判据）：body 峰值 = uColor×1.15（G 0.276）；湿唇/孢尖叠加后由
// 保色缩放压到最大通道 0.5。
export const mossCreepShade = Fn(([vUv, uProg, uColor, uSeed]) => {
  const p = vUv.sub(vec2(0.5));
  const x = p.x.add(float(0.5));                     // 0(苔球)→1(玩家向)
  const lat = p.y.add(float(0.5));                   // 横向 0..1
  // 推进段 0→72% 走完全程（爬得快→慢压迫），其后锋面驻留远端——留出「缠上」的读秒
  const adv = clamp(uProg.mul(1.389), 0.0, 1.0);
  const baseHead = adv.mul(0.92).add(0.06);
  // ---- cell hash 场（非周期：值噪声双线性插值，边界有机）----
  const hash1 = (t) => fract(sin(t.mul(127.1).add(uSeed.mul(3.17))).mul(43758.585));
  const hash2 = (ix, iy) => fract(sin(ix.mul(12.9898).add(iy.mul(78.233)).add(uSeed.mul(0.731))).mul(43758.585));
  const vn1 = (t) => {
    const i = floor(t);
    const f = fract(t);
    const w = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
    const a = hash1(i);
    return a.add(hash1(i.add(1)).sub(a).mul(w));
  };
  const vn2 = (qx, qy) => {
    const ix = floor(qx), iy = floor(qy);
    const fx = fract(qx), fy = fract(qy);
    const wx = fx.mul(fx).mul(float(3.0).sub(fx.mul(2.0)));
    const wy = fy.mul(fy).mul(float(3.0).sub(fy.mul(2.0)));
    const a = hash2(ix, iy);
    const b = hash2(ix.add(1), iy);
    const c = hash2(ix, iy.add(1));
    const d = hash2(ix.add(1), iy.add(1));
    const top = a.add(b.sub(a).mul(wx));
    const bot = c.add(d.sub(c).mul(wx));
    return top.add(bot.sub(top).mul(wy));
  };
  // ---- 前缘指瓣（6 根独立指，cell hash 定宽/长/错峰相位；max 融合 + 指间真缝）----
  const LN = float(6.0);
  const lq = lat.mul(LN);
  const li = floor(lq);
  const hW = hash1(li.add(float(0.37)));
  const hL = hash1(li.add(float(7.13)));
  const hP = hash1(li.add(float(13.7)));
  const hC = hash1(li.add(float(23.3)));
  const uc = li.add(float(0.5)).div(LN).add(hC.sub(float(0.5)).mul(float(0.03)));
  const wid = float(0.025).add(hW.mul(float(0.025)));        // 半宽 0.025..0.05（全宽 0.05..0.10v）
  const dLat = lat.sub(uc).div(wid);
  const bandI = oneMinus(smoothstep(float(0.55), float(1.0), dLat.mul(dLat)));
  const grow = smoothstep(0.0, 0.30, clamp(adv.add(hP.sub(float(0.5)).mul(float(0.20))), 0.0, 1.0));
  const flen = float(0.025).add(hL.mul(float(0.085)));       // 指长 0.025..0.11（x 归一）
  // 基线粗糙（1D 值噪声 ≈4 段，非周期）+ 指瓣融合；指端用抛物线收圆（平台状带缘
  // 会读成锯齿梳，苔的指瓣是圆头的）；端头钳在 quad 内
  const rough = vn1(lat.mul(float(4.0))).sub(float(0.5)).mul(float(0.03));
  const fingerK = oneMinus(dLat.mul(dLat)).clamp(0.0, 1.0);
  const head = min(baseHead.add(rough).add(fingerK.mul(grow).mul(flen)), float(0.985));
  const rel = head.sub(x);
  // 苔毯：越过即留（不再衰减成雾）；纵向中线厚两侧薄
  const mat = smoothstep(float(-0.015), float(0.012), rel);
  const ay = p.y.mul(2.0);
  const band = exp(ay.mul(ay).mul(-0.9));
  // 斑块场：双尺度值噪声叠加 → 阈值化（大斑 + 小斑、覆盖率不均）；细颗粒再破一层
  // 平滑感（苔的颗粒质地，不是雾的渐变）
  const nL = vn2(x.mul(3.0), lat.mul(3.0));
  const nS = vn2(x.mul(9.0).add(float(11.7)), lat.mul(9.0).add(float(5.3)));
  const nF = vn2(x.mul(26.0).add(float(3.1)), lat.mul(20.0).add(float(7.7)));
  const patch = smoothstep(float(0.26), float(0.50), nL.mul(0.62).add(nS.mul(0.38)));
  const patchB = float(0.30).add(patch.mul(float(0.70)));    // 暗苔斑 0.30..1.0× 主色（覆盖率不均）
  const grain = float(0.78).add(nF.mul(float(0.22)));
  // 生长差：锋后新苔略亮（近锋 1.0），越过沉为暗毯（0.65）
  const age = oneMinus(smoothstep(0.0, 0.18, rel));
  const growth = float(0.65).add(age.mul(0.35));
  // 整件末段退场（苔干枯消散）
  const fade = oneMinus(smoothstep(float(0.82), float(1.0), uProg));
  // 湿唇：窄亮一线（只贴当前锋线）；孢尖：指端小亮斑
  const lip = exp(rel.mul(rel).mul(-700.0)).mul(band).mul(fade);
  const tipX = min(baseHead.add(rough).add(flen.mul(grow)), float(0.985));
  const dTip = x.sub(tipX);
  const tip = exp(dTip.mul(dTip).mul(-1400.0))
    .mul(exp(dLat.mul(dLat).mul(-5.0)))
    .mul(grow).mul(bandI).mul(fade);
  const hot = max(lip.mul(float(0.60)), tip);
  const edge = oneMinus(smoothstep(float(0.42), float(0.50), abs(p.x)))
    .mul(oneMinus(smoothstep(float(0.40), float(0.50), abs(p.y))));
  const body = mat.mul(band).mul(fade).mul(growth).mul(patchB).mul(grain);
  // 峰值纪律（用户裁定「整体输出峰值 ≤0.5」）：体 + 湿唇/孢尖是加色叠加，体峰值
  // 0.276 与亮斑叠加会越 0.5——**保色缩放**（按最大通道等比压到 0.5）收口，
  // 不逐通道钳（三通道同超会洗成灰白，scaleDust 五审教训）。
  const raw = uColor.mul(body.mul(1.15))
    .add(vec3(0.45, 0.62, 0.30).mul(hot.mul(float(0.78))));
  const pk = max(max(raw.x, raw.y), raw.z).add(1e-4);
  const rgb = raw.mul(min(float(1.0), float(0.5).div(pk)));
  return vec4(rgb.mul(edge), float(1.0));
});

/**
 * 贴地蔓延爬苔（dir = ±1 漫向）。quad 背缘贴 at（苔球），width = 波程（调用方按
 * 实际间距取——size 不足会让锋面半途消失）。返回 { promise, arriveU }——
 * arriveU = 锋面爬过 dist 对应的 uProg（0..1），抵达拍按此定时刻。
 */
export function mossCreep(ctx, deps, {
  at, dir = 1, color = [0.16, 0.24, 0.11], size = 20.0, ms = 900, dist = null,
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
  at, color = [0.17, 0.26, 0.12], size = 8.0, ms = 380,
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

// ============ 喉囊充气（pufferInflate 鼓气主体，迭代 #16 蓄力语言重做）============
// 材料真相 = **充气**：喉囊一层层鼓起、气压积聚到膜面绷紧。旧 chargeOrb 的径向光球
// 无材料（用户终审「有点抽象」）——本件三圈错相位泡膜：每圈 = 膜亮边 + 半透明泡体 +
// 左上高光弧（球面立体感），圈间胀速/极限/相位各异，从小逐层胀大；末圈到极限时
// 膜面绷紧（窄亮膜线增亮 = 临界读感）→ 最外泡膜崩为小半径快环脉冲一记（约 260ms
// 窗口，尺寸远小于 wailRing 全向广播环），随后编排接既有峰压声波环。
// 色/相位烘常量，Fn 2 参（vUv/uProg）；峰值保色缩放收口 ≤0.85（泡体哑光更低）。
export function makeThroatPuffShade([cr, cg, cb], seed) {
  const col = vec3(cr, cg, cb);
  // 膜色保持材质色相（绿档偏绿，不洗成中性白）
  const mem = vec3(
    Math.min(0.90, cr * 1.06 + 0.10),
    Math.min(0.96, cg * 1.05 + 0.10),
    Math.min(0.78, cb * 0.96 + 0.04),
  );
  const bub = ([vUv, uProg], cx, cy, delay, dur, r0, r1, ph, wgt, tautK, bulge) => {
    const p = vUv.sub(vec2(0.5)).sub(vec2(cx, cy));
    const r = length(p).mul(2.0);
    const a = atan(p.y, p.x);
    // 涨速非匀速：easeOut（先快后慢，膜被气压撑开），圈间 delay/dur/极限各异
    const g = clamp(uProg.sub(float(delay)).div(float(dur)), 0.0, 1.0);
    const ge = g.mul(float(2.0).sub(g));
    // 膜面微颤 + 角向鼓包（整数频率，切口连续）：膜被气压顶得不规则，不是几何圆；
    // 外圈 bulge 更大（泡往喉前下方鼓）
    const tremble = sin(uProg.mul(52.0).add(float(ph))).mul(0.0045).mul(g)
      .mul(oneMinus(smoothstep(0.72, 0.98, ge)));
    const lobe = sin(a.mul(3.0).add(float(ph))).mul(0.015)
      .add(sin(a.mul(5.0).sub(float(ph * 1.7))).mul(0.008))
      .add(sin(a.sub(float(0.9))).mul(float(bulge)))
      .mul(ge);
    // 下坠感：喉囊是挂着的袋子，下半鼓得更多（蛋形，不是几何圆）
    const bottom = clamp(p.y.mul(-1.0).div(float(r1).add(0.001)).mul(0.5).add(0.5), 0.0, 1.0);
    const egg = bottom.mul(bottom).mul(0.10).mul(ge).add(1.0);
    const rr = float(r0).add(float(r1 - r0).mul(ge)).add(lobe).add(tremble).mul(egg);
    const dr = r.sub(rr);
    // 膜 = 窄亮边 + 外侧薄膜光 + 内侧第二线（膜厚读感，不是一根发丝线）；
    // 膜线随胀大收紧（软边 → 紧绷的窄亮线）
    const line = exp(dr.mul(dr).mul(float(-500.0).sub(ge.mul(900.0)))).mul(float(0.62).add(ge.mul(0.50)));
    const film = exp(dr.mul(dr).mul(-420.0)).mul(0.14);
    const inner = exp(dr.add(float(0.012)).mul(dr.add(float(0.012))).mul(-2600.0)).mul(0.55);
    // 半透明泡体：**边缘厚、中心透**（泡膜掠射亮 / 中心留空 = 读「泡」不读「发光球」）
    const fill = oneMinus(smoothstep(rr.sub(float(0.012)), rr, r));
    const rimK = smoothstep(0.30, 1.0, r.div(rr.add(0.001)));
    const grad = clamp(p.x.mul(-0.34).add(p.y.mul(0.52)).div(rr.add(0.001)).mul(0.30).add(0.62), 0.0, 1.0);
    // 左上高光弧（hdot^4 收成一条窄弧，只贴在膜内缘）+ 右下反光弧（泡膜两处受光）；
    // 膜线本身按上亮下暗打光（球面立体）
    const lit = clamp(p.x.mul(-0.50).add(p.y.mul(0.75)).div(rr.add(0.001)), 0.0, 1.0);
    const hdot = clamp(p.x.mul(-0.52).add(p.y.mul(0.70)).div(rr.add(0.001)), 0.0, 1.0);
    const spec = hdot.mul(hdot).mul(hdot).mul(hdot);
    const rev = clamp(p.x.mul(0.42).add(p.y.mul(-0.55)).div(rr.add(0.001)), 0.0, 1.0);
    const spec2 = rev.mul(rev).mul(rev).mul(rev).mul(rev);
    // 末圈绷紧：ge 到顶 → 极窄亮膜线增亮（tautK 只最后一圈为 1）
    const taut = smoothstep(0.88, 1.0, ge).mul(float(tautK));
    const tautLine = exp(dr.mul(dr).mul(-8000.0)).mul(taut);
    return col.mul(fill.mul(grad).mul(rimK.mul(0.85).add(0.15)).mul(float(wgt)))
      .add(mem.mul(line).mul(lit.mul(1.15).add(0.42)))
      .add(mem.mul(film).mul(0.6))
      .add(mem.mul(inner).mul(lit.mul(0.55).add(0.55)))
      .add(mem.mul(spec.mul(exp(dr.mul(dr).mul(-300.0))).mul(3.0)))
      .add(mem.mul(spec2.mul(exp(dr.mul(dr).mul(-700.0))).mul(0.7)))
      .add(mem.mul(tautLine.mul(2.2)));
  };
  return Fn(([vUv, uProg]) => {
    const p = vUv.sub(vec2(0.5));
    const r = length(p).mul(2.0);
    // 三圈错位（泡在喉囊里往不同方向鼓）+ 错相位胀大
    const acc = bub([vUv, uProg], -0.006, -0.006, 0.00, 0.38, 0.10, 0.34, seed * 1.7, 0.075, 0.0, 0.020)
      .add(bub([vUv, uProg], 0.028, 0.010, 0.08, 0.34, 0.09, 0.54, seed * 2.9 + 2.1, 0.085, 0.0, 0.045))
      .add(bub([vUv, uProg], 0.052, -0.014, 0.14, 0.36, 0.08, 0.77, seed * 4.3 + 4.7, 0.095, 1.0, 0.075));
    // 破圈：泡体在 0.56→0.70 退净（爆前的膜内收）
    const bubbleFade = oneMinus(smoothstep(0.56, 0.70, uProg));
    // 破圈前兆：外膜崩为小半径快环（0.18→0.54，约 260ms 窗口——远小于 wailRing；
    // 起于 0.58×900ms=522ms，领先 pufferInflate 的峰压声波环（560ms）半个拍子）
    const rp = smoothstep(0.58, 0.84, uProg).mul(0.36).add(0.18);
    const drp = r.sub(rp);
    const ringP = exp(drp.mul(drp).mul(-1200.0)).mul(1.4)
      .add(exp(drp.mul(drp).mul(-160.0)).mul(0.30));
    const ruptEnv = smoothstep(0.58, 0.62, uProg).mul(oneMinus(smoothstep(0.82, 0.90, uProg)));
    const pop = mem.mul(ringP).mul(ruptEnv);
    // 包络纪律：born 淡入 + 尾段退场（uProg=1 前全零才 release）
    const born = smoothstep(0.0, 0.05, uProg);
    const tail = oneMinus(smoothstep(0.90, 1.0, uProg));
    const raw = acc.mul(bubbleFade).add(pop);
    // 峰值保色缩放收口 ≤0.85（三通道同超时等比压，色相不洗灰）
    const pk = max(max(raw.x, raw.y), raw.z).add(1e-4);
    const rgb = raw.mul(min(float(1.0), float(0.85).div(pk)));
    const edge = oneMinus(smoothstep(float(0.42), float(0.50), abs(p.x)))
      .mul(oneMinus(smoothstep(float(0.42), float(0.50), abs(p.y))));
    return vec4(rgb.mul(born).mul(tail).mul(edge), float(1.0));
  });
}

/**
 * 喉囊充气（竖直 billboard，at = 喉锚 0.42H）。吸气尘 = 体前 4 粒慢速弧线吸向
 * 口部（方向语义向内；充气是内向动作，灯峰值压低 ≤300）。编排在峰值声波环之前
 * 调用，件内破圈前兆落在 uProg 0.58→0.90（约 522→810ms）。
 */
export async function throatPuff(ctx, deps, {
  at, h = 22, dir = 1, color = [0.72, 0.95, 0.45], ms = 900, lampIntensity = 280,
}) {
  if (!at) return;
  const uProg = uniform(0.0);
  const seed = Math.random() * 6.28 + 0.01;
  const { quad, release } = spellQuad({
    shade: makeThroatPuffShade(color, seed)(uvOf(), uProg),
    width: h * 0.72, height: h * 0.60, name: 'spellFx:throatPuff',
  });
  quad.position.set(at.x, at.y, (at.z ?? 0) + 1.2);
  deps.scene.add(quad);
  ctx.onKill(() => release());
  // 吸气尘：气流从体前被吸向喉口（3-5 粒、慢速、内向——不是外溢）
  const s = Math.max(0.7, h / 22);
  ctx.spawn(async (c) => {
    for (let i = 0; i < 4; i++) {
      if (i > 0) await c.wait(140);
      const ox = (2.6 + i * 0.75) * s;
      deps.particles?.spawn?.(at.x + dir * ox, at.y + (i % 2 ? 0.55 : -0.35) * s, {
        color: 0x9ab878, count: 1, speed: 0.85, size: 0.85, ttl: 0.8,
        gravity: 0.2, z: at.z ?? 0, vx: (-dir * ox) / 0.75, vy: 0.4,
      });
    }
  });
  lampPulse(ctx, deps, {
    name: 'light:fx0', at: { x: at.x, y: at.y, z: (at.z ?? 0) + 1.5 }, color,
    peak: Math.min(300, lampIntensity), attackMs: Math.round(ms * 0.35), decayMs: Math.round(ms * 0.5),
  });
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'linear',   // 进度即时间（破圈/绷紧窗口按真实时刻落位）
    onUpdate: () => { uProg.value = st.t; },
    onComplete: () => release(),
  });
}

// ============ 坠尘旋进（通用蓄力档，迭代 #16 蓄力语言重做）============
// 材料真相 = **重量与角动量**：重心压进地面、尘被卷起绕体旋进。与 gatherFocus
// （径向内汇光带）、rageSwell（搏动边光）三分——本档读「越转越快的重」：
// 两条不同倾角的椭圆轨道光尘带（带内粗尘粒 hash 亮斑沿轨跑，环面纹理随相位转），
// 角速度随进程上升（JS 积分相位——频率 ramp，不写 sin(k·t) 假加速）；脚下贴地
// 暗尘环向内收拢（重量把尘压吸向身体）。色金土（0.8/0.68/0.45 派生），峰值保色
// 收口 ≤0.85；地面环压得更低（暗尘）。
export function makeWeightSwirlShade([cr, cg, cb], seed) {
  const col = vec3(cr, cg, cb);
  const hot = vec3(
    Math.min(0.98, cr * 1.20 + 0.10),
    Math.min(0.95, cg * 1.14 + 0.10),
    Math.min(0.90, cb * 1.12 + 0.06),
  );
  // 每带 4 颗粗尘粒：角偏移非均布（一颗主尘团更亮更大——旋转的可读锚）
  const motes = [];
  const moteAng = [0.15, 1.65, 2.90, 4.40];
  for (let i = 0; i < moteAng.length; i++) {
    const a = seed + moteAng[i] + (i % 2 ? 0.16 : -0.12);
    motes.push({
      ca: Math.cos(a), sa: Math.sin(a),
      jit: 0.94 + ((i * 0.618) % 1) * 0.10,
      tw: seed + i * 2.3,
      sigma: i === 0 ? 0.033 : 0.021 + ((i * 0.37) % 1) * 0.010,
      k: i === 0 ? 1.35 : 0.75,
    });
  }
  const bandOf = ([p, uProg, uTheta], A, B, tilt, spd, ph, wgt, heavy) => {
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    // 椭圆轨道（倾斜）：局部系归一距离 q = 椭圆隐式距离
    const x = p.x.mul(ct).add(p.y.mul(st));
    const y = p.y.mul(ct).sub(p.x.mul(st));
    const q = length(vec2(x.div(float(A)), y.div(float(B)))).sub(1.0);
    const ang = atan(y, x);
    // 近侧（面镜头半边）更亮更宽——环带的 3D 倾角读感
    const near = cos(ang.sub(float(seed))).mul(0.5).add(0.5);
    const line = exp(q.mul(q).mul(-160.0)).mul(near.mul(0.5).add(0.5)).mul(0.78);
    const halo = exp(q.mul(q).mul(-26.0)).mul(0.22);
    // 环面尘纹随相位转（角频整数，切口连续）——带本身也在转；高频 grain 破开
    // 平滑绳带感（读「尘带」不读「光绳」）
    const tex = sin(ang.mul(3.0).sub(uTheta.mul(spd)).add(float(ph))).mul(0.5).add(0.5);
    const grain = sin(ang.mul(23.0).add(q.mul(41.0)).sub(uTheta.mul(spd * 2.7)).add(float(seed * 3.1)))
      .mul(0.5).add(0.5);
    const bandK = line.mul(tex.mul(0.38).add(0.62)).mul(grain.mul(0.46).add(0.54)).add(halo);
    // 粗尘粒：在椭圆上以同一相位推进（角速度 ramp 由 uTheta 承担）
    let bits = float(0.0);
    for (const m of motes) {
      const th = uTheta.mul(spd).add(float(ph));
      const c = float(m.ca).mul(cos(th)).sub(float(m.sa).mul(sin(th))).mul(float(m.jit));
      const sn = float(m.sa).mul(cos(th)).add(float(m.ca).mul(sin(th))).mul(float(m.jit));
      const ex = float(A).mul(c), ey = float(B).mul(sn);
      const wx = ex.mul(ct).sub(ey.mul(st));
      const wy = ex.mul(st).add(ey.mul(ct));
      const dx = p.x.sub(wx), dy = p.y.sub(wy);
      const tw = sin(uProg.mul(16.0).add(float(m.tw))).mul(0.30).add(0.85);
      bits = bits.add(exp(dx.mul(dx).add(dy.mul(dy)).mul(float(-0.5 / (m.sigma * m.sigma))))
        .mul(tw).mul(float(m.k)));
    }
    return col.mul(bandK.mul(float(wgt))).add(hot.mul(bits.mul(heavy ? 0.80 : 0.52)));
  };
  return Fn(([vUv, uProg, uTheta]) => {
    const p = vUv.sub(vec2(0.5));
    const acc = bandOf([p, uProg, uTheta], 0.40, 0.165, 0.42, 0.90, seed * 1.4, 1.0, true)
      .add(bandOf([p, uProg, uTheta], 0.335, 0.140, -0.46, 1.45, seed * 2.6 + 3.1, 0.72, false));
    const born = smoothstep(0.0, 0.10, uProg);
    const tail = oneMinus(smoothstep(0.80, 1.0, uProg));
    const raw = acc;
    const pk = max(max(raw.x, raw.y), raw.z).add(1e-4);
    const rgb = raw.mul(min(float(1.0), float(0.78).div(pk)));
    const edge = oneMinus(smoothstep(float(0.44), float(0.50), abs(p.x)))
      .mul(oneMinus(smoothstep(float(0.44), float(0.50), abs(p.y))));
    return vec4(rgb.mul(born).mul(tail).mul(edge), float(1.0));
  });
}

// 贴地坠尘环：暗尘圈从占地外缘缓慢向内收拢（uProg 二次 = 越收越快），角向尘团
// （整数频率）+ 向内卷的螺旋纹；中心压暗（尘被身体压吸走）。峰值压 ≤0.5（暗尘）。
export function makeWeightDustRingShade([cr, cg, cb], seed) {
  const col = vec3(cr, cg, cb);
  return Fn(([vUv, uProg]) => {
    const p = vUv.sub(vec2(0.5));
    const r = length(p).mul(2.0);
    const a = atan(p.y, p.x);
    const pull = uProg.mul(uProg);                 // 内收：慢起、尾段加快
    const R = float(0.86).sub(pull.mul(0.50));
    const dr = r.sub(R);
    const ring = exp(dr.mul(dr).mul(-80.0)).mul(0.55);
    const skirt = exp(dr.mul(dr).mul(-16.0)).mul(0.18);
    const mot = sin(a.mul(5.0).add(float(seed))).mul(0.5).add(0.5)
      .mul(sin(a.mul(9.0).sub(float(seed * 1.7))).mul(0.5).add(0.5));
    const streak = sin(a.mul(7.0).add(r.mul(7.0)).sub(uProg.mul(5.0))).mul(0.5).add(0.5);
    const dust = ring.add(skirt)
      .mul(mot.mul(0.45).add(0.55))
      .mul(streak.mul(0.35).add(0.65));
    const env = smoothstep(0.0, 0.08, uProg).mul(oneMinus(smoothstep(0.86, 1.0, uProg)));
    const raw = col.mul(dust);
    const pk = max(max(raw.x, raw.y), raw.z).add(1e-4);
    const rgb = raw.mul(min(float(1.0), float(0.50).div(pk)));
    const edge = oneMinus(smoothstep(float(0.46), float(0.50), length(p)));
    return vec4(rgb.mul(env).mul(edge), float(1.0));
  });
}

/**
 * 坠尘旋进（at = 脚位；h = 单位视觉高）。竖直 billboard 轨道带 + 贴地内收尘环 +
 * 地上几粒向内吸的坠尘。角速度 ramp 走 JS 积分相位（uTheta += dt·(2.2+9.5p)）。
 * 返回 promise（tween 走完，含双件回收）。
 */
export function weightSwirl(ctx, deps, {
  at, h = 22, color = [0.80, 0.68, 0.45], ms = 900, lampIntensity = 340,
}) {
  if (!at) return Promise.resolve();
  const uProg = uniform(0.0);
  const uTheta = uniform(0.0);
  const uRing = uniform(0.0);
  const seed = Math.random() * 6.28 + 0.01;
  const { quad, release } = spellQuad({
    shade: makeWeightSwirlShade(color, seed)(uvOf(), uProg, uTheta),
    width: h * 1.28, height: h * 0.98, name: 'spellFx:weightSwirl',
  });
  quad.position.set(at.x, at.y + h * 0.46, (at.z ?? 0) + 1.2);
  quad.userData.probe = { uProg, uTheta };   // 探针读口（像素自评判核对相位 ramp）
  deps.scene.add(quad);
  ctx.onKill(() => release());
  const ringCol = new THREE.Color(color[0] * 0.62, color[1] * 0.60, color[2] * 0.58);
  const ring = spellQuad({
    shade: makeWeightDustRingShade([ringCol.r, ringCol.g, ringCol.b], seed + 1.3)(uvOf(), uRing),
    width: h * 0.95, height: h * 0.95, name: 'spellFx:weightDustRing',
  });
  ring.quad.position.set(at.x, at.y + 0.2, (at.z ?? 0) + 0.6);
  ring.quad.rotation.x = -Math.PI / 2;             // 贴地（groundRing 同位法）
  deps.scene.add(ring.quad);
  ctx.onKill(() => ring.release());
  // 坠尘粒子：地上几粒被压吸向身体（横向内向初速；有物理动机）
  const R = h * 0.36;
  for (const side of [-1, 1]) {
    deps.particles?.spawn?.(at.x + side * R, at.y + 0.4, {
      color: 0x9a8058, count: 2, speed: 1.4, size: 1.1, ttl: 1.05, gravity: -1,
      z: at.z ?? 0, vx: -side * 2.2, vy: 0.5,
    });
  }
  lampPulse(ctx, deps, {
    name: 'light:fx0', at: { x: at.x, y: at.y + h * 0.45, z: (at.z ?? 0) + 1.5 }, color,
    peak: Math.min(320, lampIntensity), attackMs: 160, decayMs: 480,
  });
  const st = { t: 0 };
  let last = performance.now();
  return ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'linear',   // 进度即时间；角速度 ramp 在下面积分
    onUpdate: () => {
      const now = performance.now();
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      const p = st.t;
      uTheta.value += dt * (2.2 + 9.5 * p);   // 频率 ramp（积分相位纪律）
      uProg.value = p;
      uRing.value = p;
      // 重心随进程压进地面（轨道中心微沉——「重」的身体语言）
      quad.position.y = at.y + h * (0.46 - 0.03 * p);
    },
    onComplete: () => { release(); ring.release(); },
  });
}

// ============ 落地尘（hunker / crouch heavy / 卷甲落定的地面反馈）============
// 迭代 #16 全域化：尘分布宽 = 身体占地（迭代 #10 病根）——旧版中心 radial 两层 =
// 单位中心一个小点冒烟（用户终审「离谱」）。现按 unit._groundRadius 撒 5 点全域
// 错峰（48ms 步进）：两侧 ±0.78R 主股横向挤出、头侧 1 股偏重、尾侧 1 股、身下 1
// 小股；每点的快层迸射与慢层浮尘都带**该点位的向外水平初速**（vx 沿占地外推，
// 不是全向 radial）。
export function dustLanding(ctx, deps, {
  at, unit = null, dir = 1, color = 0xb0a088, count = 16, lampIntensity = 0,
}) {
  if (!at) return Promise.resolve();
  const R = unit?._groundRadius ?? 5;
  const z = at.z ?? 0;
  const y = at.y;
  const pts = [
    { x: -0.78 * R, vx: -1.0, w: 1.0 },             // 左主股（横向挤出）
    { x: 0.78 * R, vx: 1.0, w: 1.0 },               // 右主股
    { x: dir * 0.60 * R, vx: dir * 0.80, w: 1.3 },  // 头侧（偏重）
    { x: -dir * 0.50 * R, vx: -dir * 0.55, w: 0.8 },// 尾侧
    { x: 0, vx: 0, w: 0.6 },                        // 身下小股
  ];
  const wSum = pts.reduce((a, p) => a + p.w, 0);
  const job = ctx.spawn(async (c) => {
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) await c.wait(48);                  // 48ms 步进：尘沿占地错峰扫开
      const p = pts[i];
      const n = Math.max(2, Math.round((count * p.w) / wSum));
      const vx = p.vx * 11;
      // 快层：迸射粗粒（横向挤出速度为主）
      deps.particles?.spawn?.(at.x + p.x, y + 0.55, {
        color, count: n, speed: 8.5, size: 1.35, ttl: 0.5, gravity: -20, z, vx,
      });
      // 慢层：浮尘（同向但更弱的低平漂移，双层结构保持）
      deps.particles?.spawn?.(at.x + p.x, y + 0.75, {
        color, count: Math.max(1, Math.round(n * 0.6)), speed: 3.0, size: 2.0,
        ttl: 1.25, gravity: -3, z, vx: vx * 0.42,
      });
    }
  });
  if (lampIntensity > 0) {
    lampPulse(ctx, deps, {
      name: 'light:fx1', at: { x: at.x, y: y + 1, z: z + 1 }, color: [0.85, 0.75, 0.6],
      peak: lampIntensity, attackMs: 60, decayMs: 240,
    });
  }
  return job.promise;
}

// ============ 竖刺（bristleFx 主体，迭代 #13）============
// 受惊的刺猬把刺啪地竖起——轮廓从圆滑变锯齿、光在刺尖上走。角域畸变造不均距
// 刺列，每刺长度双频抖动；竖起带角域相位差（一排排弹起）；刺 = 体缘椭圆外推的
// 细锥射线（弧宽随进度收紧 = 尖端细）；tip 热斑随起立闪烁。色/相位烘常量，
// Fn 2 参（vUv/uRise）。包络纪律（#12）：淡入起 / 尾 1/4 退。
export function makeQuillRiseShade([cr, cg, cb], seed) {
  const col = vec3(cr, cg, cb);
  return Fn(([vUv, uRise]) => {
    const p = vUv.sub(vec2(0.5));
    const r = length(p).mul(2.0);                    // 0 中心 → 1 画布缘
    const a = atan(p.y, p.x);
    // 角域畸变（不均距）+ 长度抖动（双频烘常量）
    // 角频率全整数（切口连续纪律，#15）：畸变 3/5、长度 3×8 组合——不规则靠相位
    const aw = a.add(sin(a.mul(3.0).add(float(seed))).mul(0.32))
      .add(sin(a.mul(5.0).sub(float(seed * 2.0))).mul(0.18));
    const lenJ = sin(aw.mul(3.0).add(float(seed * 3.0))).mul(0.5).add(0.5)
      .mul(sin(aw.mul(8.0).add(float(seed))).mul(0.5).add(0.5)).mul(0.5).add(0.75); // 0.75..1.25
    // 体缘（宽扁椭圆两瓣调制）与刺长
    const base = float(0.54).sub(cos(a.mul(2.0)).mul(0.07));
    const L = float(0.30).mul(lenJ);
    // 竖起扫掠：角域相位差 + power 收锋（snap）
    const k = sin(aw.mul(2.0).sub(float(seed))).mul(0.5).add(0.5).mul(0.28);
    const rise = clamp(uRise.mul(1.9).sub(k), 0.0, 1.0);
    const tip = base.add(L.mul(pow(rise, float(0.7))));
    // 刺轨：最近刺的角距（弧长近似）→ 锥形截面（越靠尖越窄）
    const rail = fract(aw.mul(float(24.0 / (Math.PI * 2)))).sub(0.5);
    const dArc = rail.mul(r);
    const s = clamp(r.sub(base).div(tip.sub(base).add(float(1e-4))), 0.0, 1.0);
    const widK = float(300.0).add(s.mul(500.0));
    const xsec = exp(dArc.mul(dArc).mul(widK).mul(-1.0));
    const shaft = smoothstep(0.0, 0.18, s).mul(oneMinus(pow(s, float(0.35))));
    const quill = xsec.mul(shaft).mul(smoothstep(0.02, 0.06, rise));   // 未竖起的刺不可见
    // 刺尖走光：tip 热斑 × 起立期间闪烁
    const dtip = r.sub(tip);
    const glint = exp(dtip.mul(dtip).mul(-2400.0)).mul(rise).mul(rise)
      .mul(sin(uRise.mul(24.0).add(aw.mul(3.0))).mul(0.3).add(0.8));
    const env = smoothstep(0.0, 0.10, uRise).mul(oneMinus(smoothstep(0.78, 1.0, uRise)));
    const edge = oneMinus(smoothstep(float(0.46), float(0.50), length(p)));
    const rgb = col.mul(quill.mul(1.15)).add(col.mul(xsec.mul(shaft).mul(glint).mul(1.4)))
      .add(vec3(1.25, 1.18, 0.95).mul(glint.mul(2.4)));
    return vec4(rgb.mul(env).mul(edge), float(1.0));
  });
}

/** 竖刺（at = 脚位；h = 单位视觉高。画布 1.7×h 宽、1.3×h 高——刺要伸出轮廓）。 */
export function quillRise(ctx, deps, { at, h = 22, color = 0xd8c060, ms = 880 }) {
  if (!at) return null;
  const uRise = uniform(0.0);
  const seed = Math.random() * 6.28 + 0.01;
  const c = new THREE.Color(color);
  const { quad, release } = spellQuad({
    shade: makeQuillRiseShade([c.r, c.g, c.b], seed)(uvOf(), uRise),
    width: h * 1.7, height: h * 1.3, name: 'spellFx:quillRise',
  });
  quad.position.set(at.x, at.y + h * 0.52, (at.z ?? 0) + 1.2);
  deps.scene.add(quad);
  ctx.onKill(() => { release(); });
  const st = { t: 0 };
  const promise = ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'power3.out',   // 刺是弹起来的（snap 起手）
    onUpdate: () => { uRise.value = st.t; },
    onComplete: () => { release(); },
  });
  return { promise };
}

// ============ 甲片合缝（hardenFx 主体，迭代 #14）============
// 甲虫硬化 = 背甲甲片逐层锁合：剪影椭圆域内径向×角域分带成梯形甲片（角域畸变
// 去均格），uSeal 自底缘向上扫——每层锁合瞬间缝线热闪 + 片面整亮一拍；合完短窗
// 保持各片 hash 微差亮度（甲片 specular 差异）后淡出。色/相位烘常量，Fn 2 参。
export function makePlateSealShade([cr, cg, cb], seed) {
  const col = vec3(cr, cg, cb);
  return Fn(([vUv, uSeal]) => {
    const p = vUv.sub(vec2(0.5));
    // 剪影椭圆域（宽扁：x 半轴 0.36 / y 半轴 0.42）
    const r2 = p.x.mul(p.x).mul(7.7).add(p.y.mul(p.y).mul(5.7));
    const inside = oneMinus(smoothstep(0.90, 1.0, r2));
    // 分带：径向 3 层 × 角域 7 区（畸变去均格）
    const a = atan(p.y, p.x);
    const aw = a.add(sin(a.mul(3.0).add(float(seed))).mul(0.35));   // 整数频率（切口连续，#15）
    const band = clamp(floor(r2.mul(2.6)), 0.0, 2.0);
    const sec = aw.mul(float(7.0 / (Math.PI * 2))).add(float(4.0)); // 整数扇区数
    const sector = floor(sec);
    // 片面 hash 微差
    const hsh = fract(sin(band.mul(12.99).add(sector.mul(78.23)).add(float(seed))).mul(437.585));
    // 合缝扫掠：自底缘向上（vn 0 底 → 1 顶），层间再错相位
    const vn = clamp(p.y.mul(2.0).add(1.0), 0.0, 1.0);
    const seal = clamp(uSeal.mul(1.6).sub(vn.mul(0.45).add(band.mul(0.16))), 0.0, 1.0);
    const sealed = smoothstep(0.05, 0.35, seal);            // 片面亮起（锁合完成）
    const flash = exp(seal.sub(0.75).mul(seal.sub(0.75)).mul(-260.0));  // 锁合瞬间的窄峰
    // 缝线：带间 + 区间边界的亮线
    const fb = fract(r2.mul(2.6));
    const db = oneMinus(abs(fb.sub(0.5)));                   // 距边界 0..0.5
    const seamR = exp(db.mul(db).mul(-140.0));
    const fs = fract(sec);
    const ds = oneMinus(abs(fs.sub(0.5)));
    const seamS = exp(ds.mul(ds).mul(-120.0));
    const seam = seamR.add(seamS);
    // 组装：锁住的片面（hash 微差）+ 锁合闪（缝线强化）+ 暖热缝线
    const plate = col.mul(sealed.mul(hsh.mul(0.22).add(0.30)));
    const rgb = plate
      .add(col.mul(flash).mul(sealed).mul(0.8))
      .add(vec3(1.2, 1.08, 0.88).mul(flash.mul(seam).mul(2.6)));
    const env = smoothstep(0.0, 0.08, uSeal).mul(oneMinus(smoothstep(0.80, 1.0, uSeal)));
    return vec4(rgb.mul(env).mul(inside), float(1.0));
  });
}

/** 甲片合缝（at = 脚位；h = 单位视觉高。画布 1.5×h 宽、1.1×h 高贴剪影）。 */
export function plateSeal(ctx, deps, { at, h = 22, color = 0xb0a890, ms = 620 }) {
  if (!at) return null;
  const uSeal = uniform(0.0);
  const seed = Math.random() * 6.28 + 0.01;
  const c = new THREE.Color(color);
  const { quad, release } = spellQuad({
    shade: makePlateSealShade([c.r, c.g, c.b], seed)(uvOf(), uSeal),
    width: h * 1.5, height: h * 1.1, name: 'spellFx:plateSeal',
  });
  quad.position.set(at.x, at.y + h * 0.52, (at.z ?? 0) + 1.2);
  deps.scene.add(quad);
  ctx.onKill(() => { release(); });
  const st = { t: 0 };
  const promise = ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'power2.inOut',   // 锁合是机械的（匀进、末段压）
    onUpdate: () => { uSeal.value = st.t; },
    onComplete: () => { release(); },
  });
  return { promise };
}


// ============ 汇流纹（聚能 gatherFocus 主体，ENEMY_FX.md 迭代#3）============
// 以胸口焦点为中心的螺旋内流光带：极角随半径偏转（内圈偏转多 = 吸积感）；
// 双频 sin 复合幂次锐化出不等宽亮带（随机相位/频率每实例烘焙——构造期字面量
// 进节点图，严禁等距均布）；亮带只存在于收束头部以内，头部亮唇 + 内向渐亮；
// 焦点小亮核随 uCharge 阶梯增亮。Fn 3 参（vUv/uProg/uCharge），色与相位烘常量。
export function makeDrainVeinsShade([cr, cg, cb], seed, f1, f2, swirlK) {
  // 角频率一律取整（atan ±π 切口连续纪律）：非整数 k 的 sin(k·a) 在分支切割
  // 线上相位跳变 = 一条径向裂缝（gatherFocus「四象限裂纹」根因，#15）。
  // 不规则感由整数频率组合 + seed 相位 + 乘法锐化承担。
  const F1 = Math.max(2, Math.round(f1));
  const F2 = Math.max(2, Math.round(f2));
  return Fn(([vUv, uProg, uCharge]) => {
    const p = vUv.sub(vec2(0.5, 0.40));                 // 焦点：quad 中下（胸口位）
    const r = length(p).mul(2.0);
    const a0 = atan(p.y, p.x);
    const sw = a0.add(float(swirlK).mul(oneMinus(r))); // 螺旋偏转
    const l1 = sin(sw.mul(float(F1)).add(float(seed))).mul(0.5).add(0.5);
    const l2 = sin(sw.mul(float(F2)).sub(float(seed).mul(1.7))).mul(0.5).add(0.5);
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

// ============ 湿苔迸裂（苔球命中主体，ENEMY_FX.md 迭代#17）============
// 材料真相：湿重的植物团被砸中**碎开**——不是「中心一撮圆点只换色」。
// 竖直 billboard（rz=0）：
//   ① 5 瓣异径湿苔块：双高斯并集 + 整数角频率径向调制（3/5/7/2 次）出凹凸有机边，
//      瓣各带横纵异径/鼓包偏移（构造期 hash 落常量）。运动 = 沿各自方向外抛后
//      **重坠**：y = up·u − drop·u²（下坠项随 uProg² 加速），不是径向匀散。
//   ② 2 根断须（设计 2-3 根）：采样 S 弯的胶囊链（任走向都连续、无虚断），
//      随碎屑甩出后垂到碎块下沿，湿亮芯线窄用。
//   ③ 底部湿渍溅幕：贴命中下缘的小溅幕，中心随 uProg 下移（下坠主导）。
//   ④ 首 25% 深绿汁液湿核一闪即收（汁液色 [0.3,0.45,0.2]，不亮）。
// 色系与 mossCreep v2 同源：深湿绿 [0.16,0.24,0.11] 派生 + 湿亮边 [0.45,0.62,0.30]
// 窄用。峰值保色缩放收口按 G>200=0 口径取 ≤0.5（0.85 HDR 经 neutral tone 后
// G≈230 会越线；0.5 与 mossCreep v2 的实测口径一致）。包络：born 淡入 + 尾段
// （0.78→1）退场，uProg=1 前全零才 release；单次脉冲无循环。
export function makeMossBurstShade([cr, cg, cb], seed) {
  const col = vec3(cr, cg, cb);
  const wet = vec3(0.45, 0.62, 0.30);      // 湿亮边（窄用，常量烘进节点图）
  const juice = vec3(0.30, 0.45, 0.20);    // 汁液核闪（不亮）
  const ASPECT = 0.90;                     // quad 高/宽（世界等比换算）
  const hash = (i, k) => {
    const v = Math.sin(seed * 12.9898 + i * 78.233 + k * 37.719) * 43758.5453;
    return v - Math.floor(v);
  };
  // 瓣参数（构造期落常量：节点图里没有逐帧随机）
  const LOBES = [];
  for (let i = 0; i < 5; i++) {
    const side = i - 2;                    // −2..2：两翼为主，一瓣近中
    LOBES.push({
      dirx: side === 0
        ? (hash(i, 0) > 0.5 ? 0.34 : -0.34)
        : Math.sign(side) * (0.52 + 0.48 * hash(i, 1)),
      up: 0.01 + 0.05 * hash(i, 2),
      drop: 0.55 + 0.25 * hash(i, 3),      // 重坠量（uv y，uProg² 加速下行）
      throwK: 0.36 + 0.20 * hash(i, 4),    // 水平抛程（瓣间真分离）
      x0: (hash(i, 13) - 0.5) * 0.06,      // 起爆点微散（开场即碎片团，不是一整块）
      r: 0.065 + 0.035 * hash(i, 5),
      squash: 0.62 + 0.55 * hash(i, 6),
      wob: 0.18 + 0.10 * hash(i, 7),
      ph1: seed * 1.7 + i * 2.13 + hash(i, 8) * 3.1,
      ph2: seed * 2.9 + i * 4.37 + hash(i, 9) * 3.1,
      ph3: seed * 4.1 + i * 5.71 + hash(i, 12) * 3.1,
      lumpX: (hash(i, 10) - 0.5) * 1.0,
      lumpY: (hash(i, 11) - 0.5) * 0.8,
    });
  }
  const TENDRILS = [0, 1].map((i) => {
    const ph = seed * 1.3 + i * 2.4 + hash(i, 24) * 3.0;
    // 10 点采样 = 9 段胶囊（sin S 弯的横向偏移在构造期烘成常量：节点图里没有
    // 逐点 sin；密采样让弯曲连续，不会像 3 段直线那样读成折线）
    const pts = [];
    for (let k = 0; k <= 9; k++) {
      const t = k / 9;
      pts.push({ t, w: Math.sin(t * Math.PI * 2 + ph) * Math.sin(t * Math.PI) });
    }
    return {
      rootX: (i ? 0.12 : -0.12) + (hash(i, 27) - 0.5) * 0.04,
      rootY: -0.05 + hash(i, 28) * 0.03,       // 根藏在碎块里（只露下沿以下）
      reach: (i ? 1 : -1) * (0.18 + 0.05 * hash(i, 21)),
      tipY: -0.34 - 0.06 * hash(i, 22),        // 下垂终点（前 50% 展开到位后驻留）
      bow: 0.025 + 0.02 * hash(i, 23),
      w: 0.022 + 0.005 * hash(i, 25),
      k: 1.15 + 0.20 * hash(i, 26),
      pts,
    };
  });
  const lobeOf = (L, p, uProg) => {
    const u2 = uProg.mul(uProg);
    const cx = float(L.x0).add(float(L.dirx * L.throwK).mul(uProg));
    const cy = float(0.02 + L.up).mul(uProg).sub(u2.mul(float(L.drop)));
    const qx = p.x.sub(cx);
    const qy = p.y.sub(cy).mul(float(ASPECT));
    const qxs = qx.mul(float(L.squash));
    const r0 = length(vec2(qxs, qy));
    const a = atan(qy, qxs);
    // 整数角频率（atan 切口连续）：三频叠加 = 凹凸有机边，非几何圆
    const bump = sin(a.mul(3.0).add(float(L.ph1))).mul(float(L.wob))
      .add(sin(a.mul(5.0).add(float(L.ph2))).mul(float(L.wob * 0.55)))
      .add(sin(a.mul(7.0).add(float(L.ph3))).mul(float(L.wob * 0.15)))
      .add(sin(a.mul(2.0).sub(float(L.ph2))).mul(float(L.wob * 0.40)));
    const edgeR = float(L.r).mul(bump.add(1.0));
    const rn = r0.div(edgeR);
    const solid = oneMinus(smoothstep(0.86, 1.0, rn));   // 更硬的湿块边
    // 第二高斯（瓣上的鼓包，偏移中心）——双高斯并集让边界出现局部隆起
    const ox = qx.sub(float(L.r * L.lumpX)).mul(float(1.35));
    const oy = qy.sub(float(L.r * L.lumpY));
    const r2 = length(vec2(ox, oy)).div(float(L.r * 0.55));
    const bump2 = oneMinus(smoothstep(0.84, 1.0, r2)).mul(0.70);
    const body = max(solid, bump2);
    const inner = oneMinus(smoothstep(0.0, 0.86, rn));
    // 苔的湿颗粒感（低频斑驳，不吃掉整体形）
    const grain = sin(qx.mul(34.0).add(float(L.ph1))).mul(sin(qy.mul(29.0).sub(float(L.ph2))))
      .mul(0.10).add(0.90);
    // 受光（左上湿亮、右下暗）——团块厚度读感
    const lit = clamp(qx.mul(-0.7).add(qy.mul(1.1)).div(edgeR.add(float(0.001)))
      .mul(0.5).add(0.5), 0.0, 1.0);
    // 湿亮边只留受光侧窄窄一线（全环亮边会让每瓣读成空心圈/环）
    const litWet = smoothstep(0.45, 1.0, lit);
    const rim = exp(rn.sub(float(0.93)).mul(rn.sub(float(0.93))).mul(-110.0));
    const fade = oneMinus(smoothstep(0.60, 1.0, uProg));    // 淡出随坠（末段才收）
    return col.mul(body).mul(inner.mul(0.45).add(0.50)).mul(lit.mul(0.45).add(0.55)).mul(grain)
      .add(wet.mul(body).mul(rim).mul(litWet).mul(float(0.42)))
      .mul(fade);
  };
  const tendrilOf = (T, p, uProg) => {
    // 断须 = 采样 S 弯 + 胶囊链。**不能写 x=f(y) 窄条**：S 中段近水平时逐行采样
    // 会断成虚点；胶囊链在任意走向都连续。**不能只用 3 段直线**：折角读成碎块轮廓
    // （三审教训）——10 点采样 + 段宽重叠出平滑弯条。
    const grow = smoothstep(0.06, 0.34, uProg);
    const rootX = float(T.rootX);
    // 断须整体：甩出（x 随 grow 展开）→ 下垂（y 随 droop 伸到固定终点后驻留）
    const droop = smoothstep(0.05, 0.50, uProg);
    const rootY = float(T.rootY);
    const ty = rootY.add(float(T.tipY).sub(rootY).mul(droop));
    const tipX = rootX.add(float(T.reach).mul(grow));
    const nodes = T.pts.map((s) => ({
      x: rootX.add(tipX.sub(rootX).mul(float(s.t))).add(grow.mul(float(T.bow * s.w))),
      y: rootY.add(ty.sub(rootY).mul(float(s.t))),
      w: T.w * (1 - 0.35 * s.t),
    }));
    const segOf = (a, b) => {
      const ex = b.x.sub(a.x), ey = b.y.sub(a.y);
      const wx = p.x.sub(a.x), wy = p.y.sub(a.y);
      const t = clamp(wx.mul(ex).add(wy.mul(ey)).div(ex.mul(ex).add(ey.mul(ey)).add(float(1e-4))), 0.0, 1.0);
      const dx = wx.sub(ex.mul(t)), dy = wy.sub(ey.mul(t));
      const w = float(a.w);
      return exp(dx.mul(dx).add(dy.mul(dy)).div(w.mul(w)).mul(-1.2));
    };
    let strip = segOf(nodes[0], nodes[1]);
    for (let k = 1; k < nodes.length - 1; k++) strip = max(strip, segOf(nodes[k], nodes[k + 1]));
    const core = strip.mul(strip).mul(strip).mul(strip).mul(strip);   // 湿亮芯线（正底幂）
    return col.mul(strip.mul(float(T.k)))
      .add(wet.mul(core).mul(float(T.k * 0.35)))
      .mul(smoothstep(0.04, 0.16, uProg));
  };
  return Fn(([vUv, uProg]) => {
    const p = vUv.sub(vec2(0.5));
    let acc = vec3(0.0, 0.0, 0.0);
    for (const L of LOBES) acc = acc.add(lobeOf(L, p, uProg));
    let tend = vec3(0.0, 0.0, 0.0);
    for (const T of TENDRILS) tend = tend.add(tendrilOf(T, p, uProg));
    // 底部湿渍溅幕：贴命中下缘的**下宽扇形**（不是软椭圆光斑）——下缘随 uProg
    // 下移（下坠主导），竖向细纹破开整片平滑感
    const fallShift = uProg.mul(uProg).mul(float(0.10));          // 溅幕整体随碎块下坠
    const down = max(float(0.0), float(0.0).sub(p.y.add(float(0.06)).add(fallShift)));
    const reachD = float(0.08).add(uProg.mul(float(0.04))).add(uProg.mul(uProg).mul(float(0.22)));
    const spread = down.mul(float(1.15)).add(float(0.05));
    const fan = oneMinus(smoothstep(0.60, 1.0, abs(p.x).div(spread)))
      .mul(smoothstep(0.0, 0.03, down))
      .mul(oneMinus(smoothstep(reachD.mul(0.65), reachD, down)));
    const runnel = sin(p.x.mul(85.0).add(float(seed * 3.1))).mul(0.25).add(0.75);
    const splashEnv = smoothstep(0.02, 0.10, uProg).mul(oneMinus(smoothstep(0.50, 0.85, uProg)));
    const sheet = fan.mul(runnel).mul(splashEnv);
    // 首 25%：深绿汁液湿核一闪即收（不亮、无白芯）
    const r = length(vec2(p.x, p.y.mul(float(ASPECT))));
    const coreEnv = smoothstep(0.0, 0.03, uProg).mul(oneMinus(smoothstep(0.14, 0.25, uProg)));
    const core = exp(r.mul(r).mul(-60.0)).mul(coreEnv);
    // 包络：born 淡入 + 尾段退场（uProg=1 前全零才 release）
    const born = smoothstep(0.0, 0.05, uProg);
    const tail = oneMinus(smoothstep(0.78, 1.0, uProg));
    // 峰值保色缩放：按最大通道等比压到 0.5（G>200=0 口径，见段头注）
    const raw = acc.add(tend)
      .add(col.mul(sheet).mul(float(1.5)))
      .add(juice.mul(core));
    const pk = max(max(raw.x, raw.y), raw.z).add(1e-4);
    const rgb = raw.mul(min(float(1.0), float(0.50).div(pk)));
    const edge = oneMinus(smoothstep(0.46, 0.50, abs(p.x)))
      .mul(oneMinus(smoothstep(0.46, 0.50, abs(p.y))));
    return vec4(rgb.mul(born).mul(tail).mul(edge), float(1.0));
  });
}

/**
 * 湿苔迸裂（竖直 billboard，命中点）。size 按伤害档给（重击更大）。
 * 命中主题 garnish 是 fire-and-forget——调用方若挂父 beat 的 ctx，punchImpact
 * 收尾的 onKill 会把仍在坠的苔块提前摘除；本件不自建生命周期，由调用方给独立
 * 短协程（见 chapter1 苔球主题）。
 */
export async function mossBurst(ctx, deps, {
  at, size = 15.0, ms = 380, color = [0.16, 0.24, 0.11], seed = null,
}) {
  if (!at) return;
  const uProg = uniform(0.0);
  // 种子量化到 8 档：瓣参数/相位是构造期常量（烘进 WGSL），连续随机种子会让
  // 每次命中都编译一条新管线（实测首帧 stall 130ms+）。8 档覆盖视觉变化，
  // 管线在首轮内复用；调试可传固定 seed。
  const sd = seed ?? 0.01 + Math.floor(Math.random() * 8) * 0.7854;
  const { quad, release } = spellQuad({
    shade: makeMossBurstShade(color, sd)(uvOf(), uProg),
    width: size, height: size * 0.90, name: 'spellFx:mossBurst',
  });
  quad.position.set(at.x, at.y, (at.z ?? 0) + 1.2);
  quad.userData.probe = { uProg };   // 探针读口（等进度窗重坠取证）
  deps.scene.add(quad);
  ctx.onKill(() => release());
  const st = { t: 0 };
  await ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'linear',   // 进度即时间（重坠曲线在 shader 里）
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

// ============ 鳞粉锋（妖蝶振翅甩粉主体，章2 迭代#1）============
// 世界 Y 截面 ribbon 沿 3D 航线（13 行顶点直写世界坐标——战场敌我纵深 dz 可达 70，
// 平面旋转 quad 只按 dx/dy 算长会在屏幕上悬空中断）。粉体**源端全程连贯**
//（翅源源拖粉，首版 tail 随锋头把源端抹掉 = 蝶端断路）；锋头**线性匀速**推进
//（粉是慢介质，前冲+驻留会让白核压在玩家身上）；**星点走独立 cell hash 通道**
//（乘在粉体亮度上会被中带削顶吞掉——星只在带缘暗部显）。色/热烘常量，Fn 2 参。
// 前缘轮廓由 5 团椭圆瓣形**直接调制轮廓**（不是亮度叠加）：团心越过 head、团尖
// 探出，团间留真缝 = 指状粉团。星点网格按 ribbon 世界长宽比给 v 向密度，屏上
// 近方形（六审：竖针根因 = u/v 高斯系数不对称）。
export function makeScaleDustShade([cr, cg, cb], seed, [hr, hg, hb], aspect = 14.0) {
  const col = vec3(cr, cg, cb);
  const hot = vec3(hr, hg, hb);
  const asp = Math.min(40, Math.max(4, aspect));
  return Fn(([vUv, uProg]) => {
    const p = vUv.sub(vec2(0.5));
    const v = p.y.add(float(0.5));                     // 0 蝶端 → 1 玩家端
    const u = p.x;                                     // 截面（世界 Y）
    // 内部低速流动：采样 v 加一层低频偏移场（密度斑块在带内缓慢挪动，不与几何
    // 蜿蜒同频——几何摆动 + 内部翻涌叠出「粉在飘」）；只用于密度/位置判断采样，
    // edge/env 的 v 保持原始值（退场分层要严格跟 v 走）
    const vOff = v.add(sin(v.mul(9.0).add(uProg.mul(12.0))).mul(0.02));
    // 锋头推进：线性匀速走完全程（uProg=1 时 adv=1，无驻留段）
    const adv = clamp(uProg.mul(1.06), 0.0, 1.0);
    const hv = adv.mul(0.92).add(0.05);
    // 前缘基线：锋线随截面双频位移（指状前缘的底形）
    const f1 = sin(u.mul(8.0).add(float(seed))).mul(0.5).add(0.5);
    const f2 = sin(u.mul(19.0).sub(float(seed * 1.7))).mul(0.5).add(0.5);
    const head = hv.add(f1.mul(f1).mul(0.09)).add(f2.mul(0.05));
    const rel = head.sub(vOff);
    // 粉体主体：锋后连贯（源端不断），锋前短过渡归零（轮廓交给瓣团）
    const body = smoothstep(float(-0.024), float(0.014), rel);
    // 前缘瓣团（5 团异位异径）：椭圆掩码**直接进轮廓**——团心越过 head、
    // 团尖探出约 0.10v，max 联合团间留真缝。六审核心根因 = 旧版高斯指数符号
    // 写反（exp(+d²) 在团外指数爆炸）→ 保色钳制被撑爆，整条束体削成恒色平顶。
    const lumpMask = (i) => {
      const uc = float(-0.36 + i * 0.18).add(sin(float(seed + i * 2.7)).mul(0.045));
      const ru = float(0.060 + 0.026 * Math.abs(Math.sin(seed + i * 1.9)));
      const rv = float(0.040 + 0.022 * Math.abs(Math.cos(seed * 1.3 + i * 1.1)));
      const vc = head.add(float(0.012 + 0.032 * Math.abs(Math.sin(seed * 1.7 + i * 0.9))));
      const du = u.sub(uc).div(ru);
      const dv = vOff.sub(vc).div(rv);
      const d2 = du.mul(du).add(dv.mul(dv));
      return oneMinus(smoothstep(float(0.55), float(1.0), d2));
    };
    const lumps = max(max(max(lumpMask(0), lumpMask(1)), max(lumpMask(2), lumpMask(3))), lumpMask(4));
    // 轮廓 = 主体 ∪ 瓣团：团外 body 归零、团间保留真缝（形态学差异，非亮度差异）
    const shape = max(body, lumps);
    // 斑驳 + 截面带 + 沿轴翻涌行波（幅度 0.45 / 频率 13：翻涌更明显、波长更长）
    const bl = sin(vOff.mul(17.0).add(u.mul(23.0)).add(float(seed))).mul(0.5).add(0.5)
      .mul(sin(vOff.mul(29.0).sub(u.mul(13.0)).sub(float(seed * 2.3))).mul(0.5).add(0.5));
    const uu = u.mul(2.0);
    const band = exp(uu.mul(uu).mul(-0.85));
    const flow = sin(vOff.mul(13.0).sub(uProg.mul(26.0))).mul(0.5).add(0.5).mul(0.45).add(0.55);
    const mottle = bl.mul(0.85).add(0.30);             // 0.30..1.15：亮度峰值压在钳制帽下
    // 鳞闪（独立通道）：cell hash 星点——网格按 ribbon 世界长宽比（aspect≈14.5）
    // 给 v 向密度（单元屏上近方形），高斯两轴同系数 → 星斑近方形（六审：5:1 竖针）
    const gu = floor(u.mul(8.0));
    const gvN = 8.0 * asp;
    const gv = floor(v.mul(gvN));
    const hA = fract(sin(gu.mul(12.9898).add(gv.mul(78.233))).mul(43758.585));
    const hB = fract(sin(gu.mul(39.346).add(gv.mul(11.135))).mul(24634.6345));
    const cu = fract(u.mul(8.0));
    const cv2 = fract(v.mul(gvN));
    const dxs = cu.sub(hA);
    const dys = cv2.sub(hB);
    const star = exp(dxs.mul(dxs).add(dys.mul(dys)).mul(-30.0))
      .mul(smoothstep(0.70, 0.74, hB));
    const tw = sin(uProg.mul(38.0).add(hA.mul(6.283))).mul(0.5).add(0.5);
    // 包络：born 淡入 + **尾随分层消散**（蝶端先散、玩家端后散：v 越大退场窗
    // 越晚）。整窗 uProg 0.55→1.0，uProg=1 时全带归零 = scaleDust 的 release 时刻
    // 与真正归零对齐（旧版 0.78→0.94 齐淡 + 0.94 提前 release = 整带齐灭）。
    const k0 = float(0.55).add(v.mul(0.30));           // 0.55..0.85
    const k1 = float(0.80).add(v.mul(0.20));           // 0.80..1.00
    const fadeLocal = oneMinus(smoothstep(k0, k1, uProg));
    const env = smoothstep(0.0, 0.05, uProg)
      .mul(smoothstep(0.0, 0.22, uProg))
      .mul(fadeLocal);
    const edge = oneMinus(smoothstep(float(0.42), float(0.50), abs(u)))
      .mul(oneMinus(smoothstep(float(0.40), float(0.50), abs(p.y))));
    const dust = shape.mul(band).mul(mottle).mul(flow);
    // 瓣团略实一点（前缘的粉更密），但不再有整线亮唇
    const frontGlow = lumps.mul(band).mul(mottle.mul(0.5).add(0.5));
    // 输出纪律（五审教训：逐通道 min 钳在 0.85 = 三通道同超时输出中性灰白，
    // ACES 后 233 白墙换皮且洗掉粉紫色）——**保色缩放**：按峰值通道等比缩到帽内，
    // 色相保留；只有星点保留 HDR 过 bloom 阈（鳞片反光起晕）
    const bodySum = col.mul(dust.mul(0.96)).add(col.mul(frontGlow.mul(0.18)));
    const peak = max(max(bodySum.x, bodySum.y), bodySum.z).add(1e-4);
    const clamped = bodySum.mul(min(float(1.0), float(0.85).div(peak)));
    const rgb = clamped
      .add(hot.mul(star.mul(tw).mul(shape).mul(band).mul(oneMinus(dust.mul(0.55))).mul(1.85)));
    return vec4(rgb.mul(env).mul(edge), float(1.0));
  });
}

/**
 * 振翅鳞粉锋（粉从蝶翅飘向玩家）。**世界 Y 截面 ribbon 沿 3D 航线**（顶点直写
 * 世界坐标，两端各带真实 z——战场敌我纵深 dz 可达 70，平面旋转 quad 只按
 * dx/dy 算长会在屏幕上悬空中断、两端不接蝶与玩家）。带体升级为 1×12 段：
 * 沿航线的每列顶点叠加**水平蜿蜒 wob(t)**（源端锚定归零、离开蝶后渐起），
 * 相位随行进积分（ω≈2.2 rad/s）——粉带在飞行途中持续飘摆，不是静态弯。
 * linear 匀速（粉是慢介质，ease 曲线会让 arriveU 时刻换算失真）。返回
 * { promise, arriveU }——arriveU = 锋头过身对应的 uProg（0..1），抵达拍按
 * arriveU × ms 定时刻。
 */
export function scaleDust(ctx, deps, {
  from, to, color = [0.46, 0.42, 0.64], hot = [0.89, 0.82, 0.82], height = 5.5, ms = 680,
}) {
  if (!from || !to) return { promise: Promise.resolve(), arriveU: 0.7 };
  const dx = to.x - from.x, dy = to.y - from.y, dz = (to.z ?? 0) - (from.z ?? 0);
  const dist = Math.hypot(dx, dy, dz) || 1;
  const ux = dx / dist, uy = dy / dist, uz = dz / dist;
  const back = 1, fore = 1.5;   // 蝶后 1（贴翅缘）/ 玩家后 1.5（锋面过身即收，白核不压进身体）
  const a = { x: from.x - ux * back, y: from.y - uy * back, z: (from.z ?? 0) - uz * back };
  const len = dist + back + fore;
  const vTarget = (dist + back - 0.5) / len;
  const arriveU = Math.min(0.95, Math.max(0.2, (vTarget - 0.05) / 0.92 / 1.06));
  const uProg = uniform(0.0);
  const seed = Math.random() * 6.28 + 0.01;
  // 蜿蜒摆动轴 = 航线的水平垂直向量（摆动是水平的，世界 Y 是带的截面方向）
  let perpX = -uz, perpZ = ux;
  const perpLen = Math.hypot(perpX, perpZ);
  if (perpLen < 1e-6) { perpX = 1; perpZ = 0; } else { perpX /= perpLen; perpZ /= perpLen; }
  const SEG = 12;               // 沿航线 12 段（13 行 × 2 顶点）
  const WOBBLE_A = 2.5;         // 世界单位：飘幅（读「飘」不读「扭」）
  const WOBBLE_F = 1.2;         // 沿带波长数
  const WOBBLE_OMEGA = 2.2;     // rad/s：相位积分速度（活摆）
  const { quad, geo, release } = spellQuad({
    shade: makeScaleDustShade(color, seed, hot, len / height)(uvOf(), uProg),
    width: 1, height: 1, segX: 1, segY: SEG, name: 'spellFx:scaleDust',
  });
  // PlaneGeometry(1,1,1,SEG) 行序 iy=0..SEG，uv.y=1-iy/SEG——行 iy=0 是 v=1 玩家端、
  // iy=SEG 是 v=0 蝶端；每行两顶点（y±h2）。v=1 玩家端 / v=0 蝶端，截面沿世界 Y
  //（quad 变换恒等，顶点即世界坐标）。
  const h2 = height / 2;
  const pos = geo.attributes.position;
  const writeBand = (phase) => {
    for (let iy = 0; iy <= SEG; iy++) {
      const t = 1 - iy / SEG;
      // 锚定包络：t=0（蝶端）完全不动（粉连着翅），t≥0.18 后摆动满幅
      const anchor = Math.sin(Math.PI * 0.5 * Math.min(1, t / 0.18));
      const wob = WOBBLE_A * Math.sin(t * Math.PI * 2 * WOBBLE_F + phase) * anchor;
      const cx = a.x + ux * len * t + perpX * wob;
      const cy = a.y + uy * len * t;
      const cz = a.z + uz * len * t + perpZ * wob;
      const i = iy * 2;
      pos.setXYZ(i, cx, cy - h2, cz);
      pos.setXYZ(i + 1, cx, cy + h2, cz);
    }
    pos.needsUpdate = true;
  };
  let phase = seed;
  writeBand(phase);
  // 顶点会铺满整个战场，1×1 的旧包围球会把整件按原点视锥裁掉——关视锥剔除
  quad.frustumCulled = false;
  deps.scene.add(quad);
  ctx.onKill(() => release());
  let lastTs = performance.now();
  const st = { t: 0 };
  const promise = ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'linear',   // 粉匀速飘（ease 曲线会让 arriveU 时刻换算失真）
    onUpdate: () => {
      const now = performance.now();
      phase += Math.min(0.1, Math.max(0, (now - lastTs) / 1000)) * WOBBLE_OMEGA;
      lastTs = now;
      uProg.value = st.t;
      writeBand(phase);
      // 尾随消散到 uProg=1 才真正全零（tweenRaw 会吞掉调用方的 onComplete，
      // 收尾必须走 onUpdate 路径；onComplete 仅作后备）
      if (st.t >= 0.999) release();
    },
    onComplete: () => release(),
  });
  return { promise, arriveU };
}

// ============ 抵达粉晕（妖蝶洗虚无的沾染拍，章2 迭代#1）============
// 玩家身周一蓬粉晕：径向软扩散团（内部弥散填充 + 环缘碎粉）+ cell hash 星点 +
// 抵达一闪。四审判定：r=2 归一下 R 只到 0.45 → 直径 0.45×size，半身高都不到——
// 环径按「直径 ≈ 玩家身高」反推（R 0.35→0.80 + 外缘熄灭放宽到 1.0-1.3）；
// 可见窗按目标反推（fadeIn 8% + 满程 67% + 退场 25% × 460ms）。
// 六审：fill 旧版乘高对比 bl（均值 0.25）且权重低于 rim → 中心只剩环缘的
// 0.3-0.6，读成护盾环。改为**低频连续径向填充**（不乘 bl）且 fill 权重 > rim。
export function makeArriveDustShade([cr, cg, cb], seed, [hr, hg, hb]) {
  const col = vec3(cr, cg, cb);
  const hot = vec3(hr, hg, hb);
  return Fn(([vUv, uProg]) => {
    const p = vUv.sub(vec2(0.5));
    const r = length(p).mul(2.0);
    // 扩散粉团前沿（软环——R 顶到 0.80，外缘熄灭带相应放宽）
    const R = uProg.mul(0.45).add(0.35);
    const dr = r.sub(R);
    const puff = exp(dr.mul(dr).mul(-70.0)).mul(oneMinus(smoothstep(float(1.0), float(1.3), r)));
    // 内部填充：低频连续径向函数（中心→R 平滑衰减）+ 低频云影轻微浓淡
    const low = sin(p.x.mul(5.0).add(float(seed))).mul(0.5).add(0.5)
      .mul(cos(p.y.mul(4.0).sub(float(seed * 1.4))).mul(0.5).add(0.5));
    const fill = oneMinus(smoothstep(R.mul(0.18), R.mul(0.96), r))
      .mul(low.mul(0.35).add(0.65));
    // 环缘碎粉（低幅斑驳只做边缘碎感，不进内部亮度）
    const bl = sin(p.x.mul(21.0).add(p.y.mul(17.0)).add(float(seed))).mul(0.5).add(0.5)
      .mul(sin(p.x.mul(13.0).sub(p.y.mul(27.0)).sub(float(seed * 2.1))).mul(0.5).add(0.5));
    const rim = puff.mul(bl.mul(0.30).add(0.70));
    // 星点（cell hash，与鳞粉锋同法；屏上近方形）
    const gu = floor(p.x.mul(10.0));
    const gv = floor(p.y.mul(10.0));
    const hA = fract(sin(gu.mul(12.9898).add(gv.mul(78.233))).mul(43758.585));
    const hB = fract(sin(gu.mul(39.346).add(gv.mul(11.135))).mul(24634.6345));
    const cu = fract(p.x.mul(10.0));
    const cv2 = fract(p.y.mul(10.0));
    const dxs = cu.sub(hA);
    const dys = cv2.sub(hB);
    const star = exp(dxs.mul(dxs).add(dys.mul(dys)).mul(-140.0))
      .mul(smoothstep(0.70, 0.74, hB));
    const tw = sin(uProg.mul(30.0).add(hA.mul(6.283))).mul(0.5).add(0.5);
    // 抵达一闪（中心热核前段快闪）
    const rr = r.mul(r);
    const core = exp(rr.mul(-110.0)).mul(oneMinus(smoothstep(0.0, 0.30, uProg)));
    // 涨落窗：快进（8%）→ 满程保持（67%）→ 退场（25%）
    const env = smoothstep(0.0, 0.08, uProg).mul(oneMinus(smoothstep(0.75, 1.0, uProg)));
    const edge = oneMinus(smoothstep(float(0.44), float(0.50), length(p)));
    // 输出：填充权重 0.90 > 环缘 0.46（中心亮于环缘，不再读成空心护盾环）
    const sum = col.mul(fill.mul(0.90)).add(col.mul(rim.mul(0.46)));
    const pk = max(max(sum.x, sum.y), sum.z).add(1e-4);
    const rgb = sum.mul(min(float(1.0), float(0.85).div(pk)))
      .add(hot.mul(star.mul(tw).mul(max(fill, rim)).mul(1.5)))
      .add(hot.mul(core).mul(1.4));
    return vec4(rgb.mul(env).mul(edge), float(1.0));
  });
}

/** 抵达粉晕（竖直 billboard，at = 玩家胸口位；size 由调用方按玩家身高传）。
 *  drift = {dx, dy}：起拍后整体沿航线前向再掠（position 补间 power2.out 340ms，
 *  与涨落并行）——粉从脸前扫过的「拂面」尾劲。 */
export async function arriveDust(ctx, deps, {
  at, color = [0.46, 0.42, 0.64], hot = [0.89, 0.82, 0.82], size = 22.0, ms = 460,
  drift = null,
}) {
  if (!at) return;
  const uProg = uniform(0.0);
  const seed = Math.random() * 6.28 + 0.01;
  const { quad, release } = spellQuad({
    shade: makeArriveDustShade(color, seed, hot)(uvOf(), uProg),
    width: size, height: size, name: 'spellFx:arriveDust',
  });
  const x0 = at.x, y0 = at.y, z0 = (at.z ?? 0) + 2.5;
  quad.position.set(x0, y0, z0);   // 玩家前侧（别藏进立牌后）
  deps.scene.add(quad);
  ctx.onKill(() => release());
  const st = { t: 0 };
  const jobs = [ctx.tweenRaw(st, { t: 1 }, {
    durationMs: ms, ease: 'linear',   // uProg 与真实时间同速：涨落窗按设计比例铺开
    onUpdate: () => { uProg.value = st.t; },
    onComplete: () => release(),
  })];
  if (drift && (drift.dx || drift.dy)) {
    jobs.push(ctx.tweenRaw(quad, { x: x0 + drift.dx, y: y0 + drift.dy },
      { durationMs: 340, ease: 'power2.out' }));   // 起步快、收尾缓：拂过脸前就散
  }
  await Promise.all(jobs);
}
