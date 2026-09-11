// 月光浮尘云（STAGE_DESIGN §2'）：常驻噪音浮尘体积——不是 spawn/死亡型粒子，
// 而是一片常驻尘埃场，全 GPU 驱动：
//   顶点：值噪声三轴漂移（无纹理、无 simplex 依赖，手搓 hash 值噪声）
//         + 逐粒速度差的缓慢下落（盒内回绕）；
//   片元：把世界位置变换进月光 shadow 空间做硬件比较采样（与 volumetricMoon
//         march pass 同约定）——**被月光照亮 → 亮冷蓝；阴影区/飞出 shadow
//         覆盖范围 → 极暗近不可见**。
// 相比旧"沿光路参数化 spawn"方案：浮尘亮暗由 shadow map 真值驱动，与体积光、
// 地面光池天然对齐，不再有"浮尘位置和光束对不上"的错位；阴影区尘埃仍有微弱
// 底色，兼作全场环境浮尘（暗部空气感）。
//
// 密度策略：大部分均匀填满房间体积（环境尘），小部分偏向两条月光柱体积 spawn
// （保证光柱内密度——wander 漂出真实光柱的粒子会被 shadow 采样自动调暗，
// 光束边缘因此是"真值裁切"而非参数近似）。
//
// CPU 侧每帧只推进 uTime + 同步 shadow uniform，零属性回写。
// node 单测可建（无 document 依赖；shadow map 缺席时 points 不渲染，不报错）。

import * as THREE from 'three';

// 浮尘体积盒（世界坐标）：罩住大厅可活动区 + 两扇窗到光池的光柱空间
const VOL_MIN = new THREE.Vector3(-88, -28, -78);
const VOL_MAX = new THREE.Vector3(85, 48, 38);

const VERT = /* glsl */`
  attribute float aSeed;
  uniform float uTime;
  uniform float uSize;    // 点径基准（世界单位）
  uniform float uScale;   // 尺寸衰减基准 = 画布高/2（全局 1080p 假设，定死 540）
  uniform vec3 uVolMin;
  uniform vec3 uVolSpan;
  varying vec3 vWorld;
  varying float vTwinkle;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  float vnoise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash13(i + vec3(0.0, 0.0, 0.0)), hash13(i + vec3(1.0, 0.0, 0.0)), f.x),
          mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
      mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x),
          mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
      f.z);
  }

  void main() {
    // 缓慢下落（逐粒速度差）+ 盒内回绕
    float fall = 0.35 + 0.75 * fract(aSeed * 17.31);
    vec3 base = position;
    base.y = uVolMin.y + mod(position.y - uVolMin.y - uTime * fall, uVolSpan.y);
    // 值噪声三轴漂移（错频，幅度 ~3.2 世界单位）
    vec3 np = base * 0.08 + vec3(aSeed * 91.7);
    vec3 wander = vec3(
      vnoise(np + uTime * 0.11),
      vnoise(np + 31.4 + uTime * 0.09),
      vnoise(np + 57.8 + uTime * 0.13)
    ) * 2.0 - 1.0;
    vec3 world = base + wander * 3.2;
    vec4 wp = modelMatrix * vec4(world, 1.0);
    vWorld = wp.xyz;
    vTwinkle = 0.55 + 0.45 * vnoise(vec3(aSeed * 47.3) + uTime * 0.6);
    vec4 mv = viewMatrix * wp;
    float size = uSize * (0.7 + 0.9 * fract(aSeed * 7.7));
    gl_PointSize = size * uScale / max(1.0, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */`
  precision highp float;
  uniform sampler2DShadow uShadow; // 月光 shadow map 深度纹理（r185 PCF：硬件比较采样）
  uniform mat4 uShadowMatrix;      // light.shadow.matrix（世界 → shadow UV/深度 [0,1]）
  uniform vec3 uLit;               // 被月光照亮：亮冷蓝
  uniform vec3 uDark;              // 阴影区：极暗（加色混合下近不可见，只留空气感）
  uniform float uBias;
  varying vec3 vWorld;
  varying float vTwinkle;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    float alpha = smoothstep(0.5, 0.18, d);
    vec4 sp = uShadowMatrix * vec4(vWorld, 1.0);
    sp.xyz /= sp.w;
    // 飞出 shadow 覆盖范围一律按"完全阴影"处理（与 volumetricMoon 同调试实录约定）
    float lit = 0.0;
    if (sp.x > 0.001 && sp.x < 0.999 && sp.y > 0.001 && sp.y < 0.999 && sp.z > 0.0 && sp.z < 1.0) {
      lit = texture(uShadow, vec3(sp.xy, sp.z + uBias)); // LinearFilter 自带 4-tap 软化
    }
    vec3 col = mix(uDark, uLit, lit) * vTwinkle;
    gl_FragColor = vec4(col * alpha, 1.0); // 加色混合：rgb 预算 alpha，a=1
  }
