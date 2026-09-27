// GPU 粒子池（纯 GPU Driven 粒子系统，2026-09-27 用户拍板；计划文档 quest_prompts/GPU_PARTICLES_PLAN.md）：
// WebGL2 无 compute/atomic——等价物 = **GPGPU ping-pong**（状态纹理经片元 pass 自更新）
// + **环形游标**（cursor 纹理在 GPU 侧推进，槽位环回卷覆盖最旧，稳态天然正确）：
//   texA = (pos.xyz, age01)　texB = (vel.xyz, emitterIdx + ttl抖动小数)　——两张 RGBA32F
//   MRT 一次写；cursor = 16×1 RGBA32F（r=新游标, g=旧游标），自己的 mini pass 先行。
//   渲染 = THREE.Points 单 draw：顶点 texelFetch 同一份状态纹理直接画（CPU 零读回）。
// 发射源两种：kind 0 点源（位置/锥形初速，通用常驻发射）；kind 1 燃烧图集（burnEmission.js
//   ——GPU 侧算好世界坐标+强度的 metadata，spawn pass 随机纹素 + 强度门控 rejection 采样）。
// 渲染纪律：additiveLight()（rgb 加算 alpha 不占地）+ 接 bloom offset 通道（uBloomPass
//   分支写起晕强度，颜色本体不拉爆）+ BLOOM_LAYER（setBloomWriter）。
// 降级：无 WebGL2 / EXT_color_buffer_float → create 返回 null（调用方回退 CPU 粒子池）。
import * as THREE from 'three';
import {
  makeFullScreenPass, renderFullScreenPass, disposeFullScreenPass, additiveLight,
} from '../../post/passes.js';
import { gpuWind, GLSL_WIND } from './wind.js';
import { createBurnEmission } from './burnEmission.js';
import { bloomPassFlag, setBloomWriter } from '../bloomOffset.js';

const POOL_W = 64, POOL_H = 64, POOL_N = POOL_W * POOL_H; // 4096 粒子上限
const MAX_E = 16; // 发射器上限（uniform 数组长度）

// ---- cursor mini pass（16×1）：游标 += rate × dt（燃烧发射器按活跃单位数扩量）----
const FRAG_CURSOR = /* glsl */`
precision highp float;
varying vec2 vUv;
uniform sampler2D tCursor;
uniform float uDt;
uniform float uERate[${MAX_E}];
uniform float uEActive[${MAX_E}];
uniform int uEKind[${MAX_E}];
uniform int uBurnCount;
void main() {
  int e = int(floor(vUv.x * ${MAX_E}.0));
  vec4 old = texture2D(tCursor, vec2((float(e) + 0.5) / ${MAX_E}.0, 0.5));
  float rate = uERate[e];
  if (uEKind[e] == 1) rate *= float(max(uBurnCount, 0));
  float cur = old.r + rate * uEActive[e] * uDt;
  gl_FragColor = vec4(cur, old.r, 0.0, 1.0);
}`;

