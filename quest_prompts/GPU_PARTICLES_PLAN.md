# GPU 粒子系统计划（GPU_PARTICLES_PLAN）

> **状态：已落地（2026-09-27，未 commit）**。实现与本文一致，两处偏差：rejection 尝试
> 8 次（非 4）；发射图集出生点需沿 billboard 法线朝镜头抬 1.6 世界单位（否则圆点被本体
> 深度裁半）。验收：burn3 稀疏 / burn30 存活 89 颗粒喷雾、净化停推残留渐熄、60fps。
> 探针 `tmp/play/probe-gpu-{sparks,iso,ab}.mjs`；排障纪律见 AGENTS.md「GPU 粒子池」。

> 2026-09-27 用户拍板「值得做」：燃烧等 shader 与粒子系统联动——燃烧边缘的活动火焰处
> 释放火星、随风飘散。目标是**纯 GPU Driven 可配置粒子** + 全局入口 + 粒子与 counter
> 数据全程 GPU buffer + GPU 侧生成粒子 metadata。

## 平台现实（先对齐，再动手）

用户描述的形态（compute shader + atomic counter + GPU buffer 直通）是 **WebGPU / GL ES 3.1+**
的能力。本项目渲染链是 **WebGL2**（three.js WebGLRenderer；全仓库 shader 资产是 GLSL：
onBeforeCompile 补丁、体积月光 ray marching、后处理链）。WebGL2 **没有** compute shader、
没有片元/顶点原子计数；three 的 WebGPURenderer 不吃 GLSL（全 TSL），迁引擎 = 重写所有
shader + 后处理链，不在本计划范围（若未来要真 compute，那是「渲染器迁移」级别的独立决策）。

**WebGL2 下的等价物（成熟做法，能力完全覆盖需求）**：

| 需求 | WebGL2 等价实现 |
|---|---|
| compute shader 粒子更新 | **GPGPU ping-pong**：状态纹理（RGBA32F）经全屏 quad 片元 pass 自更新（three 例的 GPUComputationRenderer 模式；我们已有 `post/passes.js` 的全屏 pass 基建） |
| 粒子数据全程 GPU buffer | 位置/速度/寿命/emitter meta 全在纹理里 ping-pong，**CPU 永不读回**；渲染 pass 顶点里 `texelFetch` 同一份纹理直接画（零 CPU 拷贝） |
| atomic counter（GPU 侧分配） | **环形游标（ring cursor）**：每发射器一格的 1×N cursor 纹理，自己的 mini pass 推进，同样 ping-pong 在 GPU；槽位 = 发射器静态分段内的环，回卷即覆盖最旧粒子（稳态天然正确，无需 compaction/原子） |
| GPU 上生成粒子 metadata | **emission atlas**：发射源 shader（燃烧场）每帧把「哪些像素在活动燃烧 + 该处世界坐标」渲进一张小 RGBA16F 图集（每燃烧单位一格）；spawn pass 采样它做随机门控发射——**出生位置/强度 metadata 由 GPU 算出并留在 GPU** |

CPU 唯一做的事：设 uniform（风参数、发射器表、活跃单位矩阵）。这满足「纯 GPU Driven」
的实质——只是 ISA 从 compute 换成片元 pass。

## 架构

```
src/stage/fx/gpu/
├── wind.js           全局风场 uniform 单例（风向/风速/阵风相位；GLSL windField 共享件）
├── gpuParticles.js   全局池：state ping-pong（posLife + velMeta，MRT 一次写两张）
│                     + cursor mini pass + spawn/update 合一 pass + THREE.Points 渲染
│                     + bloom offset 接入（火花可声明起晕）
└── emission.js       发射图集：per-unit 一格（RGBA16F: xyz=世界坐标, w=发射强度），
                      燃烧字段与本体 shader 共用同一份 GLSL（unitBodyFx 抽函数）
```

- **池**：64×64 = 4096 粒子上限；`texA` = (pos.xyz, age01)，`texB` = (vel.xyz, emitterIdx)。
  age01 ≥1 = 死亡（槽位空闲，等环回卷覆盖）。
- **发射器表**（uniform 数组，上限 16）：每发射器 = {池段 start/cap、rate、初速锥、重力、
  风响应系数、ttl、尺寸、颜色（HDR 乘算）}。注册/注销在 CPU（只动 uniform）。
- **渲染**：一次 draw 的 THREE.Points（dummy index attribute → 顶点 texelFetch）；
  additive + depthTest 不 write；soft 圆点 × age 曲线 × HDR；接 `glslBloomOffsetWrite`
  （尾迹起晕走 offset 通道纪律：颜色不过阈拉爆）。
- **风**：`windField(pos, t)` GLSL 共享件——基底风向 + 阵风正弦 + 位置湍流；
  发射器带 windK 响应系数（火星 1.0，后续重烟雾 0.3 之类）。
- **燃烧联动**（首个消费方）：emission atlas 每活跃燃烧单位一格 64×64；
  片元复用 `GLSL_BODY_FX` 抽出的燃烧场函数（charEdge×闪烁 = 发射强度——
  **发射源与本体着色单一事实源**），世界坐标由 `bodyMesh.matrixWorld` 算出
  （姿态 squash/lean 白拿）。burn aura enter/exit 注册/摘除活跃单位。
  spawn pass：随机活跃单位 → 随机 texel → strength 门控（4 次 rejection 尝试）。

## 与既有系统的关系

- CPU `particles/ParticleSystem.js`（一次性爆发：伤害火花/尘）**保留**——短寿命高迸发
  不需要联动，CPU 池已胜任。GPU 池服务**常驻联动发射**（燃烧火星为首例）。
- burn aura 的 `emitter`（CPU 池 rate14）在 GPU 链路就位后摘除，改 `gpuEmit: 'burn'`；
  GPU 不可用（无 EXT_color_buffer_float / headless 无 renderer）回退旧 CPU 路径。

## 验收

- 探针 `tmp/play/probe-gpu-sparks.mjs`：burn 3 vs 30 对照（火星量随燃烧境界）、
  火星是否从**火缘**出生（裁图看亮点分布贴轮廓）、风向偏移、cursor GPU 侧推进读数、
  fps ≥ 55、无 pageerror。
- AGENTS.md 单位特效 bullet 增补 GPU 粒子段；记忆同步。

## 后续扩展（不在本轮）

- instanced quad 拉伸火花（速度方向拉丝）替代 Points——若验收嫌圆点平淡再上。
- 毒雾/凝滞霜尘/血雾等同法接入（emission 各写各的强度场）。
- 房间/塔楼环境粒子（雪、灰烬）迁 GPU 池——风场天然共享。
- 真 compute/atomics：仅当决定迁 WebGPU 渲染器时重议。
