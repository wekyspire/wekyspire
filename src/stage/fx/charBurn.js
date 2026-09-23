// 烧毁/烧黑 modifier shader（fx Phase 5，2026-09-23；同日视觉大改）：
// 「shader 一旦写好可应用在任何 PCG mesh 上」（用户定）——一份补丁挂进任意材质
// （主顾 = 族单例 M.wood / M.cloth：木件与布旗全族生效，合批散件与未合批活件一视同仁）。
// 三枚 uniforms（普通对象，剧本经 ctx.tweenRaw 直推标量字段）：
//   uChar 0→1  烧黑：albedo 混向炭黑（双频 hash 噪波斑驳，不是匀色漆）
//   uBurn 0→1  烧毁：按 ~0.6u 格块 hash 逐格 discard 侵蚀 + 侵蚀前沿一条窄余烬边；
//            前沿阈值叠加第二层 hash 扰动（侵蚀边界犬牙交错，不再匀速直线推）；
//            余烬边吃 uTime 闪烁（火在啃木头，不是静态描边）
//   uTime      秒计时（常驻剧本线性推）：只服务余烬闪，不进任何阈值判据
// 铁律：族单例是进程级共享物——演出收尾/剧本 kill 必须 resetCharBurn 归零，
// 否则下一场战斗的木件还带着上一场的烧痕。
import * as THREE from 'three';
import { materialOf } from '../scenes/kit/materials.js';

const PATCH_KEY = '_charBurn';

/** 会被挂烧毁补丁的材质族（剧本按族给错峰参数；加新族这里与剧本的 CHAR 表同步）。 */
export const CHAR_BURN_FAMILIES = ['wood', 'cloth'];

/**
 * 给材质打烧毁补丁（幂等：已打过直接取原记录）。
 * 记录里**不反引 material**：挂在 userData 上的循环引用会让 Material.clone() 的
 * JSON 深拷贝直接抛错（族单例自首次补丁起终身携带，clone 即炸——验收 P2-3）。
 * @returns {{ uChar: {value:number}, uBurn: {value:number} }}
 */
export function attachCharBurn(material) {
  if (material.userData[PATCH_KEY]) return material.userData[PATCH_KEY];
  const rec = { uChar: { value: 0 }, uBurn: { value: 0 }, uTime: { value: 0 } };
  material.userData[PATCH_KEY] = rec;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uChar = rec.uChar;
    shader.uniforms.uBurn = rec.uBurn;
    shader.uniforms.uTime = rec.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCharBurnPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCharBurnPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uChar;
uniform float uBurn;
uniform float uTime;
varying vec3 vCharBurnPos;
float charBurnHash() {
  vec3 cell = floor(vCharBurnPos * 1.6); // 0.63u 格：再细就在远处墙上糊成彩色噪点（09-23 实拍）
  return fract(sin(dot(cell.xy + cell.z * 7.13, vec2(12.9898, 78.233))) * 43758.5453);
}
float charBurnHash2() { // 第二层噪声：细频格子，供前沿扰动与炭黑斑驳
  vec3 cell = floor(vCharBurnPos * 5.7 + 13.7);
  return fract(sin(dot(cell.xy + cell.z * 3.71, vec2(39.721, 91.177))) * 24634.6345);
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  float h = charBurnHash();
  float frontier = uBurn * 1.35 - 0.35 * charBurnHash2(); // 犬牙交错的前沿（同一 uBurn 下有的格先焚）
  if (h < frontier) discard; // 烧毁：格块 hash 逐格侵蚀成灰
  // 烧黑：炭黑底 + 细频噪波斑驳（落灰不均匀，带一丝暖红）
  vec3 charCol = vec3(0.045, 0.028, 0.02) + (charBurnHash2() - 0.5) * 0.035;
  diffuseColor.rgb = mix(diffuseColor.rgb, charCol, uChar * (0.75 + 0.25 * charBurnHash2()));
}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float h = charBurnHash();
  float h2 = charBurnHash2();
  float frontier = uBurn * 1.35 - 0.35 * h2;
  // 余烬只沿「活料与灰烬的交界」亮一条窄边，且逐格自己的明暗差一大（09-23 实拍：
  // 0.12 宽 + 2.2 强度时每个存活格都是一块等亮橙斑，整面旗看着像撒了彩纸）
  float rim = 1.0 - smoothstep(0.0, 0.07, h - frontier);
  float flick = 0.72 + 0.28 * sin(uTime * 9.3 + h * 47.0) * sin(uTime * 3.1 + h * 11.0);
  totalEmissiveRadiance += vec3(1.0, 0.3, 0.05) * rim * step(0.001, uBurn) * (0.55 + 0.75 * h2) * flick;
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

/**
 * 入场预热：把烧毁变体的 program 在黑幕期就编好，演出里只推 uniform 不再触发重编译。
 * 教训（09-23 转段「跃变」）：补丁只在用的那一拍挂上，needsUpdate 让两枚族单例
 * 当场重编译，实测在主线程上砸出 715ms 空档（tmp/play/pyro-cam-jump.mjs 量得），
 * 正好卡在爆发那一帧——先冻一下再跳出，比任何补间曲线都刺眼。
 * 必须拿**真实舞台场景**当 targetScene：program 缓存键含灯光状态与雾，空场景预热
 * 编出来的是另一个变体，等于白暖。
 */
export function warmCharBurn({ renderer, scene, camera, families = CHAR_BURN_FAMILIES }) {
  if (!renderer || !scene || !camera) return;
  for (const fam of families) {
    try { attachCharBurn(materialOf(fam)); } catch { /* 未知族：没有件可烧，跳过 */ }
  }
  // compileAsync 走 KHR_parallel_shader_compile（驱动并行编 shader，不冻主线程）；
  // 老 renderer/假 renderer 没这方法时退回同步版——同样是入场一次性成本，不进演出
  const async = renderer.compileAsync?.call(renderer, scene, camera);
  if (!async) renderer.compile?.call(renderer, scene, camera);
}