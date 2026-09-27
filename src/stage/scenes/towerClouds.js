// 雪云体积渲染（towerWilderness 的大气件，2026-09-16 用户定开工）——WebGPU 迁移 TSL 版
// （2026-09-22，原三段 GLSL（march/blur/composite）逐式平移，.glsl 源文件随之删除）：
// **三段管线**（用户定正确修法，结构与 GLSL 版一致）：
//   ① mesh pass：场景（穹顶/雪原/塔/雪粒子）渲进 rtScene——HalfFloat linear 色 + 深度纹理
//     （进 RT 时渲染器按目标判定不套 tone map/sRGB，整帧只在末段走一次）；
//   ② 云 raymarch：1/4 分辨率 → rtCloud，**逐像素读场景深度线性化，march 到几何面
//     终止**（几何在板前=全遮、几何在板内=transmittance 累积到面前）+ 小域可分离 blur；
//   ③ transmittance 合成：col = cloudInscatter + scene * T → 屏幕。
// 接入 = StageManager 的 composeScene 钩子（MapStage 委托 composeFrame，BattleStage
// 体积光同范式）；云体 = Worley base + perlin+worley detail 侵蚀 + 独立随风 offset 场。
// 云板按 y 求交，相机在云下/云内/云上三种相对位置同一路径（TOWER.md 四阶段）。
// node/headless 可安全构造（RT/材质创建不触 GL；管线只在浏览器 composeFrame 里跑）。
//
// TSL 化要点（范式见 fx/unitBodyFx.js 头注六条；结构参照 scenes/volumetricMoon.js）：
//   · 满屏大三角形顶点 trick → passes.js 的 makeFullScreenPass（PlaneGeometry(2,2)+
//     正交相机）；四角世界射线的插值改在片元做 mix(mix(A,B,x),mix(C,D,x),y)——
//     quad 上逐像素与旧 vUv 线性插值相等（双线性 vs 线性外推在可见区内逐像素同值）；
//   · **NDC 深度不翻倍**：sceneRayDist 的线性化式本就是 [0,1] 深度约定（d=1 →
//     viewZ=-far），对 WebGL 窗口深度与 WebGPU 投影 z∈[0,1] 逐项成立（three 的
//     WebGPU 坐标系投影恰使 ndc z 与旧窗口深度同值）——无 z*2-1 类残留可删；
//   · march 早退：uMaxSteps 是调参位 uniform（非编译期常量）→ Loop 用固定 64 上界 +
//     Break()（步数用尽 / 走出板 / 透射率趋零，GLSL break 三条件逐条对应）；
//   · blur 自译而非复用 passes.js 的 tslBlur——后者只糊 rgb 且 alpha 写 1，会毁掉
//     march 输出的透射率 alpha（composite 的 1-cl.a 依赖它）；本件 rgba 全通道同核；
//   · **composite 直出线性 HDR**：tone map + sRGB 统一由渲染器帧末输出 blit 施加
//     （flavor A，passes.js 头注「输出变换铁律」，2026-09-27 用户定）——本件不碰
//     renderer.toneMapping；曾短暂改回节点内 tone（UI pass 摘除窗口冲掉 blit tone
//     的病灶，probe-blit 实测），flavor A 统一后病灶根除；
//   · uniforms 全部 TSL uniform() 节点：key 与 .value 语义逐字不变（towerWilderness/
//     cloudGallery 的 syncParams 与 knob 直推 uniforms.uXxx.value——含 Vector2/Color
//     的 set/setHex/copy 与 uFogColor 换共享 Color 实例，零改动）；纹理输入 =
//     TextureNode，composeFrame 每帧换 .value（场景深度 / blur 源 / composite 双源）；
//     blackTex 兜底初始化防首帧 null。
import * as THREE from 'three';
import {
  Fn, If, Loop, Break, uniform, texture, uv, screenCoordinate, select,
  vec2, vec3, vec4, float, bool, mix, clamp, abs, max, min, mod, pow, sqrt,
  exp, fract, sin, dot, length, floor, smoothstep, oneMinus,
} from 'three/tsl';
import { makeFullScreenPass, renderFullScreenPass, disposeFullScreenPass, passUV } from '../post/passes.js';

const RT_SCALE = 0.25;          // 云 RT 1/4 分辨率（用户定：省性能 + blur 降噪）
const CORNER_NDC = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
const PI = 3.141592653589793;

