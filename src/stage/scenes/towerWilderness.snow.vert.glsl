// 雪花实例化顶点着色器（towerWilderness，2026-09-16 用户定）：
// **分章双配方**（TOWER.md 四阶段）：uStormAmt=0 一章平静雪（圆片软雪、慢落、微风、
// 无拉伸），=1 雪云阶段急迫斜雪（湍流扭曲 + 沿飞行方向拉伸）。位移积分与速度
// **解析一致且同号**（vel = disp'，拉伸轴因此严格对齐真实运动方向——此前 base 取
// -disp 导致雪片往左飘、拉伸朝右的反向乌龙）。
// 粒子 = 实例化四边形：速度位移向量做长轴、视线叉乘做宽度轴；aSeed 三路随机流
// 派生逐粒出生点（实例无位置属性）。调参位：uFall/uStorm/uStretch/uStormAmt。
attribute vec3 aSeed;   // 实例化：三路独立随机流
uniform float uTime;
uniform float uSize;    // 雪片截面直径（世界单位）
uniform float uStretch; // 拉伸增益（速度单位；storm 配方）
uniform float uFall;    // 下落速度基准（storm 配方，世界单位/秒）
uniform vec2 uStorm;    // 斜风 (x,z)（storm 配方；与云层风同源，JS 侧同源注入）
uniform float uStormAmt; // 配方混合 0=一章平静 1=雪云急迫（MapStage 按层驱动）
uniform vec3 uVolMin;
uniform vec3 uVolSpan;
varying float vDepth;   // 视深（片元雾衰减：远处雪片融雾淡出，掩盖体积盒边缘）
varying vec2 vUv;
varying float vStretch;
void main() {
  float sA = aSeed.x, sB = aSeed.y, sC = aSeed.z;
  // 逐粒出生点（实例无位置属性，从 seed 派生——否则全体挤在原点靠位移扩散）
  vec3 origin = uVolMin + uVolSpan * vec3(fract(sA * 0.731), fract(sB * 0.517), fract(sC * 0.913));
  // 湍流参数（逐粒 x/z 正弦；storm 全幅，calm 收敛到原始配方的慢摆）
  float ampX = (2.2 + 2.0 * fract(sB * 7.7)) * mix(0.6, 1.0, uStormAmt);
  float wX   = (1.9 + 1.3 * fract(sA * 3.1)) * mix(0.35, 1.0, uStormAmt);
  float pX   = sA * 41.0;
  float ampZ = (1.4 + 1.2 * fract(sC * 5.9)) * mix(0.6, 1.0, uStormAmt);
  float wZ   = (1.4 + 1.1 * fract(sB * 5.3)) * mix(0.35, 1.0, uStormAmt);
  float pZ   = sB * 23.0;
  float fall = mix(0.5, uFall, uStormAmt) * (0.7 + 0.9 * fract(sA * 17.31)); // 正值下落速率
  // 速度场（斜风 + 湍流）；位移积分与其**同号一致**（base = origin + disp）。
  // ⚠ 三处符号必须一致：vel.y = -fall（向下）、disp.y = -fall·t。此前 fall 自身
  // 被塞过负号 + disp.y 未跟上 → 速度与位移再次反号，雪片朝右下落、长轴朝右上
  // （视觉即"向左下拉伸"的斜线，2026-09-16 用户报二番）。
  vec2 wind = uStorm * uStormAmt;
  vec3 vel = vec3(
    wind.x + ampX * sin(wX * uTime + pX),
    -fall,
    wind.y + ampZ * sin(wZ * uTime + pZ));
  vec3 disp = vec3(
    wind.x * uTime + (ampX / wX) * (1.0 - cos(wX * uTime + pX)),
    -fall * uTime,
    wind.y * uTime + (ampZ / wZ) * (1.0 - cos(wZ * uTime + pZ)));
  // 盒内回绕（出生点 + 位移后取模；斜风下三轴都回绕）
  vec3 base = origin + disp;
  base.x = uVolMin.x + mod(base.x - uVolMin.x, uVolSpan.x);
  base.y = uVolMin.y + mod(base.y - uVolMin.y, uVolSpan.y);
  base.z = uVolMin.z + mod(base.z - uVolMin.z, uVolSpan.z);
  // 实例四边形：长轴沿飞行方向（storm 拉伸；calm stretch=1 即圆片），宽度轴 = 飞行 × 视线
  vec4 wp = modelMatrix * vec4(base, 1.0);
  float speed = length(vel);
  vec3 vdir = vel / max(speed, 1e-3);
  vec3 viewDir = normalize(cameraPosition - wp.xyz);
  vec3 side = cross(vdir, viewDir);
  side = length(side) < 1e-4 ? vec3(0.0, 1.0, 0.0) : normalize(side); // 逆光共线兜底
  float r = 0.6 + 0.9 * fract(sC * 11.3);
  float halfW = 0.5 * uSize * r;
  float stretch = mix(1.0, clamp(1.0 + uStretch * speed * 0.14, 1.0, 3.5), uStormAmt);
  vStretch = stretch;
  vDepth = -(viewMatrix * wp).z;
  vUv = position.xy + 0.5;
  vec3 world = wp.xyz
    + side * (position.x * 2.0 * halfW)
    + vdir * (position.y * 2.0 * halfW * stretch);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
