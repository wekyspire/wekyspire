// 雪云体积片元（towerClouds）：简单 raymarch + 多重散射 ambient 近似。
// 视线由顶点侧插值的四角射线外推（vRay 对 vUv 线性——大三角形越界区域外推同样正确）。
// 云体 = 2 倍频各向异性 Worley 噪音场（用户定：worley 生成云层），uCloudTime 步进
// advect + 双速视差模拟风中滚动。云板按 y 求交：相机在云下看底面 / 云内环视外望 /
// 云上俯瞰三种关系同一条路径（t0=max(0,入场) 处理内部视角，TOWER.md 二/三阶段）。
// 输出**线性空间**预乘色（RT 为 HalfFloat）：合成在穹顶 shader 里做，tone map/sRGB
// 只在穹顶链路走一遍（RT 不编码——与 r185 雾语义约定一致）。
precision highp float;
varying vec2 vUv;
varying vec3 vRay;

uniform vec3 uCamPos;
uniform float uCloudTime;
uniform vec2 uCloudWind;      // 风场 (x,z) 世界单位/秒（噪音场 advect 速度）
uniform float uCloudBase;     // 云板底 y
uniform float uCloudTop;      // 云板顶 y
uniform float uCloudScale;    // worley 基准频率（世界单位 → 单元尺度 1/scale 的倒数）
uniform float uCoverage;      // 覆盖度 0..1（门槛越低云越满）
uniform float uDensity;       // 消光峰值（每单位）
uniform float uStepSize;      // raymarch 步长（世界单位）
uniform float uHaze;          // 距离雾化系数：远云融进天空（防 RT 结果与雾带脱节）
uniform vec3 uSkyTop;
uniform vec3 uSkyBottom;
uniform vec3 uFogColor;       // 场景 FogExp2 雾色（JS 侧共享实例）——远云融雾的色调源
uniform vec3 uSunDir;         // 月/日光方向（world，指向光源）
uniform float uSunAmt;        // 银边强度
uniform float uMaxSteps;      // 步数上限（调参位）
// ---- detail 侵蚀 + 独立随风 offset 场（2026-09-16 用户定）----
uniform float uDetailAmt;     // 细节侵蚀强度（边缘絮条化，核心保留）
uniform float uDetailFreq;    // 细节场空间频率（per单元世界单位）
uniform float uWarpAmt;       // offset 场域扭曲幅度（世界单位）
uniform float uWarpFreq;      // offset 场频率
uniform float uGustBoost;     // 云内阵风倍率（相机在云内时 detail/warp advect 加速）
uniform float uInnerStepScale; // 云内步长收紧倍率（近场细节更密，用户定特调）
// ---- 场景深度（正确遮挡：march 到几何面终止，云内俯视云在地面/塔身之前）----
uniform sampler2D uSceneDepth; // mesh pass 深度（全分辨率，线性化后 = 沿视线的几何距离）
uniform float uCamNear;
uniform float uCamFar;
uniform mat4 uCamWorldInv;     // 相机世界逆矩阵（世界射线 → 视空间射线）
// ---- 测试点光（用户定 2026-09-16：云内无光照灰成一坨——先挂相机前方测试灯试渲染
// 质量；正式版塔楼挂灯的位置/参数由 stage pass-in 替换这个口子）----
uniform vec3 uLanternPos;
uniform vec3 uLanternColor;
uniform float uLanternIntensity; // 0 = 关（云外 JS 侧自动熄灯，光 march 整段跳过）
// ---- 近机密度减淡（用户定 2026-09-16：靠近相机的云经验性变薄，露出中距离的
// detail/erosion 云体形态；t 即样本沿视线到相机的距离，直接做平滑压低）----
uniform float uNearFadeStart;  // 减淡起点（单位，此距离内压到最低）
uniform float uNearFadeEnd;    // 减淡终点（此距离外完全不衰减）
uniform float uNearFadeAmt;    // 近场残余密度比例（0 = 近场全透明）
// ---- 云下仰视压暗（用户定 2026-09-16：一章从下看云层整体暗一点，云底背光）----
uniform float uUnderShade;     // 相机在云板下时的云体系数（1 = 不压暗）

const float PI = 3.141592653589793;

vec3 hash3(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453);
}

