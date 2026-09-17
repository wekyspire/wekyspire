// 雪云合成（towerClouds 管线末段）：transmittance composite。
// mesh pass 已渲进 rtScene（linear + 深度）；云 march 输出预乘色 acc 与透射率
// alpha=1-T——本 pass 把二者合成：col = cloudInscatter + scene * T。
// tone map / sRGB 在这里对**整帧**走一遍（mesh 进 RT 时 three 按目标判定不套映射）。
precision highp float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform sampler2D uCloud;
void main() {
  vec4 sc = texture2D(uScene, vUv);
  vec4 cl = texture2D(uCloud, vUv);
  vec3 col = cl.rgb + sc.rgb * (1.0 - cl.a);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