// ---- 状态 pass（64×64，MRT 双写）：spawn（游标区间内初始化）+ advect（风/浮力/阻尼/寿命）----
const FRAG_STATE = /* glsl */`
precision highp float;
precision highp int;
varying vec2 vUv;
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform sampler2D tCursor;
uniform sampler2D tEmission;
uniform float uDt;
uniform float uTime;
uniform int uFrame;
uniform vec2 uESegment[${MAX_E}]; // (start, cap)——槽位归属权威（状态纹素里的只是快照）
uniform float uETtl[${MAX_E}];
uniform float uEWindK[${MAX_E}];
uniform float uEGravity[${MAX_E}];
uniform float uEDrag[${MAX_E}];
uniform vec3 uEVel[${MAX_E}];
uniform float uEVelJit[${MAX_E}];
uniform float uESpread[${MAX_E}];
uniform float uEActive[${MAX_E}];
uniform int uEKind[${MAX_E}];
uniform vec3 uEPos[${MAX_E}];
uniform int uBurnCount;
uniform float uEmissionWidth; // 图集宽（px）
${GLSL_WIND}
layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oVel;

float hash1(float n) { return fract(sin(n) * 43758.5453123); }

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  int idx = px.y * ${POOL_W} + px.x;
  int se = -1; float local = 0.0; float cap = 1.0;
  for (int i = 0; i < ${MAX_E}; i++) {
    float s = uESegment[i].x, c = uESegment[i].y;
    if (c > 0.5 && float(idx) >= s && float(idx) < s + c) {
      se = i; local = float(idx) - s; cap = c; break;
    }
  }
  vec4 pl = texelFetch(tPos, px, 0);
  vec4 vm = texelFetch(tVel, px, 0);
  if (se < 0) { oPos = vec4(0.0, 0.0, 0.0, -1.0); oVel = vec4(0.0); return; }

  vec4 cur = texelFetch(tCursor, ivec2(se, 0), 0);
  float s0 = floor(cur.g), s1 = floor(cur.r);
  float m0 = mod(s0, cap), m1 = mod(s1, cap);
  bool want = uEActive[se] > 0.5 && s1 > s0 &&
              (s1 - s0 >= cap || (m0 < m1 ? (local >= m0 && local < m1)
                                          : (local >= m0 || local < m1)));

  if (want) {
    float fh = float(uFrame);
    float h1 = hash1(float(idx) * 0.719 + fh * 0.613);
    float h2 = hash1(h1 * 91.7 + 0.13);
    float h3 = hash1(h1 * 47.3 + 0.37);
    float h4 = hash1(h1 * 71.9 + 0.61);
    float h5 = hash1(h1 * 33.1 + 0.83);
    vec3 v;
    if (uEKind[se] == 1) {
      // 燃烧图集：随机活跃单位 → 随机纹素 → 强度门控（rejection，8 次尝试；
      // 全落空 = 本帧少发，rate 口径是「尝试次数」，成功率由火缘密度决定）
      vec3 wp = vec3(0.0); bool hit = false;
      for (int k = 0; k < 8; k++) {
        float hk = hash1(h1 * 57.1 + float(k) * 19.77 + fh * 0.377);
        if (uBurnCount <= 0) break;
        float col = floor(hash1(hk * 13.1) * float(uBurnCount));
        vec2 tuv = vec2(
          (col * 64.0 + hash1(hk * 71.3) * 64.0) / uEmissionWidth,
          hash1(hk * 41.9));
        vec4 em = texture(tEmission, tuv);
        if (em.w > 0.12 && hash1(hk * 7.7 + fh) < em.w) { wp = em.xyz; hit = true; break; }
      }
      if (!hit) { oPos = vec4(0.0, 0.0, 0.0, -1.0); oVel = vec4(0.0, 0.0, 0.0, float(se)); return; }
      oPos = vec4(wp + (vec3(h2, h3, h4) - 0.5) * 0.9, 0.001);
      v = uEVel[se] + (vec3(h3, h4, h5) - 0.5) * 2.0 * uEVelJit[se];
    } else {
      oPos = vec4(uEPos[se] + (vec3(h2, h3, h4) - 0.5) * 2.0 * uESpread[se], 0.001);
      v = uEVel[se] + (vec3(h3, h4, h5) - 0.5) * 2.0 * uEVelJit[se];
    }
    // w 打包：整数 = emitterIdx，小数 ×100 = ttl 抖动（0.1..1.0，出生时刻入、随粒子走）
    oVel = vec4(v * (0.7 + 0.6 * h2), float(se) + h5 * 0.009 + 0.001);
    return;
  }

  bool alive = pl.w >= 0.0 && pl.w < 1.0;
  if (!alive) { oPos = pl; oVel = vm; return; }
  vec3 vel = vm.xyz;
  vel += (windField(pl.xyz, uTime) * uEWindK[se] + vec3(0.0, uEGravity[se], 0.0)) * uDt;
  vel *= exp(-uEDrag[se] * uDt);
  float ttl = uETtl[se] * (0.7 + 0.6 * clamp(fract(vm.w) * 100.0, 0.0, 1.0));
  oPos = vec4(pl.xyz + vel * uDt, pl.w + uDt / max(ttl, 0.05));
  oVel = vec4(vel, vm.w);
}`;

