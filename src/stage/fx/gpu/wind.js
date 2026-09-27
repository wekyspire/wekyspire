// 全局风场（GPU 粒子的环境驱动，GPU 粒子系统 2026-09-27）：
// uniform 单例 + GLSL 共享件——所有 GPU 粒子发射器经 windK 系数响应同一阵风。
// v1 = 常量微风 + 阵风调制 + 位置湍流；后续接房间预设/天气时只改 uniform 值，
// 粒子 update pass 与（未来的）旗帜/雪共用同一份风，全场飘动方向天然一致。
import * as THREE from 'three';

/** 风参数 uniform 单例（xz 平面风向 / 基准风速 / 湍流幅度）。 */
export const gpuWind = {
  uWindDir: { value: new THREE.Vector2(0.88, 0.47) }, // 模长并入强度，未单位化
  uWindSpeed: { value: 2.4 },
  uWindGust: { value: 1.5 },
};

/** GLSL 共享件：windField(世界坐标, 秒) → 瞬时风力（含阵风与湍流）。 */
export const GLSL_WIND = /* glsl */`
uniform vec2 uWindDir;
uniform float uWindSpeed;
uniform float uWindGust;
vec3 windField(vec3 p, float t) {
  // 阵风：两个不可约频率相乘，强弱交替不机械
  float g = 0.55 + 0.45 * sin(t * 0.9 + p.y * 0.15) * sin(t * 0.53 + 1.7);
  vec3 base = vec3(uWindDir.x, 0.0, uWindDir.y) * (uWindSpeed * g);
  // 湍流：位置相关扰动——火星/灰烬飘散的「碎」感来源
  vec3 turb = vec3(
    sin(p.y * 0.45 + t * 1.7) + sin(p.z * 0.30 - t * 1.1),
    0.4 * sin(p.x * 0.35 + t * 1.3),
    cos(p.x * 0.40 + t * 1.5) + cos(p.y * 0.25 - t * 0.9)
  ) * (uWindGust * 0.5);
  return base + turb;
}
`;
