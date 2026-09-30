// 单位本体特效（L0 本体层）——WebGPU 迁移 TSL 版（原 onBeforeCompile 字符串补丁重写）：
// 挂进单位 _body 的 MeshBasicNodeMaterial。范式（W3 立）：
//   · uniforms = TSL uniform() 节点——对外仍是 `rec.uBurn.value = x` 的推值口径，
//     全体调用点（unitFxLayer/剧本）零改动；
//   · 着色链 = TSL Fn 组合（替代字符串 include）；材质创建点改用 Node 材质类
//     （WebGPURenderer 反正把经典材质内部转节点，显式用节点类零额外代价）；
//   · colorNode 全量接管 diffuse：base = materialColor（⚠ TSL 的 materialColor
//     已含 map——MaterialNode.COLOR = color × map，再乘一次 texture(map) = tex²
//     平方压暗，实测单位立绘中调崩掉的根因；顶点色由 NodeMaterial
//     在 colorNode 之后自动乘入，与旧 color_fragment 注入位序一致）；
//   · map 后到的材质（立绘异步挂载）：attach 时不建链，setArt 落地后 rec.rebind()
//     重建 colorNode 并 needsUpdate——与旧 USE_MAP 变体重编的时机/成本一一对应；
//   · bloom offset 通道：shade 返回 vec4(rgb, bloomOff)，attach 处在 colorNode 尾部
//     select(bloomPassFlag) 覆写输出（W2 后处理链重搭后生效，当前偏移 pass 未建 = 死分支）。
//   · **If/Discard/Loop 等控制流必须待在 Fn 栈内**（顶层调 If = 「null.If」崩）——
//     携带控制流的合成一律写成 Fn 再调用（本文件 ubfShade / cardBodyFx rebind 为范式）。
// 效果语义与 GLSL 版逐式一致（视觉零回归）：
//   uBurn   0..1  燃烧=烧灼进度：碳化斑块扩张 + 火线 + 火星点 + 30 层烧透橙红 / 60 层
//                 白炙 HDR；高热段 retain 动态双场噪声保留岛（乘算合成不盖死）
//   uCalm   0/1   火焰亲和：碳化收敛、火势放缓
//   uPoison 0..1  中毒：泛青绿渗色 + 慢速胀动 + 高频噪斑；浸润前锋自脚底向上漫/退潮
//   uTime         秒计时（UnitFxLayer 常驻推进——多 uniform 共用一钟）
// 纪律：
//   · 只动 diffuseColor.rgb，不碰 alpha——alphaTest 剪影与深度写入零影响；
//   · WGSL smoothstep 反向边（edge0>edge1）是 indeterminate（GLSL 靠驱动行为）——
//     一律改写正向 + oneMinus（火星点 smoothstep(0.34,0.10,…) 是唯一一处旧反向写法）；
//   · 着色链 TSL 件导出共享：W4 的 stasisShell（同源重算）与 W5 的 burnEmission
//     （compute 化）import 同一份 Fn——单一事实源的地位与 GLSL_BODY_FX 时代相同。
import {
  Fn, If, uniform, uv, materialColor, select,
  vec2, vec3, vec4, float, mix, clamp, abs, max, min, floor, fract,
  sin, dot, length, step, smoothstep, oneMinus,
} from 'three/tsl';
import { bloomPassFlag } from './bloomOffset.js';

const PATCH_KEY = '_unitBodyFx';

// ---- 共享 TSL 件（本体着色 / W4 stasisShell 同源重算 / W5 burnEmission compute 共用）----

export const ubfHash = Fn(([p]) =>
  fract(sin(dot(p, vec2(127.1, 311.7))).mul(43758.5453)));

// 平滑 value noise（碳化场基元）——裸 cell hash 铺色 = 方形马赛克（09-26 验收原话）
export const ubfNoise = Fn(([p]) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2.0).add(3.0));
  return mix(
    mix(ubfHash(i), ubfHash(i.add(vec2(1.0, 0.0))), u.x),
    mix(ubfHash(i.add(vec2(0.0, 1.0))), ubfHash(i.add(vec2(1.0, 1.0))), u.x),
    u.y);
});

