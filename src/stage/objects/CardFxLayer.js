// CardFxLayer：卡牌特效统一宿主 —— 牌面叠加特效的统一管理者（CardObject 组合子）。
// 对位单位侧 UnitFxLayer（固定 C0–C3 层级）。
// 全部时间驱动（update(dt) 自算时间线），不依赖 gsap/tween 注入，也没有外部寄生状态。
// 固定层级（C = Card；z 为牌面局部纵深，牌面 z=0）：
//   C0 牌面 shader —— face 材质补丁（fx/cardBodyFx.js，构造即挂常驻）：uBurn 焚毁
//        吞蚀（离场演出）/ uDim 禁用压暗 / uHighlight 高亮提暖；记录 = this.body
//   C1 压暗层 z 0.35~0.36 —— veil 冷却膜（shader 霜冻/腐蚀）+ doom 暗化盖纱（0.36，
//        TSL 面片法线混合）：压暗牌面（「这张牌暂时不可用/要离开」的沉下去感）
//   C2 标记层 z 0.40~0.50 —— chip 冷却拍数水印（0.40，不发光）、lock 锁定四角括号
//        （0.44，TSL 面片加色）、doom 将弃描框（0.50，TSL 面片加色）：表意件
//   C3 发光层 z 0.40~3.0 —— pulse 一次性加色脉冲（0.45，TSL shader 三模式能量面片）、
//        edge 咏唱流光（0.40，
//        低于手牌扇相邻卡 z 间隔 0.5：邻牌盖得住光环；HDR 直出 >1.45 阈喂 bloom）、
//        transform 变换叠层（3.0，fx/cardTransform.js
//        自管生命周期）；HDR 约定：内容色 ≤1，发光件乘算过阈
// 三张平面各自惰性创建；焚毁接管牌面前调 clearTransient() 熄灭全部叠加。

import * as THREE from 'three';
import { additiveLight } from '../post/passes.js';
import { attachCardBodyFx } from '../fx/cardBodyFx.js';
import {
  Fn, If, Discard, Loop, uniform, uv, select,
  vec2, vec3, vec4, float, mix, clamp, abs, max, min, pow, floor, fract,
  sin, dot, length, exp, step, smoothstep, oneMinus,
} from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu'; // veil/edgeGlow 的 colorNode 必须挂 Node 材质
import { UI_FONT } from '../richtext/uiFont.js';

const VEIL_LERP = 7;       // 覆盖高度收敛速率（/s——拍数推进时前沿平滑爬行的动画）
// 脉冲面片外扩边距（冲击环越过牌边的余韵空间；边缘熄灭窗贴真面片边缘防断层）
const PULSE_MARGIN = 4;
// 冷却拍数水印：牌面中央低透明度平面白字（平面型水印）
const CHIP_LAYOUT = { w: 12, h: 12, y: 1.2, z: 0.4, opacity: 0.26 };
// 将弃描边：警示红 + 急促呼吸（1.2s 周期——逼近的截止感）；暗化盖纱让牌面"沉"下去
// （颜色烘常量 vec3 进 shader——彩层 uniform 跨会话非确定失显铁律；0xd84848≈(0.847,0.282,0.282)）
const DOOM_MARGIN = 2;   // 描框面片外扩边距（环带外缘 1.15 留软边余量）
// 锁定括号：警戒琥珀 + 慢呼吸（2.4s 周期——「已被瞄准」的持续状态感，与将弃的急促截止区分；
// 0xe8a23c≈(0.910,0.635,0.235)）
const LOCK_MARGIN = 2;   // 括号面片外扩边距（臂端外缘 1.45 留软边余量）
// 咏唱流光面片：牌面外扩边距（给 rim 外溢与光晕留空间）、点亮淡入速率
const EDGE_MARGIN = 5;
const EDGE_FADE_IN = 3.5;

// ---- veil / edgeGlow 的 TSL 着色范式（与 fx/unitBodyFx.js 同源）----
// uniform = TSL uniform() 节点（`{ uX: { value } }` 推值
// 口径不变，update 推流点零改动）；着色链 = TSL Fn 组合；材质改 MeshBasicNodeMaterial，
// colorNode 全量接管输出（vec4 的 a 通道即片元透明度——veil 写 alpha、edgeGlow 恒 1）。
// 纪律：If/Discard/Loop 必须待在 Fn 栈内；WGSL smoothstep 反向边一律改正向 + oneMinus。

// 圆角矩形 SDF（veil 圆角裁剪 / edgeGlow rimlight 共用基元）
const sdRoundBox = Fn(([p, b, r]) => {
  const q = abs(p).sub(b).add(r);
  return length(max(q, vec2(0.0))).add(min(max(q.x, q.y), 0.0)).sub(r);
});

// 咏唱边缘流光：呼吸 rimlight（圆角矩形 SDF 内收外溢
// 双边带）+ 3 颗沿边巡游的彗星光点（头部高斯光晕 + 沿 rim 的渐熄拖尾，亮度并入
// rimlight）。加色混合、alpha 恒 1，rgb 直接输出 HDR（峰值 >1 radiance）交给 bloom。
const vHash = Fn(([p]) => fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));

// 矩形周长参数路径（t∈[0,1)，顶边左→右起顺时针）
const edgePath = Fn(([t, hf]) => {
  const w = hf.x.mul(2.0), h = hf.y.mul(2.0);
  const d = fract(t).mul(2.0).mul(w.add(h)).toVar();
  const out = vec2(0.0).toVar();
  If(d.lessThan(w), () => {
    out.assign(vec2(d.sub(hf.x), hf.y));
  }).Else(() => {
    d.subAssign(w);
    If(d.lessThan(h), () => {
      out.assign(vec2(hf.x, hf.y.sub(d)));
    }).Else(() => {
      d.subAssign(h);
      If(d.lessThan(w), () => {
        out.assign(vec2(hf.x.sub(d), hf.y.mul(-1.0)));
      }).Else(() => {
        d.subAssign(w);
        out.assign(vec2(hf.x.mul(-1.0), d.sub(hf.y)));
      });
    });
  });
  return out;
});

