// 雪云体积渲染（towerWilderness 的大气件，2026-09-16 用户定开工）：
// **三段管线**（用户定正确修法）：
//   ① mesh pass：场景（穹顶/雪原/塔/雪粒子）渲进 rtScene——linear 色彩 + 深度纹理
//     （进 RT 时 three 按 renderTarget 判定不套 tone map/sRGB，整帧只在末段走一次）；
//   ② 云 raymarch：1/4 分辨率 → rtCloud，**逐像素读场景深度线性化，march 到几何面
//     终止**（几何在板前=全遮、几何在板内=transmittance 累积到面前）+ 小域可分离 blur；
//   ③ transmittance 合成：col = cloudInscatter + scene * T → 屏幕（tone map/sRGB 在此
//     对整帧走一遍）。
// 接入 = StageManager 的 composeScene 钩子（MapStage 委托 composeFrame，BattleStage
// 体积光同范式）；云体 = Worley base + perlin+worley detail 侵蚀 + 独立随风 offset 场。
// 云板按 y 求交，相机在云下/云内/云上三种相对位置同一路径（TOWER.md 四阶段）。
// node/headless 可安全构造（RT/材质创建不触 GL；管线只在浏览器 composeFrame 里跑）。

import * as THREE from 'three';
import marchFragSrc from './towerClouds.march.frag.glsl?raw';
import blurFragSrc from './towerClouds.blur.frag.glsl?raw';
import compositeFragSrc from './towerClouds.composite.frag.glsl?raw';

// 满屏大三角形（越界顶点外推出整屏，vUv/射线对 xy 线性外推同样正确）
const TRI_POS = new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]);

const TRI_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vRay;
uniform vec3 uRayA; // 四角世界射线（底左/底右/顶左/顶右），对 vUv 双线性插值
uniform vec3 uRayB;
uniform vec3 uRayC;
uniform vec3 uRayD;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  vRay = mix(mix(uRayA, uRayB, vUv.x), mix(uRayC, uRayD, vUv.x), vUv.y);
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const PLAIN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

const RT_SCALE = 0.25;          // 云 RT 1/4 分辨率（用户定：省性能 + blur 降噪）
const CORNER_NDC = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

// ---- 分章观感预设（TOWER.md 四阶段；全部为用户 cloudGallery 实调值，2026-09-16）----
// 云板几何对齐塔楼（用户定：11 层 boss 前恰在云外、12-33 层完全在云内、34 层起云上）：
// 层 f 相机锚 y = -58.5+(f-0.5)×7 → 11 层 15 / 12 层 22 / 33 层 169 / 34 层 176。
// base 18 = 11 层上方 3 / 12 层下方 4；top 174 = 33 层上方 5 / 34 层下方 2。
// ch1 = 一章塔外·云底仰视；ch2 = 二/三章·云中。towerWilderness.setStormLevel 按层
// 在两套之间插值（爬升跨章连续渐变）；三/四章云观感待美术 pass 后在此追加。
// haze 语义 = 云雾等效密度（march 侧与场景 FogExp2 同为平方指数 ramp）：ch1 取
// 0.005 → 云堤在 t0≈350 全融、头顶（t0≈73）仅 ~13% 融——远处云与地面在全雾距离
// 处同步抹平（2026-09-16 用户定：远云/天暗成雾色消接缝）。
// underShade = 相机在云板下时的云体压暗系数（一章云底仰视暗一点，云底背光）。
export const CLOUD_PRESETS = {
  ch1: {
    base: 18, top: 174, scale: 69, coverage: 0.83, density: 0.15,
    stepSize: 7, steps: 32, haze: 0.005, underShade: 0.78,
    windX: -2.5, windZ: 2.5, sun: 1.3,
    detailAmt: 0.5, detailFreq: 0.2, warpAmt: 18, warpFreq: 0.032,
    gustBoost: 2.3, innerStep: 0.55, nearFadeStart: 6, nearFadeEnd: 45, nearFadeAmt: 0.35,
  },
  ch2: {
    base: 18, top: 174, scale: 82, coverage: 0.77, density: 0.15,
    stepSize: 7, steps: 32, haze: 0.005, underShade: 1,
    windX: -1.5, windZ: 0, sun: 1.3,
    detailAmt: 0.85, detailFreq: 0.31, warpAmt: 18, warpFreq: 0.032,
    gustBoost: 3.5, innerStep: 0.25, nearFadeStart: 0, nearFadeEnd: 35, nearFadeAmt: 0.1,
  },
};