// Worley F1 反相（billow：单元中心亮=云团）。27 邻域标准实现。
float worleyBillow(vec3 q, float cell) {
  vec3 f = q / cell;
  vec3 i = floor(f);
  vec3 fr = fract(f);
  float d = 1e9;
  for (int x = -1; x <= 1; x++)
  for (int y = -1; y <= 1; y++)
  for (int z = -1; z <= 1; z++) {
    vec3 g = vec3(float(x), float(y), float(z));
    vec3 o = hash3(i + g);
    vec3 r = g + o - fr;
    d = min(d, dot(r, r));
  }
  return 1.0 - clamp(sqrt(d), 0.0, 1.0);
}

// 云密度场：2 倍频 worley（细层以 0.35 倍风速漂移 → 层间剪切=滚动感）+ 垂直剖面
// （云底平齐、中段最厚、顶缘碎散）。返回 >0 的"过门槛密度"，0 = 空气。
// 注意：调用方先把采样点经 warpOffset 域扭曲——本函数只管 base 形状。
float cloudField(vec3 p) {
  vec3 adv = vec3(uCloudWind.x, 0.0, uCloudWind.y) * uCloudTime;
  vec3 q = p + adv;
  float w = 0.62 * worleyBillow(q, uCloudScale)
          + 0.38 * worleyBillow(q * 2.6 + vec3(31.7, 11.3, 7.7) + vec3(uCloudWind.x, 0.0, uCloudWind.y) * uCloudTime * -0.65, uCloudScale);
  float hr = clamp((p.y - uCloudBase) / max(1.0, uCloudTop - uCloudBase), 0.0, 1.0);
  float profile = smoothstep(0.0, 0.16, hr) * (1.0 - smoothstep(0.68, 1.0, hr));
  float d = w * profile - (1.0 - uCoverage);
  return max(d, 0.0);
}

float g_gust = 1.0;   // 云内阵风倍率（main 按相机是否在云板内置位，避免穿参）

// 值噪音（quintic 插值 8 角）——perlin 通道的便宜实现，fbm 后观感一致
float hash1(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash1(i), hash1(i + vec3(1, 0, 0)), u.x),
        mix(hash1(i + vec3(0, 1, 0)), hash1(i + vec3(1, 1, 0)), u.x), u.y),
    mix(mix(hash1(i + vec3(0, 0, 1)), hash1(i + vec3(1, 0, 1)), u.x),
        mix(hash1(i + vec3(0, 1, 1)), hash1(i + vec3(1, 1, 1)), u.x), u.y), u.z);
}

// 细节侵蚀场：**perlin + worley**（用户定），独立于主场的更快随风 advect——
// 高频絮条以错速扫过云体 → 云内视角读作薄纱掠面
float detailField(vec3 p) {
  vec3 q = (p + vec3(uCloudWind.x, 0.0, uCloudWind.y) * (uCloudTime * 1.45 * g_gust)) * uDetailFreq;
  return 0.62 * vnoise(q) + 0.38 * worleyBillow(q + vec3(11.3, 5.1, 8.7), 1.35);
}

// 独立随风 offset 场：**perlin + worley**（用户定）——主场采样点被它水平推着走。
// 云内视角 g_gust 加速 → 阵风脉冲 + 薄纱层掠过的大风感；wo y 分量为 0（风是水平的）。
vec3 warpOffset(vec3 p) {
  vec3 q = (p + vec3(uCloudWind.x, 0.0, uCloudWind.y) * (uCloudTime * 0.85 * g_gust)) * uWarpFreq;
  float wx = vnoise(q) - 0.5;
  float wz = vnoise(q + vec3(23.7, 11.9, 5.3)) - 0.5;
  float gust = worleyBillow(q * 0.73 + vec3(3.1, 17.3, 9.7), 1.21) - 0.55; // 阵风脉冲通道
  return (vec3(wx, 0.0, wz) + vec3(gust * 0.35, 0.0, -gust * 0.28)) * uWarpAmt;
}

float hgPhase(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * c, 1.5));
}

// 光 march 用的密度场 lite 版：单倍频 worley + 剖面（27 tap）。完整场的 warp/detail
// 对遮蔽贡献是二阶的，光 march 每样本省下 100+ tap。
float cloudDensityLite(vec3 p) {
  vec3 adv = vec3(uCloudWind.x, 0.0, uCloudWind.y) * uCloudTime;
  float w = worleyBillow(p + adv, uCloudScale);
  float hr = clamp((p.y - uCloudBase) / max(1.0, uCloudTop - uCloudBase), 0.0, 1.0);
  float profile = smoothstep(0.0, 0.16, hr) * (1.0 - smoothstep(0.68, 1.0, hr));
  return max(w * profile - (1.0 - uCoverage), 0.0);
}

