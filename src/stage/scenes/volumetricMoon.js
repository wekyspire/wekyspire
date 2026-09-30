// 月光体积光 composer：真 ray marching（非贴面片）+ temporal 累积——TSL 版（W2）。
//   pass 1：世界场景渲进带深度纹理的 RT（同时触发 three 渲染 shadow map）；
//   pass 2（march + EMA）：全屏 quad 重建每像素视线，向场景深度行进 N 步，逐步把采样点
//           变换进月光 shadow 空间做硬件比较采样，累计"在光中"的散射量；
//           每帧 jitter 相位轮转（frame seed % 30），光量写入**历史 RT（ping-pong）**：
//           ema = mix(history, current, 1/30)——30 帧收敛，jitter 条纹被时间域抹平；
//   pass 3（composite）：屏幕 = 场景色 + EMA 光量（只 EMA 光项，不 EMA 场景色——
//           全场 EMA 会让火焰闪烁/单位呼吸/卡牌动画全部拖影）。
// 效果：光柱被窗洞/柱列真实切碎（柱影在空气中拉出资讯量），假面片方案做不到。
//
// 集成：BattleStage 在 renderer 支持 RT 时创建，StageManager tick 里替代
//   默认 scene 渲染（composeScene 钩子），resize 走 composeResize（历史同步失效重收敛）。
//
// WebGPU 迁移要点：
//   · **NDC 深度不翻倍**：WebGPU 坐标系投影矩阵把 z 映到 [0,1]（renderer 会给相机换坐标系），
//     旧 GLSL 的 depth*2-1 是 WebGL [-1,1] 约定——这里直接喂 depth；
//   · 硬件阴影比较 = texture(depthTex, uv).compare(z)（TSL 内建），纹理的
//     compareFunction 由 shadow 系统备好；越界仍按"完全阴影"处理（乘掩码不累积）；
//   · 终段只出线性 HDR，tone map + sRGB 统一由渲染器帧末输出 blit 施加
//     （flavor A，passes.js 头注「输出变换铁律」——本 composer 不碰 renderer.toneMapping）；
//   · bloom/终段与 uiComposer 共享 post/ 一份实现（唯一事实源不变）。
import * as THREE from 'three';
import {
  Fn, If, Loop, uniform, texture, uv, screenCoordinate,
  vec2, vec3, vec4, float, mix, max, min, length, exp, fract, dot, step, oneMinus,
} from 'three/tsl';
import {
  tslFinalWorld, passUV,
  makeFullScreenPass, renderFullScreenPass, disposeFullScreenPass,
} from '../post/passes.js';
import { createBloomChain } from '../post/bloomChain.js';
import { renderBloomOffsetPass } from '../fx/bloomOffset.js';

const EMA_ALPHA = 1 / 30; // temporal EMA 新帧权重（≈1s 收敛 @30fps）
const STEPS = 26;

/** 月光链质量档（?moonq=high|half|low，缺省 high）——iGPU 救命档。
 *  march 每像素 = STEPS 步 × LinearFilter 深度比较采样（自带 4-tap 软化）≈ 百次
 *  深度纹理采样/像素，在共享内存 iGPU（~34GB/s）上是带宽怪兽（用户笔记本实测只有
 *  房间层/战斗掉帧——塔楼层 MapStage 无此链，天然对照组）。half = march/EMA 链
 *  半分辨率（带宽 ÷4）；low = 0.375 分辨率（带宽 ÷7）。**步数不砍**：12 步实测
 *  光柱能量腰斩——窗棂切碎的窄光带宽小于 2×步长，稀疏采样点跨过光带 = 欠采样
 *  丢能量（glm-flash 三档 A/B 实锤，结构级劣化非柔和度）。分辨率与步数无关，
 *  只降分辨率无此风险（EMA 本就在抹噪）。 */
export function moonQualityFromUrl() {
  let q = null;
  if (typeof location !== 'undefined') q = new URLSearchParams(location.search).get('moonq');
  if (q === 'half') return { scale: 0.5, steps: STEPS };
  if (q === 'low') return { scale: 0.375, steps: STEPS };
  return { scale: 1, steps: STEPS };
}

