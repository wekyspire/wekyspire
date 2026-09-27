// 卡牌本体特效补丁（C0 牌面 shader 层，VFX 结构大更新 Phase 3，2026-09-27）：
// 对位单位侧 L0（unitBodyFx.js）——同一手法挂进牌面 MeshBasicMaterial：
// **每卡独立材质实例**（CardObject 构造即 new），补丁随材质 dispose 自然消亡；
// 单 program 多 uniform 常驻（构造即挂，效果全 0 时零视觉）——焚毁点燃/状态切换
// 只推 uniform 不再换 onBeforeCompile 重编译（旧 startBurn 点燃时换 cacheKey 重编
// 的做法废弃：补丁常驻后点燃零编译成本）。
//  uniforms：
//   uBurn      0..1  焚毁吞蚀（离场演出）：自底向上噪声火线 + 炭化预热 + 逐格 discard——
//                    实现与旧 startBurn 内联补丁逐式一致（视觉零回归）；uBurn=0 时
//                    前沿线在牌面下方界外，天然无效果
//   uSeed            焚毁噪声种子（每张卡咬边形状不同，点燃时写入）
//   uDim       0..1  禁用态（setVisualState('disabled') 的 shader 版——旧实现是
//                    material.color 乘 0xb8b8b8 的粗占位）：去饱和 + 压暗 + 微冷
//   uHighlight 0..1  高亮态（'highlighted'）：提亮 + 微暖 + 极轻呼吸（uTime 驱动）
//   uTime            秒计时（CardFxLayer 的层内统一钟推进——多 uniform 共用一钟）
// 纪律：
//   · 只动 diffuseColor.rgb，不碰 alpha——命中热区/透明度语义零影响；
//   · 自带 varying（vCardFxUv），不依赖 USE_MAP（无贴图的占位牌也编译得过）；
//   · HDR 约定：焚毁火线峰 ~2.05 过 uiScene bloom 阈 1.45（既有视觉，刻意保留）；
//     状态档（dim/highlight）全部压阈下——状态是读数不是演出；
//   · 合成顺序固定：状态档 → 焚毁（焚毁最大，盖过一切状态）。
import * as THREE from 'three';

const PATCH_KEY = '_cardBodyFx';

// C0 着色链（注入牌面材质 color_fragment 后）
const GLSL_CARD_BODY_FX = /* glsl */`
  float cardBodyFxHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float cardBodyFxNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(cardBodyFxHash(i), cardBodyFxHash(i + vec2(1.0, 0.0)), u.x),
               mix(cardBodyFxHash(i + vec2(0.0, 1.0)), cardBodyFxHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  vec3 cardBodyFxShade(vec3 base, vec2 uv, float uDim, float uHighlight, float uTime) {
    vec3 c = base;
    // 禁用：去饱和 + 压暗 + 微冷（「打不出去」的冷却感；旧乘法灰化的精致版）
    if (uDim > 0.001) {
      float g = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c, vec3(g), 0.62 * uDim) * mix(1.0, 0.66, uDim);
      c = mix(c, c * vec3(0.92, 0.97, 1.08), uDim);
    }
    // 高亮：提亮 + 微暖 + 极轻呼吸（可点/被选中的活物感）
    if (uHighlight > 0.001) {
      float breath = 0.5 + 0.5 * sin(uTime * 2.4);
      c *= 1.0 + uHighlight * (0.10 + 0.05 * breath);
      c = mix(c, c * vec3(1.06, 1.03, 0.90), uHighlight);
    }
    return c;
  }
`;

/**
 * 给牌面材质打 C0 特效补丁（幂等：已打过直接取原记录）。
 * @returns {{ uBurn:{value}, uSeed:{value}, uDim:{value}, uHighlight:{value}, uTime:{value} }}
 */
export function attachCardBodyFx(material) {
  if (material.userData[PATCH_KEY]) return material.userData[PATCH_KEY];
  const rec = {
    uBurn: { value: 0 },
    uSeed: { value: 0 },
    uDim: { value: 0 },
    uHighlight: { value: 0 },
    uTime: { value: 0 },
  };
  material.userData[PATCH_KEY] = rec;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBurn = rec.uBurn;
    shader.uniforms.uSeed = rec.uSeed;
    shader.uniforms.uDim = rec.uDim;
    shader.uniforms.uHighlight = rec.uHighlight;
    shader.uniforms.uTime = rec.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vCardFxUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\tvCardFxUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec2 vCardFxUv;
uniform float uBurn;
uniform float uSeed;
uniform float uDim;
uniform float uHighlight;
uniform float uTime;
${GLSL_CARD_BODY_FX}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  // 状态档（C0 下段）：禁用压暗 / 高亮提暖
  diffuseColor.rgb = cardBodyFxShade(diffuseColor.rgb, vCardFxUv, uDim, uHighlight, uTime);
  // 焚毁（C0 上段，离场演出）：双频值噪声咬边火线，自底向上吞蚀
  if (uBurn > 0.001) {
    float n = cardBodyFxNoise(vCardFxUv * vec2(5.0, 8.0) + vec2(uSeed, uSeed * 0.7)) * 0.6
            + cardBodyFxNoise(vCardFxUv * vec2(11.0, 17.0) - uSeed) * 0.4;
    float line = uBurn * 1.45 - 0.2;               // 前沿自底向上推进（两端留噪声余量）
    float d = vCardFxUv.y - line + (n - 0.5) * 0.45; // 距前沿的有符号距离
    if (d < -0.05) {
      discard;                                      // 已燃尽区域
    } else if (d < 0.02) {
      float g = 1.0 - (d + 0.05) / 0.07;            // 火线辉光带（深橙→亮黄，HDR 过阈）
      vec3 ember = mix(vec3(0.55, 0.12, 0.01), vec3(1.0, 0.88, 0.42), g * g);
      diffuseColor.rgb = mix(diffuseColor.rgb * 0.3, ember * (1.15 + 0.9 * g), g);
    } else if (d < 0.16) {
      float c1 = 1.0 - (d - 0.02) / 0.14;           // 前沿上方炭化预热（焦黑泛红）
      diffuseColor.rgb = mix(diffuseColor.rgb,
        diffuseColor.rgb * vec3(0.4, 0.26, 0.2) + vec3(0.09, 0.015, 0.0), c1 * 0.85);
    }
  }
}`);
  };
  // 全体卡牌共享一个 program 变体（USE_MAP 等标准参数仍在缓存键里，有/无贴图各自成立）
  material.customProgramCacheKey = () => 'weky-card-body-fx';
  material.needsUpdate = true;
  return rec;
}

/** 取已打的补丁记录（未打 → null）。 */
export function cardBodyFxOf(material) { return material.userData[PATCH_KEY] ?? null; }
