// 单位本体特效补丁（L0 本体层，VFX 结构大更新 Phase 1，2026-09-26）：
// charBurn 同款手法挂进单位 _body 的 MeshBasicMaterial——但与房间道具不同，
// 单位材质是**每单位独立实例**（UnitObject 构造即 new），无族单例跨场复位负担，
// 补丁随材质 dispose 自然消亡（只留 dispose 钩子里的防御性归零）。
// 单 program 多 uniform（固定层级 L0 的纪律：效果在同一片元程序内按固定顺序合成，
// 上层效果天然读到下层的输出——L2 笼罩层「需要下层 framebuffer」的需求多半在此
// 零成本满足，真邻域采样才走懒建 RT）：
//   uBurn   0..1  燃烧：立绘自下而上泛橙红脉动（vMapUv.y 梯度）+ 双频 hash 噪波斑驳
//   uPoison 0..1  中毒：整体泛青绿渗色（无梯度，毒是浸润不是烧）+ 慢速胀动 + 高频噪斑
//   uTime         秒计时（UnitFxLayer 常驻推进——多 uniform 共用一钟，
//                 不许单个 aura 占钟：毒无火时 uTime 也得走）
// 纪律：
//   · 只动 diffuseColor.rgb，不碰 alpha——alphaTest 剪影与深度写入零影响；
//   · 本体亮度上限压 ~1.3，**不过世界 bloom 阈 1.45**——发光是 L1 贴体件的活，
//     分工防「单位糊成一团白光」（bloom 阈值事故的教训）；
//   · 合成顺序固定（burn → poison），后写者读到前者的输出（L0 内的层内优先级）；
//   · 着色链实现抽成 GLSL_BODY_FX 共享件：本体补丁与 L2 同源重算件（stasisShell）
//     include 同一份函数 + 共享同一份 uniform 记录——一份实现，两处同帧；
//   · 全部效果包在 #ifdef USE_MAP 内：无立绘的占位色块单位不编效果
//     （map 挂上时 three 自动重编，变体各自成立）。
import * as THREE from 'three';

const PATCH_KEY = '_unitBodyFx';

// L0 着色链（共享 GLSL 件）：fxUv 空间（0..1，y=0 牌底）内按固定顺序合成全部本体效果。
// 本体补丁注入时在 color_fragment 后调它；L2 同源重算件（stasisShell 的壳内影）也调它——
// 「下层长什么样」对上层永远 = 同函数 + 同 uniform 记录，零 RT。
export const GLSL_BODY_FX = /* glsl */`
  float unitBodyFxHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  vec3 unitBodyFxShade(vec3 base, vec2 fxUv, float uBurn, float uPoison, float uTime) {
    vec3 c = base;
    // ---- 燃烧（uBurn）：火自脚下起——下身为主的斑驳火区，双频噪波让火区边界
    // 犬牙交错；明暗闪烁吃 uTime。余烬色峰值 ~1.26r（阈下，见文件头纪律）
    {
      float fxLow = 1.0 - fxUv.y;
      float fxN1 = unitBodyFxHash(floor(fxUv * vec2(9.0, 15.0)) + vec2(0.0, floor(uTime * 6.0)));
      float fxN2 = unitBodyFxHash(floor(fxUv * vec2(23.0, 29.0)) - vec2(floor(uTime * 2.0), 0.0));
      float fxZone = smoothstep(0.18, 1.0, fxLow * (0.5 + 0.5 * fxN2));
      float fxFlick = 0.68 + 0.32 * sin(uTime * 9.7 + fxN1 * 39.0);
      float fxK = clamp(uBurn * fxZone * fxFlick, 0.0, 1.0);
      vec3 fxEmber = vec3(1.05, 0.34, 0.07) * (0.35 + 0.85 * fxN1);
      c = mix(c, c * 0.42 + fxEmber, fxK * 0.85);
    }
    // ---- 中毒（uPoison）：毒是浸润不是烧——无梯度整体渗青绿，慢速胀动 + 高频
    // 噪斑（密集细点 = 溃烂感，与燃烧的大块火区读出区分）
    {
      float pN = unitBodyFxHash(floor(fxUv * vec2(13.0, 17.0)) + vec2(floor(uTime * 1.5), 0.0));
      float pPulse = 0.75 + 0.25 * sin(uTime * 3.1);
      float pK = clamp(uPoison * (0.55 + 0.45 * pN) * pPulse, 0.0, 1.0);
      vec3 pTint = vec3(0.30, 0.85, 0.26) * (0.5 + 0.5 * pN);
      c = mix(c, c * 0.5 + pTint, pK * 0.62);
    }
    return c;
  }
`;

/**
 * 给单位本体材质打特效补丁（幂等：已打过直接取原记录）。
 * 记录只装 uniforms（不反引 material——charBurn 的 clone 深拷贝教训）。
 * @returns {{ uBurn: {value:number}, uPoison: {value:number}, uTime: {value:number} }}
 */
export function attachUnitBodyFx(material) {
  if (material.userData[PATCH_KEY]) return material.userData[PATCH_KEY];
  const rec = {
    uBurn: { value: 0 },
    uPoison: { value: 0 },
    uTime: { value: 0 },
  };
  material.userData[PATCH_KEY] = rec;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBurn = rec.uBurn;
    shader.uniforms.uPoison = rec.uPoison;
    shader.uniforms.uTime = rec.uTime;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uBurn;
uniform float uPoison;
uniform float uTime;
${GLSL_BODY_FX}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
#ifdef USE_MAP
diffuseColor.rgb = unitBodyFxShade(diffuseColor.rgb, vMapUv, uBurn, uPoison, uTime);
#endif`);
  };
  // 补丁材质走独立 program（全体单位本体共享一个变体，预热一次全就位）
  material.customProgramCacheKey = () => 'unit-body-fx';
  material.needsUpdate = true;
  return rec;
}

/** 取已打的补丁记录（未打 → null）。 */
export function unitBodyFxOf(material) { return material.userData[PATCH_KEY] ?? null; }