// 片元的最近边周长参数（拖尾亮带用；角部按主导轴近似，视觉连续即可）
const edgeParam = Fn(([p, hf]) => {
  const w = hf.x.mul(2.0), h = hf.y.mul(2.0);
  const dx = hf.x.sub(abs(p.x)), dy = hf.y.sub(abs(p.y));
  const s = float(0).toVar();
  If(dx.lessThan(dy), () => {
    s.assign(select(p.x.greaterThan(0.0),
      w.add(hf.y.sub(p.y)), w.mul(2.0).add(h).add(p.y.add(hf.y))));
  }).Else(() => {
    s.assign(select(p.y.greaterThan(0.0),
      p.x.add(hf.x), w.add(h).add(hf.x.sub(p.x))));
  });
  return s.div(w.add(h).mul(2.0));
});

const edgeShade = Fn(([vUv, uTime, uFade, uCard, uPlane, uColor, uComets]) => {
  const p = vUv.sub(0.5).mul(uPlane);
  const hf = uCard.mul(0.5);
  const d = sdRoundBox(p, hf, 1.5);

  // 呼吸 rimlight：内收外溢不对称边带，3.2s 慢呼吸（明灭约 3:1）
  const breath = float(0.55).add(sin(uTime.mul(1.9635)).mul(0.45));
  const rim = select(d.lessThan(0.0), exp(d.mul(1.6)), exp(d.mul(-0.85)));

  // 绕行光点：3 颗彗星 ~4.5s 一圈，各自快速脉动；拖尾只亮在 rim 附近 → 融入 rimlight
  const s = edgeParam(p, hf);
  const rimProx = exp(abs(d).mul(-0.9));
  const head = float(0).toVar();
  const trail = float(0).toVar();
  Loop(3, ({ i }) => {
    const fi = float(i);
    const ti = fract(uTime.mul(0.22).add(fi.mul(0.333333)));
    const pulse = float(0.62).add(sin(uTime.mul(11.0).add(fi.mul(2.4))).mul(0.38));
    const dv = p.sub(edgePath(ti, hf));
    head.addAssign(exp(dot(dv, dv).mul(-1.1)).mul(pulse));
    trail.addAssign(exp(fract(s.sub(ti).add(1.0)).mul(-11.0)).mul(pulse).mul(0.7));
  });

  // 能量配比：rim 呼吸 ~0.16..0.54（压 bloom 阈下，保持牌面可读、rim 色不发白），
  // 拖尾峰值 ~0.85，光点头峰值 ~1.9（唯一稳过 bloom 阈的主光源）；
  // uComets = 绕行光点开关权重（咏唱 1 / 条件金光 0——光点是咏唱的签名造型）
  const energy = rim.mul(breath.mul(0.38).add(0.16))
    .add(trail.mul(rimProx).mul(0.85).mul(uComets))
    .add(head.mul(1.9).mul(uComets));
  // 面片边缘衰减窗（断层修复）：rim 的 exp 外溢渐熄但永不严格到 0，
  // 面片边界处残余 ~0.01 能量被硬截断 → 淡淡色彩断层。在外扩带的外半段把能量
  // 平滑压到恰 0（margin = 牌面到面片边的外扩距离；d 在边中点恰 = margin，角部更大，
  // 面片边界处窗恒为 0）。光点头在卡边（d≈0）不受窗影响。
  const margin = uPlane.x.sub(uCard.x).mul(0.5);
  const edgeFade = oneMinus(smoothstep(margin.mul(0.45), margin.mul(0.95), d));
  return vec4(uColor.mul(energy).mul(uFade).mul(edgeFade), 1.0);
});

// 冷却薄纱（「别弄纯色块覆盖」）：
// 覆盖区 = 顶部 uFrac 高。
//   冷却中（uMode 0）：霜冻膜——霜蓝斑驳 + 竖向冷凝垂纹 + 霜晶闪点（缓闪）+ 冰蓝前沿线；
//   衰败过（uMode 1，冷却被反向推深）：腐蚀膜——暗红血管纹理搏动 + 犬牙侵蚀前沿 + 余烬闪点（急闪）。
// 前沿线位置噪声扰动（冷却细波 / 衰败犬牙），高度变化经 JS 侧 uFrac 收敛驱动（前沿爬行动画）。
// 亮度纪律：指示性特效不抢戏——前沿线峰 ~1.3 压 bloom 阈下；法线混合（要压暗牌面，非发光件）。
const vNoise = Fn(([p]) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2.0).add(3.0));
  return mix(
    mix(vHash(i), vHash(i.add(vec2(1.0, 0.0))), u.x),
    mix(vHash(i.add(vec2(0.0, 1.0))), vHash(i.add(vec2(1.0, 1.0))), u.x),
    u.y);
});
const vFbm = Fn(([p]) =>
  vNoise(p).mul(0.55)
    .add(vNoise(p.mul(2.13).add(vec2(4.7, 9.2))).mul(0.28))
    .add(vNoise(p.mul(4.31).add(vec2(9.4, 2.6))).mul(0.17)));

