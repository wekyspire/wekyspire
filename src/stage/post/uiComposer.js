// uiScene 后处理 composer（TSL 版，W2 ）：
// 卡牌/按钮/面板/特写从「直渲屏幕」升级为「RT + bloom 链」——
//   uiScene → HalfFloat RT（透明底）→ bloom 三段（阈值同世界链 1.45）
//   → 终段 bloom 加算直出**线性 HDR**，premultiplied 合成进帧缓冲。
// tone map + sRGB 统一由渲染器帧末输出 blit 施加（flavor A，passes.js 头注
// 「输出变换铁律」——本 composer 不碰 renderer.toneMapping）；帧末 blit 对
// 「世界 + UI」的线性叠加结果一次性映射，卡牌叠亮背景处的观感与旧「各自 tone
// 后混合」略有差别（物理上更正确）。
// 成立前提 = passes.js 头注释的两条铁律（premultiplied 终段 + additiveLight 约定）。
// 既有受益件：CardFxLayer 咏唱流光的 HDR 输出（峰值 ~1.9）自 09-13 起就在等这条链。
import * as THREE from 'three';
import { uniform, texture } from 'three/tsl';
import {
  tslFinalUi,
  makeFullScreenPass, renderFullScreenPass, disposeFullScreenPass,
} from './passes.js';
import { uSceneGrade } from '../fx/sceneMood.js';
import { createBloomChain } from './bloomChain.js';
import { renderBloomOffsetPass } from '../fx/bloomOffset.js';

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
    // 无 MSAA：WebGPU 后端对「RT samples>0 + 深度附件」的处理有 destroyed-texture 病灶
    // （probe-w2-post 实测，volumetricMoon 同案）——卡边 AA 暂失，终版如需补 FXAA。
  });
  // bloom 强度偏移通道（fx/bloomOffset.js）：卡牌/特写 FX 主动声明起晕强度，
  // 颜色本体不必拉爆 HDR（世界链同手法；uiScene 无遮挡需求，独立深度清深度即可）
  const rtBloomOff = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });
  const bloom = createBloomChain(bloomParams);

  // 终段纹理/标量节点（.value 每帧重绑）
  const blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blackTex.needsUpdate = true;
  const tColor = texture(blackTex);
  const tBloom = texture(blackTex);
  const uBloom = uniform(bloomParams.strength);
  const finalScene = makeFullScreenPass(tslFinalUi(tColor, tBloom, uBloom, uSceneGrade));
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
    rtBloomOff.setSize(rw, rh);
    bloom.resize(rw, rh);
  }

  function render(renderer, scene, camera) {
    renderer.getClearColor(_clearColor);
    const prevClearAlpha = renderer.getClearAlpha();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    // pass 1：uiScene → 透明底 RT（渲进 RT 无输出变换，保持线性）
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    // pass 1.5：bloom 偏移通道（BLOOM_LAYER 上的 UI FX 件重写输出；独立深度清深度）
    renderer.setRenderTarget(rtBloomOff);
    renderBloomOffsetPass(renderer, scene, camera, { clearDepth: true });
    // pass 2-4：bright → 半分辨率 H/V blur
    bloom.render(renderer, rt.texture, rtBloomOff.texture);
    // pass 5：bloom 加算，premultiplied 线性叠加进帧缓冲。
    // 直出线性 HDR——tone+sRGB 由渲染器帧末输出 blit 统一施加（flavor A，
    // 本链不碰 renderer.toneMapping）
    tColor.value = rt.texture;
    tBloom.value = bloom.texture;
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
    if (Number.isFinite(strength)) { bloomParams.strength = strength; uBloom.value = strength; }
  }

  function dispose() {
    rt.dispose();
    rtBloomOff.dispose();
    bloom.dispose();
    blackTex.dispose();
    disposeFullScreenPass(finalScene);
  }

  return {
    render, resize, dispose, setBloom, bloomParams,
    // 调参口（与 volumetricMoon 同惯例）
    _nodes: { tColor, tBloom, uBloom },
    // 调试探针口：色彩空间链排查用（读回 uiRT 线性像素）
    _rt: rt,
    _finalScene: finalScene,
  };
}
