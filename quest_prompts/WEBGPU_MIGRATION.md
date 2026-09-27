# WebGPU 迁移方案（2026-09-27 研究定稿；同日按用户修正改为「一把梭」形态）

> 裁决（用户 2026-09-27）：**迁**。理由——视觉复杂度持续增长，WebGL2（≈GLES 3.0）的天花板
> （无 compute / 无 SSBO / 无 atomic）会让后续开发越来越难，存量越大越难迁。
> 兼容性不设防（目标 = 较新桌面设备）。

> **形态修正（用户 2026-09-27 二轮指令，取代初版「TSL 先行、backend 后切」的保守桥）**：
> 1. **一把梭**：W1 直接把默认渲染器切成 WebGPU 后端；`forceWebGL` 只由 `?forceWebGL=1`
>    在**验收对照**时触发。不维护长期双后端并行。
> 2. **WebGL 兼容逻辑是验收 reference，生产最终全部去除**（W6 摘尽，含 tslGate 本身）。
> 3. 端侧不支持 WebGPU → **加载界面兼容性检查阶段永久卡住**（进不了开始界面）。
> 4. **中间态「缺特效」「崩坏」完全接受**——这是一次完整版本迭代，不要求中间结果可用
>    （能编译只是为了方便验证）。GLSL 件用 tslGate 隔离（返回空件/降级路径），逐件
>    TSL 化翻真，全翻真后闸门文件与 WebGL 分支整体删除。
> 5. **compute 化范围扩大**：不止粒子系统，一切适合 compute 的 shader 都重写
>    （候选：粒子三件套 / 风场 / 燃烧 emission / volumetricMoon raymarch）。

## 一、关键事实（spike 实测，非纸面推演）

| 事实 | 证据 |
|---|---|
| headless Chromium **裸启动即有 WebGPU，且走真卡**（NVIDIA ampere，非 SwiftShader）——browserHarness 验收链存活 | tmp/play/spike-webgpu.mjs：requestAdapter/Device 成功，compute wg 256、storage buffer 128MB |
| **TSL 双后端成立**：同一份 TSL 代码在 WebGPU 后端与 `forceWebGL`（WebGL2）后端渲染结果像素级一致——验收对照的方法论基础 | tmp/play/spike-webgpu2.mjs |
| three r185 自带 WebGPU 全家桶：`three/webgpu` + `three/tsl` 入口；`nodes/gpgpu/` 有 **ComputeNode / AtomicFunctionNode / SubgroupFunctionNode** | node_modules 实证 |
| TSL 后处理原语齐备：PassNode / ViewportTextureNode / ViewportDepthTextureNode + 成品 BloomNode | 同上 |
| WGSL 顶点 stage 禁 `textureSample`，只能 `textureLoad`——TSL 侧 `texture().load(ivec2)` 已验证可行 | spike 2 |
| **onBeforeCompile 在两后端下静默失效**（不调不炸）；**裸 ShaderMaterial = 报错 + 渲成黑洞**——所以 GLSL 件必须隔离，不能放任 | tmp/play/spike3-legacy-mat.js |
| `three` 与 `three/webgpu` 共享 three.core.js 单例——混用 import 无 instanceof 分裂 | node_modules 包结构 |

**import 策略**：存量 `from 'three'` 全部不动；renderer 处 `import { WebGPURenderer } from 'three/webgpu'`；
TSL 从 `three/tsl`。无需 vite alias。`build.target: 'es2022'`（顶层 await；门槛远低于 WebGPU 自身门槛）。

## 二、存量盘点

**零成本层（~80 处）**：MeshBasicMaterial / Lambert / Standard / PointsMaterial——内建材质
three 自带 WebGPU 实现。CanvasTexture 富文本烘焙与渲染器无关，不动。

**重写层（GLSL → TSL，~15 件）**：

| 组 | 件 | 复杂度 |
|---|---|---|
| 本体补丁（onBeforeCompile） | unitBodyFx / cardBodyFx / charBurn / ParticleSystem | 中——范式转换点（字符串补丁 → 节点组合），静默失效所以其实不隔离也"只是没效果" |
| 后处理链 | post/passes + bloomChain + uiComposer + fx/bloomOffset | 中高——多 RT 调度、深度共享、bloom offset 双 pass 技法（官方 BloomNode 表达不了「FX 主动声明起晕权重」，选惯用法平移） |
| 特效叠加件 | bodyFlames / stasisShell / stunStars / vaporPlumes / CardFxLayer(veil/edgeGlow) / cardTransform | 中——裸 ShaderMaterial 直译，fbm/SDF 公式平移 |
| 场景 shader | skydome / moonDust / towerClouds / towerWilderness / volumetricMoon | volumetricMoon 最重（raymarch + temporal EMA + 共享深度 RT）——W5 候选 compute 化 |
| GPGPU | gpu/gpuParticles + burnEmission + wind | **重构**（不是直译）：片元 pass → ComputeNode + storage buffer + atomic 游标 |

