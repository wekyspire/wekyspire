// 月光体积光 composer：真 ray marching（非贴面片）+ temporal 累积——
//   pass 1：世界场景渲进带深度纹理的 RT（同时触发 three 渲染 shadow map）；
//   pass 2（march + EMA）：全屏 quad 重建每像素视线，向场景深度行进 N 步，逐步把采样点
//           变换进月光 shadow 空间做硬件比较采样，累计"在光中"的散射量；
//           每帧 jitter 相位轮转（frame seed % 30），光量写入**历史 RT（ping-pong）**：
//           ema = mix(history, current, 1/30)——30 帧收敛，jitter 条纹被时间域抹平；
//   pass 3（composite）：屏幕 = 场景色 + EMA 光量（只 EMA 光项，不 EMA 场景色——
//           全场 EMA 会让火焰闪烁/单位呼吸/卡牌动画全部拖影）。
// 效果：光柱被窗洞/柱列真实切碎（柱影在空气中拉出资讯量），假面片方案做不到。
//
// 集成：BattleStage 在 renderer 支持 RT 时创建，StageManager tick 里替代
//   默认 scene 渲染（composeScene 钩子），resize 走 composeResize（历史同步失效重收敛）。
// node 单测无真 renderer，本模块不会被实例化（纯 WebGL 链路，无降级需求）。

import * as THREE from 'three';

