// 共享后处理件（stage/post/ 层）——WebGPU 迁移 TSL 版（GLSL 字符串件全部重写）：
// 全屏 pass 的**唯一事实源**——体积月光 composer（scenes/volumetricMoon.js）与
// uiScene composer（post/uiComposer.js）共用同一套节点函数，bloom 阈值等全局约定
// 只在这里各有一份，改一处两链同步。
//
// TSL 化要点（W2 立的规矩）：
//   · 全屏 pass = Scene + PlaneGeometry(2,2) + MeshBasicNodeMaterial（colorNode 注入），
//     正交相机原样（顶点管线与 WebGL 时代数学等价）；纹理输入 = TextureNode，调用方
//     每帧换 `.value`（RT ping-pong 的标准姿势）；
//   · 渲进 RT 的 pass 天然无输出变换（isOutputTarget=false），与 WebGL RT 排除一致；
//   · **RT 纹理采样必须过 passUV（V 翻转）**——WebGPU 帧缓冲原点在左上（WebGL 在
//     左下），本后端渲出的 RT 纹理内容与 uv() 的屏幕朝向相反（probe-w2 实测：
//     不翻转则整帧上下颠倒）。NDC 重建/屏幕空间计算仍用 uv（它跟随片元 NDC
//     朝向，与后端无关）；只有「把 RT 当纹理读」的采样点用 passUV。
//
// 输出变换铁律（flavor A，取代 W2 的「节点内 tone + 临时摘
// renderer.toneMapping」旧规矩——两套约定混用曾致塔楼整帧无 tone）：
//   · **tone mapping + sRGB 的唯一落点 = 渲染器输出 blit**：渲屏幕（renderTarget=null）
//     的 render() 自动走「内部 HalfFloat FB → 帧末 blit 施加 renderer.toneMapping +
//     outputColorSpace」；帧内多条渲屏幕的 pass 顺序汇入同一 FB（首 pass autoClear
//     清底、后续 pass autoClear=false 线性叠加），末次 blit 对全帧统一变换一次；
//   · **所有 composer 链终段只出线性 HDR**（bloom 加算完即止）——任何节点内 tone
//     都会被 blit 再映射一次 = 双重 tone；
//   · **任何代码不得临时改 renderer.toneMapping/outputColorSpace**：它是全帧共享
//     状态，帧内最后一个渲屏幕的 blit 按当时值施加给**整帧**（含先前 pass 的内容）——
//     uiComposer 旧例的摘除窗口曾把塔楼世界的 tone 整帧冲掉（probe-blit 实测：
//     画布 = sRGB(FB) 恰好无 tone）。调参只走 applyToneMapping（常驻设定，非逐帧）；
//   · bloom 仍在各链内部、线性段做（tone 必须在其后，否则光晕发灰发脏）。
//
// 两条铁律（RT 间接合成成立的前提，uiComposer 依赖）：
//   ① 终段合成用 premultiplied（ONE, ONE_MINUS_SRC_ALPHA）——three 法线混合在 RT
//     里留下的 rgb 本就是预乘色、alpha 是真覆盖率，数学上与直渲逐像素等价；
//   ② uiScene 的加法发光件一律走 additiveLight（rgb 加算照旧、alpha 不占地）——
//     否则光斑的 alpha 会在 RT 里「占地」，合成时把背后的世界挡掉。
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn, texture, uv,
  vec2, vec4, clamp, max, oneMinus,
} from 'three/tsl';

/** RT 纹理采样 UV（V 翻转，理由见文件头注最后一条）。 */
export const passUV = vec2(uv().x, oneMinus(uv().y));

// 全屏 pass 相机：模块级单例（渲染期无状态，所有 pass 共享一台）。
// 正交 (-1..1) 无旋转：平面四角直落 NDC——与旧 VERT 的 vec4(position.xy,0,1) 等价。
const FS_CAM = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

