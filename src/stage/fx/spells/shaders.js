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
  floor, fract, mix, dot, max, normalView, atan,
} from 'three/tsl';

/**
 * 刀光斩痕（新月扫掠带）：
 *  · 形状 = 弓形中心线（刀走弧线）+ 两端收尖的新月带（厚度沿 x 变化）；
 *  · 横截面双带：窄热核（推 HDR）+ 宽色缘；
 *  · 纵向 = 扫掠头（随 uProgress 推进的锐亮前沿 + 命中尖峰）+ 指数拖尾
 *    （头前缘 smoothstep 正向截断：未扫过区域严格为 0）；
 *  · 细条纹调制（刀锋流光的方向感）+ 全局尾段渐隐。
 *  · 画布横向加宽 SLASH_QUAD_SPAN 倍 + x 坐标补偿（世界形状不变）——扫掠头热区
 *    原本直接冲出 quad 直边（用户实测横向两道断层）；真边缘由 edge mask 软收。
 * @param vUv       quad uv
 * @param uProgress 0..1 扫掠进度（block 侧 tween 推 uniform）
 * @param uColor    vec3 核心色（线性；峰值 ~2.4×HDR）
 * @param uFringe   vec3 色缘（银白冷光一类）
 * @param uArc      float 中心线弓高（0=直带）
 * @param uDir      float 扫掠方向（+1 左→右；-1 翻转）
 */