export const ubfFbm = Fn(([p]) =>
  ubfNoise(p).mul(0.6).add(ubfNoise(p.mul(2.13).add(vec2(5.3, 8.1))).mul(0.4)));

// 亲和放缓后的火势钟（多处复用，单行事实源）
export const ubfTSlow = Fn(([uTime, uCalm]) => uTime.mul(uCalm.mul(-0.35).add(1.0)));

// 燃烧场四元：返回 vec4(charField, charTh, nBig, nDet)（tSlow 由调用点经 ubfTSlow 重算——
// GLSL out 参数在 TSL 无对应物，拆成「向量返回 + 单行重算」）
export const ubfBurnFields = Fn(([fxUv, uBurn, uTime, uCalm]) => {
  const tSlow = ubfTSlow(uTime, uCalm);
  const nBig = ubfFbm(fxUv.mul(vec2(2.6, 3.4)));           // 大尺度碳化场（斑块）
  const nDet = ubfFbm(fxUv.mul(vec2(10.0, 13.0)).add(vec2(0.0, tSlow.mul(-0.2))));
  const charField = nBig.mul(0.78).add(nDet.mul(0.22)).add(oneMinus(fxUv.y).mul(0.10)); // 火起于下
  const charTh = mix(1.02, 0.22, uBurn).add(uCalm.mul(0.18)); // 碳化面随进度扩张；亲和收敛
  return vec4(charField, charTh, nBig, nDet);
});

// 燃烧发射强度（W5 burnEmission compute 的发射密度源）：「燃烧边缘有活动火焰的地方」=
// 宽火线带 × 明灭；白炙段火线熄灭后改用高热碳化区余热发射
export const ubfBurnEmission = Fn(([fxUv, uBurn, uTime, uCalm]) => {
  const f = ubfBurnFields(fxUv, uBurn, uTime, uCalm);
  const charField = f.x, charTh = f.y, nDet = f.w;
  const tSlow = ubfTSlow(uTime, uCalm);
  const scorch = smoothstep(charTh.sub(0.22), charTh.add(0.02), charField);
  const edgeWide = oneMinus(smoothstep(0.0, 0.14, abs(charField.sub(charTh))))
    .mul(oneMinus(smoothstep(0.85, 1.0, uBurn)));
  const flick = sin(tSlow.mul(9.0).add(nDet.mul(30.0))).mul(0.4).add(0.6);
  const heat = smoothstep(0.80, 1.0, uBurn);
  return clamp(
    edgeWide.mul(flick).add(heat.mul(scorch).mul(0.5).mul(nDet.mul(0.45).add(0.55))),
    0.0, 1.0);
});

