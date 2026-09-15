// 雪花顶点着色器（towerWilderness）：GPU 常驻粒子——下落 + 风摆 + 盒内回绕，
// CPU 每帧只推进 uTime（moonDust 同范式，零属性回写）。
// 调参位：fall 下落速度区间（6~14）、sway 风摆幅度（1.2~2.8）与频率。
attribute float aSeed;
uniform float uTime;
uniform float uSize;    // 点径基准（世界单位）
uniform float uScale;   // 尺寸衰减基准 = 画布高/2（1080p 假设 540）
uniform vec3 uVolMin;
uniform vec3 uVolSpan;
varying float vDepth;   // 视深（片元做雾衰减：远处雪片融雾淡出，掩盖体积盒边缘）
void main() {
  // 下落（逐粒速度差 6~14 世界单位/秒）+ 盒内回绕
  float fall = 6.0 + 8.0 * fract(aSeed * 17.31);
  vec3 base = position;
  base.y = uVolMin.y + mod(position.y - uVolMin.y - uTime * fall, uVolSpan.y);
  // 风摆：错频正弦水平漂移（x 主摆 + z 副摆）
  float sway = 1.2 + 1.6 * fract(aSeed * 7.7);
  base.x += sin(uTime * (0.5 + fract(aSeed * 3.1)) + aSeed) * sway;
  base.z += cos(uTime * (0.4 + fract(aSeed * 5.3)) + aSeed * 2.0) * sway * 0.6;
  vec4 wp = modelMatrix * vec4(base, 1.0);
  vec4 mv = viewMatrix * wp;
  vDepth = -mv.z;
  gl_PointSize = uSize * (0.6 + 0.9 * fract(aSeed * 11.3)) * uScale / max(1.0, -mv.z);
  gl_Position = projectionMatrix * mv;
}
