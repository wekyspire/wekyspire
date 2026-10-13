// G-buffer 深度的透明件遮挡（deferred 路径专用）：forward 余量 pass 不写深度、光照输出
// RT 不挂深度附件（W2⑨），透明件在自家材质里采 G-buffer 深度做比较——
//   硬测试（立牌类）：applyGbufHardTest(material)——被遮挡像素 alphaTest 强制不过（discard），
//                     不碰 colorNode，与 unitBodyFx 等补丁零冲突；
//   软衰减（粒子类）：gbufSoftFadeFactor(range) 节点乘进 colorNode（加法混合下等效淡出，
//                     即 soft particle）。
// 共享单例 uniform（tDepth/camProjInv 由 deferred 控制器每帧驱动，材质构建期即引用）。
// DEFERRED_ON 是构建期常量（?deferred=1）：非 deferred 局不接入任何节点，前向零开销。
import * as THREE from 'three';
import {
  uniform, texture, uv, vec4, float, clamp, oneMinus, select, Fn, positionView,
} from 'three/tsl';
import { passUV } from './passes.js';

export const DEFERRED_ON = typeof location !== 'undefined'
  && new URLSearchParams(location.search).get('deferred') === '1';

const blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
blackTex.needsUpdate = true;

export const gbufDepthShared = {
  tDepth: texture(blackTex),
  camProjInv: uniform(new THREE.Matrix4()),
};

/** 片元视距 − 场景面视距：>0 = 片元在 G-buffer 几何后方（被遮挡） */
export const gbufBehind = /* @__PURE__ */ Fn(() => {
  const d = gbufDepthShared.tDepth.sample(passUV).x;
  const ndc = vec4(uv().mul(2.0).sub(1.0), d, 1.0);
  const vpos = gbufDepthShared.camProjInv.mul(ndc);
  const sceneDist = vpos.z.div(vpos.w).negate();
  return positionView.z.negate().sub(sceneDist);
})();

/** 软衰减因子（1 = 未遮挡；遮挡深度超过 range 世界单位后归 0） */
export const gbufSoftFadeFactor = (range = 2.0) => oneMinus(clamp(gbufBehind.div(float(range)), 0.0, 1.0));

/** 硬遮挡：被遮挡像素 alphaTest 阈值抬到 2（alpha 恒 ≤1 → 恒 discard） */
export function applyGbufHardTest(material) {
  const threshold = float(material.alphaTest > 0 ? material.alphaTest : 0.5);
  material.alphaTestNode = select(gbufBehind.greaterThan(0.0), float(2.0), threshold);
}