const VERT3 = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// ---- 渲染（Points 单 draw，顶点 texelFetch 状态纹理）----
const VERT_POINTS = /* glsl */`
varying vec3 vColor;
varying float vAge;
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform float uESize[${MAX_E}];
uniform vec3 uEColor[${MAX_E}];
uniform float uPointScale; // = drawingBufferHeight/2 × proj[1][1]（onBeforeRender 逐帧填）
attribute float aIndex;
void main() {
  int idx = int(aIndex + 0.5);
  ivec2 px = ivec2(idx % ${POOL_W}, idx / ${POOL_W});
  vec4 pl = texelFetch(tPos, px, 0);
  vec4 vm = texelFetch(tVel, px, 0);
  int e = int(floor(vm.w));
  bool alive = pl.w >= 0.0 && pl.w < 1.0;
  vAge = clamp(pl.w, 0.0, 1.0);
  vColor = uEColor[e];
  vec4 mv = modelViewMatrix * vec4(pl.xyz, 1.0);
  float sz = uESize[e] * (1.0 - vAge * 0.5); // 越老越小
  gl_PointSize = alive ? max(sz * uPointScale / max(-mv.z, 0.1), 0.0) : 0.0;
  gl_Position = alive ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0); // 死粒子丢到裁剪外
}`;

const FRAG_POINTS = /* glsl */`
precision highp float;
varying vec3 vColor;
varying float vAge;
uniform float uBloomPass;
layout(location = 0) out vec4 outColor;
void main() {
  float m = smoothstep(0.5, 0.10, length(gl_PointCoord - 0.5)); // soft 圆点
  float fade = 1.0 - vAge;
  // bloom offset 通道：声明起晕强度（颜色本体不拉爆，见 fx/bloomOffset.js 纪律）
  if (uBloomPass > 0.5) { outColor = vec4(m * fade * 0.7, 0.0, 0.0, 1.0); return; }
  vec3 c = vColor * (0.6 + 1.5 * fade); // 新鲜火星更热更亮（HDR 过阈真发光）
  outColor = vec4(c, m * fade);
}`;

const RT_OPTS = {
  type: THREE.FloatType, format: THREE.RGBAFormat,
  minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, // float 不可线性过滤
  depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
};

/**
 * 建全局 GPU 粒子池。能力不齐（无 WebGL2 / float RT）返回 null——调用方回退 CPU 池。
 * @param {THREE.WebGLRenderer} renderer
 */
