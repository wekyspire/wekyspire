// 单位本体特效补丁（L0 本体层，VFX 结构大更新 Phase 1，2026-09-26）：
// charBurn 同款手法挂进单位 _body 的 MeshBasicMaterial——但与房间道具不同，
// 单位材质是**每单位独立实例**（UnitObject 构造即 new），无族单例跨场复位负担，
// 补丁随材质 dispose 自然消亡（只留 dispose 钩子里的防御性归零）。
// 单 program 多 uniform（固定层级 L0 的纪律：效果在同一片元程序内按固定顺序合成，
// 上层效果天然读到下层的输出——L2 笼罩层「需要下层 framebuffer」的需求多半在此
// 零成本满足，真邻域采样才走懒建 RT）：
//   uBurn   0..1  燃烧=**烧灼进度**（层数→进度的境界映射见 recipes levelOf）：
//                 纸张式烧灼——碳化斑块随层数扩张、碳化缘挂火线、火星点明灭（抖动破格阵）；
//                 30 层境界烧透橙红，60 层境界白炙（HDR 过 1.45 阈，亮度交给世界 bloom 链）；
//                 高热段经 retain mask（**动态双场噪声**——保留岛随时间游走生灭，
//                 静态大岛会糊成大片死白）保留原纹理特征区——乘算合成不盖死
//                 （2026-09-26 用户定机制，2026-09-27 用户定动态化）
//   uCalm   0/1   火焰亲和（flameAffinity 在场）：碳化收敛、火势放缓更稳（可控的火）
//   uPoison 0..1  中毒：泛青绿渗色 + 慢速胀动 + 高频噪斑；赋予/消除走浸润前锋
//                 （自脚底向上漫/退潮，前锋挂渗色亮带）
//   uTime         秒计时（UnitFxLayer 常驻推进——多 uniform 共用一钟，
//                 不许单个 aura 占钟：毒无火时 uTime 也得走）
// 纪律：
//   · 只动 diffuseColor.rgb，不碰 alpha——alphaTest 剪影与深度写入零影响；
//   · 噪声一律平滑 value noise/fbm——裸 cell hash 铺色是「暗淡的方形马赛克」病灶
//     （2026-09-26 用户验收原话）；火星点用 cell 内圆点 + 时间明灭，不铺方块；
//   · HDR 只在 60 层白炙段乘算过阈；低层烧灼压阈下，防糊白（bloom 阈值事故教训）；
//   · 合成顺序固定（burn → poison），后写者读到前者的输出（L0 内的层内优先级）；
//   · 着色链实现抽成 GLSL_BODY_FX 共享件：本体补丁与 L2 同源重算件（stasisShell）
//     include 同一份函数 + 共享同一份 uniform 记录——一份实现，两处同帧；
//   · 全部效果包在 #ifdef USE_MAP 内：无立绘的占位色块单位不编效果
//     （map 挂上时 three 自动重编，变体各自成立）。
import * as THREE from 'three';
import { bloomPassFlag, glslBloomOffsetWrite } from './bloomOffset.js';

const PATCH_KEY = '_unitBodyFx';