// ---- 分章观感预设（TOWER.md 四阶段；全部为用户 cloudGallery 实调值，2026-09-16）----
// 云板几何对齐塔楼（用户定：11 层 boss 前恰在云外、12-33 层完全在云内、34 层起云上）：
// 层 f 相机锚 y = -58.5+(f-0.5)×7 → 11 层 15 / 12 层 22 / 33 层 169 / 34 层 176。
// base 18 = 11 层上方 3 / 12 层下方 4；top 174 = 33 层上方 5 / 34 层下方 2。
// ch1 = 一章塔外·云底仰视；ch2 = 二/三章·云中。towerWilderness.setStormLevel 按层
// 在两套之间插值（爬升跨章连续渐变）；三/四章云观感待美术 pass 后在此追加。
// haze 语义 = 云雾等效密度（march 侧与场景 FogExp2 同为平方指数 ramp）：ch1 取
// 0.005 → 云堤在 t0≈350 全融、头顶（t0≈73）仅 ~13% 融——远处云与地面在全雾距离
// 处同步抹平（2026-09-16 用户定：远云/天暗成雾色消接缝）。
// underShade = 相机在云板下时的云体压暗系数（一章云底仰视暗一点，云底背光）。
export const CLOUD_PRESETS = {
  ch1: {
    base: 18, top: 174, scale: 69, coverage: 0.83, density: 0.15,
    stepSize: 7, steps: 32, haze: 0.005, underShade: 0.78,
    windX: -2.5, windZ: 2.5, sun: 1.3,
    detailAmt: 0.5, detailFreq: 0.2, warpAmt: 18, warpFreq: 0.032,
    gustBoost: 2.3, innerStep: 0.55, nearFadeStart: 6, nearFadeEnd: 45, nearFadeAmt: 0.35,
  },
  ch2: {
    base: 18, top: 174, scale: 82, coverage: 0.77, density: 0.15,
    stepSize: 7, steps: 32, haze: 0.005, underShade: 1,
    windX: -1.5, windZ: 0, sun: 1.3,
    detailAmt: 0.85, detailFreq: 0.31, warpAmt: 18, warpFreq: 0.032,
    gustBoost: 3.5, innerStep: 0.25, nearFadeStart: 0, nearFadeEnd: 35, nearFadeAmt: 0.1,
  },
};

// ================= 云 march 节点链（GLSL towerClouds.march.frag.glsl 逐式平移）=================

const tcHash3 = Fn(([p]) => {
  return fract(sin(vec3(
    dot(p, vec3(127.1, 311.7, 74.7)),
    dot(p, vec3(269.5, 183.3, 246.1)),
    dot(p, vec3(113.5, 271.9, 124.6)))).mul(43758.5453));
});

// Worley F1 反相（billow：单元中心亮=云团）。27 邻域标准实现。
// GLSL 的 x/y/z 三重 -1..1 循环展平成一重 27 次循环（k = (x+1)+3(y+1)+9(z+1)；
// min 累积与遍历顺序无关，数学等价）。
const tcWorley = Fn(([q, cell]) => {
  const f = q.div(cell);
  const i = floor(f);
  const fr = fract(f);
  const d = float(1e9).toVar();
  Loop(27, ({ i: k }) => {
    const kf = float(k);
    const g = vec3(kf.mod(3.0), kf.div(3.0).mod(3.0), kf.div(9.0)).sub(1.0);
    const o = tcHash3(i.add(g));
    const r = g.add(o).sub(fr);
    d.assign(min(d, dot(r, r)));
  });
  return oneMinus(clamp(sqrt(d), 0.0, 1.0));
});

// 云密度场：2 倍频 worley（细层以 0.35 倍风速漂移 → 层间剪切=滚动感）+ 垂直剖面
// （云底平齐、中段最厚、顶缘碎散）。返回 >0 的"过门槛密度"，0 = 空气。
// 注意：调用方先把采样点经 warpOffset 域扭曲——本函数只管 base 形状。
const tcCloudField = Fn(([u, p]) => {
  const adv = vec3(u.uCloudWind.x, 0.0, u.uCloudWind.y).mul(u.uCloudTime);
  const q = p.add(adv);
  const w = tcWorley(q, u.uCloudScale).mul(0.62)
    .add(tcWorley(
      q.mul(2.6).add(vec3(31.7, 11.3, 7.7))
        .add(vec3(u.uCloudWind.x, 0.0, u.uCloudWind.y).mul(u.uCloudTime).mul(-0.65)),
      u.uCloudScale).mul(0.38));
  const hr = clamp(p.y.sub(u.uCloudBase).div(max(1.0, u.uCloudTop.sub(u.uCloudBase))), 0.0, 1.0);
  const profile = smoothstep(0.0, 0.16, hr).mul(oneMinus(smoothstep(0.68, 1.0, hr)));
  return max(w.mul(profile).sub(oneMinus(u.uCoverage)), 0.0);
});

// 值噪音（quintic 插值 8 角）——perlin 通道的便宜实现，fbm 后观感一致
const tcHash1 = Fn(([p]) => fract(sin(dot(p, vec3(127.1, 311.7, 74.7))).mul(43758.5453)));

const tcVnoise = Fn(([p]) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2.0).add(3.0));
  return mix(
    mix(mix(tcHash1(i), tcHash1(i.add(vec3(1.0, 0.0, 0.0))), u.x),
        mix(tcHash1(i.add(vec3(0.0, 1.0, 0.0))), tcHash1(i.add(vec3(1.0, 1.0, 0.0))), u.x), u.y),
    mix(mix(tcHash1(i.add(vec3(0.0, 0.0, 1.0))), tcHash1(i.add(vec3(1.0, 0.0, 1.0))), u.x),
        mix(tcHash1(i.add(vec3(0.0, 1.0, 1.0))), tcHash1(i.add(vec3(1.0, 1.0, 1.0))), u.x), u.y),
    u.z);
});

