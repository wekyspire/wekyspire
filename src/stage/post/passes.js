// 共享后处理件（stage/post/ 层，2026-09-26 结构大更新 Phase 0）：
// 全屏 pass 的**唯一事实源**——体积月光 composer（scenes/volumetricMoon.js）与
// uiScene composer（post/uiComposer.js）共用同一套 shader / 工具，bloom 阈值、
// 色调映射曲线等全局约定只在这里各有一份，改一处两链同步。
//
// 两条铁律（RT 间接合成成立的前提，uiComposer 依赖）：
//   ① 终段合成用 premultiplied（ONE, ONE_MINUS_SRC_ALPHA）——three 法线混合在 RT
//     里留下的 rgb 本就是预乘色、alpha 是真覆盖率，数学上与直渲逐像素等价；
//   ② uiScene 的加法发光件一律走 additiveLight()（rgb 加算照旧、alpha 不占地）——
//     否则光斑的 alpha 会在 RT 里「占地」，合成时把背后的世界挡掉。
import * as THREE from 'three';

export const VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// 全屏 pass 相机：模块级单例（渲染期无状态，所有 pass 共享一台）
const FS_CAM = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

/** 建一个全屏 quad pass（返回只有一子的 Scene）。 */
export function makeFullScreenPass(fragmentShader, uniforms) {
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms, vertexShader: VERT, fragmentShader,
      depthTest: false, depthWrite: false,
    }),
  ));
  return scene;
}

/** 渲一个全屏 pass（调用方负责 setRenderTarget）。 */
export function renderFullScreenPass(renderer, scene) {
  renderer.render(scene, FS_CAM);
}

/** 销毁全屏 pass 的几何与材质（RT 由持有方自己销毁）。 */
export function disposeFullScreenPass(scene) {
  for (const child of [...scene.children]) {
    child.geometry.dispose();
    child.material.dispose();
  }
}

// bright pass：软膝阈值提亮部（线性空间）。彩灯/屏幕这些 >1 的自发光体才是主角。
export const FRAG_BRIGHT = /* glsl */`
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
export const FRAG_BLUR = /* glsl */`
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

// 色调映射库（GLSL 字符串件）：FRAG_FINAL 与 uiComposer 的 UI 终段共享同一份
// 曲线实现——Neutral/ACES/Reinhard/none 四种，exposure 显式传参（不再读全局 uniform，
// 行为与原内嵌版逐式等价）。
export const GLSL_TONE_LIB = /* glsl */`
  vec3 linearToSrgb(vec3 c) {
    return pow(max(c, vec3(0.0)), vec3(1.0 / 2.2));
  }
  vec3 toneNeutral(vec3 color, float exposure) {
    const float StartCompression = 0.8 - 0.04;
    const float Desaturation = 0.15;
    color *= exposure;
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
  vec3 toneAces(vec3 color, float exposure) {
    const mat3 inMat = mat3(
      vec3(0.59719, 0.07600, 0.02840),
      vec3(0.35458, 0.90834, 0.13383),
      vec3(0.04823, 0.01566, 0.83777));
    const mat3 outMat = mat3(
      vec3( 1.60475, -0.10208, -0.00327),
      vec3(-0.53108,  1.10813, -0.07276),
      vec3(-0.07367, -0.00605,  1.07602));
    color *= exposure / 0.6;
    color = inMat * color;
    color = rrtOdtFit(color);
    color = outMat * color;
    return clamp(color, 0.0, 1.0);
  }
  vec3 applyTone(vec3 c, int tone, float exposure) {
    if (tone == 1) return toneNeutral(c, exposure);
    if (tone == 2) return toneAces(c, exposure);
    if (tone == 3) return c * exposure / (1.0 + c * exposure);
    return c; // none：原样直出（与旧 FRAG_FINAL 的 uTone==0 分支一致，不乘曝光）
  }
`;

// final：色调映射 + bloom 叠加 + sRGB 输出（世界链终段；alpha 恒 1 直出屏幕）
export const FRAG_FINAL = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tColor;
  uniform sampler2D tBloom;
  uniform float uBloom;
  uniform float uExposure;
  uniform int uTone;
  ${GLSL_TONE_LIB}

  void main() {
    vec3 c = texture2D(tColor, vUv).rgb + texture2D(tBloom, vUv).rgb * uBloom;
    c = applyTone(c, uTone, uExposure);
    gl_FragColor = vec4(linearToSrgb(c), 1.0);
  }
`;

/** 色调映射模式（宿主/调试页共用一份枚举，避免两边写死数字）。 */
export const TONE_MODES = Object.freeze({ none: 0, neutral: 1, aces: 2, reinhard: 3 });

/**
 * 全局缺省色调映射：直渲路径（StageManager 的 renderer）与体积光 composer 必须一致。
 * 选 Neutral（Khronos PBR Neutral）的理由：保色相/饱和，
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
 * 加法发光件约定（铁律②）：rgb 加算保持旧 AdditiveBlending 观感（SRC_ALPHA 因子，
 * opacity 呼吸动画照旧生效），但 alpha 通道**不写**（ZERO, ONE）——光不占地。
 * uiScene 进 RT 再合成的链路里，普通 AdditiveBlending 会把光斑 alpha 累进覆盖率，
 * 终段合成时把背后的世界挡掉；直渲路径下本约定与 AdditiveBlending 逐像素等价
 * （画布不透明，alpha 写什么是垃圾值都无人在乎），两条路径零回归。
 */
export function additiveLight(material) {
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = THREE.SrcAlphaFactor;
  material.blendDst = THREE.OneFactor;
  material.blendSrcAlpha = THREE.ZeroFactor;
  material.blendDstAlpha = THREE.OneFactor;
  material.transparent = true;
  return material;
}
