// 月光浮尘云（STAGE_DESIGN §2'）——WebGPU 迁移 TSL 版（原裸 GLSL
// shader 逐式平移，范式见 fx/unitBodyFx.js 头注）：常驻噪音浮尘体积——
// 不是 spawn/死亡型粒子，而是一片常驻尘埃场，全 GPU 驱动：
//   顶点：值噪声三轴漂移（无纹理、无 simplex 依赖，手搓 hash 值噪声）
//         + 逐粒速度差的缓慢下落（盒内回绕）；
//   片元：把世界位置变换进月光 shadow 空间做硬件比较采样（与 volumetricMoon
//         march pass 同约定）——**被月光照亮 → 亮冷蓝；阴影区/飞出 shadow
//         覆盖范围 → 极暗近不可见**。
// 相比沿光路参数化 spawn：浮尘亮暗由 shadow map 真值驱动，与体积光、
// 地面光池天然对齐；阴影区尘埃仍有微弱
// 底色，兼作全场环境浮尘（暗部空气感）。
//
// 两段人口：
//   · 环境尘：均匀填满房间体积，垂直下落 + 盒内回绕（旧逻辑不变）；
//   · 光柱尘：**贴光轴循环**——仍按竖直落差下落（视觉仍是尘埃缓降），但水平位随
//     降高跟踪斜光轴（W = dir/|dir.y| 每单位降高的水平推进），截面内慢速公转，
//     落到底回绕回窗顶。不能只做出生点偏置后垂直坠落——斜柱的水平
//     截移率 ~1.5 单位/单位降高，垂直车道几单位降高就穿出光柱：整柱粒子进房数十秒
//     内集体漏光、之后每周期只有个位数百分比在柱内（「有的光柱扎堆、有的全空」）。
//     贴轴循环让光柱密度恒定，真值裁切只发生在截面边缘（wander 溢出）。
//
// ⚠ 点精灵的 WebGPU 落地形态（与旧 GLSL 的结构性差异，记录在案）：
//   WebGPU 的 point-list 拓扑恒为 1 像素、没有 gl_PointSize——r185 官方口径：
//   PointsNodeMaterial 配 THREE.Points 时 sizeNode 无效。官方替代式 = 单个
//   THREE.Sprite 载 InstancedBufferGeometry + PointsNodeMaterial.sizeNode：
//   setupVertexSprite 以「sizeNode × DPR × (画布高/2) ÷ 视深」重演旧
//   gl_PointSize = size × uScale ÷ max(1,-mv.z) 公式（1080p/DPR1 时与旧
//   uScale=540 定值逐字节等价，且不再锁死 1080p 假设），角点偏移在 NDC 侧
//   补偿透视除法；片元 uv() 即旧 gl_PointCoord。故 `points` 键承载的是
//   Sprite（调用点只 add / 置 visible / 透传 update，对象类型无感）。
//
// CPU 侧每帧只推进 uTime + 同步 shadow uniform，零属性回写。
// node 单测可建（无 document 依赖；shadow map 缺席时 points 不渲染，不报错）。

import * as THREE from 'three';
import { PointsNodeMaterial } from 'three/webgpu';
import {
  Fn, uniform, texture, varying, uv, instancedBufferAttribute, select,
  vec2, vec3, vec4, float, mix, fract, sin, cos, dot, length, smoothstep, oneMinus,
  floor, cross, modelWorldMatrix,
} from 'three/tsl';

// 浮尘体积盒（世界坐标）：罩住大厅可活动区 + 两扇窗到光池的光柱空间（环境人口用）
const VOL_MIN = new THREE.Vector3(-88, -28, -78);
const VOL_MAX = new THREE.Vector3(85, 48, 38);

// 3D 格 hash（vec3 → 0..1），与 GLSL hash13 逐式一致
const hash13 = Fn(([p]) => {
  const q = fract(p.mul(0.1031)).toVar();
  q.addAssign(dot(q, q.zyx.add(31.32)));
  return fract(q.x.add(q.y).mul(q.z));
});

// 平滑值噪声（三线性插值），与 GLSL vnoise 逐式一致
const vnoise3 = Fn(([p]) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2.0).add(3.0));
  return mix(
    mix(
      mix(hash13(i), hash13(i.add(vec3(1.0, 0.0, 0.0))), u.x),
      mix(hash13(i.add(vec3(0.0, 1.0, 0.0))), hash13(i.add(vec3(1.0, 1.0, 0.0))), u.x),
      u.y),
    mix(
      mix(hash13(i.add(vec3(0.0, 0.0, 1.0))), hash13(i.add(vec3(1.0, 0.0, 1.0))), u.x),
      mix(hash13(i.add(vec3(0.0, 1.0, 1.0))), hash13(i.add(vec3(1.0, 1.0, 1.0))), u.x),
      u.y),
    u.z);
});