const EMA_ALPHA = 1 / 30; // temporal EMA 新帧权重（≈1s 收敛 @30fps）

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// march + EMA：输出线性光量（不写屏幕，写历史 RT）
// 体积区域 = 房间 AABB 外扩少许（用户定 2026-09）：view ray 先与盒求交，t start/t end
// clamp 在 [tEnter, tExit]——盒外像素（天空盒/远景）零光量直出，天空渲染不被污染；
// tfar 不再用 nearZ/固定值硬截（相机拉远时截断曾致全场偏暗，干扰视觉判断）。
const FRAG_MARCH = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tDepth;
  uniform sampler2DShadow tShadow; // r185 PCF：深度存 depthTexture + 硬件比较采样
  uniform sampler2D tHistory;      // 上一帧 EMA 光量（ping-pong）
  uniform mat4 camProjInv;    // camera.projectionMatrixInverse
  uniform mat4 camWorld;      // camera.matrixWorld
  uniform mat4 shadowMatrix;  // light.shadow.matrix（世界 → shadow UV/深度 [0,1]）
  uniform vec3 camPos;
  uniform vec3 lightColor;    // 已含强度的光色
  uniform float density;      // 散射密度（每世界单位）
  uniform float maxDist;      // 行进上限（安全后闸，非主要界——盒交才是体积边界）
  uniform float frame;        // frame seed（每帧轮转，temporal 收敛的原料）
  uniform float frame_percentage; // 1 / max temporal frames
  uniform float emaAlpha;     // EMA 新帧权重（首帧=1 直接定植，之后=1/30）
  uniform vec3 boxMin;        // 房间体积盒（比房间内稍大）
  uniform vec3 boxMax;
  uniform float shadowBias;

  const int STEPS = 26;

  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  void main() {
    float depth = texture2D(tDepth, vUv).x;
    // 重建世界空间视线端点（深度=1 的天空/窗洞端点落在远平面，行进被盒交截断）
    vec4 ndc = vec4(vUv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 vpos = camProjInv * ndc;
    vpos /= vpos.w;
    vec3 wpos = (camWorld * vpos).xyz;
    vec3 ray = wpos - camPos;
    float sceneDist = length(ray);
    vec3 rd = ray / sceneDist;
    // 视线 × 房间体积盒：盒外像素（天空盒/远景）零光量，天空正常渲染
    vec3 invD = 1.0 / rd;
    vec3 tA = (boxMin - camPos) * invD;
    vec3 tB = (boxMax - camPos) * invD;
    vec3 tSm = min(tA, tB);
    vec3 tBg = max(tA, tB);
    float tEnter = max(max(tSm.x, tSm.y), max(tSm.z, 0.0));
    float tExit = min(min(tBg.x, tBg.y), tBg.z);
    vec3 current = vec3(0.0);
    float trans = 1.0; // 透射率：盒内空气对视线方向的吸收（天空也要乘，用户定 2026-09）
    if (tExit > tEnter) {
      float t0 = tEnter;
      float maxT = min(min(sceneDist, tExit), maxDist);
      if (maxT > t0) {
        float stepLen = (maxT - t0) / float(STEPS);
        float jitter = fract(hash12(gl_FragCoord.xy) + frame * frame_percentage); // 抖动去带状条纹
        float acc = 0.0;
        for (int i = 0; i < STEPS; i++) {
          float t = t0 + (float(i) + jitter) * stepLen;
          vec3 p = camPos + rd * t;
          vec4 sp = shadowMatrix * vec4(p, 1.0);
          sp.xyz /= sp.w;
          // 飞出 shadow 覆盖范围一律按"完全阴影"处理（不累积）——sp.z 还要卡下界：
          // 负 z（比 shadow 相机近面更近）拿去做 LessEqual 比较会恒亮（调试实录）
          if (sp.x > 0.001 && sp.x < 0.999 && sp.y > 0.001 && sp.y < 0.999 && sp.z > 0.0 && sp.z < 1.0) {
            // 硬件阴影比较（与 three PCF getShadow 同约定：比较值 = shadowCoord.z + bias，
            // LinearFilter 的深度贴图采样自带 4-tap 软化）
            acc += texture(tShadow, vec3(sp.xy, sp.z + shadowBias));
          }
        }
        current = lightColor * acc * density * stepLen;
        trans = exp(-density * (maxT - t0)); // 单次散射近似：消光系数 = 散射密度
      }
    }
    // temporal EMA：mix(历史, 当前帧, 1/30)——jitter 噪声在时间域收敛成稳定柔光
    // alpha 通道同步 EMA 透射率（与光量同节拍收敛）
    vec4 history = texture2D(tHistory, vUv);
    gl_FragColor = vec4(mix(history.rgb, current, emaAlpha), mix(history.a, trans, emaAlpha));
  }
`;

// composite：场景色 + EMA 光量 + 配方 tint → **线性、未映射**的合成色（写进 rtColor）。
// 色调映射/曝光/sRGB 全部移到最后的 FRAG_FINAL——因为 bloom 必须在线性、映射之前的色上做
// （映射后再提亮会连同高光压缩一起被放大，光晕会发灰发脏）。
const FRAG_COMPOSITE = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tDiffuse;
  uniform sampler2D tLight; // EMA 后的线性光量
  uniform vec3 uTint;

  void main() {
    vec3 sceneCol = texture2D(tDiffuse, vUv).rgb;
    vec3 light = texture2D(tLight, vUv).rgb;
    gl_FragColor = vec4((sceneCol + light) * uTint, 1.0);
  }
`;

// bright pass：软膝阈值提亮部（线性空间）。彩灯/屏幕这些 >1 的自发光体才是主角。
const FRAG_BRIGHT = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tColor;
  uniform float uThreshold;
  uniform float uKnee;
  void main() {
    vec3 c = texture2D(tColor, vUv).rgb;
    float lum = max(c.r, max(c.g, c.b));
    // 软膝：threshold 以下全黑，以上平滑过渡（硬阈值会让 bloom 边缘出现台阶）
    float soft = clamp(lum - uThreshold + uKnee, 0.0, 2.0 * uKnee);
    soft = soft * soft / (4.0 * uKnee + 1e-4);
    float w = max(soft, lum - uThreshold) / max(lum, 1e-4);
    gl_FragColor = vec4(c * w, 1.0);
  }
`;

// 分离高斯模糊（9 抽样、线性采样跨步 → 实际覆盖 ~2px 半径；H/V 各跑一次）
const FRAG_BLUR = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tSrc;
  uniform vec2 uDir;      // 像素步长方向（已含半径）
  void main() {
    vec3 sum = texture2D(tSrc, vUv).rgb * 0.2270270270;
    sum += texture2D(tSrc, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
    sum += texture2D(tSrc, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
    sum += texture2D(tSrc, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
    sum += texture2D(tSrc, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
    gl_FragColor = vec4(sum, 1.0);
  }
`;

// final：色调映射 + bloom 叠加 + sRGB 输出
const FRAG_FINAL = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tColor;
  uniform sampler2D tBloom;
  uniform float uBloom;
  uniform float uExposure;
  uniform int uTone;

  vec3 linearToSrgb(vec3 c) {
    return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
  }
  vec3 toneNeutral(vec3 color) {
    const float StartCompression = 0.8 - 0.04;
    const float Desaturation = 0.15;
    color *= uExposure;
    float x = min(color.r, min(color.g, color.b));
    float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
    color -= offset;
    float peak = max(color.r, max(color.g, color.b));
    if (peak < StartCompression) return color;
    float d = 1.0 - StartCompression;
    float newPeak = 1.0 - d * d / (peak + d - StartCompression);
    color *= newPeak / peak;
    float g = 1.0 - 1.0 / (Desaturation * (peak - newPeak) + 1.0);
    return mix(color, vec3(newPeak), g);
  }
  vec3 rrtOdtFit(vec3 v) {
    vec3 a = v * (v + 0.0245786) - 0.000090537;
    vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
    return a / b;
  }
  vec3 toneAces(vec3 color) {
    const mat3 inMat = mat3(
      vec3(0.59719, 0.07600, 0.02840),
      vec3(0.35458, 0.90834, 0.13383),
      vec3(0.04823, 0.01566, 0.83777));
    const mat3 outMat = mat3(
      vec3( 1.60475, -0.10208, -0.00327),
      vec3(-0.53108,  1.10813, -0.07276),
      vec3(-0.07367, -0.00605,  1.07602));
    color *= uExposure / 0.6;
    color = inMat * color;
    color = rrtOdtFit(color);
    color = outMat * color;
    return clamp(color, 0.0, 1.0);
  }

  void main() {
    vec3 c = texture2D(tColor, vUv).rgb + texture2D(tBloom, vUv).rgb * uBloom;
    if (uTone == 1) c = toneNeutral(c);
    else if (uTone == 2) c = toneAces(c);
    else if (uTone == 3) c = c * uExposure / (1.0 + c * uExposure);
    gl_FragColor = vec4(linearToSrgb(c), 1.0);
  }
`;

/** 色调映射模式（宿主/调试页共用一份枚举，避免两边写死数字）。 */
export const TONE_MODES = Object.freeze({ none: 0, neutral: 1, aces: 2, reinhard: 3 });

/**
 * 全局缺省色调映射：直渲路径（StageManager 的 renderer）与体积光 composer 必须一致。
 * 选 Neutral（Khronos PBR Neutral）的理由见 FRAG_COMPOSITE 顶部注释——保色相/饱和，
 * 只在接近过曝时压高光（0.76 以下基本是恒等，不动既有布光配比）。
 */
export const DEFAULT_TONE_MODE = 'neutral';

/**
 * 把色调映射选择同步到两条渲染路径：
 *   · composer 合成 shader 的 uTone/uExposure（体积光路径）
 *   · renderer.toneMapping / toneMappingExposure（直渲路径）
 * 传 null/undefined 的 mode 视为 noop（保留现状）。
 */
export function applyToneMapping(renderer, composer, mode, exposure = 1) {
  const id = TONE_MODES[mode] ?? TONE_MODES.none;
  const THREE_TONE = [THREE.NoToneMapping, THREE.NeutralToneMapping, THREE.ACESFilmicToneMapping, THREE.ReinhardToneMapping];
  if (renderer) {
    renderer.toneMapping = THREE_TONE[id];
    renderer.toneMappingExposure = exposure;
  }
  if (composer?.setToneMapping) composer.setToneMapping(id, exposure);
}

/**
 * 建体积月光 composer。
 * @param {object} options
 *   light: THREE.DirectionalLight（castShadow，唯一体积光源）
 *   box: { min:[x,y,z], max:[x,y,z] } 房间体积盒（比房间内稍大；view ray 与之求交框定
 *        march 区间，盒外像素零光量——天空盒/远景正常渲染，用户定 2026-09）
 *   maxDist/density/lightBoost: 参数（density 单位：每世界单位散射量；maxDist 仅安全后闸）
 * @returns { render(renderer, scene, camera), resize(w, h), dispose() }
 */
export function createVolumetricMoonlight({
  light,
  box = { min: [-95, -35, -92], max: [148, 95, 112] }, // 缺省 = 房型房间外扩（walls.js 常量 + 边距）
  maxDist = 800,   // 安全后闸：盒交才是体积边界（曾用 300 硬截，相机拉远即渲染错误/偏暗——用户指正）
  density = 0.01,   // 光束要 prominent（过低只剩"空气感"，调试实录）
  lightBoost = 0.9,
  tint = null,       // 配方场景调色 [r,g,b]（composeRoom grading.tint 下发；缺省白）
} = {}) {
  const rt = new THREE.WebGLRenderTarget(2, 2, {
    type: THREE.HalfFloatType,
    samples: 4, // MSAA（r185 支持 depthTexture + 多样本自动 resolve）
    depthTexture: new THREE.DepthTexture(2, 2),
  });
  // temporal 历史（ping-pong，只存线性光量；HalfFloat 保平滑）
  let historyRead = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });
  let historyWrite = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });
  let historyValid = false; // 首帧/resize 后：emaAlpha=1 直接定植，避免从黑收敛 1s

  const marchUniforms = {
    tDepth: { value: rt.depthTexture },
    tShadow: { value: null },
    tHistory: { value: null },
    camProjInv: { value: new THREE.Matrix4() },
    camWorld: { value: new THREE.Matrix4() },
    shadowMatrix: { value: new THREE.Matrix4() },
    camPos: { value: new THREE.Vector3() },
    lightColor: { value: light.color.clone().multiplyScalar(lightBoost) },
    density: { value: density },
    maxDist: { value: maxDist },
    frame: { value: 0 },
    frame_percentage: { value: 1 / 30 }, // 30 帧抖动轮转（与 EMA 速率同周期）
    emaAlpha: { value: EMA_ALPHA },
    boxMin: { value: new THREE.Vector3(...box.min) },
    boxMax: { value: new THREE.Vector3(...box.max) },
    shadowBias: { value: 0.002 },
  };
  const compositeUniforms = {
    tDiffuse: { value: rt.texture },
    tLight: { value: null },
    uTint: { value: tint ? new THREE.Color(...tint) : new THREE.Color(1, 1, 1) },
  };
  // ---- bloom（用户定 2026-09-11：给整条渲染管线加 bloom，让彩灯/屏幕真的"发光"）----
  // 链：线性合成 → 半分辨率 bright（软膝阈值）→ H/V 两次分离高斯 → 终段 tone map + 叠加 + sRGB。
  // **阈值必须卡在"漫反射受光面"之上**（用户指正"选像素要收紧，只选亮度溢出的那些"）：
  // 本管线的**管路是 HDR 的**（所有 RT 都是 HalfFloat、线性工作空间、three 物理光单位、
  // 最后才 tone map），但**内容不是 HDR 创作的**——调色板颜色 ≤1、强光把墙面/机身照到 1~2，
  // 阈值取 0.95 就会把"被照亮的机身"整片选进 bloom（机器糊成一团白光）。所以两件事一起做：
  //   ① 自发光体（灯泡/指示灯）用**乘算推到真 HDR**（线性 ×10 / ×18），它们才是 bloom 的主角；
  //   ② 阈值抬到漫反射受光范围之上（1.45）→ 只有真正溢出的像素进 bloom。
  const bloomParams = { threshold: 1.45, knee: 0.35, strength: 0.42, radius: 1.4 };
  const brightUniforms = {
    tColor: { value: null },
    uThreshold: { value: bloomParams.threshold },
    uKnee: { value: bloomParams.knee },
  };
  const blurUniforms = { tSrc: { value: null }, uDir: { value: new THREE.Vector2(1, 0) } };
  const finalUniforms = {
    tColor: { value: null },
    tBloom: { value: null },
    uBloom: { value: bloomParams.strength },
    uExposure: { value: 1 },
    uTone: { value: TONE_MODES.neutral },   // 缺省保色映射（逐通道硬转换会把彩灯裁成白）
  };
  const rtColor = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });
  let bloomA = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });
  let bloomB = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });
  const bloomTexel = new THREE.Vector2(0.5, 0.5);   // 半分辨率 texel（resize 里更新）
  const fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const makePass = (fragmentShader, uniforms) => {
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        uniforms, vertexShader: VERT, fragmentShader,
        depthTest: false, depthWrite: false,
      }),
    ));
    return scene;
  };
  const marchScene = makePass(FRAG_MARCH, marchUniforms);
  const compositeScene = makePass(FRAG_COMPOSITE, compositeUniforms);
  const brightScene = makePass(FRAG_BRIGHT, brightUniforms);
  const blurScene = makePass(FRAG_BLUR, blurUniforms);
  const finalScene = makePass(FRAG_FINAL, finalUniforms);

  function resize(w, h) {
    const rw = Math.max(1, w);
    const rh = Math.max(1, h);
    rt.setSize(rw, rh);
    historyRead.setSize(rw, rh);
    historyWrite.setSize(rw, rh);
    rtColor.setSize(rw, rh);
    const bw = Math.max(1, Math.round(rw / 2));
    const bh = Math.max(1, Math.round(rh / 2));
    bloomA.setSize(bw, bh);
    bloomB.setSize(bw, bh);
    bloomTexel.set(bloomParams.radius / bw, bloomParams.radius / bh);
    historyValid = false; // 尺寸变了，历史失效重收敛
  }

  function render(renderer, scene, camera) {
    // shadow map 首帧尚未生成：退回普通渲染（仅一帧）
    if (!light.shadow.map) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }
    camera.updateMatrixWorld();
    marchUniforms.camProjInv.value.copy(camera.projectionMatrixInverse);
    marchUniforms.camWorld.value.copy(camera.matrixWorld);
    marchUniforms.camPos.value.setFromMatrixPosition(camera.matrixWorld);
    marchUniforms.shadowMatrix.value.copy(light.shadow.matrix);
    marchUniforms.frame.value = (marchUniforms.frame.value + 1) % 30;
    marchUniforms.tShadow.value = light.shadow.map.depthTexture; // 深度在 depthTexture（color 纹理是未用的垃圾）
    marchUniforms.emaAlpha.value = historyValid ? EMA_ALPHA : 1;

    // pass 1：场景 → RT
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, camera);
    // pass 2：march + EMA → historyWrite（tHistory 读上一帧的 historyRead）
    marchUniforms.tHistory.value = historyRead.texture;
    renderer.setRenderTarget(historyWrite);
    renderer.render(marchScene, fsCam);
    // pass 3：场景色 + EMA 光量 → rtColor（**线性、未映射**：bloom 与终段都在这之后）
    compositeUniforms.tLight.value = historyWrite.texture;
    renderer.setRenderTarget(rtColor);
    renderer.render(compositeScene, fsCam);
    // pass 4-6：bright → 半分辨率 H 模糊 → V 模糊（结果留在 bloomA）
    brightUniforms.tColor.value = rtColor.texture;
    renderer.setRenderTarget(bloomA);
    renderer.render(brightScene, fsCam);
    blurUniforms.tSrc.value = bloomA.texture;
    blurUniforms.uDir.value.set(bloomTexel.x, 0);
    renderer.setRenderTarget(bloomB);
    renderer.render(blurScene, fsCam);
    blurUniforms.tSrc.value = bloomB.texture;
    blurUniforms.uDir.value.set(0, bloomTexel.y);
    renderer.setRenderTarget(bloomA);
    renderer.render(blurScene, fsCam);
    // pass 7：tone map(线性色 + bloom) → sRGB → 屏幕
    finalUniforms.tColor.value = rtColor.texture;
    finalUniforms.tBloom.value = bloomA.texture;
    renderer.setRenderTarget(null);
    renderer.render(finalScene, fsCam);
    // ping-pong：本帧的 write 成为下一帧的 read
    const tmp = historyRead;
    historyRead = historyWrite;
    historyWrite = tmp;
    historyValid = true;
  }

  function dispose() {
    rt.depthTexture?.dispose?.();
    rt.dispose();
    rtColor.dispose();
    bloomA.dispose();
    bloomB.dispose();
    historyRead.dispose();
    historyWrite.dispose();
    for (const s of [marchScene, compositeScene, brightScene, blurScene, finalScene]) {
      for (const child of [...s.children]) {
        child.geometry.dispose();
        child.material.dispose();
      }
    }
  }

  /** 实时改色调映射/曝光（调试页 A/B 用；不动 shader 编译，只改 uniform）。 */
  function setToneMapping(mode, exposure) {
    if (Number.isFinite(mode)) finalUniforms.uTone.value = mode;
    if (Number.isFinite(exposure)) finalUniforms.uExposure.value = exposure;
  }

  /** 实时改 bloom（调试页 A/B 用）：threshold 门槛、knee 软膝、strength 强度、radius 半径。 */
  function setBloom({ threshold, knee, strength, radius } = {}) {
    if (Number.isFinite(threshold)) { bloomParams.threshold = threshold; brightUniforms.uThreshold.value = threshold; }
    if (Number.isFinite(knee)) { bloomParams.knee = knee; brightUniforms.uKnee.value = knee; }
    if (Number.isFinite(strength)) { bloomParams.strength = strength; finalUniforms.uBloom.value = strength; }
    if (Number.isFinite(radius)) {
      bloomParams.radius = radius;
      bloomTexel.set(radius / Math.max(1, bloomA.width), radius / Math.max(1, bloomA.height));
    }
  }

  return {
    render, resize, dispose, setToneMapping, setBloom, bloomParams,
    _uniforms: marchUniforms,          // 调试/调参口（页面内实时改 density 等）
    _compositeUniforms: compositeUniforms,
  };
}