**不动层**：core / bridge / shell / 观战链路（wire 描述符在动画指令层，与渲染器解耦）。

## 三、分阶段计划

- **W1 渲染壳 + 隔离（✅ 已完成并验收 2026-09-27）**：StageManager 换 WebGPURenderer
  （async `init()` + THREE.Timer）；App.vue 兼容性预检门（`probeWebGpuAdapter`，不过则
  AssetLoadingScreen 永久卡「不支持 WebGPU」）；`src/stage/fx/tslGate.js` 集中开关表
  隔离全部裸 GLSL 件（返空件/降级路径）；`?forceWebGL=1` 验收对照口。
  **验收结果**：headless WebGPU **60.2fps 真卡**（头号风险排除）、战斗现场单位/卡牌/UI 全可见、
  无迁移相关 console error（预期降级：无夜空/云/体积光/冷却膜/bloom）。
- **W3 本体补丁三件（✅ 已完成并验收 2026-09-27）**：onBeforeCompile → TSL 节点组合。
  立下的范式：① uniform = TSL `uniform()` 节点，对外 `.value` 推值口径不变，调用点零改动；
  ② 材质创建点换 Node 材质类（MeshBasic/Standard/LambertNodeMaterial）；
  ③ `colorNode = Fn(...)(texture(material.map, uv()))` 全量接管 diffuse
  （base = materialColor × map，顶点色由 NodeMaterial 自动后乘）；
  ④ map 异步落地的材质走 `rec.rebind()`（setArt/_setBakedFace 调用），同构图命中 program
  缓存只换纹理绑定；⑤ **If/Discard 必须在 Fn 栈内**（顶层调 = 「null.If」崩）；
  ⑥ WGSL smoothstep 反向边 indeterminate——GLSL 反向写法一律改正向 + oneMinus。
  验收：燃烧/中毒/焚毁/禁用/高亮五效果截图 + 数值量化全对，60fps 保持，零 console error。
  已知语义差（记录在案）：charBurn 炭黑改为吃顶点色（NodeMaterial 顶点色后乘），视觉等价。
- **W4 特效件 + 场景 shader**：逐件 TSL 化翻真（veil/edgeGlow/cardTransform/bodyFlames/
  stasisShell/skydome/moonDust/towerWilderness/volumetricMoon）。范式立后可并行。
