// 施术演出 shader 库（TSL——WebGPU 迁移后内嵌 shader 的唯一写法，范式抄
// CardFxLayer 的 veil/edgeGlow：MeshBasicNodeMaterial + colorNode 全量接管输出）。
// TA 纪律（2026-09-30 用户定）：好看的特效大部分靠 shader 写，geometry transform
// 只做辅助——面片只是画布，形状/扫掠/拖尾/渐隐全在 fragment 里算。
// 纪律：WGSL smoothstep 一律正向写法（反向边用 oneMinus）；无控制流（纯算术）；
// 加色混合（additiveLight，rgb 直出、alpha 恒 1）；核心推过 bloom 阈 1.45 起晕。
import {
  Fn, uniform, uv, select,
  vec2, vec4, float, pow, abs, sin, length, exp, smoothstep, oneMinus,
} from 'three/tsl';

/**
 * 刀光斩痕（新月扫掠带）：
 *  · 形状 = 弓形中心线（刀走弧线）+ 两端收尖的新月带（厚度沿 x 变化）；
 *  · 横截面双带：窄热核（推 HDR）+ 宽色缘；
 *  · 纵向 = 扫掠头（随 uProgress 推进的锐亮前沿 + 命中尖峰）+ 指数拖尾
 *    （头前缘 smoothstep 正向截断：未扫过区域严格为 0）；
 *  · 细条纹调制（刀锋流光的方向感）+ 全局尾段渐隐。
 * @param vUv       quad uv
 * @param uProgress 0..1 扫掠进度（block 侧 tween 推 uniform）
 * @param uColor    vec3 核心色（线性；峰值 ~2.4×HDR）
 * @param uFringe   vec3 色缘（银白冷光一类）
 * @param uArc      float 中心线弓高（0=直带）
 * @param uDir      float 扫掠方向（+1 左→右；-1 翻转）
 */
export const slashShade = Fn(([vUv, uProgress, uColor, uFringe, uArc, uDir, uDbg]) => {
  const p = vUv.sub(vec2(0.5));
  const x = p.x.mul(uDir);
  const y = p.y;
  const yc = uArc.mul(x.mul(x).mul(4.0).sub(1.0));
  // 沿 x 的收尖（新月：两端薄、中段厚）——直接调制各层宽度
  const taper = oneMinus(pow(abs(x.mul(2.0)), float(2.5)));
  const thin = taper.mul(0.55).add(0.45);   // 宽度系数 0.45..1
  // 截面用**显式宽度**（UV 单位）分层——塞进一条薄带里核/晕/影互相挤压读不出层次：
  //   热核 ~4px 细线（HDR 白）、aura 3 倍宽冷蓝裙（阈下辉光）、画布高 5 世界单位给裙展开空间
  const dyC = abs(y.sub(yc)).div(thin.mul(float(0.085)));   // 核宽 0.085uv ≈ 4px
  const core = exp(dyC.mul(dyC).mul(-1.0));
  const dyA = abs(y.sub(yc)).div(thin.mul(float(0.27)));    // 裙宽 3.2×核
  const fringe = exp(dyA.mul(dyA).mul(-1.0));
  // 纵向扫掠包络：头部推进（-0.75 → 0.95，越过带端读「斩出」）
  const head = uProgress.mul(1.7).sub(0.75);
  const rel = head.sub(x);
  const front = smoothstep(float(-0.10), float(0.04), rel);   // 头前缘截断（正向写法）
  const tail = exp(rel.mul(-6.5)).mul(front);                 // 拖尾衰减（亮刃短于暗缝）
  const spike = exp(rel.mul(rel).mul(-60.0)).mul(front);       // 命中前沿尖峰
  // 全局尾段渐隐 + 起手淡入
  const fade = oneMinus(smoothstep(float(0.70), float(1.0), uProgress))
    .mul(smoothstep(float(0.0), float(0.10), uProgress));
  // 细条纹（刀锋流光）
  const stri = sin(y.mul(36.0).add(x.mul(7.0))).mul(0.5).add(0.5).mul(0.45).add(0.7);
  const energy = tail.add(spike.mul(5.0)).mul(fade);   // 头部尖峰系数即「最热」担当
  // ⚠ TSL 实测坑：中间量（const 节点）被最终表达式**二次引用**会输出全黑
  // （spike 曾同时进 energy 与 rgb 第三项，画面即黑；d 的双引用子树反而无事）。
  // 头部热度已由包络里的 spike 系数承担，rgb 不再单独引用 spike。
  const rgb = uFringe.mul(fringe.mul(1.6)).add(uColor.mul(core.mul(stri).mul(10.0)));
  const out = vec4(rgb.mul(energy), float(1.0));
  // 排障可视化（spelldebug=shape/energy）：分段输出中间量定位黑屏项
  return select(uDbg.greaterThan(float(2.5)), vec4(uColor, float(1.0)),   // 排障：颜色 uniform 直读
    select(uDbg.greaterThan(float(1.5)), vec4(energy, energy, energy, float(1.0)),
      select(uDbg.greaterThan(float(0.5)), vec4(core, fringe, stri, float(1.0)), out)));
});