const veilShade = Fn(([vUv, uTime, uFrac, uMode, uCard]) => {
  // 圆角裁剪（与牌面轮廓一致——薄纱不再顶出方形角）
  const p = vUv.sub(0.5).mul(uCard);
  const corner = oneMinus(smoothstep(-0.25, 0.0, sdRoundBox(p, uCard.mul(0.5), 1.5)));

  const y = vUv.y; // 0 底 1 顶
  // 前沿线（冷却细波 / 衰败犬牙，随时间缓移）
  const jag = mix(0.010, 0.030, uMode);
  const wob = vFbm(vec2(
    vUv.x.mul(mix(14.0, 9.0, uMode)),
    uTime.mul(mix(0.35, 1.1, uMode)),
  )).sub(0.5).mul(2.0).mul(jag);
  const front = oneMinus(uFrac).add(wob);
  const d = y.sub(front); // >0 = 覆盖区内
  const a = smoothstep(0.0, 0.010, d).mul(corner);
  If(a.lessThanEqual(0.002), () => { Discard(); }); // 覆盖区外整片裁掉

  // 覆盖区底纹：冷却 = 斑驳 + 冷凝垂纹；衰败 = 血管状搏动（ridged noise）
  const mottle = vFbm(vUv.mul(vec2(5.0, 7.5)).add(vec2(0.0, uTime.mul(-0.03))));
  const streak = vFbm(vec2(vUv.x.mul(26.0), vUv.y.mul(3.0).add(uTime.mul(0.05))));
  const vein = oneMinus(abs(vFbm(vUv.mul(vec2(7.0, 10.0))
    .add(vec2(uTime.mul(0.06), uTime.mul(-0.10)))).mul(2.0).sub(1.0)))
    .pow(3.0)
    .mul(sin(uTime.mul(5.2)).mul(0.4).add(0.6));
  const texK = mix(mottle.mul(0.7).add(streak.mul(0.3)), vein, uMode);

  // 深度渐变：离前沿越远（越靠顶）越沉——进度读感（刚入冷整片深、将回充只剩顶上一圈深）
  const deep = clamp(d.div(max(uFrac, 0.05)), 0.0, 1.0);
  const tintA = mix(vec3(0.075, 0.125, 0.200), vec3(0.260, 0.055, 0.075), uMode); // 前沿侧
  const tintB = mix(vec3(0.045, 0.075, 0.130), vec3(0.160, 0.035, 0.050), uMode); // 顶部沉色
  const col = mix(tintA, tintB, deep).mul(texK.mul(0.5).add(0.75)).toVar();

  // 闪点：cell 内随机抖动破格点阵（冷却 = 霜晶慢闪 / 衰败 = 余烬急闪）
  const cellUv = vUv.mul(vec2(26.0, 34.0));
  const cid = floor(cellUv);
  const hsh = vHash(cid);
  const cp = fract(cellUv).sub(vec2(vHash(cid.add(7.3)), vHash(cid.add(3.1))).mul(0.5).add(0.25));
  const tw = sin(uTime.mul(mix(2.0, 5.5, uMode)).add(hsh.mul(39.0))).mul(0.5).add(0.5);
  // WGSL 正向边改写：GLSL smoothstep(0.10, 0.0, x) ≡ 1 - smoothstep(0.0, 0.10, x)
  const spark = oneMinus(smoothstep(0.0, 0.10, length(cp)))
    .mul(step(0.62, hsh)).mul(tw).mul(tw);
  const sparkCol = mix(vec3(0.55, 0.80, 1.15), vec3(1.00, 0.30, 0.14), uMode);
  col.addAssign(sparkCol.mul(spark).mul(0.9));

  // 前沿线：细亮核 + 宽晕（压 bloom 阈下；衰败线搏动）
  const pulse = mix(1.0, sin(uTime.mul(5.236)).mul(0.28).add(0.72), uMode);
  const lineCore = exp(abs(d).mul(mix(110.0, 70.0, uMode)).mul(-1.0));
  const lineGlow = exp(abs(d).mul(mix(26.0, 16.0, uMode)).mul(-1.0)).mul(0.35);
  const lineCol = mix(vec3(0.75, 0.95, 1.30), vec3(1.25, 0.42, 0.20), uMode);
  col.addAssign(lineCol.mul(lineCore.mul(1.15).add(lineGlow)).mul(pulse));

  let alpha = a.mul(texK.mul(0.20).add(0.46).add(deep.mul(0.16)));
  alpha = max(alpha, a.mul(lineCore.mul(0.85).add(lineGlow)).mul(pulse)); // 前沿线读得清
  return vec4(col, min(alpha, 0.92));
});

// ---- 将弃/锁定标记面片 ----
// 形状全在 shader 内 SDF 绘制、呼吸由 uTime 驱动（doom 框
// 0.45~0.95 急促（2π/1.2≈5.236）、盖纱反相 0.22~0.34；lock 0.45~0.95 慢（2π/2.4≈2.618)）。

// 将弃描框：圆角矩形环带（心线外扩 0.6、带粗 1.1），加色发光件
const doomFrameShade = Fn(([vUv, uTime, uCard]) => {
  const p = vUv.sub(0.5).mul(uCard.add(DOOM_MARGIN * 2));
  const d = sdRoundBox(p, uCard.mul(0.5).add(0.6), 1.5);
  const ring = oneMinus(smoothstep(0.35, 0.55, abs(d)));
  const k = float(0.5).add(sin(uTime.mul(5.236)).mul(0.5));
  return vec4(vec3(0.847, 0.282, 0.282).mul(ring).mul(float(0.45).add(k.mul(0.5))), 1.0);
});

// 将弃盖纱：牌面圆角内均匀压暗（法线混合；框亮时纱浮、框暗时纱沉的反相轻颤）
const doomVeilShade = Fn(([vUv, uTime, uCard]) => {
  const p = vUv.sub(0.5).mul(uCard);
  const corner = oneMinus(smoothstep(-0.25, 0.0, sdRoundBox(p, uCard.mul(0.5), 1.5)));
  const k = float(0.5).add(sin(uTime.mul(5.236)).mul(0.5));
  return vec4(vec3(0.102, 0.031, 0.031), corner.mul(float(0.34).sub(k.mul(0.12))));
});