// 光 march（点光）：朝灯 4 步粗采样密度场，返回光学深度（未乘消光系数）。
// 点光只被「灯与样本之间」的云遮蔽——步进上限 = min(灯距, 40)。
float lightMarch(vec3 p, vec3 L, float distL) {
  float stepL = min(distL, 40.0) / 4.0;
  float od = 0.0;
  for (int i = 1; i <= 4; i++) {
    od += cloudDensityLite(p + L * (stepL * float(i))) * stepL;
  }
  return od;
}

// 多重散射近似（Schneider multi-octave，实时渲染惯用；用户描述的「更 smooth 的
// phase + 指数衰减后的光强」即第 2+ 档=间接光估计）：od = 朝光光学深度，每档
// 消光衰减 a、贡献衰减 b、相位平滑 c——低档 = 锐银边直接光，高档 = 包绕的间接光。
float multiscatter(float od, float cosT) {
  float sum = 0.0;
  float a = 1.0, b = 1.0, c = 1.0;
  for (int i = 0; i < 3; i++) {
    sum += b * exp(-od * a) * hgPhase(cosT, 0.55 * c);
    a *= 0.25; b *= 0.55; c *= 0.4;
  }
  return sum + 0.06; // 常数底：多次散射的最低保证，防死黑
}

// 云板与视线求交；相机在板内时 t0 = 0（内部环视），t1 ≤ 0 = 背离云板（无交）。
bool slabRange(vec3 ro, vec3 rd, out float t0, out float t1) {
  float span = max(1.0, uCloudTop - uCloudBase);
  if (abs(rd.y) < 1e-4) {
    if (ro.y <= uCloudBase || ro.y >= uCloudTop) return false;
    t0 = 0.0; t1 = span * 64.0;
    return true;
  }
  float ta = (uCloudBase - ro.y) / rd.y;
  float tb = (uCloudTop - ro.y) / rd.y;
  t0 = min(ta, tb);
  t1 = max(ta, tb);
  if (t1 <= 0.0) return false;
  t0 = max(t0, 0.0);
  return t1 > t0;
}

// 场景几何沿射线的距离：深度纹理线性化（three packing 同式）→ 视距 → 除以视线
// 方向的 -z 分量得到欧氏 t。天空像素深度=1 → 距离=far（不截断）。
float sceneRayDist(vec2 uv, vec3 rd) {
  float d = texture2D(uSceneDepth, uv).x;
  float viewZ = (uCamNear * uCamFar) / ((uCamFar - uCamNear) * d - uCamFar);
  vec3 rdView = (uCamWorldInv * vec4(rd, 0.0)).xyz;
  return -viewZ / max(1e-4, -rdView.z);
}

