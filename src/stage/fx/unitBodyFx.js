// 单位本体特效补丁（L0 本体层，VFX 结构大更新 Phase 1，2026-09-26）：
// charBurn 同款手法挂进单位 _body 的 MeshBasicMaterial——但与房间道具不同，
// 单位材质是**每单位独立实例**（UnitObject 构造即 new），无族单例跨场复位负担，
// 补丁随材质 dispose 自然消亡（只留 dispose 钩子里的防御性归零）。
// 单 program 多 uniform（固定层级 L0 的纪律：效果在同一片元程序内按固定顺序合成，
// 上层效果天然读到下层的输出——L2 笼罩层「需要下层 framebuffer」的需求多半在此
// 零成本满足，真邻域采样才走懒建 RT）：
//   uBurn 0..1  燃烧：立绘自下而上泛橙红脉动（vMapUv.y 梯度）+ 双频 hash 噪波斑驳
//               + uTime 闪烁——暗部压焦、亮部泛余烬色；
//   uTime       秒计时（burn aura 存活期由 def 经 unit.addTick 推进，熄灭即冻结）
// 纪律：
//   · 只动 diffuseColor.rgb，不碰 alpha——alphaTest 剪影与深度写入零影响；
//   · 本体亮度上限压 ~1.3，**不过世界 bloom 阈 1.45**——发光是 L1 贴体叠火的活，
//     分工防「单位糊成一团白光」（bloom 阈值事故的教训）；
//   · 全部效果包在 #ifdef USE_MAP 内：无立绘的占位色块单位不编效果
//     （map 挂上时 three 自动重编，变体各自成立）。
import * as THREE from 'three';

const PATCH_KEY = '_unitBodyFx';

/**
 * 给单位本体材质打特效补丁（幂等：已打过直接取原记录）。
 * 记录只装 uniforms（不反引 material——charBurn 的 clone 深拷贝教训）。
 * @returns {{ uBurn: {value:number}, uTime: {value:number} }}
 */
export function attachUnitBodyFx(material) {
  if (material.userData[PATCH_KEY]) return material.userData[PATCH_KEY];
  const rec = { uBurn: { value: 0 }, uTime: { value: 0 } };
  material.userData[PATCH_KEY] = rec;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBurn = rec.uBurn;
    shader.uniforms.uTime = rec.uTime;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uBurn;
uniform float uTime;
#ifdef USE_MAP
float unitBodyFxHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
#endif`)
      .replace('#include <color_fragment>', `#include <color_fragment>
#ifdef USE_MAP
{
  // 燃烧：火自脚下起（vMapUv.y=0 是牌底）——下身为主的斑驳火区，双频噪波让
  // 火区边界犬牙交错；明暗闪烁吃 uTime。余烬色峰值 ~1.26r（阈下，见文件头纪律）
  float fxLow = 1.0 - vMapUv.y;
  float fxN1 = unitBodyFxHash(floor(vMapUv * vec2(9.0, 15.0)) + vec2(0.0, floor(uTime * 6.0)));
  float fxN2 = unitBodyFxHash(floor(vMapUv * vec2(23.0, 29.0)) - vec2(floor(uTime * 2.0), 0.0));
  float fxZone = smoothstep(0.18, 1.0, fxLow * (0.5 + 0.5 * fxN2));
  float fxFlick = 0.68 + 0.32 * sin(uTime * 9.7 + fxN1 * 39.0);
  float fxK = clamp(uBurn * fxZone * fxFlick, 0.0, 1.0);
  vec3 fxEmber = vec3(1.05, 0.34, 0.07) * (0.35 + 0.85 * fxN1);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.42 + fxEmber, fxK * 0.85);
}
#endif`);
  };
  // 补丁材质走独立 program（全体单位本体共享一个变体，预热一次全就位）
  material.customProgramCacheKey = () => 'unit-body-fx';
  material.needsUpdate = true;
  return rec;
}

/** 取已打的补丁记录（未打 → null）。 */
export function unitBodyFxOf(material) { return material.userData[PATCH_KEY] ?? null; }