export const SLASH_QUAD_SPAN = 1.3;   // 画布横向加宽系数（blocks.js quad 宽同步乘）
export const slashShade = Fn(([vUv, uProgress, uColor, uFringe, uArc, uDir, uDbg]) => {
  const p = vUv.sub(vec2(0.5));
  const x = p.x.mul(float(SLASH_QUAD_SPAN)).mul(uDir);   // 跨度补偿：画布加宽、世界形状不变
  const y = p.y;
  // 边缘熄灭（全 shade 同款纪律）：扫掠头越过新月带端后仍热，无 mask 会在 quad
  // 直边切出竖直亮缝
  const edge = oneMinus(smoothstep(float(0.40), float(0.50), abs(p.x)))
    .mul(oneMinus(smoothstep(float(0.42), float(0.50), abs(p.y))));
  const yc = uArc.mul(x.mul(x).mul(4.0).sub(1.0));
  // 沿 x 的收尖（新月：两端薄、中段厚）——直接调制各层宽度；补偿后 |x| 可达
  // 0.65（taper 转负）→ 钳 0，带宽恒为非负
  const taper = max(oneMinus(pow(abs(x.mul(2.0)), float(2.5))), float(0.0));
  const thin = taper.mul(0.55).add(0.45);   // 宽度系数 0.45..1
  // 截面用**显式宽度**（UV 单位）分层——塞进一条薄带里核/晕/影互相挤压读不出层次：
  //   热核 ~4px 细线（HDR 白）、aura 3 倍宽冷蓝裙（阈下辉光）、画布高 5 世界单位给裙展开空间
  const dyC = abs(y.sub(yc)).div(thin.mul(float(0.16)));    // 核宽 0.16uv（质量整改加宽）
  const core = exp(dyC.mul(dyC).mul(-1.0));
  const dyA = abs(y.sub(yc)).div(thin.mul(float(0.42)));    // 裙宽 2.6×核
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
  const rgb = uFringe.mul(fringe.mul(1.6)).add(uColor.mul(core.mul(stri).mul(6.5)));
  const out = vec4(rgb.mul(energy).mul(edge), float(1.0));
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
 * 扩张读「冲击波」）。4 参纪律（见 projectileShade 头注）。内孔压暗（halo 在
 * r<0.5 渐灭、热核保留）——环与核之间留出暗隙，环读「环」不读「脚下 一滩光」。
 */
export const ringFlashShade = Fn(([vUv, uProgress, uColor, uHot, uSeed]) => {
  const p = vUv.sub(vec2(0.5));
  const r = length(p).mul(2.0);
  // 边缘熄灭（punchShade 同款纪律）：环在高进度逼近 quad 直边，无 mask 会在
  // 地板上切出矩形亮痕（glm-flash 复审实测）
  const mask = oneMinus(smoothstep(float(0.40), float(0.49), abs(p.x)))
    .mul(oneMinus(smoothstep(float(0.40), float(0.49), abs(p.y))));
  const hole = smoothstep(float(0.12), float(0.52), r);   // 内孔：中心让位给热核
  const halo = exp(r.mul(r).mul(-4.5)).mul(hole);
  const core = exp(r.mul(r).mul(-16.0));
  // 冲击环贴地压扁（y×1.9 椭圆——竖直 billboard 上的环读「地面冲击波」，
  // 不读「门环」；halo/core 保持圆形：爆心光团是立体的）
  const rg = length(vec2(p.x, p.y.mul(1.9)));
  const ang = atan(p.y.mul(1.9), p.x);
  // 环缘角向破边（fbm 调制环半径——冲击波前缘不是完整圆，是撕开的波）
  const wob = fbm2(vec2(ang.mul(1.4).add(uSeed), uProgress.mul(0.6))).sub(0.5);
  const ringR = uProgress.mul(1.05).add(wob.mul(0.10));
  const ring = exp(pow(abs(rg.sub(ringR)), float(2.0)).mul(-90.0));
  const fade = oneMinus(uProgress.mul(uProgress));
  const rgb = uColor.mul(halo.mul(fade))
    .add(uHot.mul(core.mul(fade).mul(2.4)))
    .add(uColor.mul(ring.mul(1.6)));
  return vec4(rgb.mul(mask), float(1.0));
});

/**
 * 拳击冲击（贴身命中读感）：横向拉伸的扩张冲击环（撞击主轴 = 攻击线）+
 * 纵向速度线条带（动漫式冲击线，沿攻击轴排布）+ 快衰白热闪光核。
 * 前向偏置在 +x 侧（来向侧线密）——左右镜像由 block 侧旋转 π 实现。
 * 画布横向加宽 PUNCH_QUAD_SPAN 倍 + x 坐标补偿（世界形状不变）——环峰半径若超
 * quad 半宽会被 mask 拦腰切断（横向断层）；补偿后内容包络收回 mask 带之内，
 * 真边缘由 mask 软收。
 * @param vUv       quad uv
 * @param uProgress 0..1 冲击进度（block 侧 tween 推 uniform）
 * @param uColor    vec3 线色（线性，暖象牙）
 * @param uHot      vec3 闪光核色（快衰窄核——层分离：核只管「命中一瞬」）
 * @param uRim      vec3 冲击环色（独立冷白缘——与暖核分层，否则 bloom 下糊成一块白）
 */
export const PUNCH_QUAD_SPAN = 1.5;   // 画布横向加宽系数（blocks.js quad 宽同步乘）
export const punchShade = Fn(([vUv, uProgress, uColor, uHot, uRim]) => {
  const p = vUv.sub(vec2(0.5));
  const x = p.x.mul(float(PUNCH_QUAD_SPAN));   // 跨度补偿：画布加宽、世界形状不变
  const y = p.y;
  // 边缘熄灭：mask 带全部落在内容包络之外——环峰 r_max 0.61 折回 |p.x|≤0.41 /
  // |p.y|≤0.41（2026-10-07 调形：环收小 + 压扁 2.1→1.5 后重算，速度线由径向衰减
  // 自然归零，mask 只兜尾段残量——上下直边不再当腰掐亮内容）
  const mask = oneMinus(smoothstep(float(0.43), float(0.50), abs(p.x)))
    .mul(oneMinus(smoothstep(float(0.43), float(0.50), abs(p.y))));
  // y 压扁 1.5 倍 → 环横向拉长（贴身水平撞击，不是球形爆炸；原 2.1 过扁）
  const r = length(vec2(x, y.mul(1.5)));
  const ring = exp(pow(abs(r.sub(uProgress.mul(0.48).add(0.13))), float(2.0)).mul(-45.0));
  const core = exp(r.mul(r).mul(-16.0)).mul(pow(oneMinus(uProgress), float(2.0)));
  // 纵向速度线：y 向条带从中心向外淡出（**不挂环门控**——线要填满环内读「冲击」；
  // 径向 ×1.3 收在环峰内侧，到不了画布边——边带是 clip 病根）
  const bands = sin(y.mul(24.0).add(x.mul(3.0))).mul(0.5).add(0.5);
  const lines = pow(bands, float(2.4)).mul(oneMinus(r.mul(1.3)));
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
  // mask 渐变带加宽（0.20 起）：窄带硬切断读「直边笔直」（glm-flash 三轮实测）
  const mask = oneMinus(smoothstep(float(0.20), float(0.48), abs(p.x)))
    .mul(oneMinus(smoothstep(float(0.24), float(0.48), abs(p.y))));
  const rq = length(vec2(q.x, q.y.mul(0.66)));   // 纵向拉长的火体半径
  const grow = smoothstep(float(0.0), float(0.35), uProgress);
  const wane = oneMinus(smoothstep(float(0.40), float(1.0), uProgress));
  // 火舌剪影：向上收尖（上部质量递减——火焰不是矩形板）
  const taper = oneMinus(smoothstep(float(-0.10), float(0.50), q.y).mul(0.65));
  // fbm 湍流（2026-10-06 升级：sin 双频在 fbm 旋涡旁读机械——火的卷曲感要域噪声）
  const turb = fbm2(vec2(q.x.mul(2.6).add(uSeed), q.y.mul(2.2).sub(uProgress.mul(1.4))))
    .mul(0.55).add(0.62);
  const body = exp(rq.mul(rq).mul(grow.mul(2.4).sub(8.2))).mul(wane).mul(taper).mul(turb);
  // 深红缘：火体外缘一圈（色温分层的外层——「像火」的关键层）。环心收进 0.36、
  // 带展宽到 -30、幅值 1.5——旧版 0.42/-40/1.1 贴着 quad 边缘 mask 被掐掉半幅，
  // 实测读不出红带（glm-flash 复审）
  const rim = exp(pow(abs(rq.sub(0.36)), float(2.0)).mul(-30.0)).mul(wane).mul(taper).mul(float(1.5));
  // 上升热柱（白热芯向上拔的火舌——y 高斯放宽到 -5.5：舌头更高，火「缠身」不「腰间着火」）
  const plume = exp(q.x.mul(q.x).mul(-30.0)
    .add(pow(abs(q.y.sub(0.18)), float(2.0)).mul(-5.5))).mul(wane).mul(taper);
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
  // fbm 流纹（上涌的火/光不是均匀正弦条纹——竖直拉丝的噪声流）
  const flow = fbm2(vec2(p.x.mul(5.0), p.y.mul(2.4).sub(uProgress.mul(3.2)))).mul(0.42).add(0.78);
  const fade = pow(oneMinus(uProgress), float(0.7));
  const rgb = uColor.mul(edge.mul(vgrad).mul(flow).mul(2.0)).add(uHot.mul(edge2.mul(vgrad).mul(2.5)));
  return vec4(rgb.mul(fade), float(1.0));
});

/**
 * 贴身火帘（selfFlame 的 veil 形态——熔岩铠甲/火墙/血焰的「甲与墙」语言）：
 * **双柱火帘**——立绘是明亮钢灰甲，加色面片直接叠甲上会被洗成不可见（实测
 * 只在剑身间隙的暗背景露出细柱）；火柱改立在身侧 ±0.30（随高度内收），
 * 暗背景上成型读「火裹身」，中央留弱填充。竖直缓燃：火根宽亮、向上收尖，
 * 低频摆动（帘的呼吸）。进度三段：点燃前锋自底升顶（0~0.5）→ 全幅缓燃
 * （0.5~0.78）→ 自底向上熄灭收场（0.78~1）。
 * @param vUv       quad uv（block 侧把 quad 底部锚在脚前、加宽到立牌 1.3 倍宽）
 * @param uProgress 0..1 全周期进度
 * @param uColor    vec3 火体主色（线性）
 * @param uHot      vec3 火根白热色（HDR）
 * @param uSeed     float 摆动相位种子
 */
export const veilShade = Fn(([vUv, uProgress, uColor, uHot, uSeed]) => {
  const p = vUv.sub(vec2(0.5));
  const y = p.y.add(0.5);                                   // 0 底 1 顶
  // 柱位：±0.44 立在立牌轮廓**外**（半宽 ~0.41——柱落在明亮的钢灰甲上会被
  // 加色洗掉，实测只在暗背景成型），随高度内收（帘在顶上合拢）
  const cx = float(0.44).mul(oneMinus(y.mul(0.34)));
  const narrow = oneMinus(y).mul(0.16).add(0.07);
  const colL = exp(pow(abs(p.x.add(cx).sub(sin(y.mul(5.0).add(uSeed).add(uProgress.mul(2.5))).mul(0.05)))
    .div(narrow), float(2.0)).mul(-1.0));
  const colR = exp(pow(abs(p.x.sub(cx).sub(sin(y.mul(4.2).sub(uSeed).add(uProgress.mul(3.0))).mul(0.05)))
    .div(narrow), float(2.0)).mul(-1.0));
  const fill = exp(p.x.mul(p.x).mul(-14.0));                // 中央弱填充（甲面上的余光）
  const streak = sin(p.x.mul(18.0).add(uSeed)).mul(0.5).add(0.5)
    .mul(sin(y.mul(9.0).sub(uProgress.mul(5.0))).mul(0.3).add(0.8));
  const vgrad = oneMinus(smoothstep(float(0.15), float(0.92), y));
  const lit = smoothstep(float(0.0), float(0.5), uProgress.sub(y.mul(0.45)));
  const fade = oneMinus(smoothstep(float(0.78), float(1.0), uProgress));
  const root = exp(y.mul(-2.6));                            // 白热火根贴地
  const fill2 = exp(p.x.mul(p.x).mul(-14.0));               // fill 独立第二份（火根用）
  const rgb = uColor.mul(colL.add(colR).mul(streak).mul(vgrad).mul(2.1))
    .add(uColor.mul(fill.mul(vgrad).mul(0.35)))
    .add(uHot.mul(fill2.mul(root).mul(2.8)));
  return vec4(rgb.mul(lit).mul(fade), float(1.0));
});

// 色参约定：调用侧 `vec3(r, g, b)` 常量节点（线性分量，HDR 值直接写 >1），由
// blocks.js 的 linearColor 帮手统一装配。勿改回 Color 型 uniform——管线缓存坑，
// 见文件头注。

// ---- 火系投射物 / 体修聚气 / 贴地环（2026-10-06 审计重制批）------------------

/**
 * 火弹能量核（fireOrb——火系投射物专属，替代 projectileShade 的「发光团」）：
 * fbm 火面 + **头尾不对称**（+x = 飞行头向：头圆亮、尾撕开拖焰——block 侧几何
 * 拉伸把 quad 沿速度方向拉长，shade 只管让头尾长不一样）+ 角向破边（火团轮廓
 * 被噪声撕出锯齿，不是光滑高斯圆）+ 热核闪烁。
 * @param vUv    quad uv（block 拉伸后 x = 飞行方向）
 * @param uPhase 单调时间量（火焰面流动 + 闪烁）
 * @param uColor vec3 火体色（线性）
 * @param uHot   vec3 热核色（HDR）
 * @param uSeed  float 场相位种子（多发不同步）
 */
export const fireOrbShade = Fn(([vUv, uPhase, uColor, uHot, uSeed]) => {
  const p = vUv.sub(vec2(0.5));
  const x = p.x;   // 头向 +
  // 边缘熄灭（铁律：边界前归零；起点内移 25%——等亮线不许是 quad 直边）
  const mask = oneMinus(smoothstep(float(0.30), float(0.48), abs(p.x)))
    .mul(oneMinus(smoothstep(float(0.24), float(0.48), abs(p.y))));
  // 尾向延伸的火面半径（尾半边烧得更长更散）：|x| 负侧放大半径
  const tail = oneMinus(smoothstep(float(-0.5), float(0.0), x)).mul(0.35);
  const rr = length(vec2(x.div(oneMinus(tail.mul(0.45))), p.y.mul(1.35)));
  const ang = atan(p.y, x.add(0.01));
  // **fbm 雕刻剪影**：覆盖率 = 噪声场 − 径向距离 的平滑阶跃——外轮廓由噪声
  // 定义（舔火缺口/锯齿缘），不是径向高斯被 quad 裁形（v2 病根：等亮线是直边）。
  // 头尾轴向梯度（v4：v3 四象限均分读不出方向——三处贯通：尾侧阈值抬高碎散、
  // 热度头×1.2 尾×0.7、热核前移）
  const axial = x.mul(0.5).add(0.5);                          // 0 尾 .. 1 头
  const tailBias = oneMinus(axial).mul(0.16);
  const n = fbm2(vec2(ang.mul(1.8).add(uSeed), rr.mul(2.4).sub(uPhase.mul(1.1))));
  const cov = smoothstep(float(0.42).add(tailBias), float(0.62).add(tailBias), n.sub(rr).add(0.5));
  // 内部色温：场的高位 = 更热（火舌芯）× 头尾梯度
  const heat = smoothstep(float(0.55), float(0.8), n.add(oneMinus(rr).mul(0.3)))
    .mul(axial.mul(0.5).add(0.7));
  const head = axial.mul(0.7).add(0.45);
  // 尾焰拖丝：尾向竖直拉丝（速度线读感）
  const drag = fbm2(vec2(x.mul(3.0).add(uPhase.mul(0.8)), p.y.mul(9.0).add(uSeed)));
  const tailWisp = oneMinus(smoothstep(float(-0.45), float(-0.05), x))
    .mul(exp(p.y.mul(p.y).mul(-24.0))).mul(drag.mul(drag)).mul(1.3);
  // 热核（头前偏移 0.25 + 闪烁）
  const rrC = length(vec2(x.sub(0.18).div(oneMinus(tail.mul(0.45))), p.y.mul(1.35)));
  const core = exp(rrC.mul(rrC).mul(-16.0)).mul(sin(uPhase.mul(31.0)).mul(0.07).add(0.93));
  const rgb = uColor.mul(cov.mul(head).mul(1.6))
    .add(uHot.mul(cov.mul(heat).mul(1.6)))
    .add(uColor.mul(tailWisp).mul(1.0))
    .add(uHot.mul(core.mul(2.2)));
  // 头尾梯度乘在**最终合成色**上（v4 病根：乘在中间场会被 smoothstep/覆盖率
  // 截断吃掉——终乘是唯一保证到达成片的位置；头×1.2 尾×0.7）
  return vec4(rgb.mul(axial.mul(0.5).add(0.7)).mul(mask), float(1.0));
});

/**
 * 体修聚气核（qiGather——fistCast 拳面气劲的专属 shade，替代静态高斯核）：
 * 收敛旋纹——角向条纹绕核旋转（吸入读感：场随相位**向内**推进）+ 核心亮斑
 * 呼吸 + 边缘熄灭。体修白气语言（灰白家族，无火相）。
 * @param vUv       quad uv
 * @param uPhase    单调时间量（旋纹推进）
 * @param uProgress 0..1 聚气进度（0 无 → 1 满核，亮度/范围随进度长）
 * @param uColor    vec3 气劲色（线性）
 * @param uHot      vec3 核心色（HDR）
 */
export const qiGatherShade = Fn(([vUv, uPhase, uProgress, uColor, uHot]) => {
  const p = vUv.sub(vec2(0.5));
  const r = length(p).mul(2.0);
  const ang = atan(p.y, p.x);
  // 收敛旋臂：角频率随半径升高（内圈转得快）+ 相位随进度推进（越聚越紧）
  const swirl = fbm2(vec2(ang.mul(2.2).sub(uPhase.mul(2.4)).add(r.mul(1.8)), r.mul(3.2)));
  const arm = pow(swirl.mul(0.5).add(0.5), float(1.8));
  // 半径包络：进度越长半径越满（气从四面聚来）；边缘熄灭
  const reach = uProgress.mul(0.92).add(0.18);
  const env = oneMinus(smoothstep(reach.mul(0.45), reach, r)).mul(oneMinus(smoothstep(float(0.46), float(0.5), length(p))));
  // 核心亮斑呼吸（聚气感：进度尾段核心越亮越实）
  const breathe = sin(uPhase.mul(9.0)).mul(0.12).add(0.88);
  const core = exp(r.mul(r).mul(-9.0)).mul(uProgress);
  const rgb = uColor.mul(arm.mul(env).mul(1.6))
    .add(uHot.mul(core.mul(breathe).mul(2.4)));
  return vec4(rgb, float(1.0));
});

/**
 * 贴地气场环（groundRing——架势/旋风地面响应的专属 shade）：**真贴地**（block
 * 侧把 quad 平躺放地面，相机俯角自然读椭圆——不是竖直 billboard 的假压扁）。
 * 环带随进度扩张，**角向破边**（环缘被 fbm 撕开——不是完整甜甜圈）+ **环流纹**
 * （环带上的亮弧沿角向流动 = 气在绕）+ 内域渐弱。
 * @param vUv       quad uv（平躺 quad 的面内坐标）
 * @param uPhase    单调时间量（环流纹推进）
 * @param uProgress 0..1 环扩张进度
 * @param uColor    vec3 环色（线性）
 * @param uHot      vec3 环带亮弧色（HDR）
 * @param uSeed     float 场种子
 */
export const groundRingShade = Fn(([vUv, uPhase, uProgress, uColor, uHot, uSeed]) => {
  const p = vUv.sub(vec2(0.5));
  const r = length(p).mul(2.0);
  const ang = atan(p.y, p.x);
  // 环半径：扩张 × 角向噪声调制（破边——环缘高低起伏）
  const wob = fbm2(vec2(ang.mul(1.5).add(uSeed), uPhase.mul(0.15))).sub(0.5);
  const ringR = uProgress.mul(0.86).add(0.10).add(wob.mul(0.12));
  const ring = exp(pow(abs(r.sub(ringR)), float(2.0)).mul(-60.0));
  // 环流纹：环带上的亮弧沿角向流动（气在绕——架势的「场」读感）
  const flow = fbm2(vec2(ang.mul(3.0).sub(uPhase.mul(2.0)).add(uSeed.mul(2.0)), r.mul(6.0)));
  const arc = pow(flow.mul(0.5).add(0.5), float(2.2));
  // 内域微光（场内不是空的）+ 全局尾段渐隐 + quad 边缘熄灭
  const inner = exp(r.mul(r).mul(-6.0)).mul(0.35);
  const fade = oneMinus(smoothstep(float(0.72), float(1.0), uProgress));
  const mask = oneMinus(smoothstep(float(0.42), float(0.5), abs(p.x)))
    .mul(oneMinus(smoothstep(float(0.42), float(0.5), abs(p.y))));
  const rgb = uColor.mul(ring.mul(arc.mul(0.65).add(0.35)).mul(1.8))
    .add(uColor.mul(inner))
    .add(uHot.mul(ring.mul(arc).mul(1.4)));
  return vec4(rgb.mul(fade).mul(mask), float(1.0));
});
// 值噪声 hash（2D → 0..1）：经典 sin 散列
// ---- 湍流场基元（whirl/fireOrb/groundRing 共用；纯算术无控制流）----
const hash21 = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));
// 值噪声（网格四角 hermite 插值）
const vnoise2 = Fn(([p]) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2.0).add(3.0));   // hermite（= 正向 smoothstep 曲线）
  const a = hash21(i);
  const b = hash21(i.add(vec2(1.0, 0.0)));
  const c = hash21(i.add(vec2(0.0, 1.0)));
  const d = hash21(i.add(vec2(1.0, 1.0)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
});
// 双倍频 fbm（两 octave 够用——whirl 的域扭曲会再贡献细节）
const fbm2 = Fn(([p]) => vnoise2(p).mul(0.62).add(vnoise2(p.mul(2.13).add(19.7)).mul(0.38)));

