# 粒子系统 v2（PARTICLE_SYSTEM_V2）——模块化 compute 粒子底座（2026-09-28 讨论定稿）

> 目标：把现有「单一用途燃烧火星池」（`fx/gpu/gpuParticles.js`，W5 已 compute 化）升级为
> 可长期生长的粒子底座。本文是结构设计定稿；玩法级效果设计另起文档。
>
> 用户已定决策（讨论沉淀，勿翻案）：
> 1. **类型懒注册 + 场景切换清预算**：粒子类型（type）全局登记、首次使用才分配显存段；
>    每类型固定 cap、占连续显存；场景切换 `pool.reset()` 全释放。同场景预计 ≤16 种。
> 2. **两类粒子**：简单粒子 = uber shader 参数化（一条 dispatch 罩全池）；复杂粒子 =
>    提供 JS→TSL 模块函数，独立编译、独立 dispatch（只管自己的段）。
> 3. **alive 计数 GPU 权威**（本期必做）：atomic 计数表，出生/死亡精确增减。
> 4. burst 本期 = CPU 游标跳变 helper（过渡件），GPU 化 spawn 请求队列排后期。
> 5. UI 空间 = 同一运行时类的第二个池实例（锚点直接用 UI 坐标，零换算）。
> 6. CPU 粒子池（`fx/particles.js`）随本系统接管一次性爆发后退役，W6 删。
> 7. retarget（飞行途中换锚点）本期不做，但排期（见 §八）。
>
> 项目铁律沿用：不手写 WGSL（一切 TSL，保住 `?forceWebGL=1` 对照能力）；three 锁 r185。

## 〇、前置 spike 结论（2026-09-28，tmp/play/spike-atomic.mjs）

TSL `storage(attr,'uint',N).toAtomic()` + `atomicAdd/atomicSub` 在 WebGPU compute 语义全对：
跨 dispatch 保序、条件加、`atomicAdd` 返回旧值（未来 GPU 槽位分配可用）。读回走
`renderer.getArrayBufferAsync`（异步，仅探针/生命周期调度用，生产路径不读回）。

## 一、分层

```
L0 运行时壳    buffer 池 + pass 调度（renderer.compute 单次提交保序）+ 全局钟 uniform
L1 属性布局    分块字段表（只许尾部追加，永不重排——Niagara 属性分配纪律的最小形态）
L2 pass 链     spawn → update → present（渲染色/尺寸回填；跨 dispatch 才有可靠 RAW）
L3 行为模块    JS 函数 → TSL 节点；声明读写字段块 + 采样的数据接口 + 参数
L4 数据接口    锚点表（本期）/ 3D 向量场纹理（排期）/ 空间网格（P2 排期）
L5 渲染外观    present recipe（progress 口径）+ 材质 builder（点精灵/拉伸 quad…）
```

## 二、L1 属性布局（每粒子，POOL_N = 16384）

| 块 | 内容 | 写者 |
|---|---|---|
| core | pos.xyz+age01 / vel.xyz+seed（2×vec4） | spawn/update |
| payload | anchorIdx+domainU+domainV+自定义（1×vec4） | spawn |
| custom | 2×vec4 空槽（复杂类型向注册表申领 offset） | 复杂类型自己 |

渲染 attribute（present pass 写、片元读，STORAGE|VERTEX 双用途——fragment 直读 storage
返回黑的后端怪癖已定案，此通道是标准化解法）：aColor(vec4) / aMisc(size, fade, …)。

## 三、类型系统（L2/L3 的骨架）

**类型描述符**（全局注册表，懒分配前不占显存）：

```js
registerType({
  name, space: 'world' | 'ui',
  cap,                       // 段容量（固定，分类预算）
  kind: 'uber' | 'custom',
  // uber：全参数行（spawn/行为/终结/渲染全参数化）
  spawn: { rate, ttl, vel, velJit, spread, ... },
  behavior: { gravity, drag, windK,
    destination: { anchorIdx, domainMode, steerDelay, steerRamp, steerK, arriveR, curveK } | null },
  endMode,                   // 见 §五
  progressMode,              // 见 §五
  render: { size, colorRamp, blending... },
  // custom：模块函数，独立编译独立 dispatch（spawn+update 一体，可覆写 present）
  custom: { buildUpdate(ctx), buildPresent?(ctx), fields? },
})
```

**段分配器**：bump 分配（`nextSlot += cap`），场景内不回收；`reset()` 全清（场景切换调用）。
Σcap > POOL_N 直接报错（容量账摆明处，不静默截断）。类型表 GPU 行 32 槽/池：
`{start, cap, kind/uberManaged, spawn 参数…, behavior 参数…, render 参数…}`（约 10×vec4）。
逐粒子归属 = 分段线性扫描（≤16 活跃段，同现版发射器扫描，一份循环同时产出段内 local
下标供 spawn 窗口用——不往粒子里存 typeIdx）。

**dispatch 拓扑**：uber 一条 update dispatch 罩全池（`uberManaged=0` 的段在 shader 内跳过）；
每个 custom 类型自己的 dispatch 只派生 `[start, start+cap)`。present 一条统一 pass
（custom 类型可覆写写同一渲染 attribute，不冲突）。

## 四、锚点表（L4 本期唯一件，目的地模块的地基）

- 32 槽/池 storage buffer；行 = `{type, alive, p0.xyz, p1.xyz, params…}`（2×vec4）。
- 三种求值器（uber 的 destination 模块内分支）：**线段**（p0→p1，域内参数 u）/
  **实心矩形**（中心+半尺寸，u,v）/ **实心圆形**（中心+半径，u,v 或 r,θ）。
