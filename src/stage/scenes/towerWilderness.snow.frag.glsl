// 雪花片元着色器（towerWilderness）：软圆白点 + 距离雾衰减。
// uFogDensity 与场景 FogExp2 同值同公式（squared exp）——远处雪片自然融雾淡出。
precision highp float;
uniform float uOpacity;
uniform float uFogDensity;
varying float vDepth;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.15, d) * uOpacity;
  a *= exp(-uFogDensity * uFogDensity * vDepth * vDepth);
  gl_FragColor = vec4(0.95, 0.97, 1.0, a);
  // 同天空穹：补齐 tone map / sRGB 输出链路，与场景内置材质统一色彩
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
