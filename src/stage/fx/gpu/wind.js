// 全局风场（GPU 粒子的环境驱动，WebGPU compute 化 原 GLSL 共享件重写）：
// uniform 单例 + TSL 共享 Fn——所有 GPU 粒子发射器经 windK 系数响应同一阵风。
// v1 = 常量微风 + 阵风调制 + 位置湍流；后续接房间预设/天气时只改 uniform 值，
// 粒子 compute pass 与（未来的）旗帜/雪共用同一份风，全场飘动方向天然一致。
// 铁律照办：uniform = TSL uniform() 节点（.value 读写口径与旧 `{ value }` 表一致，
// 调用侧感知不到差别）；Fn 内无控制流，纯表达式，不涉 If/Loop 栈限制。
import * as THREE from 'three';
import { uniform, Fn, vec3, float, sin, cos } from 'three/tsl';

/** 风参数 uniform 单例（xz 平面风向 / 基准风速 / 湍流幅度）。 */
export const gpuWind = {
  uWindDir: uniform(new THREE.Vector2(0.88, 0.47)), // 模长并入强度，未单位化
  uWindSpeed: uniform(2.4),
  uWindGust: uniform(1.5),
};

/**
 * TSL 共享件：windField(世界坐标, 秒) → 瞬时风力（含阵风与湍流）。
 * 与旧 GLSL windField 逐式一致，compute 与（未来的）顶点侧都可调用。
 */
export const windField = Fn(([p, t]) => {
  // 阵风：两个不可约频率相乘，强弱交替不机械
  const g = float(0.55).add(
    sin(t.mul(0.9).add(p.y.mul(0.15))).mul(sin(t.mul(0.53).add(1.7))).mul(0.45));
  const base = vec3(gpuWind.uWindDir.x, float(0.0), gpuWind.uWindDir.y)
    .mul(gpuWind.uWindSpeed.mul(g));
  // 湍流：位置相关扰动——火星/灰烬飘散的「碎」感来源
  const turb = vec3(
    sin(p.y.mul(0.45).add(t.mul(1.7))).add(sin(p.z.mul(0.30).sub(t.mul(1.1)))),
    sin(p.x.mul(0.35).add(t.mul(1.3))).mul(0.4),
    cos(p.x.mul(0.40).add(t.mul(1.5))).add(cos(p.y.mul(0.25).sub(t.mul(0.9))))
  ).mul(gpuWind.uWindGust.mul(0.5));
  return base.add(turb);
});
