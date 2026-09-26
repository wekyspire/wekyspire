// bloom 三段链（bright → 半分辨率 H blur → V blur）抽成的共享件：
// 体积月光 composer 与 uiScene composer 各持一条，参数各自、实现一份。
// 阈值约定（volumetricMoon 迁移注释）：管路是 HDR 的（HalfFloat 线性），但内容不是
// HDR 创作的——漫反射受光面 ~1~2，阈值必须卡在其上（缺省 1.45），只有乘算推到
// 真 HDR 的自发光体才进 bloom。
import * as THREE from 'three';
import {
  FRAG_BRIGHT, FRAG_BLUR,
  makeFullScreenPass, renderFullScreenPass, disposeFullScreenPass,
} from './passes.js';

/**
 * @param {object} options { threshold, knee, radius }
 * @returns {
 *   render(renderer, inputTexture): void,   // 输入 → 三段 → 结果留在 texture
 *   texture: THREE.Texture,                 // 链输出（bloom 光量，供终段加算）
 *   resize(w, h),                           // 全分辨率尺寸入，内部自取半分辨率
 *   setBloom({threshold, knee, radius}),    // 调试页 A/B 实时改（只 uniform）
 *   params, dispose()
 * }
 */
export function createBloomChain({ threshold = 1.45, knee = 0.35, radius = 1.4 } = {}) {
  const params = { threshold, knee, radius };
  let rtA = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });
  let rtB = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });
  const brightUniforms = {
    tColor: { value: null },
    uThreshold: { value: params.threshold },
    uKnee: { value: params.knee },
  };
  const blurUniforms = { tSrc: { value: null }, uDir: { value: new THREE.Vector2(1, 0) } };
  const brightScene = makeFullScreenPass(FRAG_BRIGHT, brightUniforms);
  const blurScene = makeFullScreenPass(FRAG_BLUR, blurUniforms);
  const texel = new THREE.Vector2(0.5, 0.5); // 半分辨率 texel（resize 里更新）

  function resize(w, h) {
    const bw = Math.max(1, Math.round(w / 2));
    const bh = Math.max(1, Math.round(h / 2));
    rtA.setSize(bw, bh);
    rtB.setSize(bw, bh);
    texel.set(params.radius / bw, params.radius / bh);
  }

  /** 输入纹理 → bright → H/V 两次分离高斯；结果留在 rtA（经 texture getter 取）。 */
  function render(renderer, inputTexture) {
    brightUniforms.tColor.value = inputTexture;
    renderer.setRenderTarget(rtA);
    renderFullScreenPass(renderer, brightScene);
    blurUniforms.tSrc.value = rtA.texture;
    blurUniforms.uDir.value.set(texel.x, 0);
    renderer.setRenderTarget(rtB);
    renderFullScreenPass(renderer, blurScene);
    blurUniforms.tSrc.value = rtB.texture;
    blurUniforms.uDir.value.set(0, texel.y);
    renderer.setRenderTarget(rtA);
    renderFullScreenPass(renderer, blurScene);
  }

  /** 实时改参（调试页 A/B 用；不动 shader 编译，只改 uniform）。 */
  function setBloom({ threshold: t, knee: k, radius: r } = {}) {
    if (Number.isFinite(t)) { params.threshold = t; brightUniforms.uThreshold.value = t; }
    if (Number.isFinite(k)) { params.knee = k; brightUniforms.uKnee.value = k; }
    if (Number.isFinite(r)) {
      params.radius = r;
      texel.set(r / Math.max(1, rtA.width), r / Math.max(1, rtA.height));
    }
  }

  function dispose() {
    rtA.dispose();
    rtB.dispose();
    disposeFullScreenPass(brightScene);
    disposeFullScreenPass(blurScene);
  }

  return {
    render, resize, dispose, setBloom, params,
    get texture() { return rtA.texture; },
  };
}