// 细节侵蚀场：**perlin + worley**（用户定），独立于主场的更快随风 advect——
// 高频絮条以错速扫过云体 → 云内视角读作薄纱掠面。
// gust = 云内阵风倍率（GLSL 版的文件级 g_gust 可变全局在 TSL 无对应物，改穿参）。
const tcDetailField = Fn(([u, p, gust]) => {
  const q = p.add(vec3(u.uCloudWind.x, 0.0, u.uCloudWind.y)
    .mul(u.uCloudTime.mul(1.45).mul(gust))).mul(u.uDetailFreq);
  return tcVnoise(q).mul(0.62)
    .add(tcWorley(q.add(vec3(11.3, 5.1, 8.7)), 1.35).mul(0.38));
});

// 独立随风 offset 场：**perlin + worley**（用户定）——主场采样点被它水平推着走。
// 云内视角 gust 加速 → 阵风脉冲 + 薄纱层掠过的大风感；wo y 分量为 0（风是水平的）。
const tcWarpOffset = Fn(([u, p, gust]) => {
  const q = p.add(vec3(u.uCloudWind.x, 0.0, u.uCloudWind.y)
    .mul(u.uCloudTime.mul(0.85).mul(gust))).mul(u.uWarpFreq);
  const wx = tcVnoise(q).sub(0.5);
  const wz = tcVnoise(q.add(vec3(23.7, 11.9, 5.3))).sub(0.5);
  const gustPulse = tcWorley(q.mul(0.73).add(vec3(3.1, 17.3, 9.7)), 1.21).sub(0.55); // 阵风脉冲通道
  return vec3(wx, 0.0, wz)
    .add(vec3(gustPulse.mul(0.35), 0.0, gustPulse.mul(-0.28)))
    .mul(u.uWarpAmt);
});

const tcHgPhase = Fn(([c, g]) => {
  const g2 = g.mul(g);
  return float(1.0).sub(g2)
    .div(pow(float(1.0).add(g2).sub(g.mul(c).mul(2.0)), 1.5).mul(4.0 * PI));
});

// 光 march 用的密度场 lite 版：单倍频 worley + 剖面（27 tap）。完整场的 warp/detail
// 对遮蔽贡献是二阶的，光 march 每样本省下 100+ tap。
const tcCloudDensityLite = Fn(([u, p]) => {
  const adv = vec3(u.uCloudWind.x, 0.0, u.uCloudWind.y).mul(u.uCloudTime);
  const w = tcWorley(p.add(adv), u.uCloudScale);
  const hr = clamp(p.y.sub(u.uCloudBase).div(max(1.0, u.uCloudTop.sub(u.uCloudBase))), 0.0, 1.0);
  const profile = smoothstep(0.0, 0.16, hr).mul(oneMinus(smoothstep(0.68, 1.0, hr)));
  return max(w.mul(profile).sub(oneMinus(u.uCoverage)), 0.0);
});

// 光 march（点光）：朝灯 4 步粗采样密度场，返回光学深度（未乘消光系数）。
// 点光只被「灯与样本之间」的云遮蔽——步进上限 = min(灯距, 40)。
const tcLightMarch = Fn(([u, p, L, distL]) => {
  const stepL = min(distL, 40.0).div(4.0);
  const od = float(0.0).toVar();
  Loop(4, ({ i }) => {
    od.addAssign(tcCloudDensityLite(u, p.add(L.mul(stepL.mul(float(i).add(1.0))))).mul(stepL));
  });
  return od;
});

// 多重散射近似（Schneider multi-octave，实时渲染惯用；用户描述的「更 smooth 的
// phase + 指数衰减后的光强」即第 2+ 档=间接光估计）：od = 朝光光学深度，每档
// 消光衰减 a、贡献衰减 b、相位平滑 c——低档 = 锐银边直接光，高档 = 包绕的间接光。
const tcMultiscatter = Fn(([od, cosT]) => {
  const sum = float(0.0).toVar();
  const a = float(1.0).toVar();
  const b = float(1.0).toVar();
  const c = float(1.0).toVar();
  Loop(3, () => {
    sum.addAssign(b.mul(exp(od.mul(a).negate())).mul(tcHgPhase(cosT, c.mul(0.55))));
    a.mulAssign(0.25);
    b.mulAssign(0.55);
    c.mulAssign(0.4);
  });
  return sum.add(0.06); // 常数底：多次散射的最低保证，防死黑
});