// L0 着色链（共享 GLSL 件）：fxUv 空间（0..1，y=0 脚底）内按固定顺序合成全部本体效果。
// 返回 vec4：rgb = 着色结果，**a = bloom 强度偏移量**（bloom offset 通道，见
// fx/bloomOffset.js——白炙段颜色保持干净白，起晕强度由偏移量主动声明）。
// 本体补丁注入时在 color_fragment 后调它；L2 同源重算件（stasisShell 的壳内影）也调它——
// 「下层长什么样」对上层永远 = 同函数 + 同 uniform 记录，零 RT。
export const GLSL_BODY_FX = /* glsl */`
  float unitBodyFxHash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  // 平滑 value noise（碳化场基元）+ 二频 fbm——裸 cell hash 铺色 = 方形马赛克
  float unitBodyFxNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(unitBodyFxHash(i), unitBodyFxHash(i + vec2(1.0, 0.0)), u.x),
               mix(unitBodyFxHash(i + vec2(0.0, 1.0)), unitBodyFxHash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float unitBodyFxFbm(vec2 p) {
    return unitBodyFxNoise(p) * 0.6 + unitBodyFxNoise(p * 2.13 + vec2(5.3, 8.1)) * 0.4;
  }
  // 燃烧场四元（**单一事实源**：本体着色与 GPU 粒子发射图集（gpu/burnEmission.js）
  // 共用——碳化场的形状/阈值只在这里有一份，改烧灼形态两处天然同步）
  void unitBodyFxBurnFields(vec2 fxUv, float uBurn, float uTime, float uCalm,
      out float charField, out float charTh, out float nBig, out float nDet, out float tSlow) {
    tSlow = uTime * (1.0 - uCalm * 0.35);            // 亲和：火势放缓
    nBig = unitBodyFxFbm(fxUv * vec2(2.6, 3.4));     // 大尺度碳化场（斑块）
    nDet = unitBodyFxFbm(fxUv * vec2(10.0, 13.0) + vec2(0.0, -tSlow * 0.2));
    charField = nBig * 0.78 + nDet * 0.22 + (1.0 - fxUv.y) * 0.10; // 火起于下
    charTh = mix(1.02, 0.22, uBurn) + uCalm * 0.18;  // 碳化面随进度扩张；亲和收敛
  }
  // GPU 粒子发射强度（burnEmission 图集的 w 通道）：「燃烧边缘有活动火焰的地方」=
  // 宽火线带（发射密度考虑，比本体火线宽）× 明灭；白炙段火线熄灭后改用高热碳化区
  // 余热发射（烧透的边缘仍在飞火星）。返回 0..1，spawn pass 据此随机门控
  float unitBodyFxBurnEmission(vec2 fxUv, float uBurn, float uTime, float uCalm) {
    float charField, charTh, nBig, nDet, tSlow;
    unitBodyFxBurnFields(fxUv, uBurn, uTime, uCalm, charField, charTh, nBig, nDet, tSlow);
    float scorch = smoothstep(charTh - 0.22, charTh + 0.02, charField);
    float edgeWide = (1.0 - smoothstep(0.0, 0.14, abs(charField - charTh)))
                   * (1.0 - smoothstep(0.85, 1.0, uBurn));
    float flick = 0.6 + 0.4 * sin(tSlow * 9.0 + nDet * 30.0);
    float heat = smoothstep(0.80, 1.0, uBurn);
    return clamp(edgeWide * flick + heat * scorch * 0.5 * (0.55 + 0.45 * nDet), 0.0, 1.0);
  }
  vec4 unitBodyFxShade(vec3 base, vec2 fxUv, float uBurn, float uPoison, float uTime, float uCalm) {
    vec3 c = base;
    float bloomOff = 0.0; // bloom 偏移量（本像素主动声明的起晕强度）
    // ---- 燃烧（uBurn = 烧灼进度）：纸张式烧灼 ----
    // 碳化斑块随层数扩张：外圈焦褐晕（宽软边）→ 内芯炭黑（窄）→ 轮廓挂火线；
    // 火星点只在火线附近稀疏明灭；30 层烧透橙红、60 层白炙 HDR（锚点见 recipes levelOf）。
    // ⚠ smoothstep 一律正向写法（edge0 < edge1）：反边形式「x 低时为 1」曾把碳化盖到
    //    噪声低区，层数越高覆盖越小（2026-09-26 用户验收「焦黑区域 invert 了」）。
    if (uBurn > 0.001) {
      // 燃烧场（与发射图集同一函数，见上）
      float charField, charTh, nBig, nDet, tSlow;
      unitBodyFxBurnFields(fxUv, uBurn, uTime, uCalm, charField, charTh, nBig, nDet, tSlow);
      // 两层碳化（都取 field 高区）：外圈焦褐晕（宽）+ 内芯炭黑（窄）
      float scorch = smoothstep(charTh - 0.22, charTh + 0.02, charField);
      float deepChar = smoothstep(charTh + 0.02, charTh + 0.16, charField);
      // 火线挂碳化轮廓：细、亮、明灭；白炙后熄（烧透了就没有「缘」）
      float charEdge = (1.0 - smoothstep(0.0, 0.05, abs(charField - charTh)))
                     * (1.0 - smoothstep(0.85, 1.0, uBurn));
      // 碳化区三段升温：焦褐/炭黑 →（30 层境界烧透）橙红 →（60 层境界白炙）HDR 白
      vec3 scorchCol = base * vec3(0.42, 0.30, 0.20) + vec3(0.05, 0.03, 0.015) * nDet;
      vec3 charCol = base * 0.08 + vec3(0.016, 0.013, 0.010) * (0.4 + 0.6 * nDet);
      vec3 zone = mix(scorchCol, charCol, deepChar);
      float burnThrough = smoothstep(0.42, 0.72, uBurn);
      vec3 emberCol = vec3(1.45, 0.42, 0.08) * (0.75 + 0.35 * nDet + 0.20 * sin(tSlow * 5.0 + nBig * 20.0));
      zone = mix(zone, emberCol, burnThrough * scorch);
      float heat = smoothstep(0.80, 1.0, uBurn);
      // 白炙色保持「干净白」不拉爆（阈值上下的斑块 bloom 是脏光源，用户 2026-09-26）——
      // 起晕交给 bloom offset 通道：返回值 .a 声明起晕强度（斑驳跟随 nDet）
      zone = mix(zone, vec3(1.55, 1.38, 1.12) * (0.72 + 0.28 * nDet), heat * scorch);
      bloomOff = heat * scorch * (0.55 + 0.45 * nDet) * 1.4;
      // 常规合成：替换（炭化段本来就该盖住原纹理）
      vec3 burned = mix(c, zone, scorch);
      // retain mask（2026-09-27 用户定动态化「根治」）：双场反向漂移 + 振荡混合 =
      // 保留岛随时间游走生灭，同一位置不会持续保留——读作火舌舐过纹理；
      // 静态岛钉死不动会糊出大片「洗掉」区（burn75 奶油史莱姆事故—— pale base ×
      // 白炙 zone ≈ 1.6 HDR 死白），继续降频率只是换一批大岛，动态才是真解。
      // 烧透/白炙段在保留岛改用**乘算**合成——原纹理明暗 × 火色（纹理特征存续、
      // 色调被火染色、亮度照走 HDR）；掺一成 zone 防原图暗部死黑，再叠 nDet 斑驳。
      float rA = unitBodyFxFbm(fxUv * vec2(4.5, 5.5) + vec2(4.7, 9.1) + vec2(tSlow * 0.11, -tSlow * 0.07));
      float rB = unitBodyFxFbm(fxUv * vec2(5.2, 4.3) + vec2(1.3, 6.8) + vec2(-tSlow * 0.09, tSlow * 0.12));
      float retainM = smoothstep(0.42, 0.68, mix(rA, rB, 0.5 + 0.5 * sin(tSlow * 0.8)));
      retainM *= 0.8 + 0.2 * sin(tSlow * 1.7 + rA * 21.0); // 岛体呼吸（生灭不僵硬）
      float hotStage = max(burnThrough, heat);
      vec3 retained = mix(base * zone * 1.15, zone, 0.12) * (0.75 + 0.5 * nDet);
      c = mix(burned, retained, retainM * hotStage * scorch);
      // 火线（明暗闪烁；亲和减半更稳）
      float edgeK = 1.0 - uCalm * 0.45;
      float flick = 0.6 + 0.4 * sin(tSlow * 9.0 + nDet * 30.0) * edgeK;
      c += vec3(2.3, 0.85, 0.15) * charEdge * flick * edgeK;
      // 火星点：稀疏圆点在火线附近明灭——cell 内**随机抖动**破格点阵
      // （钉在 cell 中心会读出网格 pattern，2026-09-26 用户验收）
      vec2 sp = fxUv * vec2(20.0, 26.0);
      vec2 spId = floor(sp);
      vec2 jit = vec2(unitBodyFxHash(spId + 7.31), unitBodyFxHash(spId + 13.73)) - 0.5;
      vec2 spUv = fract(sp) - 0.5 - jit * 0.62;
      float spRnd = unitBodyFxHash(spId);
      float tw = 0.5 + 0.5 * sin(uTime * (5.0 + spRnd * 9.0) + spRnd * 40.0);
      float dot2 = smoothstep(0.34, 0.10, length(spUv)) * step(0.86, spRnd);
      c += vec3(2.4, 1.0, 0.25) * dot2 * tw * clamp(charEdge * 1.6 + deepChar * 0.15, 0.0, 1.0) * edgeK;
    }
    // ---- 中毒（uPoison）：毒是浸润不是烧——整体渗青绿，慢速胀动 + 高频噪斑 ----
    // 浸润前锋（赋予/消除过渡演出，2026-09-26 用户定）：毒自脚底向上漫——level 斜坡期
    // 前锋爬升（×4 倍速，1 层稳态 uPoison=0.35 即爬满全覆盖），退出向下退潮；
    // 前锋处挂一条渗色亮带（压阈下：毒不发光）。
    if (uPoison > 0.001) {
      float pN = unitBodyFxHash(floor(fxUv * vec2(13.0, 17.0)) + vec2(floor(uTime * 1.5), 0.0));
      float pPulse = 0.75 + 0.25 * sin(uTime * 3.1);
      float soakFront = min(uPoison * 4.0, 1.15);
      float soak = 1.0 - smoothstep(soakFront - 0.12, soakFront + 0.10, fxUv.y);
      float soakEdge = (1.0 - smoothstep(0.0, 0.10, abs(fxUv.y - soakFront)))
                     * (1.0 - step(1.1, soakFront)); // 漫满（稳态）后亮带收掉
      float pK = clamp(uPoison * (0.55 + 0.45 * pN) * pPulse, 0.0, 1.0) * soak;
      vec3 pTint = vec3(0.30, 0.85, 0.26) * (0.5 + 0.5 * pN);
      c = mix(c, c * 0.5 + pTint, pK * 0.62);
      c += pTint * soakEdge * 0.5;
    }
    return vec4(c, bloomOff);
  }
`;

