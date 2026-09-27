// 程序化夜空穹顶（skydome）：纯 shader 生成，零贴图零外部资产。
// 大球壳 BackSide + MeshBasicNodeMaterial（WebGPU 迁移 TSL 版，2026-09-27，
// 原裸 GLSL shader 逐式平移，范式见 fx/unitBodyFx.js 头注）：
// 地平线暗紫 → 天顶蓝黑的渐变、3D 格 hash 星野（只出地平线以上）、月亮盘 + 广晕。
// 方向采样以**相机位置**为原点（positionWorld - camPos），与球壳中心无关——
// 相机不动但写法正确，日后相机动了也不错位。
// 不投影不受影不吃雾（fog:false / depthWrite:false / renderOrder 最先画）。
// 着色链无控制流 = 纯表达式（hash31 独立成 Fn）；uniform 一律 TSL uniform()
// 节点，对外仍是 `.value` 推值口径（updateSkydome 直推 camPos）。

import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn, uniform, positionWorld,
  vec4, float, mix, fract, floor, dot, step, smoothstep, pow, max,
} from 'three/tsl';

const SKYDOME_RADIUS = 800; // 世界单位；相机 far=2000 之内

// 3D 格 hash（vec3 → 0..1）：三次搅拌，与 GLSL hash31 逐式一致
const hash31 = Fn(([p]) => {
  const q = fract(p.mul(0.1031)).toVar();
  q.addAssign(dot(q, q.zyx.add(31.32)));
  return fract(q.x.add(q.y).mul(q.z));
});

/**
 * 建程序化夜空穹顶。
 * @param {object} options
 *   moonDir: THREE.Vector3 月亮方向（世界，会归一化）
 *   flat: 调试模式（用户定 2026-09）——纯低饱和中调冷蓝直出，方便区分「天空透墙洞」
 *         与「暗墙体」；后续乘 godlight transmittance 的正式版接回完整 shader
 * @returns {THREE.Mesh} 挂进世界场景即可（调用点不判空直调 updateSkydome）
 */
export function buildSkydome({ moonDir = new THREE.Vector3(-0.52, -0.15, -0.84), flat = false } = {}) {
  // uniforms：TSL uniform() 节点（`.value` 推值口径不变）
  const uCamPos = uniform(new THREE.Vector3());
  const uMoonDir = uniform(moonDir.clone().normalize());   // 月亮方向（世界，单位向量）
  const uMoonColor = uniform(new THREE.Color(0xdce8f8));
  const uHorizonColor = uniform(new THREE.Color(0x1a1430)); // 地平线：暗紫
  const uZenithColor = uniform(new THREE.Color(0x04060f));  // 天顶：蓝黑
  const uStarColor = uniform(new THREE.Color(0xbccaf0));
  const uFlatColor = uniform(new THREE.Color(0x4a5a72));    // 调试平色：低饱和中调冷蓝
  const uFlat = uniform(flat ? 1 : 0);

  const mat = new MeshBasicNodeMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });

  // 方向采样：d = normalize(片元世界位 - 相机位)——相机位由 updateSkydome 每帧推入
  const d = positionWorld.sub(uCamPos).normalize();
  const h = d.y;
  // 夜空渐变：地平线（暗紫）→ 天顶（蓝黑）
  let sky = mix(uHorizonColor, uZenithColor, smoothstep(-0.15, 0.55, h));
  // 星野：方向量化 3D 格 hash，稀疏亮点，只出地平线以上
  const cell = floor(d.mul(90.0));
  const rnd = hash31(cell);
  const star = step(0.9965, rnd).mul(smoothstep(0.0, 0.12, h));
  const bright = float(0.5).add(hash31(cell.add(7.7)).mul(0.5));
  sky = sky.add(uStarColor.mul(star).mul(bright));
  // 月亮：角盘 + 广晕
  const ang = dot(d, uMoonDir.normalize());
  const disc = smoothstep(0.99930, 0.99965, ang);
  const halo = pow(max(ang, 0.0), 220.0).mul(0.35);
  sky = sky.add(uMoonColor.mul(disc.add(halo)));
  // 调试平色模式：纯低饱和中调冷蓝直出（区分诊断用）
  sky = mix(sky, uFlatColor, uFlat);
  mat.colorNode = vec4(sky, 1.0);

  const dome = new THREE.Mesh(new THREE.SphereGeometry(SKYDOME_RADIUS, 32, 16), mat);
  dome.name = 'skydome';
  dome.renderOrder = -100; // 最先画（深度不写，永不遮挡）
  dome.frustumCulled = false;
  /** 帧驱动：同步相机位置（方向采样原点 + 球壳跟随——R=800 恒在 far 内，永不裁切）。 */
  dome.updateSkydome = (camPos) => {
    dome.position.copy(camPos);
    uCamPos.value.copy(camPos);
  };
  return dome;
}