void main() {
  vec3 rd = normalize(vRay);
  vec4 outc = vec4(0.0);
  float t0, t1;
  if (slabRange(uCamPos, rd, t0, t1)) {
    // 场景遮挡：几何在云板入点之前 → 本像素云全遮；几何在板内（云内俯视地面/
    // 塔身）→ march 到几何面为止（transmittance 只累积到面前）
    float tScene = sceneRayDist(vUv, rd);
    if (tScene <= t0 + 1e-3) { gl_FragColor = vec4(0.0); return; }
    t1 = min(t1, tScene);
    // 云内阵风：相机在云板内 → detail/warp 场 advect 加速（大风 + 薄纱扫动，用户定）
    float inside = (uCamPos.y > uCloudBase && uCamPos.y < uCloudTop) ? 1.0 : 0.0;
    g_gust = mix(1.0, uGustBoost, inside);
    // 云内步长收紧（用户定特调）：近场细节更密；密度积分/抖动/截断同用有效步长
    float effStep = uStepSize * mix(1.0, uInnerStepScale, inside);
    t1 = min(t1, t0 + 40.0 * effStep * 8.0);     // 掠射射线距离截断（步数上限兜底）
    // 抖动起步 + 半分辨率 + 后端 blur → 步进条带不可见
    float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    float t = t0 + jitter * effStep;
    float T = 1.0;
    vec3 acc = vec3(0.0);
    float cosSun = dot(rd, uSunDir);
    float phase = mix(hgPhase(cosSun, 0.55), hgPhase(cosSun, -0.25), 0.55) * uSunAmt;
    int steps = int(uMaxSteps);
    for (int i = 0; i < 64; i++) {
      if (i >= steps || t >= t1 || T < 0.02) break;
      vec3 p = uCamPos + rd * t;
      vec3 pw = p + warpOffset(p);            // 独立随风 offset 场推着主场走
      float d = cloudField(pw);
      if (d > 0.001) {
        // 细节侵蚀：高频 perlin+worley 从云体上"啃"出絮条——边缘（d 小）啃得多、
        // 核心保留，薄纱即侵蚀殆尽的残絮（advect 错速独立扫动）
        float det = detailField(p);
        float eroded = max(d - det * uDetailAmt * (1.0 - min(d * 2.4, 1.0)), 0.0);
        if (eroded > 0.001) {
          float depthT = clamp((p.y - uCloudBase) / max(1.0, uCloudTop - uCloudBase), 0.0, 1.0);
          // 环境项（天空 ambient，无探针闭式）：板内越高越亮 + 越稀薄越透光
          float lit = clamp(0.32 + depthT * 0.62 + (1.0 - min(eroded * 1.7, 1.0)) * 0.38, 0.0, 1.0);
          vec3 c = mix(uSkyBottom * 0.58, uSkyTop * 1.32, lit * 0.75 + depthT * 0.25);
          c *= mix(0.78, 1.14, det); // 细节明暗调制：絮条/空洞写进颜色（不止 alpha），中距离形态可读
          // 点光直接光 + 多重散射间接估计（光 march；灯在云外时强度=0 整段跳过）
          // 近机减淡：近场样本自己贡献的遮蔽也同比例压低（浓度整体变薄，形态保留）
          float nearFade = smoothstep(uNearFadeStart, uNearFadeEnd, t);
          float densityScale = mix(uNearFadeAmt, 1.0, nearFade);
          vec3 toL = uLanternPos - p;
          float distL = length(toL);
          float atten = uLanternIntensity / (1.0 + distL * distL * 0.02);
          if (atten > 0.002) {
            vec3 L = toL / max(distL, 1e-3);
            float od = lightMarch(p, L, distL) * uDensity * densityScale;
            c += uLanternColor * atten * multiscatter(od, dot(rd, L));
          }
          c += vec3(0.9, 0.93, 1.0) * phase * (0.25 + lit * 0.75); // 月光银边（原 ambient 项）
          float a = 1.0 - exp(-eroded * densityScale * uDensity * effStep);
          acc += c * (a * T);
          T *= 1.0 - a;
        }
      }
      t += effStep;
    }
    // 远云融雾（用户定：融进**体积雾色调**，不融进天空盒）——只把颜色 lerp 到雾色，
    // 透射率不衰减（alpha 保留 = 远云是雾色云堤，不露出背后的天空渐变）。
    // 公式与场景 FogExp2 同形（平方指数，uHaze 语义 = 云雾等效密度，由
    // towerWilderness 随雾密度同步缩放）：远云堤在与地面全雾**同距离**处同步全融，
    // 地/云/穹面融成同一条暗雾带（2026-09-16 用户报地平线亮带）。
    // ⚠ 雾色必须以**预乘**形式进合成（composite = cl.rgb + scene·(1−cl.a)）：acc 本身
    // 预乘，融雾若裸写雾色，「远处没云 alpha≈0」的像素会输出满强度雾色叠在穹顶上
    // = 雾色被记两次（雾+穹底 ≈ 2×亮度）——地平线上方一圈幽灵亮带的真凶
    // （红色雾探针实测：alpha≈0 行 rgb=满红 + 穹底透出，2026-09-16）。
    float far = 1.0 - exp(-t0 * t0 * uHaze * uHaze);
    // 云下仰视压暗：跨云底 smooth 过渡（爬升穿板不瞬跳），只压云体散射、融雾色不动
    float under = mix(uUnderShade, 1.0, smoothstep(uCloudBase - 10.0, uCloudBase + 4.0, uCamPos.y));
    outc = vec4(mix(acc * under, uFogColor * (1.0 - T), far), 1.0 - T);
  }
  gl_FragColor = outc;
}
