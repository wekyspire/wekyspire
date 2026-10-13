// 混合 deferred 着色（实验路径，?deferred=1，战斗舞台先行）：
//   pass A 房间 opaque → G-buffer 三附件（albedo / 视空间法线 / rough-metal 常量槽）；
//   pass B 全屏光照 → 写回月光 composer 的场景色 RT（线性 HDR）：点光表（DataTexture）
//           + 月光平行光（shadow map 硬件比较，march 同式）+ 副平行光 + 半球环境 + 线性 fog；
//   pass C 层 0 forward 余量（单位立牌/粒子/法术/玻璃）autoClear=false 叠画，不写深度。
//   unlit 件（skydome/自发光族）经 G-buffer 的 mat 槽 r<0 标记在光照段直通。
// 铁律承接：MRT 槽位节点在材质上下文求值（materialRoughness/Metalness 属性节点读每材质
//   常量，twin 上同名属性赋值）；动态循环上界 = 固定 MAX + Break（towerClouds 同款）；
//   灯表走 DataTexture（TSL uniform 数组不可用）；光强 = color×intensity（无 4π 因子，
//   AnalyticLightNode 实测）；雾 = FogNode 的 smoothstep(near, far, 视距)。
// 已知 v1 缺口（spike 验证项）：alphaTest 切割件未接（rough 槽与 alpha 冲突须四槽或另案）；
//   透明件深度遮挡未接（设计定案 = shader 内采 G-buffer 深度比较，v1 缺省关闭）。
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn, If, Loop, Break, uniform, texture, uv,
  vec2, vec3, vec4, float, max, min, dot, mix, pow, sqrt, abs,
  clamp, smoothstep, oneMinus, normalize, length,
  mrt, normalView, materialRoughness, materialMetalness, output,
} from 'three/tsl';
import { passUV, makeFullScreenPass, renderFullScreenPass, disposeFullScreenPass } from './passes.js';

export const GBUF_LAYER = 6;              // BLOOM_LAYER=7 之外的未占用层位
const MAX_LIGHTS = 64;                    // 灯表容量（G-buffer 场景实测 21 盏，上限留破坏时代余量）
const RECIP_PI = 0.3183098861837907;      // 1/π（BRDF_Lambert，与 forward 生成码同值）

// G-buffer 槽位（'output' 槽 = 材质自己的输出 → 附件 0，albedo twin 的 colorNode；
// 额外槽为全局节点表达式，在每个材质的片元上下文里求值）
export const GBUF_MRT = mrt({
  output,
  normal: vec4(normalView, float(1.0)),
  mat: vec4(materialRoughness, materialMetalness, float(0.0), float(0.0)),
});

/**
 * 材质的 G-buffer twin：统一降为 MeshBasic（无光照），albedo = color×顶点色；
 * roughness 槽语义：标准材质 → 源 roughness；unlit 源 → -1（光照段直通标记）。
 * @param {THREE.Material} src 房间 mesh 的原材质（kit 族材质/克隆/特例）
 */
function makeGBufferTwin(src) {
  const std = !!src.isMeshStandardNodeMaterial;
  const m = new MeshBasicNodeMaterial({
    vertexColors: !!src.vertexColors,
    side: src.side,
    fog: false,
    transparent: false,
  });
  m.flatShading = std ? src.flatShading !== false : true;   // 法线槽走片元导数（flat 族观感同源）
  m.color.copy(src.color);
  m.roughness = std ? (Number.isFinite(src.roughness) ? src.roughness : 1) : -1;
  m.metalness = std && Number.isFinite(src.metalness) ? src.metalness : 0;
  return m;
}

/**
 * 全屏光照 pass：读 G-buffer + 深度重建视空间片元，逐灯累计（单次散射 GGX，
 * 多次散射 LUT 补偿暂缺——parity A/B 定差距）→ 线性 HDR 场景色。
 * u：uniform 包（单参数传入，Fn 参数上限约束）；debug 0=正常 1=albedo 2=normal 3=mat。
 */