// 锁定括号：四角 L 形瞄准框（外扩 1.0、条粗 0.9、臂长 5；abs 镜像折叠
// 到第一象限后取横竖两臂盒 SDF 之并），加色发光件
const lockShade = Fn(([vUv, uTime, uCard]) => {
  const p = vUv.sub(0.5).mul(uCard.add(LOCK_MARGIN * 2));
  const q = abs(p);
  const w = uCard.x.mul(0.5).add(1.0), h = uCard.y.mul(0.5).add(1.0);
  // 横臂盒（心 (w-2.5, h)、半 (2.5, 0.45)）∪ 竖臂盒（心 (w, h-2.5)、半 (0.45, 2.5)）
  const dH = max(abs(q.x.sub(w.sub(2.5))).sub(2.5), abs(q.y.sub(h)).sub(0.45));
  const dV = max(abs(q.x.sub(w)).sub(0.45), abs(q.y.sub(h.sub(2.5))).sub(2.5));
  const mask = oneMinus(smoothstep(-0.25, 0.25, min(dH, dV)));
  const k = float(0.5).add(sin(uTime.mul(2.618)).mul(0.5));
  return vec4(vec3(0.910, 0.635, 0.235).mul(mask).mul(float(0.45).add(k.mul(0.5))), 1.0);
});

// ---- 一次性加色脉冲 shader ----
// 单 shader + scalar uniform 组驱动三种能量演出（控制量打包：uVecA = [prog, mode, intensity, seed]，
// uVecB = [cardW, cardH, reach, 0]——TSL Fn 参数 ≤4 才安全，超参会整体猝死）：
//   mode 0 涌动（默认）：能量自卡心涌出——冲击波亮环外扩（外锋锐/内尾拖、环宽随行渐阔）、
//     中心注能闪、边框共振（环越过牌边时逐片元「充电」，与环位天然相位锁定）、环带闪点；
//   mode 1 汇聚：能量向卡心内坍——环自牌缘加速收缩 + 末段中心迸发（负向/压制语义：衰败/挤压）；
//   mode 2 流扫：对角丝质流光带（≈42°）easeInOut 扫全程 + 尾随淡回波 + 随行闪点（镀金/晋升语义）。
// 包络/环程全由 uProg（0→1）在 shader 内驱动，JS 只推进度；旧 scale 参数折算环程系数 uReach。
// HDR 纪律：环锋/闪点/迸发峰可乘算过 1.45 bloom 阈（uIntensity 推），填充能量压阈下（亮面卡不洗白）。
// 沿带闪点：cell 内随机抖动破格点阵；prox = 片元到带的标量距离（高斯窗内才亮）
const sparkleAlong = Fn(([p, prox, uProg, uSeed]) => {
  const cellUv = p.mul(0.42);
  const cid = floor(cellUv);
  const h1 = vHash(cid.add(uSeed));
  const h2 = vHash(cid.add(vec2(7.3, 3.1).add(uSeed)));
  const cp = fract(cellUv).sub(vec2(0.25, 0.25).add(vec2(h1, h2).mul(0.5)));
  const dot_ = oneMinus(smoothstep(0.0, 0.16, length(cp)));
  const tw = sin(uProg.mul(26.0).add(h1.mul(39.0)).add(uSeed)).mul(0.5).add(0.5);
  return dot_.mul(step(0.72, h1)).mul(tw.mul(tw)).mul(exp(prox.mul(prox).mul(-0.09)));
});

const pulseShade = Fn(([vUv, uVecA, uColor, uVecB]) => {
  const uProg = uVecA.x, uMode = uVecA.y, uIntensity = uVecA.z, uSeed = uVecA.w;
  const uCard = uVecB.xy, uReach = uVecB.z;
  const uPlane = uCard.add(PULSE_MARGIN * 2);   // 面片 = 牌面 + 双边距（标量广播）
  const p = vUv.sub(0.5).mul(uPlane);
  const hf = uCard.mul(0.5);
  const sd = sdRoundBox(p, hf, 1.5);
  const dist = length(p);
  const diag = length(hf);

  // 模式 0 涌动：环程 = easeOutCubic 进度 × 半对角线 × 环程系数
  const ringR0 = oneMinus(pow(oneMinus(uProg), 3.0)).mul(diag).mul(uReach);
  const dd0 = dist.sub(ringR0);
  const sig0 = float(1.05).add(uProg.mul(1.7));
  const band0 = exp(dd0.mul(dd0).mul(-1.0).div(
    select(dd0.greaterThan(0.0), sig0.mul(0.55), sig0.mul(1.2)).pow(2.0))); // 外锋锐、内尾拖
  const env0 = smoothstep(0.0, 0.07, uProg).mul(pow(oneMinus(uProg), 1.35));
  const flash0 = exp(dist.mul(-0.30)).mul(pow(oneMinus(uProg), 3.0)).mul(0.9);  // 中心注能闪
  const rim0 = band0.mul(exp(abs(sd).mul(-0.9))).mul(0.8);                     // 边框共振
  const spark0 = sparkleAlong(p, dd0, uProg, uSeed).mul(1.9);
  const e0 = band0.mul(1.35).add(flash0).add(rim0).add(spark0).mul(env0);

  // 模式 1 汇聚：环自牌缘内坍（(1-p)² 加速），末段中心迸发
  const ringR1 = pow(oneMinus(uProg), 2.0).mul(diag).mul(min(uReach, 1.0));
  const dd1 = dist.sub(ringR1);
  const sig1 = float(0.95).add(uProg.mul(1.1));
  const band1 = exp(dd1.mul(dd1).mul(-1.0).div(sig1.mul(sig1)));
  const env1 = smoothstep(0.0, 0.06, uProg)
    .mul(oneMinus(uProg.mul(0.30)))
    .mul(oneMinus(smoothstep(0.90, 1.0, uProg)));
  const burst1 = exp(dist.mul(-0.42))
    .mul(smoothstep(0.62, 0.92, uProg))
    .mul(oneMinus(smoothstep(0.92, 1.0, uProg))).mul(1.35);
  const spark1 = sparkleAlong(p, dd1, uProg, uSeed).mul(1.5);
  const e1 = band1.mul(1.15).add(burst1).add(spark1).mul(env1);

  // 模式 2 流扫：对角亮带 easeInOut 扫全程；丝质条纹沿带向调制（方向烘归一化常量）
  const sAlong = dot(p, vec2(0.7413, 0.6712));
  const sPerp = dot(p, vec2(-0.6712, 0.7413));
  const sb2 = mix(diag.mul(-1.15), diag.mul(1.15), smoothstep(0.0, 1.0, uProg));
  const dd2 = sAlong.sub(sb2);
  const band2 = exp(dd2.mul(dd2).mul(-0.0868));              // σ=2.4（-1/(2σ²)）
  const echo2 = exp(dd2.add(5.5).pow(2.0).mul(-0.22)).mul(0.35); // 尾随淡回波（σ≈1.5）
  const silk = sin(sPerp.mul(9.5)).mul(0.12)
    .add(sin(sPerp.mul(23.0).add(uSeed)).mul(0.08)).add(0.80);
  const env2 = smoothstep(0.0, 0.14, uProg).mul(oneMinus(smoothstep(0.78, 1.0, uProg)));
  const spark2 = sparkleAlong(p, dd2.mul(0.8), uProg, uSeed).mul(1.6);
  const e2 = band2.mul(silk).add(echo2).mul(1.15).add(spark2).mul(env2);

  const energy = select(uMode.lessThan(0.5), e0, select(uMode.lessThan(1.5), e1, e2));
  // 形状窗：卡内全量；卡外溢出带 exp 衰减（环/共振越过牌边的余韵）；
  // 面片边缘窗把能量在外半 margin 压到恰 0（防硬截断色彩断层，同 edgeShade 纪律；
  // 1.6/3.8 = PULSE_MARGIN×0.4/0.95）
  const shape = select(sd.lessThan(0.0), float(1.0), exp(max(sd, 0.0).mul(-1.15)));
  const edgeFade = oneMinus(smoothstep(1.6, 3.8, sd));
  return vec4(uColor.mul(energy).mul(uIntensity).mul(shape).mul(edgeFade), 1.0);
});