- **W2 后处理链重搭（✅ 逻辑与性能已闭环 2026-09-27，视觉攒批验收待用户）**：
  passes/bloomChain/uiComposer/bloomOffset/volumetricMoon 惯用法平移完成。
  **新踩出的铁律（⑦-⑪，后续一切 RT/多 pass 件照办）**：
  ⑦ **本后端渲出的 RT，采样必须 V 翻转**——WebGPU 帧缓冲原点左上（WebGL 左下），
  `passes.js` 导出 `passUV = vec2(uv().x, oneMinus(uv().y))`；NDC 重建/屏幕空间计算
  仍用 `uv()`（跟随片元 NDC 朝向）。官方 QuadGeometry 的 uv 恰好 v=0 在屏顶（天然无翻转）。
  ⑧ **阴影采样 y 翻转**——官方 ShadowNode.js 对 shadowCoord 做 `.y.oneMinus()`，
  手写阴影采样（vmMarch/moonDust）必须同法，否则整屏泛白。
  ⑨ **一个 DepthTexture 不得挂两个 RenderTarget**——后端按 RT 缓存渲染通道描述符，
  失效判据只含 width/height/samples 不含深度纹理身份；共享深度会让第一个 RT 永久
  引用已销毁纹理（每帧 GPUValidationError）。替代 = 各持深度 + depth-only 预填
  （bloomOffset.js 的 depthPrepass 模式）。
  ⑩ **MSAA samples>0 与 depthTexture 不兼容**（depth attachment sample count 校验错）——
  volumetricMoon rt 与 uiComposer rt 均降 samples 0（UI 卡边 AA 暂失，终版如需补 FXAA）。
  ⑪ **相机层掩码会过滤灯光收集**（projectObject 的 layers.test）——偏移 pass 只开
  BLOOM_LAYER 时灯组为空，lightsNode 动态缓存键 ≠ 主渲 → 同一张材质跨 pass 反复
  needsUpdate → renderObject/管线每帧销毁重建（**4fps 病灶**，WGSL 逐字节相同也救不回来，
  stage 缓存随释放清空）。修法 = 偏移 pass 期间把灯临时挂上 BLOOM_LAYER
  （renderBloomOffsetPass 内置，两 composer 同享）。
  ⑫ **非透明 NodeMaterial 片元末段被强制 `DiffuseColor.w = 1.0`**（opaque_fragment
  约定，probe-cloudgal9 实测 WGSL 铁证）——任何把数据放进 alpha 通道的 RT pass
  （如云 march 的透射率）必须 `makeFullScreenPass(node, { keepAlpha: true })`
  （transparent=true + blending=NoBlending），否则 RT alpha 恒 1，composite 的
  `sc·(1−cl.a)` 恒 0（塔楼全黑病灶，2026-09-27）。
  ⑬ **tone map + sRGB 的唯一落点 = 渲染器帧末输出 blit；任何代码不得临时改
  renderer.toneMapping**（flavor A，2026-09-27 用户定，取代 W2 旧规矩「节点内
  tone + 终段临时摘 NoToneMapping」）。机制：渲屏幕（renderTarget=null）的
  render() 在「tone≠None 或 outputColorSpace≠working」时自动走内部 HalfFloat
  FB target，帧内多条渲屏幕 pass 顺序汇入同一 FB（首 pass autoClear 清底、后续
  pass autoClear=false 线性叠加），**帧内最后一次渲屏幕的 blit 按当时 toneMapping
  对整帧施加一次变换**——旧规矩的摘除窗口会被末段 blit 继承，把先前 pass 的世界
  内容 tone 整帧冲掉（probe-blit 实测塔楼画布 = sRGB(FB) 无 tone）。现行三链
  （volumetricMoon/uiComposer/towerClouds）终段全部只出线性 HDR，节点内 tone 库
  （tslApplyTone/tslToneNeutral/tslToneAces）已删，曲线 = three 内置
  NeutralToneMapping（与旧手译版同式），调参唯一口 = `applyToneMapping(renderer,
  mode, exposure)`（StageManager.attach 设一次；gallery 的 ?tm= knob 同走此口）。
  附带观感差（记录在案）：UI 与世界的混合从旧「各自 tone 后混合」变为「线性混合
  后统一 tone」——卡牌叠亮背景处物理上更正确。验证：三场景「FB vs 画布」判决
  tone 恰一次（probe-flavora/2：塔楼/房间均值逐值命中、战斗逐像素 max 残差
  0.86/255）；**均值判决只在均匀区有效**——tone 非线性，E[tone(x)] ≠ tone(E[x])，
  有亮物混入的采样区必须逐像素对照。
  配套落地：**纹理延迟销毁器** `src/stage/deferredDispose.js`——换图即 dispose 在
  WebGPU 下会让仍在飞的 submit 携带已销毁纹理（WebGL 由驱动引用计数兜底，WebGPU 没有
  安全网），旧纹理排队 3 帧后由 StageManager tick 末尾统一落刀；UnitObject(×4)/
  ApCoinObject(×2)/CardObject(×1) 换图点已切换。
  验收数：战斗链 60fps、自然链路（异步立绘换图 + 出牌 + 过回合）零 GPU 错误、
  截图朝向/阴影正确。
- **W5 compute 化**：gpuParticles/burnEmission/wind 三件套重构（storage buffer + atomic
  游标，上限 4096 → 64K+）；**并评估一切适合 compute 的 shader**（volumetricMoon raymarch
  为首要候选）。
  - **评估结论（2026-09-27）**：volumetricMoon/towerClouds 的 raymarch 都是「逐像素独立 +
    单 RT 写出」的全屏片元工作，compute 化的收益点（workgroup 共享内存、跨像素协作、
    灵活早退）它们都用不上——保持片元 pass。真正的 compute 收益件就是粒子三件套
    （状态自更新 + 动态计数 + 高上限），其余件（wind 场函数、burn emission 图集）
    随三件套一并消化。
- **W6 摘 WebGL**：tslGate 文件与全部 `TSL_READY` 分支、forceWebGL 分支、WebGL fallback
  路径整体删除；生产加载门定稿。

## 四、风险与未验证点

1. ~~headless WebGPU 帧率~~——**已验：60.2fps 满帧**（W1）。
2. **TSL 表达力死角**：discard / 自定义 blend / MRT / 深度读都有对应节点（已查证），
   但每件落地时仍要 spike（尤其 volumetricMoon 的「共享深度纹理 + 多 pass」）。
3. **编译耗时分布变化**：WGSL 编译 + TSL 转译的入场成本未知，charBurn 预热类策略要重验。
4. **three 版本锁定**：WebGPU 线 API 漂移快——锁 r185，升级必过全量探针。
5. **调试工具链退化**：Spector 不可用——harness 截图/A/B 差分方法论反而更重要。

## 五、不做的事

- 不手写 WGSL（全部走 TSL，单一源码源——`?forceWebGL=1` 的验收对照能力也来自 TSL 双后端）。
- 不动 core/bridge/shell/观战（渲染器切换严格局限在 stage 层）。
- 不引入 bindless 依赖（binding 上限够当前需求，subgroups 等可选 feature 用到再申请）。
- 不在迁移期改视觉设计（W1-W4 零回归；compute 解锁的新效果留给 W5 之后的迭代）。