const dlLighting = Fn(([u]) => {
  const gAlb = texture(u.tGAlbedo, passUV);
  const gNrm = texture(u.tGNormal, passUV);
  const gMat = texture(u.tGMat, passUV);

  const outgoing = vec3(0.0).toVar();

  // 深度 → 视空间片元（projInv × NDC；与 march 同 WebGPU z∈[0,1] 约定）；光照与 fog 共用
  const depth = texture(u.tDepth, passUV).x;
  const ndc = vec4(uv().mul(2.0).sub(1.0), depth, 1.0);
  const vposH = u.camProjInv.mul(ndc);
  const vpos = vposH.xyz.div(vposH.w);
  const viewDist = length(vpos);

  If(gMat.r.greaterThanEqual(0.0), () => {
    const albedo = gAlb.rgb;
    const rough = clamp(gMat.r, 0.05, 1.0);
    const metal = gMat.g;
    const N = normalize(gNrm.rgb);

    const V = normalize(vpos.negate());
    const NdotV = clamp(dot(N, V), 1e-4, 1.0);

    const a = rough.mul(rough);
    const a2 = a.mul(a);
    const oneMinusA2 = oneMinus(a2);
    const diffuseColor = albedo.mul(oneMinus(metal));
    const F0 = mix(vec3(0.04), albedo, metal);

    const directDiffuse = vec3(0.0).toVar();
    const directSpecular = vec3(0.0).toVar();

    // ---- 点光表（DataTexture 2×MAX：texel0 = 视空间位置+截止半径，texel1 = 色×强度+decay）----
    Loop(MAX_LIGHTS, ({ i }) => {
      If(float(i).greaterThanEqual(u.lightCount), () => { Break(); });
      const rowY = float(i).add(0.5).div(float(MAX_LIGHTS));
      const t0 = texture(u.tLight, vec2(0.25, rowY));
      const t1 = texture(u.tLight, vec2(0.75, rowY));
      const lv = t0.xyz.sub(vpos);
      const dist = max(length(lv), 1e-4);
      const L = lv.div(dist);
      // 距离衰减（LightUtils.getDistanceAttenuation 同式：1/max(d^decay,0.01) × 窗函数）；
      // 窗函数无分支化：CPU 侧把 distance=0（不截止）预写为大半径
      const base = max(pow(dist, max(t1.w, 1e-3)), 0.01);
      const q = clamp(dist.div(t0.w), 0.0, 1.0);
      const w = oneMinus(pow(q, 4.0));
      const irrad = t1.xyz.mul(base.reciprocal().mul(w).mul(w));
      const NdotL = clamp(dot(N, L), 0.0, 1.0);
      If(NdotL.greaterThan(0.0), () => {
        directDiffuse.addAssign(irrad.mul(NdotL));
        const H = normalize(L.add(V));
        const NdotH = clamp(dot(N, H), 0.0, 1.0);
        const VdotH = clamp(dot(V, H), 0.0, 1.0);
        const dDen = pow(NdotH.mul(NdotH).mul(oneMinusA2).add(1.0), 2.0);
        const D = a2.div(dDen.mul(3.141592653589793)).max(0.0);
        const Vis = float(0.5).div(
          NdotL.mul(sqrt(NdotV.mul(NdotV).mul(oneMinusA2).add(a2)))
            .add(NdotV.mul(sqrt(NdotL.mul(NdotL).mul(oneMinusA2).add(a2)))),
        ).max(0.0);
        const F = F0.add(oneMinus(F0).mul(pow(oneMinus(VdotH), 5.0)));
        directSpecular.addAssign(irrad.mul(NdotL).mul(D).mul(Vis).mul(F));
      });
    });

    // ---- 月光平行光（含 shadow map 硬件比较；march 同式含越界掩码与 y 翻转）----
    const mNdotL = clamp(dot(N, u.moonDir), 0.0, 1.0);
    If(mNdotL.greaterThan(0.0), () => {
      const shadow = float(1.0).toVar();
      If(u.shadowOn.greaterThan(0.5), () => {
        const wpos = u.camWorld.mul(vec4(vpos, 1.0));
        const sp = u.shadowMatrix.mul(wpos);
        const spz = sp.xyz.div(sp.w);
        const inb = smoothstep(0.001, 0.01, spz.x).mul(oneMinus(smoothstep(0.99, 0.999, spz.x)))
          .mul(smoothstep(0.001, 0.01, spz.y)).mul(oneMinus(smoothstep(0.99, 0.999, spz.y)))
          .mul(smoothstep(0.0, 0.01, spz.z)).mul(oneMinus(smoothstep(0.99, 0.999, spz.z)));
        const s = texture(u.tShadow, vec2(spz.x, oneMinus(spz.y))).compare(spz.z.add(u.shadowBias));
        shadow.assign(s.mul(inb));
      });
      const mIr = u.moonColor.mul(mNdotL).mul(shadow);
      directDiffuse.addAssign(mIr);
      const H = normalize(u.moonDir.add(V));
      const NdotH = clamp(dot(N, H), 0.0, 1.0);
      const VdotH = clamp(dot(V, H), 0.0, 1.0);
      const dDen = pow(NdotH.mul(NdotH).mul(oneMinusA2).add(1.0), 2.0);
      const D = a2.div(dDen.mul(3.141592653589793)).max(0.0);
      const Vis = float(0.5).div(
        mNdotL.mul(sqrt(NdotV.mul(NdotV).mul(oneMinusA2).add(a2)))
          .add(NdotV.mul(sqrt(mNdotL.mul(mNdotL).mul(oneMinusA2).add(a2)))),
      ).max(0.0);
      const F = F0.add(oneMinus(F0).mul(pow(oneMinus(VdotH), 5.0)));
      directSpecular.addAssign(u.moonColor.mul(mNdotL).mul(shadow).mul(D).mul(Vis).mul(F));
    });

    // ---- 副平行光（无阴影）----
    const d1NdotL = clamp(dot(N, u.dir1), 0.0, 1.0);
    If(d1NdotL.greaterThan(0.0), () => {
      directDiffuse.addAssign(u.dir1Color.mul(d1NdotL));
    });

    // ---- 半球环境（HemisphereLightNode 同式：mix(ground, sky, N_world·up×0.5+0.5)）----
    const Nw = normalize(u.camWorld.mul(vec4(N, 0.0)).xyz);
    const hemiW = clamp(dot(Nw, u.hemiUp), -1.0, 1.0).mul(0.5).add(0.5);
    const hemiIrr = mix(u.hemiGround, u.hemiSky, hemiW);

    outgoing.assign(
      diffuseColor.mul(RECIP_PI).mul(directDiffuse.add(hemiIrr)).add(directSpecular),
    );
  }).Else(() => {
    outgoing.assign(gAlb.rgb);   // unlit 直通
  });

  // ---- 线性 fog（FogNode 同式：smoothstep(near, far, -viewZ)；three 用视向 Z 非径向距离）----
  const fogF = smoothstep(u.fogNear, u.fogFar, vpos.z.negate());
  outgoing.assign(mix(outgoing, u.fogColor, fogF));

  // debug 直通
  If(u.debug.equal(1.0), () => { outgoing.assign(gAlb.rgb); });
  If(u.debug.equal(2.0), () => { outgoing.assign(abs(gNrm.rgb)); });
  If(u.debug.equal(3.0), () => { outgoing.assign(vec3(gMat.r, gMat.g, 0.0)); });

  return vec4(outgoing, 1.0);
});