/**
 * 建一个全屏 quad pass（返回只有一子的 Scene）。
 * @param {Node} colorNode TSL 节点（调用方持 uniform/texture 节点，每帧换 .value）
 * @param {object} [opts]
 * @param {boolean} [opts.keepAlpha] RT 要保留 colorNode 的 alpha（如云 march 的透射率）
 *   时必开：**非透明材质在 NodeBuilder 片元末段被强制 `DiffuseColor.w = 1.0`**
 *   （opaque_fragment 约定，probe-cloudgal9 实测 WGSL 铁证）——RT alpha 恒 1，
 *   composite 的 sc·(1−cl.a) 恒为 0（塔楼全黑病灶）。transparent 摘掉这行；
 *   blending 置 NoBlending 防 NormalBlending 把 rgb 按 alpha 混进 RT 底色。
 */
export function makeFullScreenPass(colorNode, { keepAlpha = false } = {}) {
  const scene = new THREE.Scene();
  const mat = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false });
  if (keepAlpha) {
    mat.transparent = true;
    mat.blending = THREE.NoBlending;
  }
  mat.colorNode = colorNode;
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  return scene;
}

/** 渲一个全屏 pass（调用方负责 setRenderTarget）。 */
export function renderFullScreenPass(renderer, scene) {
  renderer.render(scene, FS_CAM);
}

/** 销毁全屏 pass 的几何与材质（RT 由持有方自己销毁）。 */
export function disposeFullScreenPass(scene) {
  for (const child of [...scene.children]) {
    child.geometry.dispose();
    child.material.dispose();
  }
}

// ---- bloom 链节点 ----

// bright pass：软膝阈值提亮部（线性空间）。彩灯/屏幕这些 >1 的自发光体才是主角。
// tOffset（bloom intensity offset 通道，见 fx/bloomOffset.js）：R 通道按 uOffsetScale
// 加和进亮度判定——绘制结果可主动声明起晕强度，颜色本体不必拉爆 HDR。
// 注意它只放大权重 w、不直接给颜色：bloom 光色仍取自 tColor 本像素（黑像素无晕）。
export const tslBright = Fn(([tColor, tOffset, uOffsetScale, uThreshold, uKnee]) => {
  const c = texture(tColor, passUV).rgb;
  const lum = max(c.r, max(c.g, c.b)).add(texture(tOffset, passUV).r.mul(uOffsetScale));
  // 软膝：threshold 以下全黑，以上平滑过渡（硬阈值会让 bloom 边缘出现台阶）
  const soft = clamp(lum.sub(uThreshold).add(uKnee), 0.0, uKnee.mul(2.0));
  const softW = soft.mul(soft).div(uKnee.mul(4.0).add(1e-4));
  const w = max(softW, lum.sub(uThreshold)).div(max(lum, 1e-4));
  return vec4(c.mul(w), 1.0);
});

// 分离高斯模糊（9 抽样、线性采样跨步 → 实际覆盖 ~2px 半径；H/V 各跑一次）
export const tslBlur = Fn(([tSrc, uDir]) => {
  const sum = texture(tSrc, passUV).rgb.mul(0.2270270270).toVar();
  sum.addAssign(texture(tSrc, passUV.add(uDir.mul(1.3846153846))).rgb.mul(0.3162162162));
  sum.addAssign(texture(tSrc, passUV.sub(uDir.mul(1.3846153846))).rgb.mul(0.3162162162));
  sum.addAssign(texture(tSrc, passUV.add(uDir.mul(3.2307692308))).rgb.mul(0.0702702703));
  sum.addAssign(texture(tSrc, passUV.sub(uDir.mul(3.2307692308))).rgb.mul(0.0702702703));
  return vec4(sum, 1.0);
});