/**
 * 给单位本体材质打特效补丁（幂等：已打过直接取原记录）。
 * 记录只装 uniforms（不反引 material——charBurn 的 clone 深拷贝教训）。
 * @returns {{ uBurn: {value:number}, uPoison: {value:number}, uCalm: {value:number}, uTime: {value:number} }}
 */
export function attachUnitBodyFx(material) {
  if (material.userData[PATCH_KEY]) return material.userData[PATCH_KEY];
  const rec = {
    uBurn: { value: 0 },
    uPoison: { value: 0 },
    uCalm: { value: 0 },
    uTime: { value: 0 },
  };
  material.userData[PATCH_KEY] = rec;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBurn = rec.uBurn;
    shader.uniforms.uPoison = rec.uPoison;
    shader.uniforms.uCalm = rec.uCalm;
    shader.uniforms.uTime = rec.uTime;
    shader.uniforms.uBloomPass = bloomPassFlag; // 共享实例：composer 翻一次全体生效
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uBurn;
uniform float uPoison;
uniform float uCalm;
uniform float uTime;
uniform float uBloomPass;
float gBodyBloom = 0.0; // 本像素 bloom 偏移量（color_fragment 写入，尾段偏移 pass 读出）
${GLSL_BODY_FX}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
#ifdef USE_MAP
vec4 bodyFx = unitBodyFxShade(diffuseColor.rgb, vMapUv, uBurn, uPoison, uTime, uCalm);
diffuseColor.rgb = bodyFx.rgb;
gBodyBloom = bodyFx.a;
#endif`)
      // 偏移 pass（uBloomPass=1）：最终输出覆写为偏移量（R 通道）；主渲染零影响。
      // 挂在 dithering_fragment 之后 = 全链最后一笔，tonemap/colorspace 都碰不到它
      .replace('#include <dithering_fragment>', `#include <dithering_fragment>
${glslBloomOffsetWrite('gBodyBloom')}`);
  };
  // 补丁材质走独立 program（全体单位本体共享一个变体，预热一次全就位）
  material.customProgramCacheKey = () => 'unit-body-fx';
  material.needsUpdate = true;
  return rec;
}

/** 取已打的补丁记录（未打 → null）。 */
export function unitBodyFxOf(material) { return material.userData[PATCH_KEY] ?? null; }