// 云 march 主 Fn：输出**线性空间**预乘色（RT 为 HalfFloat）：合成在末段做，tone map/sRGB
// 只在渲染器输出 blit 走一遍（RT 不编码——与 r185 雾语义约定一致）。
// 视线由四角射线在片元插值（GLSL 版在顶点插值 vRay——quad 上逐像素等价，见文件头注）。
const tcMarch = Fn(([u]) => {
  const vUv = uv();
  const vRay = mix(mix(u.uRayA, u.uRayB, vUv.x), mix(u.uRayC, u.uRayD, vUv.x), vUv.y);
  const rd = vRay.normalize();
  const outc = vec4(0.0).toVar();

  // ---- 云板与视线求交（GLSL slabRange 内联——out 参数/bool 返回在 TSL 拆不开）；
  // 相机在板内时 t0 = 0（内部环视），t1 ≤ 0 = 背离云板（无交）----
  const span = max(1.0, u.uCloudTop.sub(u.uCloudBase));
  const t0v = float(0.0).toVar();
  const t1v = float(0.0).toVar();
  const hit = bool(false).toVar();
  If(abs(rd.y).lessThan(1e-4), () => {
    // 平掠射线：相机在板内才有交
    If(u.uCamPos.y.greaterThan(u.uCloudBase).and(u.uCamPos.y.lessThan(u.uCloudTop)), () => {
      t0v.assign(0.0);
      t1v.assign(span.mul(64.0));
      hit.assign(bool(true));
    });
  }).Else(() => {
    const ta = u.uCloudBase.sub(u.uCamPos.y).div(rd.y);
    const tb = u.uCloudTop.sub(u.uCamPos.y).div(rd.y);
    t0v.assign(min(ta, tb));
    t1v.assign(max(ta, tb));
    If(t1v.greaterThan(0.0), () => {
      t0v.assign(max(t0v, 0.0));
      hit.assign(t1v.greaterThan(t0v));
    });
  });

  If(hit, () => {
    // 场景几何沿射线的距离：深度纹理线性化（three packing 同式）→ 视距 → 除以视线
    // 方向的 -z 分量得到欧氏 t。天空像素深度=1 → 距离=far（不截断）。
    // 深度 = 本后端渲出的 RT → 采样走 passUV（铁律⑦；vRay 插值是 NDC 朝向，保持 vUv）
    const d = texture(u.uSceneDepth, passUV).x;
    const viewZ = u.uCamNear.mul(u.uCamFar)
      .div(u.uCamFar.sub(u.uCamNear).mul(d).sub(u.uCamFar));
    const rdView = u.uCamWorldInv.mul(vec4(rd, 0.0)).xyz;
    const tScene = viewZ.negate().div(max(1e-4, rdView.z.negate()));

    // 场景遮挡：几何在云板入点之前 → 本像素云全遮（outc 保持 0）；几何在板内
    // （云内俯视地面/塔身）→ march 到几何面为止（transmittance 只累积到面前）
    If(tScene.greaterThan(t0v.add(1e-3)), () => {
      t1v.assign(min(t1v, tScene));
      // 云内阵风：相机在云板内 → detail/warp 场 advect 加速（大风 + 薄纱扫动，用户定）
      const inside = select(
        u.uCamPos.y.greaterThan(u.uCloudBase).and(u.uCamPos.y.lessThan(u.uCloudTop)),
        1.0, 0.0);
      const gust = mix(1.0, u.uGustBoost, inside);
      // 云内步长收紧（用户定特调）：近场细节更密；密度积分/抖动/截断同用有效步长
      const effStep = u.uStepSize.mul(mix(1.0, u.uInnerStepScale, inside));
      t1v.assign(min(t1v, t0v.add(effStep.mul(40.0 * 8.0)))); // 掠射射线距离截断（步数上限兜底）
      // 抖动起步 + 1/4 分辨率 + 后端 blur → 步进条带不可见
      const jitter = fract(sin(dot(screenCoordinate.xy, vec2(12.9898, 78.233))).mul(43758.5453));
      const t = t0v.add(jitter.mul(effStep)).toVar();
      const T = float(1.0).toVar();
      const acc = vec3(0.0).toVar();
      const cosSun = dot(rd, u.uSunDir);
      const phase = mix(tcHgPhase(cosSun, 0.55), tcHgPhase(cosSun, -0.25), 0.55).mul(u.uSunAmt);
      // 早退三条件（GLSL break 逐条对应）：步数用尽（uMaxSteps 调参位 uniform，比较
      // 用浮点）/ 走出云板 / 透射率趋零。固定 64 上界 = GLSL 原循环上界。
      Loop(64, ({ i }) => {
        If(float(i).greaterThanEqual(u.uMaxSteps)
          .or(t.greaterThanEqual(t1v))
          .or(T.lessThan(0.02)), () => { Break(); });
        const p = u.uCamPos.add(rd.mul(t));
        const pw = p.add(tcWarpOffset(u, p, gust));    // 独立随风 offset 场推着主场走
        const df = tcCloudField(u, pw);
        If(df.greaterThan(0.001), () => {
          // 细节侵蚀：高频 perlin+worley 从云体上"啃"出絮条——边缘（d 小）啃得多、
          // 核心保留，薄纱即侵蚀殆尽的残絮（advect 错速独立扫动）
          const det = tcDetailField(u, p, gust);
          const eroded = max(df.sub(det.mul(u.uDetailAmt).mul(oneMinus(min(df.mul(2.4), 1.0)))), 0.0);
          If(eroded.greaterThan(0.001), () => {
            const depthT = clamp(p.y.sub(u.uCloudBase)
              .div(max(1.0, u.uCloudTop.sub(u.uCloudBase))), 0.0, 1.0);
            // 环境项（天空 ambient，无探针闭式）：板内越高越亮 + 越稀薄越透光
            const lit = clamp(float(0.32).add(depthT.mul(0.62))
              .add(oneMinus(min(eroded.mul(1.7), 1.0)).mul(0.38)), 0.0, 1.0);
            const c = mix(u.uSkyBottom.mul(0.58), u.uSkyTop.mul(1.32),
              lit.mul(0.75).add(depthT.mul(0.25))).toVar();
            c.mulAssign(mix(0.78, 1.14, det)); // 细节明暗调制：絮条/空洞写进颜色（不止 alpha），中距离形态可读
            // 点光直接光 + 多重散射间接估计（光 march；灯在云外时强度=0 整段跳过）
            // 近机减淡：近场样本自己贡献的遮蔽也同比例压低（浓度整体变薄，形态保留）
            const nearFade = smoothstep(u.uNearFadeStart, u.uNearFadeEnd, t);
            const densityScale = mix(u.uNearFadeAmt, 1.0, nearFade);
            const toL = u.uLanternPos.sub(p);
            const distL = length(toL);
            const atten = u.uLanternIntensity.div(float(1.0).add(distL.mul(distL).mul(0.02)));
            If(atten.greaterThan(0.002), () => {
              const L = toL.div(max(distL, 1e-3));
              const od = tcLightMarch(u, p, L, distL).mul(u.uDensity).mul(densityScale);
              c.addAssign(u.uLanternColor.mul(atten).mul(tcMultiscatter(od, dot(rd, L))));
            });
            c.addAssign(vec3(0.9, 0.93, 1.0).mul(phase)
              .mul(float(0.25).add(lit.mul(0.75)))); // 月光银边（原 ambient 项）
            const a = oneMinus(exp(eroded.mul(densityScale).mul(u.uDensity).mul(effStep).negate()));
            acc.addAssign(c.mul(a.mul(T)));
            T.mulAssign(oneMinus(a));
          });
        });
        t.addAssign(effStep);
      });
      // 远云融雾（用户定：融进**体积雾色调**，不融进天空盒）——只把颜色 lerp 到雾色，
      // 透射率不衰减（alpha 保留 = 远云是雾色云堤，不露出背后的天空渐变）。
      // 公式与场景 FogExp2 同形（平方指数，uHaze 语义 = 云雾等效密度，由
      // towerWilderness 随雾密度同步缩放）：远云堤在与地面全雾**同距离**处同步全融，
      // 地/云/穹面融成同一条暗雾带（2026-09-16 用户报地平线亮带）。
      // ⚠ 雾色必须以**预乘**形式进合成（composite = cl.rgb + scene·(1−cl.a)）：acc 本身
      // 预乘，融雾若裸写雾色，「远处没云 alpha≈0」的像素会输出满强度雾色叠在穹顶上
      // = 雾色被记两次（雾+穹底 ≈ 2×亮度）——地平线上方一圈幽灵亮带的真凶
      // （红色雾探针实测：alpha≈0 行 rgb=满红 + 穹底透出，2026-09-16）。
      const farF = oneMinus(exp(t0v.mul(t0v).mul(u.uHaze).mul(u.uHaze).negate()));
      // 云下仰视压暗：跨云底 smooth 过渡（爬升穿板不瞬跳），只压云体散射、融雾色不动
      const under = mix(u.uUnderShade, 1.0,
        smoothstep(u.uCloudBase.sub(10.0), u.uCloudBase.add(4.0), u.uCamPos.y));
      outc.assign(vec4(mix(acc.mul(under), u.uFogColor.mul(oneMinus(T)), farF), oneMinus(T)));
    });
  });
  return outc;
});

