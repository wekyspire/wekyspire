// bloom intensity offset 通道（2026-09-26 用户定的 bloom pass 增强，「根治」方案）：
// 问题：HDR 阈值创作约定下，想让某区域起晕只能把颜色乘算推过阈——峰值贴阈会让
// bloom 断断续续、糊成白色斑块（白炙阶段实测教训）；「拉爆 HDR」又会烧掉颜色本身。
// 根治 = 场景渲染之外另渲一张「bloom 强度偏移」RT（R 通道），bright 段在阈值判定前
// 把它加和到亮度上——绘制结果因此能**主动声明「我这里要多强的晕」**，
// 颜色本体保持干净（白炙 = 干净白 + offset 起晕，不再靠拉爆）。
// 注意：offset 只放大「已有颜色」的起晕权重（bright 段输出 = 颜色 × 权重）——
// 黑像素加 offset 也晕不出光，想要光就得给点底色。
//
// FX 侧写法：
//   · ShaderMaterial 件：uniforms 挂 `uBloomPass: bloomPassFlag`（共享实例），
//     片元头 include GLSL_BLOOM_OFFSET_DECL，main() 尾插 BLOOM_OFFSET_WRITE(expr)；
//   · 内建材质补丁（unitBodyFx）：shade 返回 vec4（rgb=色，a=偏移），补丁尾段覆写；
//   · 想进偏移 pass 的对象：setBloomWriter(obj3D)（挂 BLOOM_LAYER）。
//   · 偏移 pass 里材质按各自语义重写输出（offset 值进 R 通道），主渲染零影响。
//
// 渲染侧（两条 composer 同手法）：主渲之后、bloom 之前，把相机层掩码临时切到
// BLOOM_LAYER + bloomPassFlag 置 1，清黑重渲一遍场景 → offsetRT 喂 bloom 链。
// ⚠ WebGPU 迁移口径修正（2026-09-27 probe-w2 确诊）：旧版世界链「offsetRT 共享场景
// 深度纹理」在本后端不成立——渲染通道描述符按 RT 缓存、失效判据不含深度纹理身份，
// 第二个 RT 首用触发共享深度 needsUpdate → 纹理销毁重建 → 第一个 RT 的缓存描述符
// 永久引用已销毁纹理。故世界链改「独立深度 + depth-only 预填」（depthPrepass 模式）。
import * as THREE from 'three';
import { uniform } from 'three/tsl';

/** 偏移 pass 专用层（渲染器层 0..31；本仓库尚无 layers 使用，取 7）。 */
export const BLOOM_LAYER = 7;

/** 偏移 pass 开关：全体 FX 材质共享同一 uniform 实例，composer 渲偏移 pass 前后翻转。
 *  WebGPU 迁移后 = TSL UniformNode（.value 读写语义不变，FX 材质的 colorNode 直接引用）。 */
export const bloomPassFlag = uniform(0);

/** 片元声明件（ShaderMaterial 片元头 include）。⚠ WebGPU 迁移后仅存量 GLSL 件（tslGate
 *  隔离中）引用——TSL 件直接 `select(bloomPassFlag.greaterThan(0.5), …)`，W6 随闸门一并删除。 */
export const GLSL_BLOOM_OFFSET_DECL = /* glsl */`
uniform float uBloomPass;
`;

/** 片元尾写件：偏移 pass 中输出 (expr,0,0,1) 并提前 return（主渲染零影响）。⚠ 同上：仅存量 GLSL 用。 */
export function glslBloomOffsetWrite(expr) {
  return `if (uBloomPass > 0.5) { gl_FragColor = vec4((${expr}), 0.0, 0.0, 1.0); return; }`;
}

/** 把对象挂上/摘出偏移 pass 层（递归子级；FX 件的 group 根一次调用即可）。 */
export function setBloomWriter(obj, on = true) {
  obj.traverse((o) => { if (on) o.layers.enable(BLOOM_LAYER); else o.layers.disable(BLOOM_LAYER); });
}

/** depth-only 预填的覆写材质（全场共用一件）：不写色只写深度。 */
const DEPTH_ONLY_MATERIAL = new THREE.MeshBasicMaterial({ colorWrite: false });

/**
 * 偏移 pass 渲染（两 composer 共用）：相机层切 BLOOM_LAYER、flag 置 1、清黑渲一遍；
 * 清屏色/相机层掩码/scene.background 都保存恢复。
 * 调用方须先 setRenderTarget(offsetRT)。
 * @param {boolean} clearDepth 偏移 RT 独立深度时清深度（uiScene 链 true；世界链走预填）
 * @param {boolean} depthPrepass 世界链遮挡语义：先以 depth-only 覆写全场渲一遍
 *   预填偏移 RT 自有深度（被遮挡的发热体不把晕透到遮挡物上），再渲 FX 写入件。
 *   代价 = 每帧多一遍无色彩的几何提交；立牌透明区会按整quad遮挡（可接受）。
 */
export function renderBloomOffsetPass(renderer, scene, camera, { clearDepth = false, depthPrepass = false } = {}) {
  const prevMask = camera.layers.mask;
  const prevBg = scene.background;
  const prevColor = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  // 阴影图豁免：autoUpdate 开着的话每次 render() 都会重渲全场阴影——偏移 pass 只是
  // 重画几个 FX quad，阴影在本帧主渲已更新，这里整体跳过（翻倍渲染的冤枉钱不花）
  const prevShadowAuto = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
  scene.background = null;
  if (depthPrepass) {
    // 全场 depth-only 预填：override 材质不写色，只把几何深度灌进偏移 RT——
    // 随后的 FX 写入件据此做遮挡深度测试（替代旧「共享场景深度纹理」方案）。
    // 相机层掩码保持原样（全场参与遮挡，不只是 FX 件）；bloomPassFlag 仍 0。
    const prevOverride = scene.overrideMaterial;
    scene.overrideMaterial = DEPTH_ONLY_MATERIAL;
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    scene.overrideMaterial = prevOverride;
  }
  bloomPassFlag.value = 1;
  camera.layers.set(BLOOM_LAYER);
  // 灯光层豁免（2026-09-27 probe-w2 确诊的 4fps 病灶）：three 的灯光收集按相机层
  // 掩码过滤（projectObject 的 layers.test），偏移 pass 只开 BLOOM_LAYER 会把全部灯
  // 滤掉 → 本 pass 的 lightsNode 动态缓存键 ≠ 主渲 → 同一张材质跨 pass 反复
  // needsUpdate → renderObject/管线每帧销毁重建（WGSL 逐字节相同也救不回来，
  // stage 缓存随释放清空）。把灯临时挂上 BLOOM_LAYER 让两个 pass 看到同一灯组。
  const bloomMask = 1 << BLOOM_LAYER;
  const patchedLights = [];
  scene.traverse((o) => {
    if (o.isLight && (o.layers.mask & bloomMask) === 0) {
      o.layers.enable(BLOOM_LAYER);
      patchedLights.push(o);
    }
  });
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, clearDepth, false);
  renderer.render(scene, camera);
  for (const l of patchedLights) l.layers.disable(BLOOM_LAYER);
  bloomPassFlag.value = 0;
  camera.layers.mask = prevMask;
  scene.background = prevBg;
  renderer.setClearColor(prevColor, prevAlpha);
  renderer.shadowMap.autoUpdate = prevShadowAuto;
}