- CPU 管理器：`addAnchor(desc) → idx` / `removeAnchor(idx)` / 每帧整表重写
  （32×8 float，与 packEmitters 同量级，不做脏标记账）。
- 粒子存**域内参数**不存世界点：锚点移动 = 行更新，目标点每帧现算，平滑追踪零跳变。

## 五、目的地模块与生命周期（uber 能力，需求族：汇聚/流向/吸收类特效）

**destination 参数块**（uber 类型行内）：`anchorIdx`（-1 = 无目的地，模块空转）、
`domainMode`（0 均匀随机 / 1 出生序均布 / 2 边缘偏置——矩形=周长、圆=圆环带）、
`steerDelay`（出生多少秒后开始汇聚 = 爆散相位时长）、`steerRamp`（汇聚强度 0→1 渐入）、
`steerK`（arrive 增益）、`arriveR`（到达半径）、`curveK`（侧向弯曲：初速垂直分量随
汇聚进度衰减，轨迹是弧线不是直线）。

**终结模式 endMode**（目的地引入后寿命不可预知，ttl 降级为保险丝）：

```
0 ttl                纯寿命到期（无目的地类型默认）
1 arrive             进入 arriveR 即终结
2 ttlOrArrive        先到先得（目的地类型常用默认）
3 lingerAfterArrive  到达后驻留（贴锚点跟随），ttl 到期终结
```

- 模式 1/2/3 的 ttl = 最长飞行/驻留硬上限（防 steerK 过弱/锚点不可达 → 槽位泄漏）。
- **锚点先死**（行 alive=0）→ 当帧起退化为模式 0，剩余 ttl 走完自然消散。
- **progressMode**（present 曲线口径，跟着 endMode 走）：
  `0 ageProgress = age/ttl`（ttl 主导）｜`1 distanceProgress = 1 - dist/dist0`
  （目的地型：出生记 dist0，接近目标时尺寸收/颜色沉——到达即死也不生硬，免去 dying 态）。

## 六、GPU 权威 alive 计数（本期必做）

- `aliveCounts` storage buffer：u32 × 32 类型槽，atomic 视图。
- **出生**：spawn pass `atomicAdd(count, wasAlive ? 0 : +1)`——环形覆盖活槽 = 死一个生一个，
  净零；覆盖死槽 = +1。覆盖语义下账目依然精确。
- **死亡**：update pass 逐粒跃迁检测（上帧 age∈[0,1) 且本帧越界）→ `atomicSub(count, 1)`，
  每粒子恰在死亡帧扣一次。
- **消费**：① `onDrained(typeId, cb)` 生命周期 API（burst 全灭 → 放锚点/接下一拍演出，
  异步读回 128B，落后 1-2 帧无妨）；② 调试探针（发射 N 后 alive+N、静置后归零）；
  ③ 未来 GPU spawn 门控/间接派发留位不接线。
- 场景 reset：CPU 整表写零（与段释放同刻）。

## 七、burst 与 spawn 的演进线

本期：burst = CPU 游标跳变 helper（`burst(typeId, n)`，游标 +n 当帧覆盖 n 槽出生），
明确过渡件。排期（下一期）：CPU 写 spawn 请求队列（storage ring），consume pass 用
每类型 atomic 游标拉取分配——`atomicAdd` 返回旧值已 spike 验证可用。本期把 spawn 窗口
逻辑收在单个函数内（`spawnWindow(typeRow, frame)` 形状），届时整体替换，行为栈无感。

## 八、retarget（排期，本期不做）

需求 = 飞行途中把粒子改派到另一个锚点。预案：**锚点行的别名间接层**——粒子 payload 存
aliasIdx，别名表每槽存当前 anchorIdx；retarget = CPU 改别名行（一处写全体跟随），
不动逐粒子数据。触发条件：首个需要「群体换目标」的效果出现时做（预计伴随空间网格 P2
或之后的演出编排需求）。

## 九、存量迁移与退役

- **燃烧火星**（现 gpuParticles 唯一消费者）：迁为 custom 类型（spawn 带 burnEmission
  条目表采样 = 自定义出生逻辑的首个实例），update 走参数等价物。
- **CPU 池一次性爆发**（伤害火花等）：逐个迁 GPU burst 类型，迁完 W6 删池。
- forceWebGL/headless：新池 `create` 返回 null，调用点静默无粒子（验收对照组缺装饰
  特效，可接受——迁移文档既定口径）。

## 十、验收方法

- 探针：atomic 计数读回做时序不变量断言（burst N → alive+N；静置 ttlMax → 归零；
  onDrained 触发时点）；`debugReadState` 全池扫描退役为计数表读回。
- 视觉：A/B 差分（BLOOM_LAYER 开关两帧 diff 查可见性）+ glm-flash 帧验收；
  演出时点用 monkey-patch 探针对齐连拍（2026-09-28 踩坑集方法）。
- 首个消费者（试金石）：**资源消耗汇聚特效**——魏启/AP 扣费时资源条爆散（类型 A 纯爆散）
  + 汇聚流（类型 B：domainMode=1 均布、steerDelay、curveK、onArrive→endMode 2）沿线段/
  矩形锚点收进卡牌边缘，onDrained 接卡牌发动演出。纯 uber 参数化拼出——拼不出说明
  参数块缺维度，补表字段不动骨架。
