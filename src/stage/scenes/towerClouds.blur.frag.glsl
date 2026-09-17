// 雪云 RT 小域可分离高斯模糊（towerClouds 1/4 分辨率降噪第二拍）。
// uTexel = 1/RT尺寸，uDir = (1,0) 横向 / (0,1) 纵向两拍各跑一次；半径 1.5 纹素
// （全分辨率下 ≈6px），只糊掉 raymarch 抖动条带、不糊云的结构。
precision highp float;
varying vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
uniform vec2 uDir;
void main() {
  vec2 o = uTexel * uDir;
  vec4 c = texture2D(uSrc, vUv) * 0.227027;
  c += (texture2D(uSrc, vUv + o * 1.3846) + texture2D(uSrc, vUv - o * 1.3846)) * 0.316216;
  c += (texture2D(uSrc, vUv + o * 3.2308) + texture2D(uSrc, vUv - o * 3.2308)) * 0.070270;
  gl_FragColor = c;
}