// ================= blur / composite 节点链 =================

// 雪云 RT 小域可分离高斯模糊（1/4 分辨率降噪第二拍）。
// uTexel = 1/RT尺寸，uDir = (1,0) 横向 / (0,1) 纵向两拍各跑一次；半径 1.5 纹素
// （全分辨率下 ≈6px），只糊掉 raymarch 抖动条带、不糊云的结构。
// **rgba 全通道同核**——不复用 passes.js 的 tslBlur：它只糊 rgb 且 alpha 写 1，
// 会毁掉 march 输出的透射率 alpha（composite 的 1-cl.a 依赖它）。
// ⚠ tSrc 是本链自渲的 RT → 采样走 passUV（铁律⑦；对称核对方向翻转无害，但中心样本
// 必须与 composite 的场景采样同约定，否则云与场景垂直镜像）。
const tcBlur = Fn(([tSrc, uTexel, uDir]) => {
  const o = uTexel.mul(uDir);
  const c = texture(tSrc, passUV).mul(0.227027).toVar();
  c.addAssign(texture(tSrc, passUV.add(o.mul(1.3846))).mul(0.316216));
  c.addAssign(texture(tSrc, passUV.sub(o.mul(1.3846))).mul(0.316216));
  c.addAssign(texture(tSrc, passUV.add(o.mul(3.2308))).mul(0.070270));
  c.addAssign(texture(tSrc, passUV.sub(o.mul(3.2308))).mul(0.070270));
  return c;
});

