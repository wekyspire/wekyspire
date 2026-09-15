// 天空穹片元着色器（towerWilderness）：上灰蓝 → 地平线雪白的渐变。
// 调参位：smoothstep 两端（0.56=雾带顶、0.92=天顶渐入）与 uTop/uBottom（JS 侧
// towerWilderness.js 头部 SKY_TOP/SKY_BOTTOM 注入，uBottom 与 FogExp2 雾色同源）。
precision highp float;
uniform vec3 uTop;
uniform vec3 uBottom;
varying vec3 vLocal;
void main() {
  // 归一化用半径与 JS 侧 DOME_RADIUS = 900 同值（改半径时两处一起动）
  float h = clamp(vLocal.y / 900.0 * 0.5 + 0.5, 0.0, 1.0);
  // 地平线雾带压平：浓雾天观感——下半球到略高于地平线整段都是雾白
  // （与 FogExp2 融掉的远端雪原无缝相接），往上才 smoothstep 渐入天顶灰蓝
  float t = smoothstep(0.56, 0.92, h);
  vec3 col = mix(uBottom, uTop, t);
  gl_FragColor = vec4(col, 1.0);
  // 自定义 ShaderMaterial 不会自动过内置材质自带的 tone map / sRGB 输出链路，
  // 底色（=雾色）与被雾融的雪原对不上屏——补齐同一条输出链路（编译期 chunk 展开）
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