/**
 * 旋涡火幕（fireWhirl 火焰旋风 v2 的主体，2026-10-06 重做）：**圆柱面**上一场
 * 真正的湍流火旋——不是条纹管。四层手艺：
 *   · **涡剪旋转采样**：噪声场坐标随时间旋转，角速度底部大顶部小（涡的剪切
 *     感——火根甩得快、火梢拖着走），叠加竖直上卷（火上飘）；
 *   · **域扭曲 fbm**：两层值噪声，第二层被第一层扭曲采样（domain warp）——
 *     火焰的卷曲/撕开感来自这里，不是 sin 条纹；
 *   · **视向假厚度**：掠射增亮（边缘法线侧视 → 亮且浓，正对面 → 薄而透）——
 *     单层壳读出体积感，背面火臂（DoubleSide）透叠加厚涡壁；
 *   · **高度破碎 + 色温分层**：覆盖率随高度收窄（顶上碎成孤舌），白热核/橙体/
 *     深红缘由**同一个噪声场不同阈值**切出（层次天然咬合，不是三层打架）。
 * @param vUv       圆柱 uv（x = 角向 0..1 环向，y = 高度 0 底..1 顶）
 * @param uPhase    单调时间量（涡旋转 + 上卷相位，block 侧逐帧推进）
 * @param uProgress 0..1 全周期进度（0 起涡 → 0.75 全幅 → 1 熄灭）
 * @param uColor    vec3 火体主色（线性）
 * @param uHot      vec3 热核色（HDR——过 bloom 阈）
 * @param uSeed     float 场相位种子（内外双圆柱不同步）
 */