/**
 * 建 deferred 着色控制器（BattleStage ?deferred=1 时注入月光 composer 的 scenePass）。
 * @param {object} options
 *   scene: THREE.Scene（战斗世界场景；灯表/层位从这里收集）
 *   roomGroup: THREE.Group 房间 PCG 子树（twin 替换与 GBUF 层只作用于它）
 *   moonlight: THREE.DirectionalLight（唯一投影平行光）
 * @returns { renderScenePass(renderer, scene, camera, targetRT), resize(w,h), dispose() }
 */
export function createDeferredShading({ scene, roomGroup, moonlight }) {
  const gbufferRT = new THREE.WebGLRenderTarget(2, 2, {
    type: THREE.HalfFloatType,
    count: 3,
    depthTexture: new THREE.DepthTexture(2, 2),
  });
  // MRTNode.setup 按 RT 纹理名匹配槽位名（对不上即弃槽）——纹理名必须与 GBUF_MRT 键一致
  gbufferRT.textures[0].name = 'output';
  gbufferRT.textures[1].name = 'normal';
  gbufferRT.textures[2].name = 'mat';

  // 灯表（DataTexture 上传：TSL uniform 数组不可用；NEAREST 逐纹素取值）
  const lightData = new Float32Array(2 * 4 * MAX_LIGHTS);
  const lightTex = new THREE.DataTexture(lightData, 2, MAX_LIGHTS, THREE.RGBAFormat, THREE.FloatType);
  lightTex.magFilter = THREE.NearestFilter;
  lightTex.minFilter = THREE.NearestFilter;

  const u = {
    tGAlbedo: texture(gbufferRT.textures[0]),
    tGNormal: texture(gbufferRT.textures[1]),
    tGMat: texture(gbufferRT.textures[2]),
    tDepth: texture(gbufferRT.depthTexture),
    tLight: texture(lightTex),
    tShadow: texture(black1x1()),
    lightCount: uniform(0.0),
    camProjInv: uniform(new THREE.Matrix4()),
    camWorld: uniform(new THREE.Matrix4()),
    moonDir: uniform(new THREE.Vector3(0, 1, 0)),
    moonColor: uniform(new THREE.Vector3()),
    dir1: uniform(new THREE.Vector3(0, 1, 0)),
    dir1Color: uniform(new THREE.Vector3()),
    hemiSky: uniform(new THREE.Vector3()),
    hemiGround: uniform(new THREE.Vector3()),
    hemiUp: uniform(new THREE.Vector3(0, 1, 0)),
    fogColor: uniform(new THREE.Vector3(0x06 / 255, 0x0a / 255, 0x14 / 255)),
    fogNear: uniform(165.0),
    fogFar: uniform(310.0),
    shadowMatrix: uniform(new THREE.Matrix4()),
    shadowBias: uniform(0.002),
    shadowOn: uniform(0.0),
    debug: uniform(0.0),
  };
  const lightScene = makeFullScreenPass(dlLighting(u));

  // ---- 安装：房间子树 twin 替换 + GBUF 层；灯与阴影相机挂 GBUF 位（两 pass 灯集恒定，
  // 防管线 churn；阴影相机须看见 GBUF-only 的房间 mesh）----
  const swaps = [];
  const twinCache = new Map();
  roomGroup.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    if (o.material.transparent) return;             // 玻璃类留 forward 原材质
    let twin = twinCache.get(o.material);
    if (!twin) { twin = makeGBufferTwin(o.material); twinCache.set(o.material, twin); }
    swaps.push({ mesh: o, orig: o.material });
    o.material = twin;
    o.layers.set(GBUF_LAYER);
  });
  scene.traverse((o) => { if (o.isLight) o.layers.enable(GBUF_LAYER); });
  moonlight.shadow.camera.layers.enable(GBUF_LAYER);

  // ---- CPU 灯表/全局灯采样（每帧；视空间量在此预乘）----
  const _v = new THREE.Vector3();
  const _view = new THREE.Matrix4();
  function updateLights(camera) {
    camera.updateMatrixWorld();
    _view.copy(camera.matrixWorld).invert();
    u.camProjInv.value.copy(camera.projectionMatrixInverse);
    u.camWorld.value.copy(camera.matrixWorld);

    let count = 0;
    let dir1Set = false;
    scene.traverse((o) => {
      if (!o.isLight || !o.visible) return;
      if (o.isPointLight && count < MAX_LIGHTS) {
        o.getWorldPosition(_v).applyMatrix4(_view);
        const i4 = count * 8;
        lightData[i4] = _v.x; lightData[i4 + 1] = _v.y; lightData[i4 + 2] = _v.z;
        lightData[i4 + 3] = o.distance > 0 ? o.distance : 1e6;
        lightData[i4 + 4] = o.color.r * o.intensity;
        lightData[i4 + 5] = o.color.g * o.intensity;
        lightData[i4 + 6] = o.color.b * o.intensity;
        lightData[i4 + 7] = o.decay;
        count += 1;
      } else if (o.isDirectionalLight && o !== moonlight) {
        o.getWorldPosition(_v);
        _v.sub(o.target.getWorldPosition(new THREE.Vector3())).normalize().applyMatrix4(_view)
          .normalize();                             // applyMatrix4 非正交时需重归一，防御写法
        if (!dir1Set) {
          u.dir1.value.copy(_v);
          u.dir1Color.value.set(o.color.r * o.intensity, o.color.g * o.intensity, o.color.b * o.intensity);
          dir1Set = true;
        }
      } else if (o.isHemisphereLight) {
        u.hemiSky.value.set(o.color.r * o.intensity, o.color.g * o.intensity, o.color.b * o.intensity);
        u.hemiGround.value.set(o.groundColor.r * o.intensity, o.groundColor.g * o.intensity, o.groundColor.b * o.intensity);
        u.hemiUp.value.copy(o.position).normalize();
      }
    });
    u.lightCount.value = count;
    lightTex.needsUpdate = true;

    // 月光（视空间方向 + shadow）
    moonlight.getWorldPosition(_v);
    _v.sub(moonlight.target.getWorldPosition(new THREE.Vector3())).normalize().applyMatrix4(_view).normalize();
    u.moonDir.value.copy(_v);
    u.moonColor.value.set(
      moonlight.color.r * moonlight.intensity,
      moonlight.color.g * moonlight.intensity,
      moonlight.color.b * moonlight.intensity,
    );
    if (moonlight.shadow.map) {
      u.shadowOn.value = 1.0;
      u.shadowMatrix.value.copy(moonlight.shadow.matrix);
      u.shadowBias.value = moonlight.shadow.bias ?? 0;   // 材质侧阴影用灯自己的 bias（非 march 的 0.002）
      const sd = moonlight.shadow.map.depthTexture;
      if (sd.compareFunction === null) sd.compareFunction = THREE.LessEqualCompare;
      u.tShadow.value = sd;
    }

    // fog（线性 Fog；场景无雾时保持远置缺省 = 不生效）
    const fog = scene.fog;
    if (fog && fog.isFog) {
      u.fogColor.value.set(fog.color.r, fog.color.g, fog.color.b);
      u.fogNear.value = fog.near;
      u.fogFar.value = fog.far;
    }
  }

  let freezeLights = false;   // 调试口：冻结 updateLights，页面内拨 uniform 做 A/B

  function renderScenePass(renderer, scene, camera, targetRT) {
    if (!freezeLights) updateLights(camera);
    // pass A：G-buffer（MRT 全局态只在 RT 渲染时生效，进出成对开关）
    const mask = camera.layers.mask;
    renderer.setRenderTarget(gbufferRT);
    renderer.clear();
    renderer.setMRT(GBUF_MRT);
    camera.layers.set(GBUF_LAYER);
    renderer.render(scene, camera);
    renderer.setMRT(null);
    // pass B：全屏光照 → composer 场景色 RT（线性 HDR；深度走 G-buffer，RT 自有深度闲置）
    u.tGAlbedo.value = gbufferRT.textures[0];
    u.tGNormal.value = gbufferRT.textures[1];
    u.tGMat.value = gbufferRT.textures[2];
    u.tDepth.value = gbufferRT.depthTexture;
    renderer.setRenderTarget(targetRT);
    renderer.clear();
    renderFullScreenPass(renderer, lightScene);
    // pass C：forward 余量叠画（层 0：单位/粒子/法术/玻璃；不写场景深度）
    camera.layers.set(0);
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(scene, camera);
    renderer.autoClear = prevAuto;
    camera.layers.mask = mask;
  }

  function resize(w, h) {
    gbufferRT.setSize(Math.max(1, w), Math.max(1, h));
  }

  function dispose() {
    for (const { mesh, orig } of swaps) { mesh.material = orig; mesh.layers.set(0); }
    scene.traverse((o) => { if (o.isLight) o.layers.disable(GBUF_LAYER); });
    moonlight.shadow.camera.layers.disable(GBUF_LAYER);
    for (const m of twinCache.values()) m.dispose();
    gbufferRT.depthTexture?.dispose?.();
    gbufferRT.dispose();
    lightTex.dispose();
    u.tShadow.value?.dispose?.();
    disposeFullScreenPass(lightScene);
  }

  return {
    renderScenePass, resize, dispose,
    set freeze(v) { freezeLights = !!v; },   // 调试：冻结灯采样，供页面内 A/B 拨 uniform
    get depthTexture() { return gbufferRT.depthTexture; },
    _uniforms: u,                 // 调试口（页面内推 debug=1/2/3 看 G-buffer 槽位）
    _gbufferRT: gbufferRT,
  };
}

function black1x1() {
  const t = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
  t.needsUpdate = true;
  return t;
}