export class CardFxLayer extends THREE.Group {
  constructor({ width = 20, height = 27, faceMaterial = null } = {}) {
    super();
    this.name = 'fx';
    this._w = width;
    this._h = height;
    // C0：牌面本体补丁记录（faceMaterial 由 CardObject 传入；幂等 attach，无材质=占位场景）
    this.body = faceMaterial ? attachCardBodyFx(faceMaterial) : null;
    this._dim = 0; this._dimT = 0;         // 禁用压暗（当前值/目标值——update 收敛）
    this._hl = 0; this._hlT = 0;           // 高亮提暖（同上）
    this._t = 0;             // 层内统一时钟（盖纱呼吸相位共用，也喂 C0 的 uTime）
    this._veil = null;       // 冷却薄纱平面（全牌面几何，覆盖高度走 shader uFrac）
    this._veilUniforms = null;
    this._veilMode = null;   // null | 'cooling' | 'decayed'
    this._veilFrac = 0;      // 当前展示的剩余比例（update 里向目标收敛 = 前沿爬行动画）
    this._veilFracTarget = 0;
    this._chip = null;       // 冷却拍数水印（随薄纱显示）
    this._chipN = null;      // 水印当前数字（重烘判据）
    this._doom = null;       // 将弃特效组（盖纱 + 描框两张 TSL 面片，惰性创建）
    this._doomUniforms = null; // { uTime, uCard }——盖纱/描框共相位（呼吸全在 shader 内）
    this._lock = null;       // 锁定括号面片（TSL shader 单件，惰性创建）
    this._lockUniforms = null;
    this._pulse = null;      // 脉冲面片（TSL shader，惰性创建）
    this._pulseTl = null;    // { elapsed, duration } | null
    this._pulseUniforms = null; // uVecA[prog,mode,intensity,seed] / uColor / uVecB[cardW,cardH,reach,-]
    this._react = null;      // 反应演出时间线 { t, i }（C0 shader 块，见 cardBodyFx.cbfReact）
    this._edgeGlow = null;   // 咏唱流光面片（自定义 shader，惰性创建）
    this._edgeUniforms = null; // 面片 uniforms 句柄（update 推进 uTime/uFade）
    this._condOn = false;    // 条件金光目标态（与咏唱流光互斥展示，咏唱优先）
    this._condGlow = null;   // 条件金光面片（同 shader、无绕行光点）
    this._condUniforms = null;
  }

  /**
   * 卡面反应演出（受益/副作用发动）：C0 牌面 shader 配方，体系 × 极性选 mode
   * （cardBodyFx.CARD_REACT_MODES / cardReactMode 解析）。重触发重置时间线；
   * 包络（攻击→保持→衰减）由 update() 自推进，播完自动归零。
   */
  react({ mode = 9, intensity = 1 } = {}) {
    if (!this.body) return;
    this.body.uReactKind.value = mode;
    this.body.uReactSeed.value = Math.random() * 97.0;
    this._react = { t: 0, i: Math.max(0.2, intensity) };
  }