// 本体着色主链：fxUv 空间（0..1，y=0 脚底）内按固定顺序合成（burn → poison）。
// 返回 vec4：rgb = 着色结果，a = bloom 强度偏移量（白炙段颜色保持干净白，
// 起晕强度由偏移量主动声明——见 fx/bloomOffset.js）。
export const ubfShade = Fn(([base, fxUv, uBurn, uPoison, uTime, uCalm]) => {
  const c = base.toVar();
  const bloomOff = float(0).toVar();

  // ---- 燃烧（纸张式烧灼）：碳化两层（外圈焦褐晕宽软 + 内芯炭黑窄）→ 轮廓火线 →
  // 三段升温（焦黑 → 30 层橙红 → 60 层白炙 HDR）→ retain 动态保留岛 → 火线闪烁 + 火星点 ----
  If(uBurn.greaterThan(0.001), () => {
    const f = ubfBurnFields(fxUv, uBurn, uTime, uCalm);
    const charField = f.x, charTh = f.y, nBig = f.z, nDet = f.w;
    const tSlow = ubfTSlow(uTime, uCalm);
    const scorch = smoothstep(charTh.sub(0.22), charTh.add(0.02), charField);
    const deepChar = smoothstep(charTh.add(0.02), charTh.add(0.16), charField);
    // 火线挂碳化轮廓：细、亮、明灭；白炙后熄（烧透了就没有「缘」）
    const charEdge = oneMinus(smoothstep(0.0, 0.05, abs(charField.sub(charTh))))
      .mul(oneMinus(smoothstep(0.85, 1.0, uBurn)));
    const scorchCol = base.mul(vec3(0.42, 0.30, 0.20)).add(vec3(0.05, 0.03, 0.015).mul(nDet));
    const charCol = base.mul(0.08).add(vec3(0.016, 0.013, 0.010).mul(nDet.mul(0.6).add(0.4)));
    const zone = mix(scorchCol, charCol, deepChar).toVar();
    const burnThrough = smoothstep(0.42, 0.72, uBurn);
    const emberCol = vec3(1.45, 0.42, 0.08)
      .mul(nDet.mul(0.35).add(0.75).add(sin(tSlow.mul(5.0).add(nBig.mul(20.0))).mul(0.20)));
    zone.assign(mix(zone, emberCol, burnThrough.mul(scorch)));
    const heat = smoothstep(0.80, 1.0, uBurn);
    // 白炙色保持「干净白」不拉爆——起晕交给 bloom offset 通道（斑驳跟随 nDet）
    zone.assign(mix(zone, vec3(1.55, 1.38, 1.12).mul(nDet.mul(0.28).add(0.72)), heat.mul(scorch)));
    bloomOff.assign(heat.mul(scorch).mul(nDet.mul(0.45).add(0.55)).mul(1.4));
    // 常规合成：替换（炭化段本来就该盖住原纹理）
    const burned = mix(c, zone, scorch);
    // retain mask（动态双场噪声）：保留岛随时间游走生灭，读作火舌舐过纹理；
    // 烧透/白炙段在保留岛改用乘算合成（纹理明暗 × 火色），掺一成 zone 防暗部死黑
    const rA = ubfFbm(fxUv.mul(vec2(4.5, 5.5)).add(vec2(4.7, 9.1)).add(vec2(tSlow.mul(0.11), tSlow.mul(-0.07))));
    const rB = ubfFbm(fxUv.mul(vec2(5.2, 4.3)).add(vec2(1.3, 6.8)).add(vec2(tSlow.mul(-0.09), tSlow.mul(0.12))));
    const retainM = smoothstep(0.42, 0.68, mix(rA, rB, sin(tSlow.mul(0.8)).mul(0.5).add(0.5)))
      .mul(sin(tSlow.mul(1.7).add(rA.mul(21.0))).mul(0.2).add(0.8)); // 岛体呼吸
    const hotStage = max(burnThrough, heat);
    const retained = mix(base.mul(zone).mul(1.15), zone, 0.12).mul(nDet.mul(0.5).add(0.75));
    c.assign(mix(burned, retained, retainM.mul(hotStage).mul(scorch)));
    // 火线（明暗闪烁；亲和减半更稳）
    const edgeK = uCalm.mul(-0.45).add(1.0);
    const flick = sin(tSlow.mul(9.0).add(nDet.mul(30.0))).mul(edgeK).mul(0.4).add(0.6);
    c.addAssign(vec3(2.3, 0.85, 0.15).mul(charEdge).mul(flick).mul(edgeK));
    // 火星点：稀疏圆点在火线附近明灭——cell 内随机抖动破格点阵
    const sp = fxUv.mul(vec2(20.0, 26.0));
    const spId = floor(sp);
    const jit = vec2(ubfHash(spId.add(7.31)), ubfHash(spId.add(13.73))).sub(0.5);
    const spUv = fract(sp).sub(0.5).sub(jit.mul(0.62));
    const spRnd = ubfHash(spId);
    const tw = sin(uTime.mul(spRnd.mul(9.0).add(5.0)).add(spRnd.mul(40.0))).mul(0.5).add(0.5);
    // WGSL 正向边改写：GLSL smoothstep(0.34, 0.10, x) ≡ 1 - smoothstep(0.10, 0.34, x)
    const dot2 = oneMinus(smoothstep(0.10, 0.34, length(spUv))).mul(step(0.86, spRnd));
    c.addAssign(vec3(2.4, 1.0, 0.25).mul(dot2).mul(tw)
      .mul(clamp(charEdge.mul(1.6).add(deepChar.mul(0.15)), 0.0, 1.0)).mul(edgeK));
  });

  // ---- 中毒：毒是浸润不是烧——整体渗青绿，慢速胀动 + 高频噪斑；前锋自脚底向上漫/退潮 ----
  If(uPoison.greaterThan(0.001), () => {
    // 噪斑走平滑 fbm（裸 cell hash 铺色 = 方形马赛克，burn 段 09-26 已栽过）；
    // 时间项连续推移（不 floor）——毒斑缓慢流动，不跳变
    const pN = ubfFbm(fxUv.mul(vec2(4.2, 5.6)).add(vec2(uTime.mul(0.21), uTime.mul(-0.13))));
    const pPulse = sin(uTime.mul(3.1)).mul(0.25).add(0.75);
    const soakFront = min(uPoison.mul(4.0), 1.15);
    const soak = oneMinus(smoothstep(soakFront.sub(0.12), soakFront.add(0.10), fxUv.y));
    const soakEdge = oneMinus(smoothstep(0.0, 0.10, abs(fxUv.y.sub(soakFront))))
      .mul(oneMinus(step(1.1, soakFront))); // 漫满（稳态）后亮带收掉
    const pK = clamp(uPoison.mul(pN.mul(0.45).add(0.55)).mul(pPulse), 0.0, 1.0).mul(soak);
    const pTint = vec3(0.30, 0.85, 0.26).mul(pN.mul(0.5).add(0.5));
    c.assign(mix(c, c.mul(0.5).add(pTint), pK.mul(0.62)));
    c.addAssign(pTint.mul(soakEdge).mul(0.5));
  });

  return vec4(c, bloomOff);
});

