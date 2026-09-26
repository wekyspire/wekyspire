// uiScene 后处理 composer（2026-09-26 结构大更新 Phase 0）：
// 卡牌/按钮/面板/特写从「直渲屏幕」升级为「RT + bloom 链」——
//   uiScene → HalfFloat RT（MSAA×4、透明底）→ bloom 三段（阈值同世界链 1.45）
//   → 终段 tone map + bloom 加算 + sRGB，premultiplied 合成盖回世界之上。
// 成立前提 = passes.js 头注释的两条铁律：
//   ① 终段 premultiplied 合成（three 法线混合在 RT 里留下的 rgb 本就是预乘色、
//     alpha 是真覆盖率——与直渲逐像素等价）；
//   ② uiScene 加法发光件一律 additiveLight()（rgb 加算照旧、alpha 不占地），
//     否则光斑 alpha 会在 RT 里累成覆盖率，合成时把背后的世界挡掉。
// 既有受益件：CardFxLayer 咏唱流光的 HDR 输出（峰值 ~1.9）自 09-13 起就在等这条链
// （直渲期被 tone map 压掉，从未真 bloom）；此后新发光 UI 按 HDR 约定写即可。
import * as THREE from 'three';
import {
  GLSL_TONE_LIB, TONE_MODES,
  makeFullScreenPass, renderFullScreenPass, disposeFullScreenPass,
} from './passes.js';
import { createBloomChain } from './bloomChain.js';

// UI 终段：与世界链 FRAG_FINAL 同曲线，唯一差别 = alpha 透传（tColor 是真覆盖率，
// 由调用侧以 premultiplied 混合盖回屏幕）；bloom 纯加算——a=0 处即溢出剪影的光晕。
const FRAG_UI_FINAL = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tColor;
  uniform sampler2D tBloom;
  uniform float uBloom;
  uniform float uExposure;
  uniform int uTone;
  ${GLSL_TONE_LIB}

  void main() {
    vec4 src = texture2D(tColor, vUv);
    vec3 c = src.rgb + texture2D(tBloom, vUv).rgb * uBloom;
    c = applyTone(c, uTone, uExposure);
    gl_FragColor = vec4(linearToSrgb(c), src.a);
  }
`;

/**
 * 建 uiScene composer。
 * @returns { render(renderer, scene, camera), resize(cssW, cssH, dpr), dispose(),
 *            setBloom({threshold,knee,strength,radius}), bloomParams }
 */
export function createUiComposer() {
  // bloom 参数与世界链同基准（threshold 1.45：只有 HDR 溢出发光件进 bloom）；
  // strength 略高（0.5 vs 0.42）：UI 光晕是纯加算盖在已映射屏幕上，量级天然偏小
  const bloomParams = { threshold: 1.45, knee: 0.35, strength: 0.5, radius: 1.4 };
  const rt = new THREE.WebGLRenderTarget(2, 2, {
    type: THREE.HalfFloatType,
    samples: 4, // MSAA：卡边/文字边缘不进 bloom 也要 AA（直渲期吃的是画布 MSAA）
  });
  const bloom = createBloomChain(bloomParams);
  const finalUniforms = {
    tColor: { value: null },
    tBloom: { value: null },
    uBloom: { value: bloomParams.strength },
    uExposure: { value: 1 },
    uTone: { value: TONE_MODES.neutral },
  };
  const finalScene = makeFullScreenPass(FRAG_UI_FINAL, finalUniforms);
  {
    // 铁律①：终段 premultiplied 合成（rgb 已是预乘色，不再乘 alpha）
    const mat = finalScene.children[0].material;
    mat.blending = THREE.CustomBlending;
    mat.blendEquation = THREE.AddEquation;
    mat.blendSrc = THREE.OneFactor;
    mat.blendDst = THREE.OneMinusSrcAlphaFactor;
    mat.blendSrcAlpha = THREE.OneFactor;
    mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
    mat.transparent = true;
  }

  const _clearColor = new THREE.Color();

  // RT 按绘制缓冲尺寸（CSS 尺寸 × DPR，cap 由调用方的 _devicePixelRatio 管）——
  // UI 文字/细边要保直渲期的锐度；世界链 RT 是 CSS 分辨率（体积光软，吃不起 4 倍），
  // 两条链分辨率各自独立（终段都是全屏采样，无对齐要求）。
  function resize(w, h, dpr = 1) {
    const rw = Math.max(1, Math.round(w * dpr));
    const rh = Math.max(1, Math.round(h * dpr));
    rt.setSize(rw, rh);
    bloom.resize(rw, rh);
  }

  function render(renderer, scene, camera) {
    renderer.getClearColor(_clearColor);
    const prevClearAlpha = renderer.getClearAlpha();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    // pass 1：uiScene → 透明底 RT（渲染进 RT 时 three 不套 tone mapping/sRGB，保持线性）
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    // pass 2-4：bright → 半分辨率 H/V blur
    bloom.render(renderer, rt.texture);
    // pass 5：tone map + bloom 加算 + sRGB，premultiplied 盖回屏幕
    finalUniforms.tColor.value = rt.texture;
    finalUniforms.tBloom.value = bloom.texture;
    renderer.setRenderTarget(null);
    renderer.setClearColor(_clearColor, prevClearAlpha);
    renderFullScreenPass(renderer, finalScene);
    renderer.autoClear = prevAutoClear;
  }

  /** 实时改 bloom（调试/调参用；只 uniform）。 */
  function setBloom({ threshold, knee, strength, radius } = {}) {
    if (Number.isFinite(threshold)) bloomParams.threshold = threshold;
    if (Number.isFinite(knee)) bloomParams.knee = knee;
    if (Number.isFinite(radius)) bloomParams.radius = radius;
    bloom.setBloom({ threshold, knee, radius });
    if (Number.isFinite(strength)) { bloomParams.strength = strength; finalUniforms.uBloom.value = strength; }
  }

  function dispose() {
    rt.dispose();
    bloom.dispose();
    disposeFullScreenPass(finalScene);
  }

  return {
    render, resize, dispose, setBloom, bloomParams,
    _finalUniforms: finalUniforms, // 调参口（与 volumetricMoon 同惯例）
  };
}
