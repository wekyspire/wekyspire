// 雪花片元着色器（towerWilderness 实例化版）：沿飞行方向拉伸的软条 + 距离雾衰减。
// vUv 为四边形 0..1（y 沿飞行方向），vStretch 还原截面圆——拉伸只体现在形状上。
// uFogDensity 与场景 FogExp2 同值同公式（squared exp）——远处雪片自然融雾淡出。
precision highp float;
uniform float uOpacity;
uniform float uFogDensity;
varying float vDepth;
varying vec2 vUv;
varying float vStretch;
void main() {
  vec2 p = vUv - 0.5;
  p.y /= max(vStretch, 1.0);
  float d = length(p);
  float a = smoothstep(0.5, 0.12, d) * uOpacity;
  a *= exp(-uFogDensity * uFogDensity * vDepth * vDepth);
  // 近机淡出：盒随相机锚点平移（相机在盒内），贴脸雪片按屏幕比例放大到巨幅
  // 且可能跨近裁剪面拉花（2026-09-16 用户报"泼水"）——5~14 单位内平滑隐去
  a *= smoothstep(5.0, 14.0, vDepth);
  gl_FragColor = vec4(0.75, 0.77, 0.8, a);
  // 同天空穹：补齐 tone map / sRGB 输出链路，与场景内置材质统一色彩
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