export const whirlShade = Fn(([vUv, uPhase, uProgress, uColor, uHot, uSeed]) => {
  const ang = vUv.x;
  const h = vUv.y;
  // 螺旋剪切主轴：角坐标随高度大幅偏移（等值线被剪成**对角螺旋条带**——火舌
  // 沿盘旋方向拉长，不是水平横环）+ 涡剪旋转（角速度底快顶慢）
  const sa = ang.mul(6.2832).add(h.mul(5.6)).sub(uPhase.mul(oneMinus(h.mul(0.5)).mul(0.9).add(0.55)));
  // 上升流：高度坐标向下滚动（火上飘）；**竖向各向异性**（y 频率压低 = 火舌
  // 竖直拉长，x 保持细密 = 撕开的锯齿缘）
  const q = vec2(sa.mul(0.85), h.mul(1.35).sub(uPhase.mul(0.42)).add(uSeed));
  const w1 = fbm2(q);
  const w2 = fbm2(q.mul(1.9).add(vec2(w1.mul(2.6).add(4.7), w1.mul(1.4))));   // 域扭曲：第二场被第一场弯折
  const f = w1.mul(0.35).add(w2.mul(0.65));
  // **撕裂场**（沿剪切方向缓变的第三场）：把连续螺旋带撕成数条独立火舌——
  // 「几条火互相追赶」而不是「一条绸带绕圈」（glm-flash 终审病根①）
  const tear = smoothstep(float(0.22), float(0.52),
    fbm2(q.add(vec2(uPhase.mul(0.35).add(9.3), uSeed.mul(0.7)))));
  // 覆盖率：阈值随高度平方抬升（顶上碎成孤舌）×撕裂；接缝渐隐
  const seam = oneMinus(smoothstep(float(0.955), float(1.0), abs(ang.mul(2.0).sub(1.0))));
  const th = float(0.30).add(h.mul(h).mul(0.52));
  const cov = smoothstep(th, th.add(0.30), f).mul(tear).mul(seam);
  // 色温分层（同场异阈）：白热核 = 场的高位切片（火舌芯线）；深红缘 = 覆盖边缘带
  const core = smoothstep(float(0.64), float(0.82), f);
  const rim = cov.mul(oneMinus(smoothstep(float(0.40), float(0.58), f)));
  // 视向假厚度：掠射（法线侧视）→ 亮且浓；正对 → 薄透——单壳读体积
  const graze = abs(normalView.x).mul(0.75).add(0.45);
  // 竖直火势：慢衰减（火裹全身到肩）+ **顶部破圆**（灭点高度随角向噪声起伏——
  // 顶缘不是闭合甜甜圈，glm-flash 终审病根②的另一半）+ 火根贴地
  const hTop = float(0.68).add(w1.mul(0.20));
  const venv = exp(h.mul(-1.35)).mul(oneMinus(smoothstep(hTop, hTop.add(0.14), h)))
    .mul(smoothstep(float(-0.03), float(0.10), h));
  // 周期包络：起涡（0~0.3 拔起）→ 全幅 → 收涡（0.75~1 整体上飘熄灭）
  const life = smoothstep(float(0.0), float(0.30), uProgress)
    .mul(oneMinus(smoothstep(float(0.75), float(1.0), uProgress)));
  const body = max(cov.sub(core.mul(0.4)), float(0.0));
  const rgb = uColor.mul(body.mul(1.7))
    .add(uColor.mul(rim.mul(1.35)).mul(vec3(0.55, 0.20, 0.10)).div(0.55))   // 深红缘加重（三层咬合）
    .add(uHot.mul(core.mul(2.9)));
  return vec4(rgb.mul(venv).mul(graze).mul(life), float(1.0));
});