const vmHash12 = Fn(([p]) => {
  const p3 = fract(vec3(p.xyx).mul(0.1031));
  p3.addAssign(dot(p3, p3.yzx.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z));
});

// march + EMA：输出线性光量（不写屏幕，写历史 RT）
// 体积区域 = 房间 AABB 外扩少许：view ray 先与盒求交，t start/t end
// clamp 在 [tEnter, tExit]——盒外像素（天空盒/远景）零光量直出，天空渲染不被污染；
// tfar 不再用 nearZ/固定值硬截（相机拉远时截断曾致全场偏暗，干扰视觉判断）。
const vmMarch = Fn(([u, steps]) => {
  const depth = texture(u.tDepth, passUV).x; // RT 纹理读 → passUV（V 翻转，passes.js 头注）
  // 重建世界空间视线端点（WebGPU 坐标系：NDC z ∈ [0,1]，depth 直喂——勿乘 2 减 1；
  // NDC 重建用 uv() 本体——它跟随片元 NDC 朝向，与后端无关）
  const ndc = vec4(uv().mul(2.0).sub(1.0), depth, 1.0);
  const vpos = u.camProjInv.mul(ndc);
  const wpos = u.camWorld.mul(vpos.div(vpos.w)).xyz;
  const ray = wpos.sub(u.camPos);
  const sceneDist = length(ray);
  const rd = ray.div(sceneDist);
  // 视线 × 房间体积盒：盒外像素（天空盒/远景）零光量，天空正常渲染
  const invD = vec3(1.0).div(rd);
  const tA = u.boxMin.sub(u.camPos).mul(invD);
  const tB = u.boxMax.sub(u.camPos).mul(invD);
  const tSm = min(tA, tB);
  const tBg = max(tA, tB);
  const tEnter = max(max(tSm.x, tSm.y), max(tSm.z, 0.0));
  const tExit = min(min(tBg.x, tBg.y), tBg.z);
  const current = vec3(0.0).toVar();
  const trans = float(1.0).toVar(); // 透射率：盒内空气对视线方向的吸收（天空也要乘）
  If(tExit.greaterThan(tEnter), () => {
    const t0 = tEnter;
    const maxT = min(min(sceneDist, tExit), u.maxDist);
    If(maxT.greaterThan(t0), () => {
      const stepLen = maxT.sub(t0).div(float(STEPS));
      const jitter = fract(vmHash12(screenCoordinate.xy).add(u.frame.mul(u.framePct)));
      const acc = float(0.0).toVar();
      Loop(steps, ({ i }) => {
        const t = t0.add(float(i).add(jitter).mul(stepLen));
        const p = u.camPos.add(rd.mul(t));
        const sp = u.shadowMatrix.mul(vec4(p, 1.0));
        const spz = sp.xyz.div(sp.w);
        // 飞出 shadow 覆盖范围一律按"完全阴影"处理（不累积）——sp.z 还要卡下界：
        // 负 z（比 shadow 相机近面更近）拿去比较会恒亮（调试实录）。
        // 旧 GLSL 是 if 分支跳过；TSL 改成乘掩码（无分支等价：越界贡献 = 0）
        const inb = step(0.001, spz.x).mul(step(spz.x, 0.999))
          .mul(step(0.001, spz.y)).mul(step(spz.y, 0.999))
          .mul(step(0.0, spz.z)).mul(step(spz.z, 1.0));
        // 硬件阴影比较（与 three PCF getShadow 同约定：比较值 = shadowCoord.z + bias；
        // **y 坐标要 oneMinus**——shadowMatrix 的 [0,1] 映射两后端同构，但 WebGPU 帧缓冲
        // 原点左上，官方 ShadowNode 同样以 oneMinus 翻转（"follow webgpu standards"）。
        // LinearFilter 的深度贴图采样自带 4-tap 软化）
        acc.addAssign(texture(u.tShadow, vec2(spz.x, oneMinus(spz.y))).compare(spz.z.add(u.shadowBias)).mul(inb));
      });
      current.assign(u.lightColor.mul(acc).mul(u.density).mul(stepLen));
      trans.assign(exp(u.density.negate().mul(maxT.sub(t0)))); // 单次散射近似
    });
  });
  // temporal EMA：mix(历史, 当前帧, 1/30)——jitter 噪声在时间域收敛成稳定柔光
  // alpha 通道同步 EMA 透射率（与光量同节拍收敛）
  const history = texture(u.tHistory, passUV);
  return vec4(
    mix(history.rgb, current, u.emaAlpha),
    mix(history.a, trans, u.emaAlpha));
});

