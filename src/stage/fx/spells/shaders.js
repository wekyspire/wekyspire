// 施术演出 shader 库（TSL——WebGPU 迁移后内嵌 shader 的唯一写法，范式抄
// CardFxLayer 的 veil/edgeGlow：MeshBasicNodeMaterial + colorNode 全量接管输出）。
// TA 纪律（2026-09-30 用户定）：好看的特效大部分靠 shader 写，geometry transform
// 只做辅助——面片只是画布，形状/扫掠/拖尾/渐隐全在 fragment 里算。
// 纪律：WGSL smoothstep 一律正向写法（反向边用 oneMinus）；无控制流（纯算术）；
// 加色混合（additiveLight，rgb 直出、alpha 恒 1）；核心推过 bloom 阈 1.45 起晕。
// ⚠ 色参一律**常量 vec3 节点**（调用侧 vec3(r,g,b) 烘进 Fn），不走 Color 型 uniform
// ——2026-09-30 实测：Color uniform 的彩色造型层会在部分编译会话里整体失显
// （白核项活、色缘项死、跨会话非确定；同文件未改动的 Fn 也会被连带重编退化），
// 与 darkSlashShade 的「Fn 末参不绑定」同族的管线缓存坑。颜色无需运行时变更，
// uniform 纯属白给绑定风险。只有**逐帧动画的标量**（uProgress/uArc/uDir/uSeed）用
// float uniform（实测稳定）。
import {
  Fn, uniform, uv, select,
  vec2, vec3, vec4, float, pow, abs, sin, length, exp, smoothstep, oneMinus,
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
  const dyC = abs(y.sub(yc)).div(thin.mul(float(0.10)));    // 核宽 0.10uv（用户定加宽）
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
 * 投射物能量核：径向双层（宽晕 + 热核 HDR 闪烁）。
 * （2026-10-02 拆分：原 coreShade 的第 5 参 uRing 是绑定雷区——uRing=0 时整个
 * colorNode 输出全灭（投射物从未真正渲染，「火球」一直是尾迹粒子+灯在撑场）；
 * 按「Fn ≤4 参」纪律拆成投射物/闪光两个 4 参版本。）
 * @param vUv quad uv
 * @param uProgress 任意单调时间量（供闪烁）
 * @param uColor vec3 晕色（线性）
 * @param uHot vec3 热核色（峰值 ~2.4×HDR 过 bloom 阈）
 */
export const projectileShade = Fn(([vUv, uProgress, uColor, uHot]) => {
  const p = vUv.sub(vec2(0.5));
  const r = length(p).mul(2.0);
  const halo = exp(r.mul(r).mul(-4.5));
  const core = exp(r.mul(r).mul(-16.0));
  const flick = sin(uProgress.mul(43.0)).mul(0.08).add(0.92);
  const rgb = uColor.mul(halo).add(uHot.mul(core.mul(flick).mul(2.4)));
  return vec4(rgb, float(1.0));
});

/**
 * 落点冲击闪光：宽晕 + 热核 + 扩张冲击环（uProgress = 爆发进度 0..1，环随进度
 * 扩张读「冲击波」）。4 参纪律（见 projectileShade 头注）。
 */
export const ringFlashShade = Fn(([vUv, uProgress, uColor, uHot]) => {
  const p = vUv.sub(vec2(0.5));
  const r = length(p).mul(2.0);
  const halo = exp(r.mul(r).mul(-4.5));
  const core = exp(r.mul(r).mul(-16.0));
  const ringR = uProgress.mul(1.15);
  const ring = exp(pow(abs(r.sub(ringR)), float(2.0)).mul(-90.0));
  const fade = oneMinus(uProgress.mul(uProgress));
  const rgb = uColor.mul(halo.mul(fade))
    .add(uHot.mul(core.mul(fade).mul(2.4)))
    .add(uColor.mul(ring.mul(1.6)));
  return vec4(rgb, float(1.0));
});

/**
 * 拳击冲击（贴身命中读感）：横向拉伸的扩张冲击环（撞击主轴 = 攻击线）+
 * 纵向速度线条带（动漫式冲击线，沿攻击轴排布）+ 快衰白热闪光核。
 * 前向偏置在 +x 侧（来向侧线密）——左右镜像由 block 侧旋转 π 实现。
 * 边缘熄灭 mask：径向面片的亮度在 quad 边缘必须衰减到 0（直边穿帮是实测病根）。
 * @param vUv       quad uv
 * @param uProgress 0..1 冲击进度（block 侧 tween 推 uniform）
 * @param uColor    vec3 线色（线性，暖象牙）
 * @param uHot      vec3 闪光核色（快衰窄核——层分离：核只管「命中一瞬」）
 * @param uRim      vec3 冲击环色（独立冷白缘——与暖核分层，否则 bloom 下糊成一块白）
 */
export const punchShade = Fn(([vUv, uProgress, uColor, uHot, uRim]) => {
  const p = vUv.sub(vec2(0.5));
  const x = p.x;
  const y = p.y;
  // 边缘熄灭：|x|/|y| 出界压到 0（环扩张上限 0.70 与掩码起点 0.38 留余量——
  // 掩码掐死扩张中的环是实测病根）
  const mask = oneMinus(smoothstep(float(0.38), float(0.48), abs(p.x)))
    .mul(oneMinus(smoothstep(float(0.36), float(0.48), abs(p.y))));
  // y 压扁 2.1 倍 → 环横向拉长（贴身水平撞击，不是球形爆炸）
  const r = length(vec2(p.x, p.y.mul(2.1)));
  const ring = exp(pow(abs(r.sub(uProgress.mul(0.62).add(0.16))), float(2.0)).mul(-45.0));
  const core = exp(r.mul(r).mul(-16.0)).mul(pow(oneMinus(uProgress), float(2.0)));
  // 纵向速度线：y 向条带从中心向外淡出（**不挂环门控**——线要填满环内读「冲击」）
  const bands = sin(y.mul(24.0).add(x.mul(3.0))).mul(0.5).add(0.5);
  const lines = pow(bands, float(2.4)).mul(oneMinus(r.mul(0.95)));
  // 前向偏置（来向侧线密）+ 全局尾段渐隐
  const fw = smoothstep(float(-0.6), float(0.7), x).mul(0.5).add(0.6);
  const fade = oneMinus(smoothstep(float(0.55), float(1.0), uProgress));
  // ⚠ 项式一律**平铺 add**（mul 参数里嵌 add 的项实测整项归零——v1 冲击环全灭的病根）；
  // 层分离：冷白环缘（最亮、读「冲击波」）｜暖线（内部）｜窄白核（命中一瞬）
  const rgb = uRim.mul(ring.mul(2.8))
    .add(uColor.mul(lines.mul(fw).mul(2.2)))
    .add(uHot.mul(core.mul(3.5)));
  return vec4(rgb.mul(fade).mul(mask), float(1.0));
});

/**
 * 火焰爆发（火球落点 / 爆裂新星共用）。三层色温（白热核 → 橙火体 → 深红缘）
 * + 火舌剪影（底部宽、向上收尖）+ 双频湍流 + 上升热柱 + 地面水平冲击环。
 * 进度三段：快速膨开（0~0.35）→ 全幅燃烧 → 后段熄灭（0.4 起 wane）。
 * 边缘熄灭 mask 同 punchShade（治直边穿帮）。
 * @param vUv       quad uv（block 侧把 quad 底部锚在落点附近）
 * @param uProgress 0..1 爆发进度
 * @param uColor    vec3 火体主色（线性，橙）
 * @param uHot      vec3 白热核色（HDR）
 * @param uEmber    vec3 深红缘色（色温分层的外层）
 * @param uSeed     float 湍流相位种子（多实例不同步）
 */
export const fireBurstShade = Fn(([vUv, uProgress, uColor, uHot, uEmber, uSeed]) => {
  const p = vUv.sub(vec2(0.5));
  const q = vec2(p.x, p.y.add(0.30));            // 原点下移：上方留体积
  const mask = oneMinus(smoothstep(float(0.30), float(0.48), abs(p.x)))
    .mul(oneMinus(smoothstep(float(0.32), float(0.48), abs(p.y))));
  const rq = length(vec2(q.x, q.y.mul(0.66)));   // 纵向拉长的火体半径
  const grow = smoothstep(float(0.0), float(0.35), uProgress);
  const wane = oneMinus(smoothstep(float(0.40), float(1.0), uProgress));
  // 火舌剪影：向上收尖（上部质量递减——火焰不是矩形板）
  const taper = oneMinus(smoothstep(float(-0.10), float(0.50), q.y).mul(0.65));
  const turb = sin(q.x.mul(15.0).add(uSeed).add(uProgress.mul(6.0)))
    .mul(sin(q.y.mul(8.0).sub(uProgress.mul(10.0)))).mul(0.35).add(0.75);
  const body = exp(rq.mul(rq).mul(grow.mul(2.4).sub(7.0))).mul(wane).mul(taper).mul(turb);
  // 深红缘：火体外缘一圈（色温分层的外层——「像火」的关键层）
  const rim = exp(pow(abs(rq.sub(0.42)), float(2.0)).mul(-40.0)).mul(wane).mul(taper);
  // 上升热柱（白热芯向上拔的火舌）
  const plume = exp(q.x.mul(q.x).mul(-30.0)
    .add(pow(abs(q.y.sub(0.15)), float(2.0)).mul(-8.0))).mul(wane).mul(taper);
  // 地面冲击环：圆心锚在 quad 空间的**地面线**（quad 底部坐在落点：center 在
  // feet+0.34h → 地面 ≈ p.y=-0.34），纵向更扁（贴地摊开的冲击波，不是空中圆）
  const gp = vec2(p.x, p.y.add(0.34));
  const rg = length(vec2(gp.x, gp.y.mul(1.9)));
  const ring = exp(pow(abs(rg.sub(uProgress.mul(0.72).add(0.10))), float(2.0)).mul(-70.0)).mul(wane);
  const core = exp(rq.mul(rq).mul(-16.0)).mul(pow(oneMinus(uProgress), float(1.5)));
  const rgb = uColor.mul(body.mul(1.5))
    .add(uEmber.mul(rim.mul(1.1)))
    .add(uColor.mul(ring.mul(1.8)))
    .add(uHot.mul(core.mul(5.0).add(plume.mul(2.2))));
  return vec4(rgb.mul(mask), float(1.0));
});

/**
 * 光柱（S/X 斩的封顶一竖）：竖直光束随进度收细 + 熄灭；底端最亮（自目标拔地而起）、
 * 流动条纹上卷（能量上涌读感）。宽度方向两次高斯（宽晕 + 窄核）分层。
 * @param vUv       quad uv（block 侧把 quad 立在目标脚下）
 * @param uProgress 0..1 光柱进度（0 最粗最亮 → 1 熄灭）
 * @param uColor    vec3 光柱主色（线性）
 * @param uHot      vec3 窄核色（HDR）
 */
export const beamShade = Fn(([vUv, uProgress, uColor, uHot]) => {
  const p = vUv.sub(vec2(0.5));
  const x = abs(p.x);
  const narrow = oneMinus(uProgress).mul(20.0).add(30.0);   // 随进度收细
  const edge = exp(x.mul(x).mul(narrow).mul(-1.0));
  const edge2 = exp(x.mul(x).mul(narrow).mul(-2.6));        // 窄核（独立算，不复用 const）
  const vgrad = oneMinus(smoothstep(float(-0.2), float(0.5), p.y));   // 底亮顶淡
  const flow = sin(p.y.mul(24.0).sub(uProgress.mul(20.0))).mul(0.25).add(0.85);
  const fade = pow(oneMinus(uProgress), float(0.7));
  const rgb = uColor.mul(edge.mul(vgrad).mul(flow).mul(2.0)).add(uHot.mul(edge2.mul(vgrad).mul(2.5)));
  return vec4(rgb.mul(fade), float(1.0));
});

/**
 * 格挡光壁（blockCast 墙）：竖直光幕在防御者身前立起——底边先亮、一道热前锋
 * 自下而上扫到顶（「墙立起来」的读感），恒亮一拍后整体渐隐。横向高斯成带 +
 * 上下端帽衰减防直边穿帮。4 参纪律（见 projectileShade 头注）。
 * @param vUv       quad uv（block 侧把 quad 底边坐在地面）
 * @param uProgress 0..1 立墙进度
 * @param uColor    vec3 墙体色（线性，灵能蓝白）
 * @param uHot      vec3 前锋亮线色（HDR）
 */
export const wallShade = Fn(([vUv, uProgress, uColor, uHot]) => {
  const p = vUv.sub(vec2(0.5));
  const band = exp(p.x.mul(p.x).mul(-9.0));                    // 竖向光带（中亮边淡）
  const cap = oneMinus(smoothstep(float(0.78), float(1.0), abs(p.y).mul(2.0)));   // 上下端帽
  // ⚠ TSL 拓扑纪律（实测踩实）：表达式链交汇处（h/front 这类被多条项引用的中间量）
  // 整体猝死黑屏——所有项只允许引用**叶子**（p / uProgress / 字面量），复合表达式
  // 在每个使用点重写一份。uProgress 作 smoothstep 动态边无恙（below 项实测）。
  const below = oneMinus(smoothstep(uProgress.mul(2.6).sub(0.30), uProgress.mul(2.6), p.y.add(0.5)));   // 前锋以下恒亮
  const base = exp(p.y.add(0.5).mul(p.y.add(0.5)).mul(-30.0));        // 底部热源亮线（静态锚——能量自地面拔起）
  const fade = oneMinus(smoothstep(float(0.55), float(1.0), uProgress));
  const rgb = uColor.mul(band.mul(cap).mul(below).mul(0.9))
    .add(uHot.mul(band.mul(cap).mul(base).mul(2.2)))
    .mul(fade);
  return vec4(rgb, float(1.0));
});

// 色参约定：调用侧 `vec3(r, g, b)` 常量节点（线性分量，HDR 值直接写 >1），由
// blocks.js 的 linearColor 帮手统一装配。勿改回 Color 型 uniform——管线缓存坑，
// 见文件头注。