/**
 * @param {object} opts
 *   sunDir: THREE.Vector3 云层受光方向（世界，指向光源）
 *   overrides: 调参位初值覆盖（如 windX/windZ 与雪花风同源）
 */
export function buildTowerClouds({
  sunDir = new THREE.Vector3(-0.55, 0.72, -0.42), overrides = {},
} = {}) {
  // ---- 调参位（gallery / knob 实时改；运行期直接改 uniforms 的 .value）----
  // 观感初值 = ch1 预设（一章塔外）；游戏内由 towerWilderness.setStormLevel 按层
  // 在 ch1/ch2 之间插值覆写。测试点光默认熄灭（用户定：正式塔灯由 stage pass-in）。
  const params = {
    ...CLOUD_PRESETS.ch1,
    lanternDist: 24,      // 灯距相机（世界单位，沿视线前方）
    lanternIntensity: 0,  // 默认关；gallery knob 手动开（70 会把整帧 HDR 爆白）
    lanternColor: 0xffdfae, // 暖灯笼色（塔楼挂灯意象）
  };
  Object.assign(params, overrides);
  /** 调参同步（gallery knob 直改 params 后调用，一次性落 uniforms）。 */
  function syncParams() {
    uniforms.uCloudWind.value.set(params.windX, params.windZ);
    uniforms.uCloudBase.value = params.base;
    uniforms.uCloudTop.value = params.top;
    uniforms.uCloudScale.value = params.scale;
    uniforms.uCoverage.value = params.coverage;
    uniforms.uDensity.value = params.density;
    uniforms.uStepSize.value = params.stepSize;
    uniforms.uMaxSteps.value = params.steps;
    uniforms.uHaze.value = params.haze;
    uniforms.uSunAmt.value = params.sun;
    uniforms.uDetailAmt.value = params.detailAmt;
    uniforms.uDetailFreq.value = params.detailFreq;
    uniforms.uWarpAmt.value = params.warpAmt;
    uniforms.uWarpFreq.value = params.warpFreq;
    uniforms.uGustBoost.value = params.gustBoost;
    uniforms.uInnerStepScale.value = params.innerStep;
    uniforms.uLanternColor.value.setHex(params.lanternColor);
    uniforms.uNearFadeStart.value = params.nearFadeStart;
    uniforms.uNearFadeEnd.value = params.nearFadeEnd;
    uniforms.uNearFadeAmt.value = params.nearFadeAmt;
    uniforms.uUnderShade.value = params.underShade;
  }

  const uniforms = {
    uCamPos: { value: new THREE.Vector3() },
    uCloudTime: { value: 0 },
    uCloudWind: { value: new THREE.Vector2(params.windX, params.windZ) },
    uCloudBase: { value: params.base },
    uCloudTop: { value: params.top },
    uCloudScale: { value: params.scale },
    uCoverage: { value: params.coverage },
    uDensity: { value: params.density },
    uStepSize: { value: params.stepSize },
    uMaxSteps: { value: params.steps },
    uHaze: { value: params.haze },
    uSkyTop: { value: new THREE.Color(0x7e93ad) },      // 与 towerWilderness SKY_TOP 同源（JS 侧覆盖）
    uSkyBottom: { value: new THREE.Color(0x59626a) },   // 同 SKY_BOTTOM
    uFogColor: { value: new THREE.Color(0x59626a) },    // 场景雾色（towerWilderness 共享 FogExp2.color 实例）
    uSunDir: { value: sunDir.clone().normalize() },
    uSunAmt: { value: params.sun },
    uRayA: { value: new THREE.Vector3(0, 0, -1) },
    uRayB: { value: new THREE.Vector3(0, 0, -1) },
    uRayC: { value: new THREE.Vector3(0, 0, -1) },
    uRayD: { value: new THREE.Vector3(0, 0, -1) },
    uDetailAmt: { value: params.detailAmt },
    uDetailFreq: { value: params.detailFreq },
    uWarpAmt: { value: params.warpAmt },
    uWarpFreq: { value: params.warpFreq },
    uGustBoost: { value: params.gustBoost },
    uInnerStepScale: { value: params.innerStep },
    // 场景深度（composeFrame 每帧接 rtScene 深度纹理与相机参数）
    uSceneDepth: { value: null },
    uCamNear: { value: 0.1 },
    uCamFar: { value: 2000 },
    uCamWorldInv: { value: new THREE.Matrix4() },
    uLanternPos: { value: new THREE.Vector3() },
    uLanternColor: { value: new THREE.Color(params.lanternColor) },
    uLanternIntensity: { value: 0 },
    uNearFadeStart: { value: params.nearFadeStart },
    uNearFadeEnd: { value: params.nearFadeEnd },
    uNearFadeAmt: { value: params.nearFadeAmt },
    uUnderShade: { value: params.underShade },  // 云下仰视压暗（相机在云板下时生效）
  };
  syncParams();

  const triGeo = new THREE.BufferGeometry();
  triGeo.setAttribute('position', new THREE.BufferAttribute(TRI_POS, 3));
  const marchMat = new THREE.ShaderMaterial({
    uniforms, vertexShader: TRI_VERT, fragmentShader: marchFragSrc,
    depthTest: false, depthWrite: false,
  });
  const blurMat = new THREE.ShaderMaterial({
    uniforms: {
      uSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uDir: { value: new THREE.Vector2(1, 0) },
    },
    vertexShader: PLAIN_VERT, fragmentShader: blurFragSrc,
    depthTest: false, depthWrite: false,
  });
  const compMat = new THREE.ShaderMaterial({
    uniforms: {
      uScene: { value: null },
      uCloud: { value: null },
    },
    vertexShader: PLAIN_VERT, fragmentShader: compositeFragSrc,
    depthTest: false, depthWrite: false, toneMapped: true, // 整帧唯一 tone map/sRGB 出口
  });
  const triScene = new THREE.Scene();
  const tri = new THREE.Mesh(triGeo, marchMat);
  tri.frustumCulled = false;
  triScene.add(tri);
  const triCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // ---- RT（懒建：首次浏览器渲染才知道 drawing buffer 尺寸）----
  let rtScene = null; // mesh pass：linear 色 + 深度纹理（全分辨率）
  let rtCloud = null; // march 结果 →（blur V 后）合成源（1/4 分辨率）
  let rtBlur = null;  // blur H 中转
  let rtW = 0;
  let rtH = 0;
  const _size = new THREE.Vector2();
  const _corner = new THREE.Vector3();
  const _camWorldInv = new THREE.Matrix4();
  const _fwd = new THREE.Vector3();
  const _UP = new THREE.Vector3(0, 1, 0);

  function ensureRTs(renderer) {
    renderer.getDrawingBufferSize(_size);
    const w = Math.max(2, Math.round(_size.x * RT_SCALE));
    const h = Math.max(2, Math.round(_size.y * RT_SCALE));
    if (rtScene && w === rtW && h === rtH) return;
    rtScene?.dispose();
    rtCloud?.dispose();
    rtBlur?.dispose();
    rtW = w; rtH = h;
    const depth = new THREE.DepthTexture(_size.x, _size.y); // 全分辨率深度
    rtScene = new THREE.WebGLRenderTarget(_size.x, _size.y, {
      type: THREE.HalfFloatType,       // linear HDR：整帧末段统一 tone map
      depthTexture: depth,
      depthBuffer: true,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    const opts = {
      type: THREE.HalfFloatType,       // 线性 HDR：银边高光不被 8bit 裁掉
      depthBuffer: false,
      minFilter: THREE.LinearFilter,   // 合成时双线性上采样（1/4 → 全屏的一半平滑）
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    };
    rtCloud = new THREE.WebGLRenderTarget(w, h, opts);
    rtBlur = new THREE.WebGLRenderTarget(w, h, opts);
    blurMat.uniforms.uTexel.value.set(1 / w, 1 / h);
  }

  /** 三段管线（StageManager composeScene 钩子 / gallery 主循环调用）。 */
  function composeFrame({ renderer, scene, camera }) {
    ensureRTs(renderer);
    if (!rtScene) return;
    // ① mesh pass：场景 → rtScene（linear + 深度；穹顶 renderOrder -10 作背景）
    renderer.setRenderTarget(rtScene);
    renderer.render(scene, camera);
    // ② 云 march：当前帧相机四角射线 + 场景深度 → rtCloud（1/4）
    camera.updateMatrixWorld();
    _camWorldInv.copy(camera.matrixWorld).invert();
    uniforms.uCamPos.value.copy(camera.position);
    uniforms.uCamNear.value = camera.near;
    uniforms.uCamFar.value = camera.far;
    uniforms.uCamWorldInv.value.copy(_camWorldInv);
    uniforms.uSceneDepth.value = rtScene.depthTexture;
    CORNER_NDC.forEach(([x, y], i) => {
      _corner.set(x, y, 0.5).unproject(camera).sub(camera.position).normalize();
      uniforms[['uRayA', 'uRayB', 'uRayC', 'uRayD'][i]].value.copy(_corner);
    });
    // 测试灯笼：相机前方 lanternDist 处（略抬高）；入云渐亮、出云熄灭（光 march
    // 在 shader 里按强度整段跳过）。正式版塔灯位置/参数由 stage pass-in 替换此段。
    camera.getWorldDirection(_fwd);
    const insideL = Math.min(1, Math.max(0, Math.min(
      (camera.position.y - (params.base - 8)) / 8,
      ((params.top + 8) - camera.position.y) / 8)));
    uniforms.uLanternPos.value.copy(camera.position)
      .addScaledVector(_fwd, params.lanternDist)
      .addScaledVector(_UP, 2);
    uniforms.uLanternIntensity.value = params.lanternIntensity * insideL;
    renderer.setRenderTarget(rtCloud);
    tri.material = marchMat;
    renderer.render(triScene, triCam);
    // blur H：Cloud→Blur；blur V：Blur→Cloud（可分离两拍，半径 1.5 纹素 = 全屏 ~6px）
    blurMat.uniforms.uSrc.value = rtCloud.texture;
    blurMat.uniforms.uDir.value.set(1, 0);
    renderer.setRenderTarget(rtBlur);
    tri.material = blurMat;
    renderer.render(triScene, triCam);
    blurMat.uniforms.uSrc.value = rtBlur.texture;
    blurMat.uniforms.uDir.value.set(0, 1);
    renderer.setRenderTarget(rtCloud);
    renderer.render(triScene, triCam);
    // ③ transmittance 合成 → 屏幕（整帧唯一 tone map/sRGB 出口）
    compMat.uniforms.uScene.value = rtScene.texture;
    compMat.uniforms.uCloud.value = rtCloud.texture;
    tri.material = compMat;
    renderer.setRenderTarget(null);
    renderer.render(triScene, triCam);
  }

  return {
    params,
    uniforms,
    /** 时间步进（windy update 链）：噪音场 advect 的时钟。 */
    update(dt) { uniforms.uCloudTime.value += dt; },
    /** 云层光源方向（世界）。 */
    setSunDir(v) { uniforms.uSunDir.value.copy(v).normalize(); },
    /** 三段渲染管线（MapStage.composeScene / cloudGallery 主循环委托）。 */
    composeFrame,
    syncParams,
    dispose() {
      rtScene?.dispose(); rtCloud?.dispose(); rtBlur?.dispose();
      rtScene = rtCloud = rtBlur = null;
      triGeo.dispose();
      marchMat.dispose();
      blurMat.dispose();
      compMat.dispose();
    },
  };
}
