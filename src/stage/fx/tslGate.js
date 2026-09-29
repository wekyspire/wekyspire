// TSL/WebGPU 迁移闸门（2026-09-27 用户拍板全量迁移，方案 quest_prompts/WEBGPU_MIGRATION.md）。
// 事实依据（spike 实测）：裸 GLSL ShaderMaterial 在 WebGPURenderer 下 = NodeBuilder 报
// "not compatible" + 对象渲成黑洞；onBeforeCompile 静默失效（不炸）。所以迁移期间每件
// 裸 GLSL 资产一个开关：false = 不创建（用户接受「缺特效」中间态），TSL 重写落地翻 true。
// 全部翻 true 且验收通过后，本文件与各处分支整体删除（WebGL 兼容逻辑同撤——用户定：
// 生产版不留 WebGL，forceWebGL 仅供迁移期验收对照）。
//
// 使用约定：创建点前 `if (!TSL_READY.xxx) return null / 不建件`；涉及语义跳过的（如
// cardTransform 演出）要保证跳过路径逻辑等价（直接落地终态），不只是不画。

/** 逐件迁移开关（false=未迁移，true=TSL 版已落地）。 */
export const TSL_READY = {
  uiPost: true,         // post/ 三件套（passes/bloomChain/uiComposer）+ fx/bloomOffset
  volumetricMoon: true, // 体积月光 composer（raymarch + temporal EMA + 共享深度 RT）
  towerClouds: true,    // 塔楼雪云 march（TSL 重写 + passUV 口径已过，2026-09-27）
  skydome: true,        // 天空穹 shader（dungeon3D/composeRoom 共用）
  moonDust: true,       // 月光尘埃粒子 shader
  veil: true,           // 卡牌冷却/衰败膜（CardFxLayer）
  edgeGlow: true,       // 咏唱边缘流光（CardFxLayer）
  cardTransform: true,  // 卡牌变换叠层演出（fx/cardTransform.js）
  bodyFlames: true,     // 单位环身火幕（aura L1）
  stasisShell: true,    // 凝滞结晶壳（aura L2）
  // （gpuParticles 键已随旧池删除——2026-09-28 粒子池 v2（particlePool.js）接管，
  //   v2 无 WebGL 对照路径，不需要闸门）
};

// onBeforeCompile 补丁件（unitBodyFx/cardBodyFx/charBurn/ParticleSystem）不在此表——
// 它们静默失效不碍事，重写后直接删旧补丁，无需开关。

/** 验收对照口：`?forceWebGL=1` 强制 WebGL2 后端跑同一套 TSL（reference 对照用）。 */
export function forceWebGLBackend() {
  if (typeof location === 'undefined') return false;
  return new URLSearchParams(location.search).get('forceWebGL') === '1';
}

// 调试口：页面内直拨开关表（harness/控制台二分用；vite 模块实例博弈的绕路）。
// W6 随本文件整体删除。
if (typeof window !== 'undefined') window.__TSL_READY = TSL_READY;

/**
 * WebGPU 支持预检（加载门用）：拿不到 adapter 即不支持。
 * 用户定（2026-09-27）：不支持 WebGPU 的设备直接卡死在加载界面，不做任何回退。
 * @returns {Promise<GPUAdapter|null>}
 */
export async function probeWebGpuAdapter() {
  try {
    if (typeof navigator === 'undefined' || !navigator.gpu) return null;
    return await navigator.gpu.requestAdapter();
  } catch {
    return null;
  }
}