// composite：场景色 + EMA 光量 + 配方 tint → **线性、未映射**的合成色（写进 rtColor）。
// 色调映射/曝光/sRGB 全部移到终段——bloom 必须在线性、映射之前的色上做
// （映射后再提亮会连同高光压缩一起被放大，光晕会发灰发脏）。
const vmComposite = Fn(([tDiffuse, tLight, uTint]) => {
  const sceneCol = texture(tDiffuse, passUV).rgb;
  const light = texture(tLight, passUV).rgb;
  return vec4(sceneCol.add(light).mul(uTint), 1.0);
});

/**
 * 建体积月光 composer。
 * @param {object} options
 *   light: THREE.DirectionalLight（castShadow，唯一体积光源）
 *   box: { min:[x,y,z], max:[x,y,z] } 房间体积盒（比房间内稍大；view ray 与之求交框定
 *        march 区间，盒外像素零光量——天空盒/远景正常渲染）
 *   maxDist/density/lightBoost: 参数（density 单位：每世界单位散射量；maxDist 仅安全后闸）
 * @returns { render(renderer, scene, camera), resize(w, h), dispose() }
 */
export function createVolumetricMoonlight({
  light,
  box = { min: [-95, -35, -92], max: [148, 95, 112] }, // 缺省 = 房型房间外扩（walls.js 常量 + 边距）
  maxDist = 800,   // 安全后闸：盒交才是体积边界（曾用 300 硬截，相机拉远即渲染错误/偏暗——用户指正）
  density = 0.01,   // 光束要 prominent（过低只剩"空气感"，调试实录）
  lightBoost = 0.9,
  tint = null,       // 配方场景调色 [r,g,b]（composeRoom grading.tint 下发；缺省白）
  march = null,      // { scale, steps }（缺省 ?moonq= 档，moonQualityFromUrl）
} = {}) {
  const q = march ?? moonQualityFromUrl();
  let marchScale = Math.min(1, Math.max(0.25, +q.scale || 1));   // march/EMA 链分辨率系数
  let marchSteps = Math.max(4, Math.min(64, Math.round(+q.steps || STEPS)));
  const rt = new THREE.WebGLRenderTarget(2, 2, {
    type: THREE.HalfFloatType,
    // 无 MSAA：WebGPU 多样本 + 深度纹理不解 resolve，samples>0 触发 depth attachment
    // sample count 校验错、整帧指令流失效（probe-w2-post 实测）——锯齿由 temporal EMA 兜。
    depthTexture: new THREE.DepthTexture(2, 2),
  });
  // bloom 强度偏移通道（fx/bloomOffset.js）：FX 件在偏移 pass 里重写输出（R = 偏移量），
  // bright 段阈值判定前加和进亮度——起晕强度由绘制方主动声明，颜色本体不必拉爆 HDR。
  // **独立深度纹理 + depth-only 预填**（WebGPU 铁律，probe-w2 确诊）：旧 GLSL
  // 版与 rt 共享深度纹理——本后端按 RT 缓存渲染通道描述符、失效判据不含深度纹理身份，
  // 第二个 RT 首用时给共享深度标 needsUpdate → 纹理销毁重建 → 第一个 RT 的缓存描述符
  // 永远引用已销毁纹理（每帧 GPUValidationError）。故两 RT 各持深度，遮挡改由偏移
  // pass 前的全场 depth-only 预填提供（renderBloomOffsetPass 的 depthPrepass 模式）。
  const rtBloomOff = new THREE.WebGLRenderTarget(2, 2, {
    type: THREE.HalfFloatType,
    depthTexture: new THREE.DepthTexture(2, 2),
  });
  // temporal 历史（ping-pong，只存线性光量；HalfFloat 保平滑）
  let historyRead = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });
  let historyWrite = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });
  let historyValid = false; // 首帧/resize 后：emaAlpha=1 直接定植，避免从黑收敛 1s

  const blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  blackTex.needsUpdate = true;

  const u = {
    tDepth: texture(rt.depthTexture),
    tShadow: texture(blackTex),          // 首帧 shadow map 未生成时兜底（那时走直渲分支）
    tHistory: texture(blackTex),
    camProjInv: uniform(new THREE.Matrix4()),
    camWorld: uniform(new THREE.Matrix4()),
    shadowMatrix: uniform(new THREE.Matrix4()),
    camPos: uniform(new THREE.Vector3()),
    lightColor: uniform(light.color.clone().multiplyScalar(lightBoost)),
    density: uniform(density),
    maxDist: uniform(maxDist),
    frame: uniform(0),
    framePct: uniform(1 / 30), // 30 帧抖动轮转（与 EMA 速率同周期）
    emaAlpha: uniform(EMA_ALPHA),
    boxMin: uniform(new THREE.Vector3(...box.min)),
    boxMax: uniform(new THREE.Vector3(...box.max)),
    shadowBias: uniform(0.002),
  };
  const tDiffuse = texture(rt.texture);
  const tLight = texture(blackTex);
  const uTint = uniform(tint ? new THREE.Color(...tint) : new THREE.Color(1, 1, 1));
  // ---- bloom（给整条渲染管线加 bloom，让彩灯/屏幕真的"发光"）----
  // 链：线性合成 → 半分辨率 bright（软膝阈值）→ H/V 两次分离高斯 → 终段加算直出线性。
  const bloomParams = { threshold: 1.45, knee: 0.35, strength: 0.42, radius: 1.4 };
  const tFinalColor = texture(blackTex);
  const tFinalBloom = texture(blackTex);
  const uBloomStr = uniform(bloomParams.strength);
  const rtColor = new THREE.WebGLRenderTarget(2, 2, { type: THREE.HalfFloatType });
  const bloom = createBloomChain(bloomParams);
  let marchScene = makeFullScreenPass(vmMarch(u, marchSteps));
  const compositeScene = makeFullScreenPass(vmComposite(tDiffuse, tLight, uTint));
  const finalScene = makeFullScreenPass(tslFinalWorld(tFinalColor, tFinalBloom, uBloomStr));
  let lastW = 2, lastH = 2;   // setQuality 重缩放用

  function resize(w, h) {
    const rw = Math.max(1, w);
    const rh = Math.max(1, h);
    lastW = rw; lastH = rh;
    rt.setSize(rw, rh);
    rtBloomOff.setSize(rw, rh);
    // march/EMA 链独立分辨率系数：march 是带宽大头（见 moonQualityFromUrl 注释），
    // 体积光是软的——半分辨率升采样（composite 采样 history 用线性过滤）视觉损失极小
    const mw = Math.max(1, Math.round(rw * marchScale));
    const mh = Math.max(1, Math.round(rh * marchScale));
    historyRead.setSize(mw, mh);
    historyWrite.setSize(mw, mh);
    rtColor.setSize(rw, rh);
    bloom.resize(rw, rh);
    historyValid = false; // 尺寸变了，历史失效重收敛
  }

  function render(renderer, scene, camera) {
    // shadow map 首帧尚未生成：退回普通渲染（仅一帧）
    if (!light.shadow.map) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }
    camera.updateMatrixWorld();
    u.camProjInv.value.copy(camera.projectionMatrixInverse);
    u.camWorld.value.copy(camera.matrixWorld);
    u.camPos.value.setFromMatrixPosition(camera.matrixWorld);
    u.shadowMatrix.value.copy(light.shadow.matrix);
    u.frame.value = (u.frame.value + 1) % 30;
    const shadowDepth = light.shadow.map.depthTexture;
    // 硬件比较采样需要比较函数（WebGPU comparison sampler；three 阴影系统若已设则不动）
    if (shadowDepth.compareFunction === null) shadowDepth.compareFunction = THREE.LessEqualCompare;
    u.tShadow.value = shadowDepth; // 深度在 depthTexture（color 纹理是未用的垃圾）
    u.emaAlpha.value = historyValid ? EMA_ALPHA : 1;

    // pass 1：场景 → RT
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, camera);
    u.tDepth.value = rt.depthTexture;
    // pass 2：march + EMA → historyWrite（tHistory 读上一帧的 historyRead）
    u.tHistory.value = historyRead.texture;
    renderer.setRenderTarget(historyWrite);
    renderFullScreenPass(renderer, marchScene);
    // ping-pong：本帧的 write 成为下一帧的 read
    const tmp = historyRead;
    historyRead = historyWrite;
    historyWrite = tmp;
    historyValid = true;
    // pass 3：场景色 + EMA 光量 → rtColor（**线性、未映射**：bloom 与终段都在这之后）
    tDiffuse.value = rt.texture;
    tLight.value = historyRead.texture;
    renderer.setRenderTarget(rtColor);
    renderFullScreenPass(renderer, compositeScene);
    // pass 3.5：bloom 偏移通道——BLOOM_LAYER 上的件以 bloomPassFlag=1 重渲一遍
    // （depthPrepass：先全场 depth-only 预填 rtBloomOff 自有深度——遮挡正确性来源，
    // 见上方 RT 创建处注释；march 早已消费完场景深度，本 pass 时序无碍）
    renderer.setRenderTarget(rtBloomOff);
    renderBloomOffsetPass(renderer, scene, camera, { clearDepth: false, depthPrepass: true });
    // pass 4-6：bright → 半分辨率 H/V 分离高斯（共享 bloom 链，结果在 bloom.texture）
    bloom.render(renderer, rtColor.texture, rtBloomOff.texture);
    // pass 7：线性色 + bloom 加算 → 屏幕（直出线性 HDR；tone+sRGB 由渲染器帧末
    // 输出 blit 统一施加——flavor A，本链不碰 renderer.toneMapping）
    tFinalColor.value = rtColor.texture;
    tFinalBloom.value = bloom.texture;
    renderer.setRenderTarget(null);
    renderFullScreenPass(renderer, finalScene);
  }

  function dispose() {
    rt.depthTexture?.dispose?.();
    rt.dispose();
    rtBloomOff.depthTexture?.dispose?.();
    rtBloomOff.dispose();
    rtColor.dispose();
    bloom.dispose();
    historyRead.dispose();
    historyWrite.dispose();
    blackTex.dispose();
    for (const s of [marchScene, compositeScene, finalScene]) disposeFullScreenPass(s);
  }

  /** 实时改 bloom（调试/调参用）：threshold 门槛、knee 软膝、strength 强度、radius 半径。 */
  function setBloom({ threshold, knee, strength, radius } = {}) {
    if (Number.isFinite(threshold)) bloomParams.threshold = threshold;
    if (Number.isFinite(knee)) bloomParams.knee = knee;
    if (Number.isFinite(radius)) bloomParams.radius = radius;
    bloom.setBloom({ threshold, knee, radius }); // 链内自判非法值，undefined 跳过
    if (Number.isFinite(strength)) { bloomParams.strength = strength; uBloomStr.value = strength; }
  }

  /** 实时改 march 质量（低性能自动降档的落点）：scale = march/EMA 链分辨率系数
   *  （0.25~1，改走 resize 重缩放 + 历史重收敛）；steps = 步数（重建 pass，一次性）。 */
  function setQuality({ scale, steps } = {}) {
    let resized = false;
    if (Number.isFinite(scale)) {
      const s = Math.min(1, Math.max(0.25, scale));
      if (s !== marchScale) { marchScale = s; resized = true; }
    }
    if (Number.isFinite(steps)) {
      const n = Math.max(4, Math.min(64, Math.round(steps)));
      if (n !== marchSteps) {
        marchSteps = n;
        disposeFullScreenPass(marchScene);
        marchScene = makeFullScreenPass(vmMarch(u, marchSteps));
      }
    }
    if (resized) resize(lastW, lastH);
  }

  return {
    render, resize, dispose, setBloom, bloomParams, setQuality,
    get marchQuality() { return { scale: marchScale, steps: marchSteps }; },
    _uniforms: u,                    // 调试/调参口（页面内实时改 density 等；.value 直推）
    _compositeUniforms: { tDiffuse, tLight, uTint },
    /** 调试探针口：RT 现场只读暴露（排障用；别在渲染逻辑里消费）。 */
    debugRts: () => ({ rt, rtBloomOff, rtColor, historyRead, historyWrite }),
  };
}
