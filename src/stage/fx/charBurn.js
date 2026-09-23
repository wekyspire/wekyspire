// 烧毁/烧黑 modifier shader（fx Phase 5，2026-09-23）：
// 「shader 一旦写好可应用在任何 PCG mesh 上」（用户定）——一份补丁挂进任意材质
// （主顾 = 族单例 M.wood：顶点色管线下木件全族生效，合批散件与未合批活件一视同仁）。
// 两枚 uniforms（普通对象，剧本经 ctx.tweenRaw 直推标量字段）：
//   uChar 0→1  烧黑：albedo 混向炭黑（带一丝暖红）
//   uBurn 0→1  烧毁：按 0.5u 格块 hash 逐格 discard 侵蚀 + 侵蚀前沿余烬发光边
// 铁律：族单例是进程级共享物——演出收尾/剧本 kill 必须 resetCharBurn 归零，
// 否则下一场战斗的木件还带着上一场的烧痕。
import * as THREE from 'three';

const PATCH_KEY = '_charBurn';

/**
 * 给材质打烧毁补丁（幂等：已打过直接取原记录）。
 * 记录里**不反引 material**：挂在 userData 上的循环引用会让 Material.clone() 的
 * JSON 深拷贝直接抛错（族单例自首次补丁起终身携带，clone 即炸——验收 P2-3）。
 * @returns {{ uChar: {value:number}, uBurn: {value:number} }}
 */
export function attachCharBurn(material) {
  if (material.userData[PATCH_KEY]) return material.userData[PATCH_KEY];
  const rec = { uChar: { value: 0 }, uBurn: { value: 0 } };
  material.userData[PATCH_KEY] = rec;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uChar = rec.uChar;
    shader.uniforms.uBurn = rec.uBurn;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCharBurnPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCharBurnPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uChar;
uniform float uBurn;
varying vec3 vCharBurnPos;
float charBurnHash() {
  vec3 cell = floor(vCharBurnPos * 2.0);
  return fract(sin(dot(cell.xy + cell.z * 7.13, vec2(12.9898, 78.233))) * 43758.5453);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float h = charBurnHash();
  float frontier = uBurn * 1.02;
  if (h < frontier) discard; // 烧毁：格块 hash 逐格侵蚀成灰
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045, 0.028, 0.02), uChar); // 烧黑
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float h = charBurnHash();
  float frontier = uBurn * 1.02;
  float rim = 1.0 - smoothstep(0.0, 0.10, h - frontier);
  totalEmissiveRadiance += vec3(1.0, 0.26, 0.04) * rim * step(0.001, uBurn) * 1.8; // 侵蚀前沿余烬边
}`);
  };
  // 补丁材质走独立 program（不污染未补丁的同型材质缓存）
  material.customProgramCacheKey = () => 'kit-char-burn';
  material.needsUpdate = true;
  return rec;
}

/** 取已打的补丁记录（未打 → null）。 */
export function charBurnOf(material) { return material.userData[PATCH_KEY] ?? null; }

/** 两枚值归零（演出收尾/剧本 kill 必调——族单例跨场景共享，不复位会漏进下一场）。 */
export function resetCharBurn(rec) {
  if (!rec) return;
  rec.uChar.value = 0;
  rec.uBurn.value = 0;
}