// ---- 终段合成节点（两链共享）----
// flavor A（见文件头注「输出变换铁律」）：终段**只出线性 HDR**——tone map 与 sRGB
// 编码统一由渲染器帧末输出 blit 施加（Khronos PBR Neutral 曲线走 three 内置
// NeutralToneMapping，与旧手译节点版同一公式）。节点内 tone 库已随 flavor A 删除。

// 世界链终段：线性色 + bloom 加算，直出线性 HDR。uGrade = 场景缓变 grade
// （sceneMood 的曝光/冷暖/压暗乘子——两链共享同一 uniform 实例）
export const tslFinalWorld = Fn(([tColor, tBloom, uBloom, uGrade]) => {
  const c = texture(tColor, passUV).rgb.add(texture(tBloom, passUV).rgb.mul(uBloom)).mul(uGrade);
  return vec4(c, 1.0);
});

// UI 链终段：同上加算，唯一差别 = alpha 透传（tColor 的 a 是真覆盖率，
// 由调用侧以 premultiplied 混合线性叠加进帧缓冲）
export const tslFinalUi = Fn(([tColor, tBloom, uBloom, uGrade]) => {
  const src = texture(tColor, passUV);
  const c = src.rgb.add(texture(tBloom, passUV).rgb.mul(uBloom)).mul(uGrade);
  return vec4(c, src.a);
});

/** 色调映射模式（宿主/调试页共用一份枚举，避免两边写死数字）。 */
export const TONE_MODES = Object.freeze({ none: 0, neutral: 1, aces: 2, reinhard: 3 });

/**
 * 全局缺省色调映射：选 Neutral（Khronos PBR Neutral）的理由：保色相/饱和，
 * 只在接近过曝时压高光（0.76 以下基本是恒等，不动既有布光配比）。
 */
export const DEFAULT_TONE_MODE = 'neutral';

/**
 * 设全局色调映射——全帧唯一调参口（flavor A）：写 renderer.toneMapping /
 * toneMappingExposure，帧末输出 blit 对整帧统一施加一次。
 * ⚠ 这是常驻设定，不是逐帧开关——任何「渲屏幕前临时改、渲完恢复」的写法都会
 * 污染全帧输出变换（见文件头注铁律）。传 null/undefined 的 mode 视为 noop。
 */
export function applyToneMapping(renderer, mode, exposure = 1) {
  if (!renderer) return;
  const id = TONE_MODES[mode] ?? TONE_MODES.none;
  const THREE_TONE = [THREE.NoToneMapping, THREE.NeutralToneMapping, THREE.ACESFilmicToneMapping, THREE.ReinhardToneMapping];
  renderer.toneMapping = THREE_TONE[id];
  renderer.toneMappingExposure = exposure;
}

/**
 * 加法发光件约定（铁律②）：rgb 加算保持旧 AdditiveBlending 观感（SRC_ALPHA 因子，
 * opacity 呼吸动画照旧生效），但 alpha 通道**不写**（ZERO, ONE）——光不占地。
 * uiScene 进 RT 再合成的链路里，普通 AdditiveBlending 会把光斑 alpha 累进覆盖率，
 * 终段合成时把背后的世界挡掉；直渲路径下本约定与 AdditiveBlending 逐像素等价
 * （画布不透明，alpha 写什么是垃圾值都无人在乎），两条路径零回归。
 */
export function additiveLight(material) {
  material.blending = THREE.CustomBlending;
  material.blendEquation = THREE.AddEquation;
  material.blendSrc = THREE.SrcAlphaFactor;
  material.blendDst = THREE.OneFactor;
  material.blendSrcAlpha = THREE.ZeroFactor;
  material.blendDstAlpha = THREE.OneFactor;
  material.transparent = true;
  return material;
}

// ---- 旧 GLSL 字符串件（FRAG_BRIGHT/FRAG_BLUR/GLSL_TONE_LIB/FRAG_FINAL/VERT）已随
// W2 删除；fx/gpu/ 两件死文件（gpuParticles/burnEmission）的旧 import 由 W5 compute 化重建。