  /**
   * 一次性加色脉冲（冷却推进/衰败反向/威力提升/施术起手）。
   * mode：0 涌动（默认）| 1 汇聚（负向/压制）| 2 流扫（镀金/晋升）；
   * intensity：HDR 强度（环锋/闪点乘算过 1.45 bloom 阈）；scale 折算环程系数。
   * 包络在 shader 内由 uProg 驱动；重触发即重置时间线（新脉冲顶掉旧脉冲）。
   */
  pulse({ color = 0xffffff, durationMs = 220, scale = 1.2, mode = 0, intensity = 1 } = {}) {
    if (!this._pulse) {
      this._pulseUniforms = {
        uVecA: uniform(new THREE.Vector4(0, 0, 1, 0)),          // prog/mode/intensity/seed
        uColor: uniform(new THREE.Color(0xffffff)),
        uVecB: uniform(new THREE.Vector4(this._w, this._h, 1, 0)), // cardW/cardH/reach/-
      };
      // 加法光不占地（uiScene RT 合成约定，passes.js 铁律②）
      const mat = additiveLight(new MeshBasicNodeMaterial({
        transparent: true, depthWrite: false,
      }));
      mat.colorNode = pulseShade(
        uv(), this._pulseUniforms.uVecA, this._pulseUniforms.uColor, this._pulseUniforms.uVecB);
      this._pulse = new THREE.Mesh(
        new THREE.PlaneGeometry(this._w + PULSE_MARGIN * 2, this._h + PULSE_MARGIN * 2), mat);
      this._pulse.position.z = 0.45;
      this._pulse.visible = false;
      this.add(this._pulse);
    }
    const u = this._pulseUniforms;
    u.uColor.value.set(color);
    u.uVecA.value.set(0, mode, intensity, Math.random() * 97.0);
    u.uVecB.value.z = 0.55 + 0.45 * scale;   // scale 参数折算环程系数
    this._pulseTl = { elapsed: 0, duration: Math.max(0.001, durationMs / 1000) };
    this._pulse.visible = true;
  }

  get pulseColor() { return this._pulseUniforms?.uColor.value.getHex() ?? null; }
  get pulseVisible() { return !!this._pulse?.visible; }

  /**
   * C0 牌面状态档：normal | disabled（去饱和压暗）| highlighted（提暖呼吸）。
   * 只设目标值——update 里向目标 lerp 收敛（切换带一拍过渡，不瞬跳）。幂等。
   */
  setVisualState(state) {
    this._dimT = state === 'disabled' ? 1 : 0;
    this._hlT = state === 'highlighted' ? 1 : 0;
  }

  /** 冷却薄纱：null 关闭 | 'cooling' 冷却中 | 'decayed' 衰败过（冷却超基准）。
   *  remaining = 剩余拍数（水印数字，>0 才显示）；fraction = 剩余冷却比例 0..1
   * （覆盖高度：1=刚入冷整片罩住、0.5=冷了一半——前沿爬行在 update 里平滑收敛）。幂等。 */
  setCooling(mode, remaining = 0, fraction = 0) {
    const n = mode && remaining > 0 ? remaining : null;
    const f = mode ? Math.min(1, Math.max(0, fraction)) : 0;
    if (mode === this._veilMode && n === this._chipN && f === this._veilFracTarget) return;
    this._veilMode = mode;
    this._veilFracTarget = f;
    if (!mode) {
      // 收起也走收敛动画（薄纱向上退尽后隐藏），不瞬切
      if (this._chip) this._chip.visible = false;
      this._chipN = null;
      return;
    }
    if (!this._veil) {
      // TSL uniform() 节点——对外仍是 `{ uX: { value } }` 推值口径（update 推流点零改动）
      this._veilUniforms = {
        uTime: uniform(0),
        uFrac: uniform(0),
        uMode: uniform(0),
        uCard: uniform(new THREE.Vector2(this._w, this._h)),
      };
      const mat = new MeshBasicNodeMaterial({
        transparent: true, blending: THREE.NormalBlending, depthWrite: false,
      });
      // colorNode 全量接管输出：vec4 的 a 通道即片元透明度（原 shader 写 alpha 的语义
      // 由 colorNode.a 表达）；If/Discard 已在 veilShade Fn 栈内
      mat.colorNode = veilShade(
        uv(), this._veilUniforms.uTime, this._veilUniforms.uFrac,
        this._veilUniforms.uMode, this._veilUniforms.uCard);
      this._veil = new THREE.Mesh(new THREE.PlaneGeometry(this._w, this._h), mat);
      this._veil.position.z = 0.35;
      this._veilFrac = 0; // 从 0 长出来 = 入冷时霜膜自牌顶罩下的动画
      this.add(this._veil);
    }
    if (this._veil) {
      this._veilUniforms.uMode.value = mode === 'decayed' ? 1 : 0;
      this._veil.visible = true;
    }
    this._setChip(n);
  }