/**
 * 给单位本体材质挂特效（幂等：已挂过直接取原记录）。
 * 记录字段 = TSL uniform 节点（对外 `.value` 推值口径不变）；不反引 material
 * （charBurn 的 clone 深拷贝教训）。
 * @returns {{ uBurn, uPoison, uCalm, uTime, rebind: () => void }}
 */
export function attachUnitBodyFx(material) {
  if (material.userData[PATCH_KEY]) return material.userData[PATCH_KEY];
  const rec = {
    uBurn: uniform(0),
    uPoison: uniform(0),
    uCalm: uniform(0),
    uTime: uniform(0),
    // map 落地（立绘异步到图）后由 setArt 调：重建 colorNode 链（无图占位色块不编效果，
    // 与旧 #ifdef USE_MAP 守卫生效范围一致）。重复调用幂等（同构图命中 program 缓存）。
    rebind: () => {
      if (!material.map) { material.colorNode = null; return; }
      // materialColor 已含 map（见文件头注⚠）——不许再乘 texture(material.map)
      const base = materialColor;
      const fx = ubfShade(base.rgb, uv(), rec.uBurn, rec.uPoison, rec.uTime, rec.uCalm);
      material.colorNode = select(
        bloomPassFlag.greaterThan(0.5),
        vec4(fx.a, 0.0, 0.0, 1.0),       // 偏移 pass：偏移量进 R 通道（W2 链接管后生效）
        vec4(fx.rgb, base.a));
      material.needsUpdate = true;
    },
  };
  material.userData[PATCH_KEY] = rec;
  if (material.map) rec.rebind();
  return rec;
}

/** 取已挂的记录（未挂 → null）。 */
export function unitBodyFxOf(material) { return material.userData[PATCH_KEY] ?? null; }