export function createGpuParticles(renderer) {
  if (!renderer?.capabilities?.isWebGL2) return null;
  if (!renderer.extensions.get('EXT_color_buffer_float')) return null;

  // ---- 状态/游标纹理（ping-pong 对）----
  const mkState = () => new THREE.WebGLRenderTarget(POOL_W, POOL_H, { ...RT_OPTS, count: 2 });
  const mkCursor = () => new THREE.WebGLRenderTarget(MAX_E, 1, RT_OPTS);
  let stateR = mkState(), stateW = mkState(), curR = mkCursor(), curW = mkCursor();
  // 初始：age01 = -1（死槽），cursor = 0
  for (const rt of [stateR, stateW]) {
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, -1);
    renderer.clear(true, false, false);
  }
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x000000, 0); // 还原全局清屏色（初始化借用过的状态不留尾）

  // ---- 发射器表 uniform（cursor/state/points 三材质按需共享实例）----
  const U = {
    segment: { value: Array.from({ length: MAX_E }, () => new THREE.Vector2(0, 0)) },
    rate: { value: new Float32Array(MAX_E) },
    ttl: { value: new Float32Array(MAX_E) },
    windK: { value: new Float32Array(MAX_E) },
    gravity: { value: new Float32Array(MAX_E) },
    drag: { value: new Float32Array(MAX_E) },
    vel: { value: Array.from({ length: MAX_E }, () => new THREE.Vector3()) },
    velJit: { value: new Float32Array(MAX_E) },
    spread: { value: new Float32Array(MAX_E) },
    size: { value: new Float32Array(MAX_E) },
    active: { value: new Float32Array(MAX_E) },
    kind: { value: new Int32Array(MAX_E) },
    pos: { value: Array.from({ length: MAX_E }, () => new THREE.Vector3()) },
    color: { value: Array.from({ length: MAX_E }, () => new THREE.Vector3()) },
  };
  const burnCount = { value: 0 };

  const cursorUniforms = {
    tCursor: { value: null },
    uDt: { value: 0 },
    uERate: U.rate, uEActive: U.active, uEKind: U.kind,
    uBurnCount: burnCount,
  };
  const cursorScene = makeFullScreenPass(FRAG_CURSOR, cursorUniforms);

  const emission = createBurnEmission(renderer);
  const stateUniforms = {
    tPos: { value: null }, tVel: { value: null }, tCursor: { value: null },
    tEmission: { value: emission.texture },
    uDt: { value: 0 }, uTime: { value: 0 }, uFrame: { value: 0 },
    uESegment: U.segment, uETtl: U.ttl, uEWindK: U.windK, uEGravity: U.gravity,
    uEDrag: U.drag, uEVel: U.vel, uEVelJit: U.velJit, uESpread: U.spread,
    uEActive: U.active, uEKind: U.kind, uEPos: U.pos,
    uBurnCount: burnCount,
    uEmissionWidth: { value: emission.texture.image.width },
    ...gpuWind,
  };
  // MRT 双写必须 GLSL3（自声明两个 out；makeFullScreenPass 只支持单输出，故自建）
  const stateMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: stateUniforms, vertexShader: VERT3, fragmentShader: FRAG_STATE,
    depthTest: false, depthWrite: false,
  });
  const stateScene = new THREE.Scene();
  stateScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), stateMat));

  // ---- 渲染件（Points 单 draw）----
  const pointsMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      tPos: { value: null }, tVel: { value: null },
      uESize: U.size, uEColor: U.color,
      uPointScale: { value: 1000 },
      uBloomPass: bloomPassFlag, // 共享实例：偏移 pass 翻一次全体生效
    },
    vertexShader: VERT_POINTS, fragmentShader: FRAG_POINTS,
    depthTest: true, depthWrite: false,
  });
  additiveLight(pointsMat); // rgb 加算、alpha 不占地（RT 合成铁律②）
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(POOL_N * 3), 3));
  const aIndex = new Float32Array(POOL_N);
  for (let i = 0; i < POOL_N; i++) aIndex[i] = i;
  geo.setAttribute('aIndex', new THREE.BufferAttribute(aIndex, 1));
  const points = new THREE.Points(geo, pointsMat);
  points.name = 'gpuParticles';
  points.frustumCulled = false; // 粒子满世界飞，包围盒无意义
  points.raycast = () => {};    // 纯装饰件：不参与指针拾取（防挡战场点击）
  points.renderOrder = 5;
  setBloomWriter(points, true); // 进 bloom offset pass（火星声明起晕）
  const _drawSize = new THREE.Vector2();
  points.onBeforeRender = (rend, _scene, camera) => {
    rend.getDrawingBufferSize(_drawSize);
    pointsMat.uniforms.uPointScale.value = _drawSize.y * 0.5 * camera.projectionMatrix.elements[5];
  };

  // ---- 发射器注册（静态分段：池槽位 bump 分配，发射器少而常驻，不做回收）----
  let nextSlot = 0;
  const used = new Array(MAX_E).fill(false);
  function registerEmitter({
    kind = 0, cap = 256, rate = 20, ttl = 1.2, windK = 1, gravity = 2.5, drag = 0.5,
    vel = [0, 4, 0], velJit = 1.5, spread = 0.5, size = 0.5, color = [2.0, 0.8, 0.2],
    pos = [0, 0, 0], active = 0,
  } = {}) {
    const id = used.findIndex(u => !u);
    if (id < 0 || nextSlot + cap > POOL_N) return -1;
    used[id] = true;
    U.segment.value[id].set(nextSlot, cap);
    U.rate.value[id] = rate;
    U.ttl.value[id] = ttl;
    U.windK.value[id] = windK;
    U.gravity.value[id] = gravity;
    U.drag.value[id] = drag;
    U.vel.value[id].set(...vel);
    U.velJit.value[id] = velJit;
    U.spread.value[id] = spread;
    U.size.value[id] = size;
    U.active.value[id] = active;
    U.kind.value[id] = kind;
    U.pos.value[id].set(...pos);
    U.color.value[id].set(...color);
    nextSlot += cap;
    return id;
  }
  function setEmitterActive(id, on) { if (id >= 0) U.active.value[id] = on ? 1 : 0; }
  function setEmitterPos(id, x, y, z) { if (id >= 0) U.pos.value[id].set(x, y, z); }

  // ---- 燃烧联动（id 0 = 内建燃烧发射器；活跃单位列表 = 图集列序）----
  // rate 口径 = 每秒 spawn 尝试次数（rejection 采样约七成成功率，实测稳态存活 ≈ rate×0.7×ttl）
  const burnId = registerEmitter({
    kind: 1, cap: 2048, rate: 110, ttl: 1.4, windK: 1.0, gravity: 1.2, drag: 0.55,
    vel: [0, 5.2, 0], velJit: 1.8, size: 0.9, color: [2.2, 0.85, 0.18],
  });
  const burnUnits = []; // [{ unit }]，下标 = 图集列
  function burnAddUnit(unit) {
    if (!unit || burnUnits.some(s => s.unit === unit)) return;
    if (burnUnits.length >= emission.maxUnits) return; // 图集满：静默跳过（aura 本体不受影响）
    burnUnits.push({ unit });
    setEmitterActive(burnId, 1);
  }
  function burnRemoveUnit(unit) {
    const i = burnUnits.findIndex(s => s.unit === unit);
    if (i >= 0) burnUnits.splice(i, 1);
    if (!burnUnits.length) setEmitterActive(burnId, 0);
  }

  // ---- 帧推进（BattleStage tick 调）：emission 图集 → cursor → state，全在 GPU ----
  let t = 0, frame = 0;
  function update(dt) {
    t += dt; frame += 1;
    if (burnUnits.length) emission.render(burnUnits);
    cursorUniforms.tCursor.value = curR.texture;
    cursorUniforms.uDt.value = dt;
    burnCount.value = burnUnits.length;
    renderer.setRenderTarget(curW);
    renderFullScreenPass(renderer, cursorScene);
    stateUniforms.tPos.value = stateR.textures[0];
    stateUniforms.tVel.value = stateR.textures[1];
    stateUniforms.tCursor.value = curW.texture; // cursor pass 产物（r=新, g=旧）
    stateUniforms.uDt.value = dt;
    stateUniforms.uTime.value = t;
    stateUniforms.uFrame.value = frame;
    renderer.setRenderTarget(stateW);
    renderFullScreenPass(renderer, stateScene);
    renderer.setRenderTarget(null);
    pointsMat.uniforms.tPos.value = stateW.textures[0]; // 渲染读最新写侧
    pointsMat.uniforms.tVel.value = stateW.textures[1];
    [stateR, stateW] = [stateW, stateR];
    [curR, curW] = [curW, curR];
  }

  /** 探针用：读 cursor 纹理（GPU 侧推进的直证；生产路径不读回）。 */
  function debugReadCursor() {
    const buf = new Float32Array(MAX_E * 4);
    renderer.readRenderTargetPixels(curR, 0, 0, MAX_E, 1, buf);
    return Array.from(buf.slice(0, 8)); // emitter 0 的 (new, old) + 1 号位
  }

  /** 探针用：读状态纹理（emitter 0 全段），数活粒子 + 采位置样本（生产路径不读回）。 */
  function debugReadState() {
    const rows = Math.ceil(nextSlot / POOL_W) || 1; // 覆盖已分配段
    const buf = new Float32Array(POOL_W * rows * 4);
    renderer.readRenderTargetPixels(stateR, 0, 0, POOL_W, rows, buf);
    let alive = 0; const sample = [];
    for (let i = 0; i < POOL_W * rows; i++) {
      const age = buf[i * 4 + 3];
      if (age >= 0 && age < 1) {
        alive++;
        if (sample.length < 4) sample.push([+buf[i * 4].toFixed(1), +buf[i * 4 + 1].toFixed(1), +buf[i * 4 + 2].toFixed(1), +age.toFixed(2)]);
      }
    }
    return { alive, sample };
  }

  function dispose() {
    for (const rt of [stateR, stateW, curR, curW]) rt.dispose();
    disposeFullScreenPass(cursorScene);
    stateScene.children[0].geometry.dispose();
    stateMat.dispose();
    geo.dispose();
    pointsMat.dispose();
    emission.dispose();
    points.parent?.remove(points);
  }

  /** 探针用：读发射图集全宽，统计强度>阈的纹素数 + 最大强度 + 逐列热纹素（生产路径不读回）。 */
  function debugReadEmission() {
    const W = emission.rt.width, H = emission.rt.height;
    const buf = new Float32Array(W * H * 4);
    renderer.readRenderTargetPixels(emission.rt, 0, 0, W, H, buf);
    let hot = 0, max = 0; const perCol = [];
    const cols = Math.floor(W / 64);
    for (let c = 0; c < cols; c++) perCol.push(0);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const w = buf[(y * W + x) * 4 + 3];
        if (w > 0.12) { hot++; perCol[Math.floor(x / 64)]++; }
        if (w > max) max = w;
      }
    }
    return { hot, max: +max.toFixed(3), perCol };
  }

  return {
    points, update, dispose,
    registerEmitter, setEmitterActive, setEmitterPos,
    burnAddUnit, burnRemoveUnit,
    debugReadCursor, debugReadState, debugReadEmission,
    get burnUnitCount() { return burnUnits.length; },
  };
}