// 雪云合成（管线末段）：transmittance composite。
// mesh pass 已渲进 rtScene（linear + 深度）；云 march 输出预乘色 acc 与透射率
// alpha=1-T——本 pass 把二者合成：col = cloudInscatter + scene * T。
// **直出线性 HDR**——tone map + sRGB 由渲染器帧末输出 blit 统一施加（flavor A，
// passes.js 头注「输出变换铁律」；本件不碰 renderer.toneMapping）。
const tcComposite = Fn(([tScene, tCloud]) => {
  // 两个输入都是本链 RT（rtScene 后端直渲 / rtCloud 自渲）→ 同走 passUV（铁律⑦）
  const sc = texture(tScene, passUV);
  const cl = texture(tCloud, passUV);
  const c = cl.rgb.add(sc.rgb.mul(oneMinus(cl.a)));
  return vec4(c, 1.0);
});

/**
 * @param {object} opts
 *   sunDir: THREE.Vector3 云层受光方向（世界，指向光源）
 *   overrides: 调参位初值覆盖（如 windX/windZ 与雪花风同源）
 */
export function buildTowerClouds({
  sunDir = new THREE.Vector3(-0.55, 0.72, -0.42), overrides = {},
} = {}) {
  // ---- 调参位（gallery / knob 实时改；运行期直接改 uniforms 的 .value）----
  // 观感初值 = ch1 预设（一章塔外）；游戏内由 towerWilderness.setStormLevel 按层
  // 在 ch1/ch2 之间插值覆写。测试点光默认熄灭（用户定：正式塔灯由 stage pass-in）。
  const params = {
    ...CLOUD_PRESETS.ch1,
    lanternDist: 24,      // 灯距相机（世界单位，沿视线前方）
    lanternIntensity: 0,  // 默认关；gallery knob 手动开（70 会把整帧 HDR 爆白）
    lanternColor: 0xffdfae, // 暖灯笼色（塔楼挂灯意象）
  };
  Object.assign(params, overrides);
  /** 调参同步（gallery knob 直改 params 后调用，一次性落 uniforms）。 */
  function syncParams() {
    uniforms.uCloudWind.value.set(params.windX, params.windZ);
    uniforms.uCloudBase.value = params.base;
    uniforms.uCloudTop.value = params.top;
    uniforms.uCloudScale.value = params.scale;
    uniforms.uCoverage.value = params.coverage;
    uniforms.uDensity.value = params.density;
    uniforms.uStepSize.value = params.stepSize;
    uniforms.uMaxSteps.value = params.steps;
    uniforms.uHaze.value = params.haze;
    uniforms.uSunAmt.value = params.sun;
    uniforms.uDetailAmt.value = params.detailAmt;
    uniforms.uDetailFreq.value = params.detailFreq;
    uniforms.uWarpAmt.value = params.warpAmt;
    uniforms.uWarpFreq.value = params.warpFreq;
    uniforms.uGustBoost.value = params.gustBoost;
    uniforms.uInnerStepScale.value = params.innerStep;
    uniforms.uLanternColor.value.setHex(params.lanternColor);
    uniforms.uNearFadeStart.value = params.nearFadeStart;
    uniforms.uNearFadeEnd.value = params.nearFadeEnd;
    uniforms.uNearFadeAmt.value = params.nearFadeAmt;
    uniforms.uUnderShade.value = params.underShade;
  }

  // 首帧兜底纹理（各纹理节点先指它，composeFrame 每帧换 .value 接真实 RT）
  const blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blackTex.needsUpdate = true;

  // 纹理输入（TextureNode：.value 换纹理 = RT ping-pong 的标准姿势）
  const tSceneDepth = texture(blackTex);  // mesh pass 深度（全分辨率）
  const tBlurSrc = texture(blackTex);     // blur 输入（Cloud/Blur 两拍轮换）
  const tCompScene = texture(blackTex);   // composite：场景色
  const tCompCloud = texture(blackTex);   // composite：云 march 结果
  const uTexel = uniform(new THREE.Vector2()); // 1/云 RT 尺寸
  const uDir = uniform(new THREE.Vector2(1, 0)); // blur 方向 (1,0)/(0,1)

  // ---- uniforms（TSL uniform 节点；key 与 .value 语义逐字不变，调用侧零改动）----
  const uniforms = {
    uCamPos: uniform(new THREE.Vector3()),
    uCloudTime: uniform(0),
    uCloudWind: uniform(new THREE.Vector2(params.windX, params.windZ)), // 风场 (x,z) 世界单位/秒
    uCloudBase: uniform(params.base),      // 云板底 y
    uCloudTop: uniform(params.top),        // 云板顶 y
    uCloudScale: uniform(params.scale),    // worley 基准频率
    uCoverage: uniform(params.coverage),   // 覆盖度 0..1（门槛越低云越满）
    uDensity: uniform(params.density),     // 消光峰值（每单位）
    uStepSize: uniform(params.stepSize),   // raymarch 步长（世界单位）
    uMaxSteps: uniform(params.steps),      // 步数上限（调参位）
    uHaze: uniform(params.haze),           // 距离雾化系数：远云融进天空（防 RT 结果与雾带脱节）
    uSkyTop: uniform(new THREE.Color(0x7e93ad)),    // 与 towerWilderness SKY_TOP 同源（JS 侧覆盖）
    uSkyBottom: uniform(new THREE.Color(0x59626a)), // 同 SKY_BOTTOM
    uFogColor: uniform(new THREE.Color(0x59626a)),  // 场景雾色（towerWilderness 共享 FogExp2.color 实例）
    uSunDir: uniform(sunDir.clone().normalize()),   // 月/日光方向（world，指向光源）
    uSunAmt: uniform(params.sun),          // 银边强度
    uRayA: uniform(new THREE.Vector3(0, 0, -1)),    // 四角世界射线（底左/底右/顶左/顶右）
    uRayB: uniform(new THREE.Vector3(0, 0, -1)),
    uRayC: uniform(new THREE.Vector3(0, 0, -1)),
    uRayD: uniform(new THREE.Vector3(0, 0, -1)),
    uDetailAmt: uniform(params.detailAmt),   // 细节侵蚀强度（边缘絮条化，核心保留）
    uDetailFreq: uniform(params.detailFreq), // 细节场空间频率
    uWarpAmt: uniform(params.warpAmt),       // offset 场域扭曲幅度（世界单位）
    uWarpFreq: uniform(params.warpFreq),     // offset 场频率
    uGustBoost: uniform(params.gustBoost),   // 云内阵风倍率（相机在云内时 detail/warp advect 加速）
    uInnerStepScale: uniform(params.innerStep), // 云内步长收紧倍率（近场细节更密，用户定特调）
    // 场景深度（composeFrame 每帧接 rtScene 深度纹理与相机参数）
    uSceneDepth: tSceneDepth,
    uCamNear: uniform(0.1),
    uCamFar: uniform(2000),
    uCamWorldInv: uniform(new THREE.Matrix4()), // 相机世界逆矩阵（世界射线 → 视空间射线）
    // 测试点光（用户定 2026-09-16：云内无光照灰成一坨——先挂相机前方测试灯试渲染
    // 质量；正式版塔楼挂灯的位置/参数由 stage pass-in 替换这个口子）
    uLanternPos: uniform(new THREE.Vector3()),
    uLanternColor: uniform(new THREE.Color(params.lanternColor)),
    uLanternIntensity: uniform(0), // 0 = 关（云外 JS 侧自动熄灯，光 march 整段跳过）
    // 近机密度减淡（用户定 2026-09-16：靠近相机的云经验性变薄，露出中距离的
    // detail/erosion 云体形态；t 即样本沿视线到相机的距离，直接做平滑压低）
    uNearFadeStart: uniform(params.nearFadeStart), // 减淡起点（此距离内压到最低）
    uNearFadeEnd: uniform(params.nearFadeEnd),     // 减淡终点（此距离外完全不衰减）
    uNearFadeAmt: uniform(params.nearFadeAmt),     // 近场残余密度比例（0 = 近场全透明）
    uUnderShade: uniform(params.underShade),       // 云下仰视压暗（相机在云板下时生效）
  };
  syncParams();

  // ---- 全屏 pass（makeFullScreenPass = PlaneGeometry(2,2) + 正交相机，见 passes.js）----
  // march/blur 的 RT alpha 承载透射率语义（composite 的 1−cl.a 依赖它）→ keepAlpha
  // 必开：非透明材质片元末段被 NodeBuilder 强制 alpha=1（opaque_fragment），
  // 塔楼全黑病灶即此（probe-cloudgal9 实测：rtCloud 全帧 alpha=1、无云区 rgb=0）。
  const marchScene = makeFullScreenPass(tcMarch(uniforms), { keepAlpha: true });
  const blurScene = makeFullScreenPass(tcBlur(tBlurSrc, uTexel, uDir), { keepAlpha: true });
  const compScene = makeFullScreenPass(tcComposite(tCompScene, tCompCloud));

  // ---- RT（懒建：首次浏览器渲染才知道 drawing buffer 尺寸）----
  let rtScene = null; // mesh pass：linear 色 + 深度纹理（全分辨率）
  let rtCloud = null; // march 结果 →（blur V 后）合成源（1/4 分辨率）
  let rtBlur = null;  // blur H 中转
  let rtW = 0;
  let rtH = 0;
  const _size = new THREE.Vector2();
  const _corner = new THREE.Vector3();
  const _camWorldInv = new THREE.Matrix4();
  const _fwd = new THREE.Vector3();
  const _UP = new THREE.Vector3(0, 1, 0);

  function ensureRTs(renderer) {
    renderer.getDrawingBufferSize(_size);
    const w = Math.max(2, Math.round(_size.x * RT_SCALE));
    const h = Math.max(2, Math.round(_size.y * RT_SCALE));
    if (rtScene && w === rtW && h === rtH) return;
    rtScene?.depthTexture?.dispose?.(); // RT.dispose 不连带深度纹理（volumetricMoon 同口径）
    rtScene?.dispose();
    rtCloud?.dispose();
    rtBlur?.dispose();
    rtW = w; rtH = h;
    const depth = new THREE.DepthTexture(_size.x, _size.y); // 全分辨率深度
    rtScene = new THREE.WebGLRenderTarget(_size.x, _size.y, {
      type: THREE.HalfFloatType,       // linear HDR：整帧末段统一 tone map
      depthTexture: depth,
      depthBuffer: true,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    const opts = {
      type: THREE.HalfFloatType,       // 线性 HDR：银边高光不被 8bit 裁掉
      depthBuffer: false,
      minFilter: THREE.LinearFilter,   // 合成时双线性上采样（1/4 → 全屏的一半平滑）
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    };
    rtCloud = new THREE.WebGLRenderTarget(w, h, opts);
    rtBlur = new THREE.WebGLRenderTarget(w, h, opts);
    uTexel.value.set(1 / w, 1 / h);
  }

  /** 三段管线（StageManager composeScene 钩子 / gallery 主循环调用）。 */
  function composeFrame({ renderer, scene, camera }) {
    ensureRTs(renderer);
    if (!rtScene) return;
    // ① mesh pass：场景 → rtScene（linear + 深度；穹顶 renderOrder -10 作背景）
    renderer.setRenderTarget(rtScene);
    renderer.render(scene, camera);
    // ② 云 march：当前帧相机四角射线 + 场景深度 → rtCloud（1/4）
    camera.updateMatrixWorld();
    _camWorldInv.copy(camera.matrixWorld).invert();
    uniforms.uCamPos.value.copy(camera.position);
    uniforms.uCamNear.value = camera.near;
    uniforms.uCamFar.value = camera.far;
    uniforms.uCamWorldInv.value.copy(_camWorldInv);
    uniforms.uSceneDepth.value = rtScene.depthTexture;
    CORNER_NDC.forEach(([x, y], i) => {
      _corner.set(x, y, 0.5).unproject(camera).sub(camera.position).normalize();
      uniforms[['uRayA', 'uRayB', 'uRayC', 'uRayD'][i]].value.copy(_corner);
    });
    // 测试灯笼：相机前方 lanternDist 处（略抬高）；入云渐亮、出云熄灭（光 march
    // 在 shader 里按强度整段跳过）。正式版塔灯位置/参数由 stage pass-in 替换此段。
    camera.getWorldDirection(_fwd);
    const insideL = Math.min(1, Math.max(0, Math.min(
      (camera.position.y - (params.base - 8)) / 8,
      ((params.top + 8) - camera.position.y) / 8)));
    uniforms.uLanternPos.value.copy(camera.position)
      .addScaledVector(_fwd, params.lanternDist)
      .addScaledVector(_UP, 2);
    uniforms.uLanternIntensity.value = params.lanternIntensity * insideL;
    renderer.setRenderTarget(rtCloud);
    renderFullScreenPass(renderer, marchScene);
    // blur H：Cloud→Blur；blur V：Blur→Cloud（可分离两拍，半径 1.5 纹素 = 全屏 ~6px）
    tBlurSrc.value = rtCloud.texture;
    uDir.value.set(1, 0);
    renderer.setRenderTarget(rtBlur);
    renderFullScreenPass(renderer, blurScene);
    tBlurSrc.value = rtBlur.texture;
    uDir.value.set(0, 1);
    renderer.setRenderTarget(rtCloud);
    renderFullScreenPass(renderer, blurScene);
    // ③ transmittance 合成 → 屏幕（直出线性 HDR；tone+sRGB 由渲染器帧末输出 blit
    // 统一施加——flavor A，本件不碰 renderer.toneMapping）
    tCompScene.value = rtScene.texture;
    tCompCloud.value = rtCloud.texture;
    renderer.setRenderTarget(null);
    renderFullScreenPass(renderer, compScene);
  }

  return {
    params,
    uniforms,
    /** 时间步进（windy update 链）：噪音场 advect 的时钟。 */
    update(dt) { uniforms.uCloudTime.value += dt; },
    /** 云层光源方向（世界）。 */
    setSunDir(v) { uniforms.uSunDir.value.copy(v).normalize(); },
    /** 三段渲染管线（MapStage.composeScene / cloudGallery 主循环委托）。 */
    composeFrame,
    syncParams,
    /** 调试探针口：RT 现场只读暴露（gallery/排障用；别在渲染逻辑里消费）。 */
    debugRts: () => ({ rtScene, rtCloud, rtBlur, marchScene, blurScene, compScene }),
    dispose() {
      rtScene?.depthTexture?.dispose?.();
      rtScene?.dispose(); rtCloud?.dispose(); rtBlur?.dispose();
      rtScene = rtCloud = rtBlur = null;
      blackTex.dispose();
      disposeFullScreenPass(marchScene);
      disposeFullScreenPass(blurScene);
      disposeFullScreenPass(compScene);
    },
  };
}