/**
 * 暗切口层（刀光的暗伴层）：亮敌人（浅灰立绘）上纯加色读不出对比——贴核的
 * 窄软阴影垫一层对比（α 低幅、宽 ~1.2×核）。独立 Fn 独立 uniforms，不与亮层
 * 共享节点（TSL 中间量跨表达式复用有实测黑屏坑）。
 */
export const darkSlashShade = Fn(([vUv, uProgress, uArc, uDir]) => {
  const p = vUv.sub(vec2(0.5));
  const x = p.x.mul(uDir);
  const yc = uArc.mul(x.mul(x).mul(4.0).sub(1.0));
  const taper = oneMinus(pow(abs(x.mul(2.0)), float(2.5)));
  const thin = taper.mul(0.55).add(0.45);
  const dy = abs(p.y.sub(yc)).div(thin.mul(float(0.10)));    // 影宽 ~1.2×核
  const body = exp(dy.mul(dy).mul(-1.0));
  const head = uProgress.mul(1.7).sub(0.75);
  const rel = head.sub(x);
  const front = smoothstep(float(-0.10), float(0.04), rel);
  const tail = exp(rel.mul(-4.5)).mul(front);
  const fade = oneMinus(smoothstep(float(0.70), float(1.0), uProgress))
    .mul(smoothstep(float(0.0), float(0.10), uProgress));
  // ⚠ 强度硬编码（0.45）：TSL Fn 末参（第 5 参）实测不绑定（alpha 无视该 arg 恒按
  // 1 计）——查明前强度作为 shader 字面量旋钮，调暗层浓淡改这一个数
  return vec4(vec3(0.005, 0.008, 0.018), body.mul(tail).mul(fade).mul(float(0.45)));
});

/**
 * 能量核（投射物头 / 落点闪光共用）：径向双层（宽晕 + 热核 HDR）+ 可选扩张冲击环。
 *  · uRing = 0 时是投射物头（flicker 由 uProgress 高频项给出闪烁）；
 *  · uRing = 1 时是落点闪光（uProgress = 爆发进度 0..1，环随进度扩张读「冲击波」）。
 * @param vUv quad uv
 * @param uProgress 头：任意单调时间量（供闪烁）；闪光：0..1 爆发进度
 * @param uColor vec3 晕/环色（线性）
 * @param uHot vec3 热核色（峰值 ~2.4×HDR 过 bloom 阈）
 * @param uRing float 冲击环强度（0 关闭）
 */
export const coreShade = Fn(([vUv, uProgress, uColor, uHot, uRing]) => {
  const p = vUv.sub(vec2(0.5));
  const r = length(p).mul(2.0);
  const halo = exp(r.mul(r).mul(-4.5));
  const core = exp(r.mul(r).mul(-16.0));
  const flick = sin(uProgress.mul(43.0)).mul(0.08).add(0.92);
  const ringR = uProgress.mul(1.15);
  const ring = exp(pow(abs(r.sub(ringR)), float(2.0)).mul(-90.0)).mul(uRing);
  const rgb = uColor.mul(halo)
    .add(uHot.mul(core.mul(flick).mul(2.4)))
    .add(uColor.mul(ring.mul(1.6)));
  return vec4(rgb, float(1.0));
});

// 色参约定：调用侧 `uniform(new THREE.Color(r, g, b))`（线性工作空间——Color
// 构造器按线性分量读，勿用 setHex 的 sRGB 直觉给 HDR 值），范式同 CardFxLayer
// 的咏唱暖金 uniform。
