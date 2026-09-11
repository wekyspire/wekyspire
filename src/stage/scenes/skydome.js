// 程序化夜空穹顶（skydome）：纯 shader 生成，零贴图零外部资产。
// 大球壳 BackSide + ShaderMaterial：地平线暗紫 → 天顶蓝黑的渐变、
// 3D 格 hash 星野（只出地平线以上）、月亮盘 + 广晕。
// 方向采样以**相机位置**为原点（vWorldPos - camPos），与球壳中心无关——
// 相机不动但写法正确，日后相机动了也不错位。
// 不投影不受影不吃雾（fog:false / depthWrite:false / renderOrder 最先画）。

import * as THREE from 'three';

const SKYDOME_RADIUS = 800; // 世界单位；相机 far=2000 之内

const VERT = /* glsl */`
  varying vec3 vWorldPos;
  void main() {
    vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */`
  precision highp float;
  varying vec3 vWorldPos;
  uniform vec3 camPos;
  uniform vec3 moonDir;    // 月亮方向（世界，单位向量）
  uniform vec3 moonColor;
  uniform vec3 horizonColor;
  uniform vec3 zenithColor;
  uniform vec3 starColor;
  uniform vec3 flatColor;
  uniform float uFlat;

  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  void main() {
    vec3 d = normalize(vWorldPos - camPos);
    float h = d.y;
    // 夜空渐变：地平线（暗紫）→ 天顶（蓝黑）
    vec3 sky = mix(horizonColor, zenithColor, smoothstep(-0.15, 0.55, h));
    // 星野：方向量化 3D 格 hash，稀疏亮点，只出地平线以上
    vec3 cell = floor(d * 90.0);
    float rnd = hash31(cell);
    float star = step(0.9965, rnd) * smoothstep(0.0, 0.12, h);
    float bright = 0.5 + 0.5 * hash31(cell + 7.7);
    sky += starColor * star * bright;
    // 月亮：角盘 + 广晕
    float ang = dot(d, normalize(moonDir));
    float disc = smoothstep(0.99930, 0.99965, ang);
    float halo = pow(max(ang, 0.0), 220.0) * 0.35;
    sky += moonColor * (disc + halo);
    // 调试平色模式：纯低饱和中调冷蓝直出（区分诊断用）
    sky = mix(sky, flatColor, uFlat);
    gl_FragColor = vec4(sky, 1.0);
  }
`;

/**
 * 建程序化夜空穹顶。
 * @param {object} options
 *   moonDir: THREE.Vector3 月亮方向（世界，会归一化）
 *   flat: 调试模式（用户定 2026-09）——纯低饱和中调冷蓝直出，方便区分「天空透墙洞」
 *         与「暗墙体」；后续乘 godlight transmittance 的正式版接回完整 shader
 * @returns {THREE.Mesh} 挂进世界场景即可
 */
export function buildSkydome({ moonDir = new THREE.Vector3(-0.52, -0.15, -0.84), flat = false } = {}) {
  const uniforms = {
    camPos: { value: new THREE.Vector3() },
    moonDir: { value: moonDir.clone().normalize() },
    moonColor: { value: new THREE.Color(0xdce8f8) },
    horizonColor: { value: new THREE.Color(0x1a1430) }, // 地平线：暗紫
    zenithColor: { value: new THREE.Color(0x04060f) },  // 天顶：蓝黑
    starColor: { value: new THREE.Color(0xbccaf0) },
    flatColor: { value: new THREE.Color(0x4a5a72) },    // 调试平色：低饱和中调冷蓝
    uFlat: { value: flat ? 1 : 0 },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(SKYDOME_RADIUS, 32, 16), mat);
  dome.name = 'skydome';
  dome.renderOrder = -100; // 最先画（深度不写，永不遮挡）
  dome.frustumCulled = false;
  /** 帧驱动：同步相机位置（方向采样原点 + 球壳跟随——R=800 恒在 far 内，永不裁切）。 */
  dome.updateSkydome = (camPos) => {
    dome.position.copy(camPos);
    uniforms.camPos.value.copy(camPos);
  };
  return dome;
}