  /** 拍数水印建/改/收（内部）：n=null 收起；否则烘低透明度平面白字数字。 */
  _setChip(n) {
    if (n === this._chipN) return;
    this._chipN = n;
    if (n === null) {
      if (this._chip) this._chip.visible = false;
      return;
    }
    if (!this._chip) {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true, opacity: CHIP_LAYOUT.opacity, depthWrite: false,
      });
      this._chip = new THREE.Mesh(
        new THREE.PlaneGeometry(CHIP_LAYOUT.w, CHIP_LAYOUT.h), mat);
      this._chip.position.set(0, CHIP_LAYOUT.y, CHIP_LAYOUT.z);
      this.add(this._chip);
    }
    const old = this._chip.material.map;
    this._chip.material.map = bakeChipTexture(n);
    this._chip.material.needsUpdate = true;
    old?.dispose?.();
    this._chip.visible = true;
  }

  get coolingMode() { return this._veilMode; }

  /** 咏唱激活边缘流光开关（幂等）：呼吸 rimlight + 绕行脉动光点，单面片自定义
   *  shader（HDR 输出喂 bloom）。点亮有短淡入；时间推进在 update(dt)。
   *  与条件金光同卡互斥：咏唱激活优先（蓝金双 rim 叠色不可读）。 */
  setEdgeGlow(on) {
    if (on === !!this._edgeGlow) return;
    if (on) {
      this._setCondMesh(false);
      ({ mesh: this._edgeGlow, uniforms: this._edgeUniforms } = this._makeEdgeMesh(
        new THREE.Color(0.58, 0.76, 1.05), 1)); // 咏唱蓝（金色留给条件金光）
    } else {
      this._disposeEdgeMesh();
      if (this._condOn) this._setCondMesh(true);
    }
  }

  get hasEdgeGlow() { return !!this._edgeGlow; }

  /** 「条件满足」金光开关（幂等）：呼吸感金色 rim、无绕行光点（那是咏唱的签名）。
   *  驱动源 = 投影 condMet（def.condition 声明的条件加成当前成立）+ 弃牌模式的
   *  灵活卡标记（sync 侧合流后推这里）；咏唱流光在场时不展示，流光熄灭自动补挂。 */
  setCondGlow(on) {
    if (on === !!this._condOn) return;
    this._condOn = on;
    if (this._edgeGlow) return;
    this._setCondMesh(on);
  }

  get hasCondGlow() { return !!this._condGlow; }

  // 边缘光面片工厂（咏唱流光/条件金光共用）：comets = 绕行光点权重
  _makeEdgeMesh(color, comets) {
    const pw = this._w + EDGE_MARGIN * 2, ph = this._h + EDGE_MARGIN * 2;
    // TSL uniform() 节点——update 推流点（uTime/uFade `.value`）零改动
    const u = {
      uTime: uniform(this._t),
      uFade: uniform(0),
      uCard: uniform(new THREE.Vector2(this._w, this._h)),
      uPlane: uniform(new THREE.Vector2(pw, ph)),
      uColor: uniform(color),
      uComets: uniform(comets),
    };
    const mat = additiveLight(new MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
    }));
    // colorNode 全量接管输出：rgb 直接 HDR（过 bloom 阈刻意保留），alpha 恒 1
    mat.colorNode = edgeShade(uv(), u.uTime, u.uFade, u.uCard, u.uPlane, u.uColor, u.uComets);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), mat);
    // z=0.4：低于手牌扇相邻卡间隔（静息 z=10+n·0.5）——透明队列按中心深度排序，
    // 若高过邻牌间隔，光环会画在右侧邻牌之上、永远挡住邻牌。
    // 0.4 < 0.5 → 邻牌盖住本卡时连同光环外溢一起盖住。同时高于牌面
    // 内层件（veil 0.35），rim 内收带仍可读。
    mesh.position.z = 0.4;
    this.add(mesh);
    return { mesh, uniforms: u };
  }

  _disposeEdgeMesh() {
    if (!this._edgeGlow) return;
    this.remove(this._edgeGlow);
    this._edgeGlow.geometry.dispose();
    this._edgeGlow.material.dispose();
    this._edgeGlow = null;
    this._edgeUniforms = null;
  }

  _setCondMesh(on) {
    if (on === !!this._condGlow) return;
    if (on) {
      ({ mesh: this._condGlow, uniforms: this._condUniforms } = this._makeEdgeMesh(
        new THREE.Color(1.0, 0.84, 0.42), 0)); // 呼吸感金光
    } else {
      if (this._condGlow) {
        this.remove(this._condGlow);
        this._condGlow.geometry.dispose();
        this._condGlow.material.dispose();
      }
      this._condGlow = null;
      this._condUniforms = null;
    }
  }

  /** 「将弃」标记（P9 尾弃预告 + 弃牌选择未确认预告）：红色呼吸描边框 + 暗化盖纱。
   *  两张 TSL 面片（盖纱法线混合压暗 / 描框加色发光），呼吸全在 shader 内由 uTime
   *  驱动（update 只推统一时钟）。幂等。 */
  setDoomed(on) {
    if (on === !!this._doom) return;
    if (!on) {
      this.remove(this._doom);
      this._doom.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      this._doom = null;
      this._doomUniforms = null;
      return;
    }
    this._doomUniforms = {
      uTime: uniform(this._t),
      uCard: uniform(new THREE.Vector2(this._w, this._h)),
    };
    const g = new THREE.Group();
    g.name = 'doom';
    // 暗化盖纱（普通混合压暗牌面——"这张牌要离开了"的沉下去感；加色系特效压不住它）
    const shadeMat = new MeshBasicNodeMaterial({
      transparent: true, blending: THREE.NormalBlending, depthWrite: false,
    });
    shadeMat.colorNode = doomVeilShade(uv(), this._doomUniforms.uTime, this._doomUniforms.uCard);
    const shade = new THREE.Mesh(new THREE.PlaneGeometry(this._w, this._h), shadeMat);
    shade.position.z = 0.36;
    g.add(shade);
    // 四边描框（呼吸主件，加色发光；面片比牌面外扩，形状在 shader 内 SDF 绘制）
    const frameMat = additiveLight(new MeshBasicNodeMaterial({
      transparent: true, depthWrite: false,
    }));
    frameMat.colorNode = doomFrameShade(uv(), this._doomUniforms.uTime, this._doomUniforms.uCard);
    const frame = new THREE.Mesh(
      new THREE.PlaneGeometry(this._w + DOOM_MARGIN * 2, this._h + DOOM_MARGIN * 2), frameMat);
    frame.position.z = 0.5;
    g.add(frame);
    this._doom = g;
    this.add(g);
  }

  get hasDoomMark() { return !!this._doom; }

  /** 「锁定」标记（无人战体「解除威胁」）：警戒琥珀色四角括号 + 慢呼吸——
   *  区别于将弃的红色整框（锁定是「被瞄准」，将弃是「要离开」）。
   *  单张 TSL 面片（加色发光；四角 SDF 与呼吸全在 shader 内）。幂等。 */
  setLocked(on) {
    if (on === !!this._lock) return;
    if (!on) {
      this.remove(this._lock);
      this._lock.traverse(o => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      this._lock = null;
      this._lockUniforms = null;
      return;
    }
    this._lockUniforms = {
      uTime: uniform(this._t),
      uCard: uniform(new THREE.Vector2(this._w, this._h)),
    };
    const mat = additiveLight(new MeshBasicNodeMaterial({
      transparent: true, depthWrite: false,
    }));
    mat.colorNode = lockShade(uv(), this._lockUniforms.uTime, this._lockUniforms.uCard);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(this._w + LOCK_MARGIN * 2, this._h + LOCK_MARGIN * 2), mat);
    mesh.position.z = 0.44;
    mesh.name = 'lock';
    this._lock = mesh;
    this.add(mesh);
  }

  get hasLockMark() { return !!this._lock; }

  /** 焚毁等接管牌面前：熄灭全部叠加特效（不销毁资源——卡随后整体 dispose）。 */
  clearTransient() {
    this.setEdgeGlow(false);
    this.setCondGlow(false);
    this.setCooling(null);
    this.setDoomed(false);
    this.setLocked(false);
    if (this._pulse) this._pulse.visible = false;
    this._pulseTl = null;
    if (this._pulseUniforms) this._pulseUniforms.uVecA.value.x = 0;
    this._react = null;
    if (this.body) { this.body.uReact.value = 0; this.body.uReactKind.value = 0; }
  }

  /** 帧驱动：C0 状态收敛与钟 / 脉冲进度回程 / 反应包络 / 盖纱呼吸 / 流光 shader 时钟与淡入。 */
  update(dt) {
    this._t += dt;
    if (this.body) {
      // C0：钟常驻推进（高亮呼吸用）；dim/highlight 向目标收敛（~10/s——状态切换有过渡）
      this.body.uTime.value = this._t;
      const k = 1 - Math.exp(-10 * dt);
      this._dim += (this._dimT - this._dim) * k;
      this._hl += (this._hlT - this._hl) * k;
      if (Math.abs(this._dimT - this._dim) < 1e-3) this._dim = this._dimT;
      if (Math.abs(this._hlT - this._hl) < 1e-3) this._hl = this._hlT;
      this.body.uDim.value = this._dim;
      this.body.uHighlight.value = this._hl;
      // 反应包络：70ms 攻击 → 120ms 保持 → 620ms 衰减，峰值 = intensity
      if (this._react) {
        const r = this._react;
        r.t += dt;
        const e = r.t < 0.07 ? r.t / 0.07
          : r.t < 0.19 ? 1
            : Math.max(0, 1 - (r.t - 0.19) / 0.62);
        this.body.uReact.value = e * r.i;
        this.body.uReactTime.value = r.t;
        if (e <= 0 && r.t >= 0.19) {
          this._react = null;
          this.body.uReact.value = 0;
          this.body.uReactKind.value = 0;
        }
      }
    }
    if (this._pulse?.visible && this._pulseTl) {
      this._pulseTl.elapsed += dt;
      const k = Math.min(this._pulseTl.elapsed / this._pulseTl.duration, 1);
      this._pulseUniforms.uVecA.value.x = k;  // 包络/环程全在 shader 内由 uProg 驱动
      if (k >= 1) {
        this._pulse.visible = false;
        this._pulseTl = null;
        this._pulseUniforms.uVecA.value.x = 0;
      }
    }
    if (this._veil) {
      // 覆盖高度收敛动画：入冷时从牌顶罩下、每推进一拍前沿向上退一截、回充后退尽隐藏
      const k = 1 - Math.exp(-VEIL_LERP * dt);
      this._veilFrac += (this._veilFracTarget - this._veilFrac) * k;
      if (Math.abs(this._veilFracTarget - this._veilFrac) < 1e-3) this._veilFrac = this._veilFracTarget;
      if (!this._veilMode && this._veilFrac <= 0) {
        this._veil.visible = false;
      } else if (this._veil.visible) {
        this._veilUniforms.uFrac.value = this._veilFrac;
        this._veilUniforms.uTime.value = this._t; // 呼吸/闪烁/纹理漂移全在 shader 内
      }
    }
    // 将弃/锁定：呼吸全在 shader 内，只推统一时钟
    if (this._doomUniforms) this._doomUniforms.uTime.value = this._t;
    if (this._lockUniforms) this._lockUniforms.uTime.value = this._t;
    for (const u of [this._edgeUniforms, this._condUniforms]) {
      if (!u) continue;
      u.uTime.value = this._t;
      const f = u.uFade;
      f.value = Math.min(1, f.value + dt * EDGE_FADE_IN); // 点亮淡入
    }
  }

  dispose() {
    this.clearTransient();
    // C0 归零防御：补丁记录挂在材质 userData 上，材质随后由 CardObject 销毁——
    // 归零防的是「材质先死、补丁引用被别处摸到」的悬空读出
    if (this.body) {
      this.body.uBurn.value = 0;
      this.body.uDim.value = 0;
      this.body.uHighlight.value = 0;
      this.body.uReact.value = 0;
      this.body.uReactKind.value = 0;
    }
    if (this._pulse) {
      this.remove(this._pulse);
      this._pulse.geometry.dispose();
      this._pulse.material.dispose();
      this._pulse = null;
      this._pulseUniforms = null;
    }
    if (this._veil) {
      this.remove(this._veil);
      this._veil.geometry.dispose();
      this._veil.material.dispose();
      this._veil = null;
    }
    if (this._chip) {
      this.remove(this._chip);
      this._chip.geometry.dispose();
      this._chip.material.map?.dispose?.();
      this._chip.material.dispose();
      this._chip = null;
    }
  }
}

// 拍数水印烘焙：平面白字（透明度由材质统一压到 CHIP_LAYOUT.opacity），不描边不发光；
// node 无 document 走占位
function bakeChipTexture(n) {
  if (typeof document === 'undefined') {
    const texture = new THREE.Texture();
    texture.needsUpdate = true;
    return texture;
  }
  const size = 144; // 正方形画布，数字居中
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const g = canvas.getContext('2d');
  const text = String(n);
  const fontPx = text.length >= 2 ? 66 : 88;
  g.font = `${fontPx}px ${UI_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#eef3fd';
  g.fillText(text, size / 2, size / 2 + 3);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
