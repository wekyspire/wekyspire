// bloom 三段链（bright → 半分辨率 H blur → V blur）抽成的共享件——TSL 版（W2，2026-09-27）：
// 体积月光 composer 与 uiScene composer 各持一条，参数各自、实现一份。
// 阈值约定（volumetricMoon 迁移注释）：管路是 HDR 的（HalfFloat 线性），但内容不是
// HDR 创作的——漫反射受光面 ~1~2，阈值必须卡在其上（缺省 1.45），只有乘算推到
// 真 HDR 的自发光体才进 bloom。
// TSL 化：pass 输入 = TextureNode（每帧换 .value 绑新 RT 纹理），标量 = uniform 节点——
// setBloom/render 的 `.value` 推值口径与 GLSL uniforms 时代逐字一致。
import * as THREE from 'three';
import { uniform, texture } from 'three/tsl';
import {
  tslBright, tslBlur,
  makeFullScreenPass, renderFullScreenPass, disposeFullScreenPass,
} from './passes.js';

/**
 * @param {object} options { threshold, knee, radius }
 * @returns {
 *   render(renderer, inputTexture, offsetTexture?): void, // 输入 → 三段 → 结果留在 texture
 *                                                           // offsetTexture = bloom 强度偏移
 *                                                           // 通道（fx/bloomOffset.js，可省）
 *   texture: THREE.Texture,                 // 链输出（bloom 光量，供终段加算）
 *   resize(w, h),                           // 全分辨率尺寸入，内部自取半分辨率
 *   setBloom({threshold, knee, radius, offsetScale}), // 调试页 A/B 实时改（只 uniform）
 *   params, dispose()
 * }
 */
export function createBloomChain({ threshold = 1.45, knee = 0.35, radius = 1.4 } = {}) {
  const params = { threshold, knee, radius };
  let rtA = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });
  let rtB = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });
  const blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); // 无偏移通道时的兜底
  blackTex.needsUpdate = true;

  // 输入纹理节点（每帧换 .value 重绑——RT ping-pong 的 TSL 惯例）
  const tColor = texture(blackTex);
  const tOffset = texture(blackTex);
  const uOffsetScale = uniform(1);
  const uThreshold = uniform(params.threshold);
  const uKnee = uniform(params.knee);
  const tSrc = texture(blackTex);
  const uDir = uniform(new THREE.Vector2(1, 0));

  const brightScene = makeFullScreenPass(tslBright(tColor, tOffset, uOffsetScale, uThreshold, uKnee));
  const blurScene = makeFullScreenPass(tslBlur(tSrc, uDir));
  const texel = new THREE.Vector2(0.5, 0.5); // 半分辨率 texel（resize 里更新）

  function resize(w, h) {
    const bw = Math.max(1, Math.round(w / 2));
    const bh = Math.max(1, Math.round(h / 2));
    rtA.setSize(bw, bh);
    rtB.setSize(bw, bh);
    texel.set(params.radius / bw, params.radius / bh);
  }

  /** 输入纹理 → bright → H/V 两次分离高斯；结果留在 rtA（经 texture getter 取）。
   *  offsetTexture：可选的 bloom 强度偏移通道（R），阈值判定前加和进亮度。 */
  function render(renderer, inputTexture, offsetTexture = null) {
    tColor.value = inputTexture;
    tOffset.value = offsetTexture ?? blackTex;
    renderer.setRenderTarget(rtA);
    renderFullScreenPass(renderer, brightScene);
    tSrc.value = rtA.texture;
    uDir.value.set(texel.x, 0);
    renderer.setRenderTarget(rtB);
    renderFullScreenPass(renderer, blurScene);
    tSrc.value = rtB.texture;
    uDir.value.set(0, texel.y);
    renderer.setRenderTarget(rtA);
    renderFullScreenPass(renderer, blurScene);
  }

  /** 实时改参（调试页 A/B 用；不动 shader 编译，只改 uniform）。 */
  function setBloom({ threshold: t, knee: k, radius: r, offsetScale: o } = {}) {
    if (Number.isFinite(t)) { params.threshold = t; uThreshold.value = t; }
    if (Number.isFinite(k)) { params.knee = k; uKnee.value = k; }
    if (Number.isFinite(o)) { params.offsetScale = o; uOffsetScale.value = o; }
    if (Number.isFinite(r)) {
      params.radius = r;
      texel.set(r / Math.max(1, rtA.width), r / Math.max(1, rtA.height));
    }
  }

  function dispose() {
    rtA.dispose();
    rtB.dispose();
    blackTex.dispose();
    disposeFullScreenPass(brightScene);
    disposeFullScreenPass(blurScene);
  }

  return {
    render, resize, dispose, setBloom, params,
    get texture() { return rtA.texture; },
  };
}