// GLSL 语义 mod（x - y*floor(x/y)，y>0 时结果恒非负）。⚠ TSL 的 mod 在 WGSL
// 侧生成原生 `%`（取余，符号随被除数）——回绕量随时间为负会把粒子甩出盒外，
// 必须用本 Fn 还原 GLSL 行为。
const modPos = Fn(([x, y]) => x.sub(y.mul(floor(x.div(y)))));

/**
 * 建月光浮尘云。
 * @param {object} options
 *   count: 总粒子数（ambient + beam 两段人口）
 *   beamRatio: 光柱人口的粒子占比（光柱内密度保证）
 *   beams: [{ origin:Vector3(窗顶心，光柱起点), dir:Vector3(单位，光行进方向),
 *            height: 竖直落差（origin.y 到地板), radius: 截面半径 }]
 * @returns { points, uniforms, update(dt, light) }
 *   points = THREE.Sprite（InstancedBufferGeometry 载体，见头注）；update 每帧
 *   推进时间并同步月光 shadow uniform；shadow map 未就绪时隐藏不渲染。
 */
export function buildMoonDust({ count = 1500, beamRatio = 0.4, beams = [] } = {}) {
  const positions = new Float32Array(count * 3);   // 环境人口体积位（beam 粒子存出生占位）
  const seeds = new Float32Array(count);
  // 光柱人口的逐粒参数。⚠ 顶点缓冲数上限 8（WebGPU 管线验证）：position/uv/aOrigin/
  // aSeed 已占 4，beam 数据只许再开 2 个属性——截面基 U/V 与两个随机相位全部
  // shader 侧派生（U=normalize(−wz,0,wx)=normalize(cross(dir,up))、V=cross(dir,U)，
  // 与 JS 侧烘焙逐式同值；y0Frac/ang0 由 aSeed 取 fract 派生，fall 已有同款先例）。
  const beamTop = new Float32Array(count * 3);      // 光柱顶点（窗心）
  const beamB = new Float32Array(count * 4);        // (wx, wz, height, r；环境人口 height=-1)
  const spanX = VOL_MAX.x - VOL_MIN.x;
  const spanY = VOL_MAX.y - VOL_MIN.y;
  const spanZ = VOL_MAX.z - VOL_MIN.z;
  const beamCount = Math.floor(count * beamRatio);
  for (let i = 0; i < count; i++) {
    seeds[i] = Math.random() * 1000;
    const beam = i < beamCount ? beams[Math.floor(Math.random() * beams.length)] : null;
    if (beam && beams.length > 0) {
      // 出生占位沿光轴（shader 会接管；截面基在 GPU 侧重导）
      const r = beam.radius * Math.sqrt(Math.random());
      const ang = Math.random() * Math.PI * 2;
      const drop = Math.random() * beam.height;
      // 每单位**降高**的水平推进 = −dir/dir.y（dir.y<0，降高时沿光行进方向横移）
      const wx = -beam.dir.x / beam.dir.y, wz = -beam.dir.z / beam.dir.y;
      positions[i * 3] = beam.origin.x + wx * drop + Math.cos(ang) * r;
      positions[i * 3 + 1] = beam.origin.y - drop;
      positions[i * 3 + 2] = beam.origin.z + wz * drop + Math.sin(ang) * r;
      beamTop[i * 3] = beam.origin.x; beamTop[i * 3 + 1] = beam.origin.y; beamTop[i * 3 + 2] = beam.origin.z;
      beamB[i * 4] = wx; beamB[i * 4 + 1] = wz;
      beamB[i * 4 + 2] = beam.height; beamB[i * 4 + 3] = r;
    } else {
      // 环境人口：均匀填满房间体积（阴影区只留极暗底色）
      positions[i * 3] = VOL_MIN.x + Math.random() * spanX;
      positions[i * 3 + 1] = VOL_MIN.y + Math.random() * spanY;
      positions[i * 3 + 2] = VOL_MIN.z + Math.random() * spanZ;
      beamB[i * 4 + 2] = -1;                        // 环境人口标记
    }
  }
  // 点精灵底四边形（角点 ±0.5 / uv 0..1）：一实例一粒，4 顶点
  const quad = new THREE.PlaneGeometry(1, 1);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.attributes.position);
  geometry.setAttribute('uv', quad.attributes.uv);
  geometry.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  geometry.setAttribute('aBeamTop', new THREE.InstancedBufferAttribute(beamTop, 3));
  geometry.setAttribute('aBeamB', new THREE.InstancedBufferAttribute(beamB, 4));
  geometry.instanceCount = count;

  // ---- uniforms：TSL uniform() 节点（`.value` 推值口径不变）----
  const uTime = uniform(0);
  const uSize = uniform(0.63);   // 点径基准（世界单位）
  const uVolMin = uniform(VOL_MIN);
  const uVolSpan = uniform(VOL_MAX.clone().sub(VOL_MIN));
  const uShadowMatrix = uniform(new THREE.Matrix4()); // light.shadow.matrix（世界 → shadow UV/深度 [0,1]）
  // 单颗亮度：粒子缩小 40%（uSize 1.05→0.63，面积 ~36%）后抬亮补偿可读性
  const uLit = uniform(new THREE.Color(0xcfe0ff).multiplyScalar(2.2));  // 被月光照亮：亮冷蓝
  const uDark = uniform(new THREE.Color(0x16203c).multiplyScalar(0.5)); // 阴影区：极暗（加色混合下近不可见）
  const uBias = uniform(0.002);

  // ---- 顶点侧（无控制流 = 纯表达式；beam/ambient 两路径 select 二选一）----
  const aOrigin = instancedBufferAttribute(geometry.attributes.aOrigin, 'vec3');
  const aSeed = instancedBufferAttribute(geometry.attributes.aSeed, 'float');
  const aBeamTop = instancedBufferAttribute(geometry.attributes.aBeamTop, 'vec3');
  const aBeamB = instancedBufferAttribute(geometry.attributes.aBeamB, 'vec4');

  // 缓慢下落（逐粒速度差）+ 盒内回绕（GLSL 语义 mod，见 modPos 注）
  const fall = float(0.35).add(fract(aSeed.mul(17.31)).mul(0.75));
  // 光柱路径：竖直落差 dY（贴轴）+ 截面慢公转（角速 0.13 rad/s，全周转 ~48s）。
  // 截面基从 (wx,wz) 重导（与 JS 侧旧烘焙逐式同值）：dir = normalize(wx,-1,wz)，
  // U = normalize(cross(dir,up)) = normalize(-wz,0,wx)，V = cross(dir,U)。
  const height = aBeamB.z;
  const isBeam = height.greaterThan(0.0);
  const y0Frac = fract(aSeed.mul(11.13));
  const ang0 = fract(aSeed.mul(23.17)).mul(6.2831853);
  const dY = modPos(y0Frac.mul(height).sub(uTime.mul(fall)), height);
  const phi = ang0.add(uTime.mul(0.13));
  const beamW = vec3(aBeamB.x, float(-1.0), aBeamB.y);       // 每单位降高的水平推进
  const uBasis = vec3(aBeamB.y.negate(), float(0.0), aBeamB.x).normalize();
  const vBasis = cross(beamW.normalize(), uBasis);
  const rOrb = aBeamB.w;
  const beamPos = aBeamTop
    .add(beamW.mul(dY))
    .add(uBasis.mul(rOrb).mul(cos(phi)))
    .add(vBasis.mul(rOrb).mul(sin(phi)));
  // 环境路径：体积盒内垂直下落回绕
  const ambientPos = vec3(
    aOrigin.x,
    uVolMin.y.add(modPos(aOrigin.y.sub(uVolMin.y).sub(uTime.mul(fall)), uVolSpan.y)),
    aOrigin.z);
  const base = select(isBeam, beamPos, ambientPos);
  // 值噪声三轴漂移（错频，幅度 ~3.2 世界单位；光柱人口的溢出由 shadow 真值调暗）
  const np = base.mul(0.08).add(vec3(aSeed.mul(91.7)));
  const wander = vec3(
    vnoise3(np.add(uTime.mul(0.11))),
    vnoise3(np.add(31.4).add(uTime.mul(0.09))),
    vnoise3(np.add(57.8).add(uTime.mul(0.13)))
  ).mul(2.0).sub(1.0);
  // 局部位（positionNode 语义 = 局部，经 modelViewMatrix 出视空间；宿主组仅平移，
  // 与旧 GLSL 的 modelMatrix × world 同构）
  const drift = base.add(wander.mul(3.2));

  // vWorld / vTwinkle 走 varying（粒子中心的量，四角共享同一值 = 旧点精灵 varying 语义）
  const vWorld = varying(modelWorldMatrix.mul(vec4(drift, 1.0)).xyz, 'vWorld');
  const vTwinkle = varying(
    float(0.65).add(vnoise3(vec3(aSeed.mul(47.3)).add(uTime.mul(0.6))).mul(0.4)),
    'vTwinkle');

  // shadow 深度纹理：硬件比较采样（r185 shadow 管线给 depthTexture 配
  // LessEqualCompare 比较采样器——与 GLSL sampler2DShadow 同物）。起跑时用
  // 1×1 占位 DepthTexture 建节点，update() 里等 shadow.map 就绪换真纹理——
  // swap 前粒子恒 invisible，占位纹理永不真正绑定。
  const placeholderDepth = new THREE.DepthTexture(1, 1);
  placeholderDepth.compareFunction = THREE.LessEqualCompare;
  const shadowTex = texture(placeholderDepth, vec2(0.0));

  const material = new PointsNodeMaterial({
    // 顶点位移：positionNode = 局部位（见 drift 注）
    positionNode: drift,
    // 点径：像素径由内建衰减「× DPR × (画布高/2) ÷ 视深」补齐（见头注）
    sizeNode: uSize.mul(fract(aSeed.mul(7.7)).mul(0.9).add(0.7)),
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });

  // ---- 片元侧：圆片软边 + shadow 硬件比较采样（无控制流 = 纯表达式）----
  // 旧 gl_PointCoord ≡ 底四边形 uv（0..1）
  const d = length(uv().sub(0.5));
  // WGSL 正向边改写：GLSL smoothstep(0.5, 0.18, x) ≡ 1 - smoothstep(0.18, 0.5, x)
  const alpha = oneMinus(smoothstep(0.18, 0.5, d));
  const sp = uShadowMatrix.mul(vec4(vWorld, 1.0));
  const spP = sp.xyz.div(sp.w);
  // 飞出 shadow 覆盖范围一律按"完全阴影"处理（与 volumetricMoon 同调试实录约定）——
  // 界内/界外用 select（两侧无条件求值，textureSampleCompare 不进非一致控制流）
  const inBox = spP.x.greaterThan(0.001).and(spP.x.lessThan(0.999))
    .and(spP.y.greaterThan(0.001)).and(spP.y.lessThan(0.999))
    .and(spP.z.greaterThan(0.0)).and(spP.z.lessThan(1.0));
  // ⚠ .sample().compare() 返回的是克隆节点——真进 shader 的是它，换纹理必须推
  // 它的 .value（基节点 shadowTex 的 value 不被克隆体跟随）。
  // 阴影采样 y 翻转（铁律⑧：官方 ShadowNode 对 shadowCoord 做 .y.oneMinus()，
  // "follow webgpu standards"——手写阴影采样必须同法，volumetricMoon vmMarch 同口径）。
  const shadowSample = shadowTex.sample(vec2(spP.x, oneMinus(spP.y))).compare(spP.z.add(uBias));
  const lit = select(inBox, shadowSample, float(0.0));
  // 加色混合：rgb 预算 alpha，a=1
  material.colorNode = vec4(mix(uDark, uLit, lit).mul(vTwinkle).mul(alpha), 1.0);

  const points = new THREE.Sprite(material);
  points.geometry = geometry;
  points.name = 'moonDust';
  points.frustumCulled = false; // 盒内回绕 + 噪声漂移，包围球没意义
  points.renderOrder = 60;
  points.visible = false; // shadow map 就绪前不渲染（首帧，由 update 翻开）

  function update(dt, light) {
    uTime.value += dt;
    if (light?.shadow?.map) {
      shadowSample.value = light.shadow.map.depthTexture; // 深度在 depthTexture（color 纹理是垃圾）
      uShadowMatrix.value.copy(light.shadow.matrix);
      points.visible = true;
    } else {
      points.visible = false;
    }
  }

  // 旧返回形状保留（uScale 已被 PointsNodeMaterial 内建衰减接管，存位不再进 shader）
  const uniforms = {
    uTime, uSize, uScale: uniform(540), uVolMin, uVolSpan,
    uShadow: shadowSample, uShadowMatrix, uLit, uDark, uBias,
  };

  return { points, uniforms, update };
}