`;

/**
 * 建月光浮尘云。
 * @param {object} options
 *   count: 总粒子数（ambient + beam 两段人口）
 *   beamRatio: 偏向光柱体积的粒子占比（保证光柱内密度）
 *   beams: [{ origin:Vector3, dir:Vector3(单位), len, radius }] 光柱体积描述
 * @returns { points, uniforms, update(dt, light) }
 *   update 每帧推进时间并同步月光 shadow uniform；shadow map 未就绪时隐藏不渲染。
 */
export function buildMoonDust({ count = 1500, beamRatio = 0.4, beams = [] } = {}) {
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const spanX = VOL_MAX.x - VOL_MIN.x;
  const spanY = VOL_MAX.y - VOL_MIN.y;
  const spanZ = VOL_MAX.z - VOL_MIN.z;
  const beamCount = Math.floor(count * beamRatio);
  const up = new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    seeds[i] = Math.random() * 1000;
    if (i < beamCount && beams.length > 0) {
      // 光柱人口：沿光轴随机 t + 垂直圆盘随机偏移（wander 漂出光柱的由 shadow 采样调暗）
      const beam = beams[Math.floor(Math.random() * beams.length)];
      u.crossVectors(beam.dir, up).normalize();
      v.crossVectors(beam.dir, u).normalize();
      const t = 3 + Math.random() * beam.len;
      const ang = Math.random() * Math.PI * 2;
      const r = beam.radius * Math.sqrt(Math.random());
      positions[i * 3] = beam.origin.x + beam.dir.x * t + (u.x * Math.cos(ang) + v.x * Math.sin(ang)) * r;
      positions[i * 3 + 1] = beam.origin.y + beam.dir.y * t + (u.y * Math.cos(ang) + v.y * Math.sin(ang)) * r;
      positions[i * 3 + 2] = beam.origin.z + beam.dir.z * t + (u.z * Math.cos(ang) + v.z * Math.sin(ang)) * r;
    } else {
      // 环境人口：均匀填满房间体积（阴影区只留极暗底色）
      positions[i * 3] = VOL_MIN.x + Math.random() * spanX;
      positions[i * 3 + 1] = VOL_MIN.y + Math.random() * spanY;
      positions[i * 3 + 2] = VOL_MIN.z + Math.random() * spanZ;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

  const uniforms = {
    uTime: { value: 0 },
    uSize: { value: 1.05 },
    uScale: { value: 540 },
    uVolMin: { value: VOL_MIN },
    uVolSpan: { value: VOL_MAX.clone().sub(VOL_MIN) },
    uShadow: { value: null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uLit: { value: new THREE.Color(0xcfe0ff).multiplyScalar(1.7) },
    uDark: { value: new THREE.Color(0x16203c).multiplyScalar(0.5) },
    uBias: { value: 0.002 },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'moonDust';
  points.frustumCulled = false; // 盒内回绕 + 噪声漂移，包围球没意义
  points.renderOrder = 60;
  points.visible = false; // shadow map 就绪前不渲染（首帧，由 update 翻开）

  function update(dt, light) {
    uniforms.uTime.value += dt;
    if (light?.shadow?.map) {
      uniforms.uShadow.value = light.shadow.map.depthTexture; // 深度在 depthTexture（color 纹理是垃圾）
      uniforms.uShadowMatrix.value.copy(light.shadow.matrix);
      points.visible = true;
    } else {
      points.visible = false;
    }
  }

  return { points, uniforms, update };
}
