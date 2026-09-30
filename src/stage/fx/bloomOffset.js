// bloom intensity offset 通道（的 bloom pass 增强，「根治」方案）：
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
// ⚠ WebGPU 迁移口径修正（probe-w2 确诊）：旧版世界链「offsetRT 共享场景
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

/** 把对象挂上/摘出偏移 pass 层（递归子级；FX 件的 group 根一次调用即可）。 */
export function setBloomWriter(obj, on = true) {
  obj.traverse((o) => { if (on) o.layers.enable(BLOOM_LAYER); else o.layers.disable(BLOOM_LAYER); });
}

/** depth-only 预填材质：按「是否镂空 + alphaMap」签名缓存，每件只建一次、建后永不改值。
 *  ⚠ 不用 scene.overrideMaterial 做预填（2026-09-30 探针实锤的每帧资源 churn 根源）：
 *  渲染器的 override 模拟会把每个对象的 alphaTest 逐个拷到共享 override 材质上，而
 *  r185 的 alphaTest 是 version++ 的 accessor——共享材质 version/cacheKey 随对象序列
 *  来回翻转（0↔0.5），RenderObjects 版本比对每渲染遍失配 → renderObject/绑定组/UBO
 *  每帧销毁重建（bindingBuffer 反复 destroy，纯每帧行为、无任何定时器参与）。
 *  逐对象替换材质则键全程稳定，首帧建缓存后零 churn；深度语义与旧 override 等价
 *  （colorWrite:false + 逐对象 alphaTest/alphaMap 镂空；transparent 双面双趟在纯深度
 *  预填里不改变最终深度，故不复制）。 */
const DEPTH_MATS = new Map();
function depthMatFor(src) {
  const cutout = (src.alphaTest ?? 0) > 0;
  const key = cutout ? `cut:${src.alphaMap?.uuid ?? '-'}` : 'solid';
  let m = DEPTH_MATS.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ colorWrite: false });
    if (cutout) { m.alphaTest = src.alphaTest; m.alphaMap = src.alphaMap ?? null; }
    DEPTH_MATS.set(key, m);
  }
  return m;
}

/**
 * 偏移 pass 渲染（两 composer 共用）：相机层切 BLOOM_LAYER、flag 置 1、清黑渲一遍；
 * 清屏色/相机层掩码/scene.background 都保存恢复。
 * 调用方须先 setRenderTarget(offsetRT)。
 * @param {boolean} clearDepth 偏移 RT 独立深度时清深度（uiScene 链 true；世界链走预填）
 * @param {boolean} depthPrepass 世界链遮挡语义：先以 depth-only 覆写全场渲一遍
 *   预填偏移 RT 自有深度（被遮挡的发热体不把晕透到遮挡物上），再渲 FX 写入件。
 *   代价 = 每帧多一遍无色彩的几何提交；立牌透明区会按整quad遮挡（可接受）。
 */
/** 场景里是否存在可见的偏移写入件（BLOOM_LAYER 层 + 可见链上）。
 *  灯不算（灯挂层是灯组豁免手段，非写入件——稳态下灯不带本层位）。 */
function hasVisibleWriter(scene) {
  const mask = 1 << BLOOM_LAYER;
  let found = false;
  scene.traverseVisible((o) => {
    if (found || o.isLight || (o.layers.mask & mask) === 0) return;
    found = true;
  });
  return found;
}

export function renderBloomOffsetPass(renderer, scene, camera, { clearDepth = false, depthPrepass = false } = {}) {
  const prevMask = camera.layers.mask;
  const prevBg = scene.background;
  const prevColor = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  // 门控（2026-09-30 实测空闲房写入件=0）：没有任何可见写入件 → 整段跳过——
  // depth 预填全场重渲 + 层重渲 + RT 带宽在无 FX 时序里是纯浪费。调用方已把
  // 渲染目标切到偏移 RT，这里只清黑保持「无偏移」语义（bloom 链每帧都采样它）。
  if (!hasVisibleWriter(scene)) {
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, false, false);
    renderer.setClearColor(prevColor, prevAlpha);
    return;
  }
  // 阴影图豁免：autoUpdate 开着的话每次 render() 都会重渲全场阴影——偏移 pass 只是
  // 重画几个 FX quad，阴影在本帧主渲已更新，这里整体跳过（翻倍渲染的冤枉钱不花）
  const prevShadowAuto = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
  scene.background = null;
  if (depthPrepass) {
    // 全场 depth-only 预填（逐对象材质替换，见 DEPTH_MATS 注释）：把几何深度灌进
    // 偏移 RT——随后的 FX 写入件据此做遮挡深度测试。相机层掩码保持原样（全场参与
    // 遮挡，不只是 FX 件）；bloomPassFlag 仍 0。
    const swaps = [];
    scene.traverseVisible((o) => {
      const src = o.material;
      if (!src) return;
      if (Array.isArray(src)) {
        let dirty = false;
        const mats = src.map((s) => { const m = depthMatFor(s); if (m !== s) dirty = true; return m; });
        if (dirty) { swaps.push([o, src]); o.material = mats; }
      } else {
        const m = depthMatFor(src);
        if (m !== src) { swaps.push([o, src]); o.material = m; }
      }
    });
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    for (const [o, src] of swaps) o.material = src;
  }
  bloomPassFlag.value = 1;
  camera.layers.set(BLOOM_LAYER);
  // 灯光层豁免（probe-w2 确诊的 4fps 病灶）：three 的灯光收集按相机层
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
