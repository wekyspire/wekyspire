# 主线推进与演出节拍链路·结构调研与重构设计（v2.2，2026-10-14）

> 分支 `k3-refactor`。范围 = **游戏主线运作逻辑推进**（run 编排）与**前端动画节拍播放**（sequencer + presenter + 节拍表 + 飞行/特写演出）。
> 方法：全量精读（约 8000 行）+ 两路静态扫描（bug 修复史考古、散落模式盘点）+ 三轮设计讨论（§六）+ 第一轮对抗审查与六疑点裁决（三个独立评审代理，2026-10-13，§九存档）+ 用户三点修订（2026-10-14：协议边界判据 / 标签认可 / 显示标量通道）。
> 状态：v2.2 定稿候选。审查轮继续（议程 = §七）；§九.3 余项有异议随时推翻，无异议按默认执行。

---

## 一、现状骨架（事实记录）

### 1.1 一条战斗指令的一生

```
Core 内核结算（同步，瞬时完成全部逻辑）
  → presenter.damage/heal/... （bridge/presenter.js）
      = anim(事件) + syncState() 两拍，按方向定次序（效果类先演后同步/入场类先同步后演/离场类先飞后同步）
  → runSequencer.enqueueInstruction（core/anim/sequencer.js，run 级唯一共享队列）
      tags/waitTags 依赖定序，默认严格串行；durationMs = 墙钟保险丝（ANIM_TIMING ≥5 倍余量）
  → frontendBus.emit(anim:*)（start 时机由队列决定）
  → BattleStage._direct → ANIM_BEATS 表（battleBeats.js）→ _xxxBeat 宿主方法
  → gsap / StageAnimator / fx 协程 播演出
  → finish() 回执（总线事件）→ sequencer.finish → 泵起后续
```

配套状态面：
- **两套状态设计**：后端即时结算；前端显示状态只在 `ANIM_STATE_SYNC` 节拍推进（快照**入队时**捕获）。`_snapshotSeq` 单调守卫丢弃过期快照。
- **DisplayModel**：卡的 zone 唯一状态面，`setZone` 单门。
- **reconcile 单消费口**：`_applySnapshot → reconcile()`。

### 1.2 一条 run 层动作的一生

```
玩家点击 → Stage 上行意图（dispatchPanelIntent 表）
  → runController / runMachines / runCutsceneFlows / runShowcase 处理器
      · 单飞锁守卫（8 处布尔锁）+ gameStage 守卫（40+ 处 if-return）
      · core 原语结算（同步落账）
      · notify() 手工调用（星型下行，55 处）
      · 演出链：void async 链或回调接力 + FuseBag 保险丝 / 轮询关锁 / 「播成功才记已播」重试位
  → 切幕经 cutscene.sceneTransition（黑幕中点 = dismissModals + swap + 阶段迁移）
```

### 1.3 量化事实

- **Bug 考古（2026-08-01 → 10-13）**：约 63 个独立修复事件，8 类根因。高复发：特写/选卡族 **11 次**；面板路由+快照驱动族 6 次；z 层序 6 次；相机链 5 次；保险丝治理 5 次；卡牌飞行/换面 5 次；队列重入/单飞锁 3 次。
- **散落模式**：单飞锁 8 + 回执位/pending 旗 7 + 舞台/套件忙旗 ~8 + 状态守卫 40+；墙钟挂点 ~23；无上限轮询 2；异地 resolve 7 + 同型句柄 5；void 链 17；notify 手工调用 55。
- **分层纪律**：Stage 直读 run/battleState 0 处；Shell 直访 Stage 私有 1 处（runController.js:180 `_deckChip`）；gameStage 写点 core 14 + shell 1（runDebug 硬重置）；setStage 6 处全在 runController。
- ⚠ 审查轮指出量化数字有抽样失真例（gameStage 写点实数 14 非文档初稿的 12）——**当验收基线用前须脚本复核一遍**。

---

## 二、深层结构判定（bug 族的共同根）

1. **双时钟**：演出真值由帧驱动，正确性兜底押墙钟（~23 处）。帧饥饿时保险丝抢杀演出（`004ab22`/`212e98f`）。缺统一「演出时间」概念。
2. **队列缺属主/取消/幂等身份**：陈旧剧本重弹、幽灵舞台守卫、8 把单飞锁 + 2 处无上限轮询 + 7 处异地 resolve皆其补偿；消费者还要扫队列内部猜未来（`_skillDisplay` 三口径，battleBeats/cards.js:249-253）。
3. **状态三面 + 对账时机只有口头纪律**：契约只写「显示态何时可写」，没写「要非显示真相时读什么」（缺 fence 式读取）；run 层 55 处手工 notify 边沿触发。
4. **「core 已结算、表现晚兑现」无事务模型**：最高发族（11 次）。
5. **舞台路由谓词六处平行**：审查轮实证 App.vue:266-278（查 gameStage）与 runController.js:587（不查）此刻就给出不同答案。
6. **微任务接力**（lastContent/`setTimeout(0)`/`.box :key`）是全链路最脆一环。

---

## 三、健康面（明确不动）

1. 两套状态设计与 sync 节拍（presenter 三类次序、入队时捕获、seq 单调守卫）。
2. bridge 战斗链收敛结构（markDirty → stateSync → 单一 sync 节拍 → reconcile 单口）。
3. DisplayModel zone 单门；卡对象与战斗同寿命。
4. Stage 基础设施（ANIM_BEATS 表、panelHost、stagePickerKit、Picker）。
5. 切台权收敛 + gameStage 迁移权在 core。
6. sequencer 的 tags/waitTags 依赖模型。

---

## 四、目标范式（v2.1：三轮讨论收敛 + 第一轮审查修订）

**总原则：决策流归 core，表现编排归前端一个扩展过的 sequencer，舞台只留连续交互态。**

### 4.1 三层职责

| 层 | 职责 | 权威什么 |
|---|---|---|
| **core（后端）** | 决策流：问句/应答协议；全部主线状态迁移 | 玩法与推进；**单飞是结构性质**——等答案时不发第二问 |
| **前端 sequencer** | 全部「闸流程」的表现 + 状态应用；FIFO + 标签代数；owner/取消；跨度闸门 | 演出秩序 + 显示状态折叠点 |
| **舞台本地** | 连续交互态（hover/拖拽/瞄准/tooltip） | 输入手感 |

事件总线 = 「大决策」运输层（core 发语义事件，前端答玩家选择）。core 从不等演出。

### 4.2 sequencer 扩展词汇表

1. **tags 可退出 `'all'` 的机制能力**（唯一代数改动；sequencer.js:50 现硬编码自动加 `'all'`）。两个用途：
   - **span**（跨度闸门专用 tag，见 5）——强制需要；
   - **ambient**（不带 `'all'`、不拦默认等待者）——**仅约定不实现**（审查轮裁决：零消费者，进 P1 即死代码）。ambient 的迁移触发条件 = P4a 落地、idle 闸门不再读 uiBusy 之时，画廊（唯一双满足「不闸流程 + 需协调」的候选，三处手搓协调点已核实）入队为第一条 ambient 指令。
   - **waitTags 组合规则（审查轮补，必须成文）**：waitTags 显式给出会**替换**缺省 `['all']`——span-gated 指令的真实需求是 `waitTags: ['all', 'battle-span']`（既等前序串行节拍、又等闸门），只写 `['battle-span']` 会与在途切幕并行起跑。
2. **owner + cancelByOwner**；**cancel ≠ abandon（审查轮关键修正）**：
   - `cancel` = 收呈现不收账（对齐现状 dismissModals 语义：picker.close 不触发 onSkip，尾款由重入兜底）；
   - `abandon` = 放弃应答（独立动词，仅显式调用）；
   - `cancelByOwner('modal')` 一律映射问句 `defer`（悬置重入），**永不映射 forfeit**——否则「切幕时机不巧 = 玩家被迫弃奖」，行为回归。
   - **owner 指派规则成文**：跨层存活指令（BATTLE_END 尾闸，presenter.js:70-79）不得挂舞台属主，否则拆台连终局闸门一起吃掉。
3. **finish 带回值**：签名 `finish(id, { result, reason = 'manual' })`（reason 通道必须保留——timeoutCount 是 fuzz 最强断言）。**两个镜像点同步**：sequencer.js:40-42 总线监听、broadcast.mjs:108 tap 的 finish 签名。**纪律：问句答案若要过线（未来观战），走 backendBus 语义事件 payload（WIRE_END_GATE 先例），finish 回执永不上 wire**——wire 是入队时刻单向 tap，完成事件在线上不存在。
4. **状态载荷 + apply-point**（`'start' | 'end'`；fuse 强杀也落地载荷）。战斗内 anim+sync 不合并；**边界成文**：payload-apply 管队列内新指令，idle-gated notify 管队列外写点——两条状态通道的管辖边界写死，防止「三面变四面」。
5. **跨度闸门（幽灵指令）**：战斗开始入队、BATTLE_END 回执、`tags: ['battle-span']` 不带 `'all'`。**保险丝选型（审查轮推翻原设计）**：既不是「队列无活动」心跳（玩家长考时队列必然排空 = 100% 误报，误杀方向是战后演出**战中提前解闸**，比墙钟误杀更糟），也不是 rAF 帧心跳（闸门链路是内核事件驱动，不依赖渲染帧；后台标签停摆是合法场景）。正确选型 = **语义谓词保险丝**：`battle 存活 ∧ 未结束 ∧ 无 pendingInput ∧ 队列除闸门外排空` 持续 **2000ms × 3 拍（≈6s）** 引爆，无绝对上限，后台免疫；谓词形与 P0 静止态断言器同构，**并入 P0 基建不设独立机制**；引爆计入 timeoutCount（fuzz 0 断言自动成为回归门）。备用方案：无保险丝（泄漏面 = BATTLE_END 丢失时战后演出不播，彼时游戏已崩在别处）。
6. **心跳保险丝（flightWatchdog 原义）**：泛化为 `fuse: 'wall' | 'heartbeat'`，heartbeat = **演出进展计数**（ticker 拍数递增才续命），缺省 wall 零迁移。**点名禁用**：拿 `finishReasons`/队列活动计数当心搏源 = 重蹈「队列无活动」覆辙。

### 4.3 core 问句协议（v2.1 事实修正版）

- **协议边界判据（2026-10-14 用户定）**：core flow 只收「对可存档核心态产生修改」的逻辑；表演层 → 核心层的数据**全都是用户能影响核心态的应答**。可证伪测试 = **交互前后存档字节是否不同**：点老虎机推近（zoom）存档不变 → 纯表现层交互留在前端（表现层自有交互可达性所有权——推近才弹操纵 UI 是既有惯例）；拉动拉杆（扣费/挂奖项）存档变了 → 上行 core。核心层 → 表演层 = 演出指令（语义事件）。
- **先例盘点（审查轮修正）**：core 发起问句的先例**只有 battle requestInput 一个**（core/instructions/input.js:9 族 = selectCards/selectHandCard/selectDeckCard/confirm）；事件房是「shell 收集、core 结算」不是 core 发问。`abandon` 是本设计**新加**的动词。协议不是「推广已两次验证的模式」，是「以一个先例为底、新增 abandon 与重呈现两条语义」。
- **问句形状**：既有族 candidates 是 uniqueID 口径；run 层问句多为选项列表择一（训练模式/粉碎什么/进阶维度/老虎机多选一）。**成文豁免一个 `selectOption` 类**（options: [{id, label, …}]），除此之外不发明第二种形状。
- **abandon 三态（按问句定义声明）**：
  - `defer`（悬置重入，**缺省**）：切幕取消一律映射此态；
  - `forfeit`（兑现放弃）：仅显式调用；`pendingCardRemoval` 的「恢复即作废」先例（saveRestore.js:44）显式声明为 `onRestore: 'forfeit'`；
  - `forbidden`（无放弃路径）：恶魔 roll（钱已到手，bank.js:317-319）、pendingUpgrade（卡已入 deck）——abandon 对这类 = **默认选项兜底结算**（事件流 catch 路径 choices[0] 先例）。
- **弃局 dispose**：随检查点回滚（真实档房内中途本就不落盘，问句随世界消失——现状语义保留）。
- **读档恢复 = 重发问句**（审查轮补的机制需求）：调试档恢复出 slotPending/pendingRoll 时，UI 若改为事件驱动呈现，必须「恢复即重发问句事件」，否则恢复出的问句永不呈现 = 软锁。
- **义务门收编**：slotPending/shopPending/pendingRoll 的离房门从 shell/stage 收进 core 的 completeRoom（问句持有者与门同源才有 fuzz 覆盖；现 headless 靠 engine.mjs:1129 手动挡）。
- **红利改写（审查轮修正）**：机器流今天就可 headless 驱动（engine.mjs 已直驱全部 core 房间 API）——协议的真实收益是**结构化单飞 + 事件化重呈现 + abandon 语义**，不是「新增可 fuzz 性」。
- **特写 dismiss 的隐式应答废除**（审查轮发现的行为修正）：现状老虎机奖品特写被切幕收掉时走 `_onDismissShow` = slotTake(null) 替玩家收下——同一次切幕「选卡悬置、特写收下」两头不一致；改为 defer。

### 4.4 前端薄适配器（runAdapter）+ stageDirector

- 双向适配（语义事件 → 指令入队；玩家输入 → 决策应答）+ 吸收 runPresenter flush。
- 舞台路由（inputStage/panelStage/fxServices/dismissModals）从 stageDirector 一处派生。
- **transitionStage 单一入口（疑点 5 裁决并入）**：全部「阶段迁移 + notify + 换台」必须经 `transitionStage(migrate)`（起幕 → 中点 migrate+notify+换台 → 揭幕），调用方绕不掉——「迁移压黑幕中点」的 **19 个记忆点**（13 处调用 + 6 条配套纪律）收敛成 1 个入口。

### 4.5 分级与不做

- P4 分档：4a = run 级 idle-gated notify（**须定义 notify 最大延迟**——idle 化会扩大「面板旧值」窗口，与演出期输入仲裁叠加的体感劣化要评估）；4b = 状态完全指令化（见 §八.5 裁决）。
- ambient 只定约定（§4.2.1）。
- anim+sync 不合并。
- **不做第二调度器**：一切排序只用 FIFO + 标签；无优先级、无抢占框架；唯一「抢占」= cancelByOwner。
- 不上 TS。
- **wire 本地词汇纪律**：owner/finish-result/apply-point 三词不过线——写进 wire.js 头注；战斗侧一旦用到这三个词，观战重放静默分叉。

### 4.6 run 层显示标量通道（2026-10-14 新增，用户金币演出需求驱动）

**需求**（用户举例）：获得金币演出 = 屏幕中央金币串 → 玩家点击 → 金币缩小 → 粒子飞向顶栏计数 → **粒子抵达后数字才 +1**。核心问题「数字何时变」与 battle「卡牌飞进坟堆计数才 +1」是同一条规则——**core 值即时结算，显示值在队列节拍推进**（两套状态设计的既有答案，扩展覆盖面而非新机制）。

最小形态三件事：
1. P1 状态载荷词汇（§4.2.4）：指令带显示增量（如 `{money: N}`），apply-point `'end'`；
2. 接收端改读显示态：顶栏金币等 HUD 标量不再直读 `run.player.money`，改读显示值；演出翻成 FIFO 三连（金币特写[人工闸门] → 粒子飞行[定时] → 落地应用载荷），多奖励排队天然按序折叠；
3. **空闲对账**：队列空闲或指令被 cancelByOwner（换台）时，显示值贴回 core 值——自愈性，演出中断不留永久不同步。

**边界（与 P4b 的分界）**：标量通道管「叶子值 + 单消费控件」，便宜、逐个迁；面板/场景重建（panelSnapshot → 三舞台复合重建）**不进此通道**，维持 notify + idle 闸 + transitionStage 单一入口——把复合重建塞进队列才是 P4b 的大工程与延迟风险所在。迁移策略：按演出需求拉动（金币演出 = 第一个消费者），不预先全量铺。

---

## 五、执行批次（v2.1 修订）

| 批 | 内容 | 消灭的 bug 族 | 风险 | 验收（v2.1 加硬） |
|---|---|---|---|---|
| **P0** | 静止态断言器（含 span 闸门语义谓词保险丝）+ wire 流 A/B 回放 + fuzz 扩展 run 级 | —（防护层） | 无 | 断言器现状 30 分钟零误报；谓词保险丝后台标签长考不误报 |
| **P1** | sequencer 词汇表：owner/cancel（**cancel 与 abandon 分开**）、finish 带值（**含 broadcast tap 镜像同步**）、tags 退出 'all' + span 闸门（谓词保险丝）、heartbeat 保险丝原义泛化。**ambient 不进** | 幽灵舞台、陈旧剧本、帧饥饿误杀 | 低 | 单测 + fuzz timeoutCount==0 + **broadcast 观战回放冒烟**（tap 是鸭子类型复刻，必须同步长出新方法） |
| **P2** | core 问句逐交互迁移。**顺序改为 shop 先行**（单问句最简）→ slot（形状见 §八.6）→ devour（双问句链最难）→ training → bank → event/ascension 收尾；每迁一个删对应 shell 锁 | 单飞锁泄漏、队列纪律族 | 中 | 每交互：wire A/B + 锁清点净减 + **tools/session 回放冒烟 + saveForge 产档浏览器起跑**（engine.mjs 15+ 处直调 core API、saveForge 直造 pending 现场，是隐藏消费者） |
| **P3** | runAdapter + stageDirector + **transitionStage 单一入口** + **显示标量通道**（§4.6，首个消费者 = 金币获得演出） | 路由失同步族 + 闪帧族纪律记忆点 | 低-中 | ascension/reward 特殊期手测 + 迁移调用点清点归一；标量通道换台/中断后数字对账 |
| **P4a** | run 级 idle-gated notify（定义最大延迟） | 漏 notify 族 | 中 | 灰度 + 三日试玩 |
| **P4b** | **长期搁置**（触发判据：P3 落地后再出现 ≥2 次闪帧族实报） | — | — | — |
| **P5** | 战斗内读取口径：三口径 pending → 类型化查询；真相源口径表成文 | 花刀族回归 | 中 | 花刀/斩链专项冒烟 |

---

## 六、设计决策记录

**2026-10-13 三轮讨论（用户决策）**：
1. 决策流归 core（大决策协议）→ 原「Shell 会话运行时」废弃。
2. tags/waitTags 支持并行 → 原「表现槽」废弃。
3. 幽灵指令（跨度闸门）实现向未来排队。
4. 统一的是「一个 sequencer + FIFO + 标签代数」，不是万能时间线。
5. 状态可打包进指令但战斗内 anim+sync 不合并。
6. flow 退薄为适配器。

**2026-10-13 第一轮审查（三评审代理）追加决策**：
7. ambient 不进 P1（零消费者）；机制能力（tags 退出 'all'）由 span 强制需要。
7a. waitTags 组合规则成文（span-gated 用 ['all','battle-span']）。
8. cancel 与 abandon 两动词；cancelByOwner('modal') 永映射 defer；特写 dismiss=收下的隐式应答废除。
9. span 闸门保险丝 = 语义谓词（2000ms×3 拍、无上限、后台免疫），并入 P0；「队列无活动」与帧心跳均为错误选型。
10. 事实修正：core 问句先例唯一（battle）；abandon 是新动词；headless 红利改写；gameStage 写点 14。
11. 问句形状豁免 selectOption；必答问句 abandon=默认选项兜底；恢复即重发问句；义务门收 core completeRoom。
12. P2 顺序 shop 先行；验收加 headless 双门（session 回放 + saveForge 起跑）。
13. P4b 长期搁置；transitionStage 单一入口并入 P3。
14. wire 三词本地词汇纪律入 wire.js 头注；broadcast tap 镜像同步。

**2026-10-14 用户三点（v2.2）**：
15. **协议边界判据**（§4.3 首条）：core 只收改可存档态的逻辑；上行数据 = 用户影响核心态的应答；判别测试 = 存档字节差。
16. **标签设计**：认可方向，具体标签到实施批再精调（现逻辑可覆盖 90%+ 场景，根治 async 回调地狱）。
17. **显示标量通道**（§4.6 新增）：节拍化状态变更是确定的未来需求（金币演出例），经两套状态设计扩展覆盖面解决；「完全指令化」维持长期搁置——贵的从来不是叶子标量，是面板/场景复合重建。

**废弃台账**：表现槽｜Shell flow 运行时｜独立 claims（退化为类型化查询）｜独立舞台仲裁者（缩入 P3）｜ambient 进 P1（降为约定）｜span 闸门「队列无活动」保险丝（改谓词）。

---

## 七、过度设计自查清单（审查轮议程）

1. **两个家族法则**：新机制须点名 ≥2 实锤 bug 族或 ≥3 处手搓件。
2. **手搓件净减**：每批落地后清点（锁/轮询/异地 resolve/保险丝散点/void 链）——必须净减少。
3. **tag 代数可解释性**：出现无人能一口解释的组合 = 代数腐坏，立即收敛。
4. **问句不套问句**：一次一问。
5. **最小替代先问**：现有机制 + 约定能否八成解决。
6. **铁律相容**：四层依赖 / core 可序列化 / presenter 注入逐条对照。
7. **每批可独立发版回滚**。
8. **量化数字脚本复核后才当验收基线**（gameStage 12→14 教训）。

---

## 八、遗留疑点（第一轮裁决记录）

1. **ambient 消费者** → 裁决：YAGNI 成立；画廊是唯一双满足候选（三处手搓协调点）；迁移触发 = P4a 落地之时，为既定路线非「等第二个消费者」。
2. **finish 带值 vs wire** → 裁决：影响面严格为零（wire 是入队时刻单向 tap，完成事件线上不存在；battle 应答从不过队列）；纪律：答案过线走语义事件 payload；两个签名镜像点（sequencer 总线监听、broadcast tap）同步。
3. **span 闸门保险丝** → 裁决：语义谓词形（详见 §4.2.5），2000ms×3 拍、无绝对上限、后台免疫、并入 P0。
4. **abandon 语义** → 裁决：三态 defer/forfeit/forbidden + 完整目标语义表（正常应答/弃局/切幕取消/读档恢复 × 各问句，见评审存档）；真实档房内不落盘 → 问句随检查点回滚，无需 abandon 回调；调试档恢复 = 重发问句。
5. **P4b 必要性** → 裁决（2026-10-14 用户修订）：拆两半。**节拍化状态变更的需求成立且确定**（金币演出例）→ 新增「显示标量通道」（§4.6，归 P3，逐控件增量迁移）；**完全指令化维持长期搁置**——贵在面板/场景复合重建而非叶子标量，该部分由 notify + idle 闸 + transitionStage 承接。闪帧族 ≥6 处已全被「黑幕中点」纪律压住。
6. **老虎机转轮形态** → 裁决：拉杆 = 输入意图非问句；**slotPending = 问句**（kind 'slotPrize'，onAbandon defer）；转轮 = 纯演出指令（apply-point 'end' 载荷「spinning→lastSpin 揭示」取代 FuseBag 存在理由）；「特写等转轮」= FIFO 序；四件手搓删三件半（FuseBag 删/回执句柄删/slot.anim 删/120ms 轮询收进指令体）；MapStage 降级路径收敛为同一指令的宿主实现；slotGiftDue 同批协议化（kind 'slotGift'）。

---

## 九、第一轮审查存档与待拍板清单

### 9.1 审查总评（评审代理原文要点）

「敢开工，但 P1 先做减法再开工。骨架判得准、自查纪律真实执行；主要失分在 §4.3 三处事实夸大——不颠覆方向，但让协议化看起来比实际更现成。最可能翻车 = P2 问句迁移（形状多样性 + cancel/abandon + 旧档重发三件事叠批，且拖着 engine.mjs/saveForge 两个隐藏消费者）。」

### 9.2 审查新发现的风险（已全部合入正文）

① cancel=abandon 会造成切幕弃奖回归；② span 闸门「队列无活动」心跳在玩家长考必误报（战中早播方向）；③ broadcast tap 鸭子类型 + wire 三词不过线 → P1 对观战链非零破坏；④ 旧档问句需「恢复即重发」；⑤ P4a 须定义 notify 最大延迟；⑥ 量化数字抽样失真例。

### 9.3 待拍板清单（2026-10-14 更新）

**已裁决**：①协议边界判据（用户定，§4.3 首条）；②标签设计（用户认可，实施时精调）；③P4b 拆分（用户修订：显示标量通道做、完全指令化搁置，§4.6/§八.5）。

**未逐项表态、按推荐默认执行（有异议随时推翻）**：

| # | 事项 | 默认 |
|---|---|---|
| 4 | P2 迁移顺序 | shop 先行 |
| 5 | 「转动中」置灰事实源 | 队列类型化查询 |
| 6 | slotGiftDue 同批协议化 | 同批 |
| 7 | span 谓词保险丝引爆方式 | 直接强杀无观察期 |
| 8 | finish 签名 | `finish(id, { result, reason })` |
| 9 | cancel/abandon 两动词 + 特写 dismiss 隐式应答废除 | defer 三态制（评审一致推荐，未见用户异议） |
| 10 | 义务门收进 core completeRoom | 收（与用户协议边界判据同向） |

---

### 9.4 P0 落地记录（2026-10-14，已实施并验证）

**交付物**：
- `src/shell/quiescence.js`——静止态断言器（`createQuiescenceChecker`：闭包注册检查项、persist 去抖、一集一报、sample() 可手动驱动）+ `battleQuiescent` 语义谓词（span 闸门保险丝本体）。调试局安装（runController），读口 `window.__quiescence`。
- 三域 `quiescenceFailures()` 访问器（runMachines/runCutsceneFlows/runShowcase）+ `FuseBag.armed()`。
- `tools/fuzz/wireFuzz.mjs`——node 侧真 bridge + tap sequencer 录制 wire 指令流（20 局 3830 条 / 5.6s；跨进程确定性已验证）；`tools/fuzz/wireDiff.mjs`——A/B 比对（正向 0 差异 / 负向正确 FAIL）。基线：`tmp/wire/baseline-p0.json`。
- `tools/fuzz/runFuzzBrowser.mjs`——run 级浏览器 soak（整层循环 + 每层收口静止态采样 + timeoutCount==0 + 零 console error；逃生舱 = setFloor 硬跳，义务门拦截计为 escape 不判负）。
- 冒烟 `tmp/smoke-quiescence.mjs` 15/15；`npm test` PASS；build ✓。

**P0 当场抓到并修复的两个真 bug**：
1. `fireBurstSkills.js` 巨火球术/天明火球 `battleDescribe` 引用未导入的 `AOE_TAGS` → 卡进手牌投影即抛 ReferenceError（wireFuzz 首跑命中）。
2. **战败路径 straggler sync**：intent 包装的 `markDirty` 落在 battleEnd 最终快照捕获之后，unsynced 悬真；战后某条指令 finish 触发 `syncIfIdle` 追加 state-sync——胜利路径舞台尚活（静默自愈），**战败路径战场已被结算屏拆除，指令发给已退订听众，保险丝强杀并污染 timeoutCount**（runFuzzBrowser 首跑实锤，定向复现取证：强杀的正是带败局判定的最终 sync）。修复 = `bridge/index.js` intent/respond 包装在 `isBattleFinished` 后不再补同步。

**已知开口项**：多层的战败路径仍观察到 1 次罕见 fuse（与上述不同源、未能稳定复现）——soak + 页内 warn 截获工具已就位，下轮 soak 命中即取 meta。

**验收遗留**：w6fight 旧档含已废弃卡 id `punch`（battleFuzzBrowser 的缺省档已坏，起跑即抛「未注册的技能」）——soak 请用 `saveForge --out runsoak` 造新档；30 分钟零误报浸泡由用户日常游玩自然覆盖（断言器常驻调试局）。

### 9.5 P1 落地记录（2026-10-14，已实施并验证）

**交付物（sequencer 词汇表）**：
- `sequencer.js`：①`owner` + `cancelByOwner(owner)`（摘除该属主全部未完成指令含在播的，清定时器，返回计数）②`finish(id, { result, reason })`（result=完成回值仅存指令记录；reason 兼容旧裸字符串；总线监听转发 Stage 回执的 result）③`tagAll: false`（退出自动 'all'——span/ambient 类不被默认等待者等）。
- **battle-span 闸门首活体**（runController `armBattleSpanGate`）：战斗开始武装（先于 `bridge.start()`）、BATTLE_END 回执带 result、谓词保险丝三态（闸门已收=不适用 / 离战未收=manual 清场 / 战中卡死=timeout 引爆计入 timeoutCount）。endBattle 兜底 disarm + cancelByOwner(bridge)；dispose 收口。
- 镜像同步：broadcast tap 长出 `cancelByOwner` + finish 签名对齐（鸭子类型复刻缺方法即断观战链）；wire.js 头注「owner/finish-result/apply-point 三词不过线」纪律。
- quiescence 联动：isIdle 与 battlePredicate 把闸门视为不可见（闸门在队=战斗进行中的正常占用，否则断言器战中永久失聪）；新增 spanGate 检查项（离战后不得挂闸门）。
- **范围裁剪（两个家族法则）**：心跳保险丝泛化**本轮不做**——flightWatchdog 留飞卡演出原位（sequencer 侧零消费者，泛化即投机 API）；待 P2 选卡指令（真消费者）出现随批落地。

**验证**：`tmp/smoke-sequencer-p1.mjs` 13/13（含 tagAll 死锁陷阱回归测试：闸门不得阻塞默认串行节拍）；wireDiff 对 P0 基线 **0 差异**（3830 条指令等价）；npm test PASS；build ✓；soak 4 层 PASS。

**P1 期间抓到并修复的产品 bug（第 3 个）**：
- `awaitFloorArrive` 等待侧兜底只 resolve Promise 不 finish 指令——爬升/残影视觉完成链任一悬空时指令悬挂 6s 被保险丝强杀（soak warn 截获实锤：`tower:floor-arrive` 超时）。修复 = 兜底同时收 Promise 与指令本体。**P0 开口项（多层战败路径罕见 fuse）就此闭环**——其源头正是这条链。
- 开工接线自查：armBattleSpanGate 漏 import createPredicateFuse（TDZ 级联），soak 首跑即抓——P0 基建的第三笔收益。

### 9.6 P2 开工前审核轮（2026-10-14，expert 代理，7 项发现全修）

**判定**：「机制层质量好（sequencer 词汇表重入安全/标签代数/计数口径/镜像全站得住），出问题的是接线层与工具层——三个 P1 全是机制对了、接歪了/瞎了。先修再开工。」

| # | 级别 | 发现 | 修复 |
|---|---|---|---|
| 1 | P1 | span 谓词保险丝吃缺省 capMs=30000，长战斗 30s 后卡死探测+硬重置清场双失能（违反「无绝对上限」设计） | 缺省改 Infinity + docstring 写明「缺省无上限，需要才显式传」；根因 = capMs 旋钮本身是投机泛化 |
| 2 | P1 | BATTLE_END 监听注册序倒置：endBattle 的 cancelByOwner 永远抢在闸门 onEnd 前，「回执带 result」从未真正走通 | 监听注册移到闸门武装之后（闸门先注册=先发射=先自收）；smoke ⑥ 用「cancelByOwner 空手返回 0」钉死生产序 |
| 3 | P1 | soak 静止态采样系统性空置：采样点恒非 idle（黑幕未揭/爬升在队）→ sample 空转 → 恒 PASS；interval 腿的 warn 又不进 FAIL 证据 | sample() 返回「是否真执行」，soak 页内自旋等真静止（-2 超时也判 FAIL）；[quiescence] warn 纳入证据；开局/收尾违例基线对账 |
| 4 | P2 | 战斗超时逃逸分支跳过采样（与 #1/#3 扣环可把长战斗真卡死吞成 escape） | 逃逸跳层前补采样，>0 判 FAIL |
| 5 | P2 | tagAll 是第四个本地词未入 wire 头注清单 | 头注补 tagAll（wired 指令用它 = 观战端把不阻塞重建成阻塞） |
| 6 | P3 | sequencer finish 的 finished 分支不可达（死代码） | 删 |
| 7 | P3 | dispose 不摘 window.__quiescence 针 | 摘 |

**修复后复验**：smoke 15/15 + 15/15；wireDiff 对 P0 基线 0 差异；npm test PASS；build ✓；soak 4 层 PASS（采样真实执行，战败链 timeoutCount 0）。**P2 放行。**

### 9.7 P2 第一交互落地：shop（2026-10-14，已实施并验证）

**实现形态（「派生视图」协议，最小侵入）**：
- `core/run/questions.js`——问句协议模块：`currentQuestion(run)`（从既有 pending 字段派生统一视图，载荷全标量）、`answerQuestion(run, answer)`（分发到 core 收尾原语）、`hasOpenQuestion`（离房义务门判据）。状态本体不动（engine.mjs/saveForge 直调原语的旧路径零影响）。
- `shell/runQuestions.js`——呈现驱动（P3 适配器种子）：notify 拍 diff 问句，**双向**——出现+空闲+非出货中 → 开全屏选卡；已清而呈现还开 → 定向收口（旁路应答兜底）。差分驱动免费获得「恢复即重发」「cancel→defer 下一拍自动再呈现」。
- runShowcase：**删** shopPendingShow 待播悬空位 + shopShowcase 手搓特写接力（三级回落逻辑）+ SHOP_TINT；出货演出位（shopDispensing + fuse）保留（Q6 形态的队列化留给 P3）。
- runMachines：shopTake* 应答走 answerQuestion；runController：notify 尾挂 drive()、离房义务门换 hasOpenQuestion。

**过程中修掉的两个结构问题**：
1. **断言器误报类**：有界瞬态（出货位/保险丝）在窗口内被静止采样即假阳——有界状态自有保险丝看管（必清），静止断言只管无界泄漏。showcase 域的三项结构性死检查全删 + FuseBag.armed() 一并退场（不过度防御的反向应用：删自己的投机检查）。
2. **协议完整性缺口（e2e 抓到）**：应答与呈现解耦后，旁路上行答案（面板/调试）不关 picker——「应答 ⇒ 呈现收口」补进驱动的 diff（定向只关自己开的那只，devour 等非问句 picker 不误伤）。

**验证**：smoke 18/18（视图拷贝/收下/放弃/遗物分支/驱动让位/旁路收口）；wireDiff 对基线 0 差异；npm test PASS；build ✓；浏览器 e2e 全链绿（买包→自动开→旁路答→收口→特写→点击收→静止采样真执行零违例）；soak 3 层 PASS。

**手搓件清点**：runShowcase 净减 1 悬空位 + 1 手搓接力函数；新增协议本体 ~85 行（core 视图 + shell 驱动）——换得两项旧代码没有的能力（恢复即重发、旁路收口）+ 后续交互（slot/devour/…）接入即一行扩 currentQuestion。

### 9.8 P2 第二交互落地：slot（2026-10-14，已实施并验证）

**实现形态（§八.6 定稿形状逐条兑现）**：
- **slotPending = 问句 'slotPrize'**：questions.js 扩取值序（shop > slotPrize > slotGift）；answer 口径 = defId/relicId（择一）、`'take'`（收下）、`null`（放弃）。**slotGiftDue 同批协议化**（kind 'slotGift'，answer = 礼物 id，不可 null——义务门要求亲手领；呈现时机 = 点「继续前进」时机器拦截演出，驱动不自动弹，面板无 UI 是 2026-10-13 用户定）。
- **转轮 = 纯演出指令**：sequencer 新词汇 `onEnd`（apply-point 'end' 完成钩子——回执/保险丝/manual 三条完成路径统一落载荷，cancel 不落）；spin 指令 start 直调宿主 `playSlotSpin({tier}, done)`、onEnd 落揭示（slot.lastSpin + notify）。「特写等转轮」= 队列类型化查询 `slotSpinPending`（findPending by meta.event），驱动与面板快照（spinning 置灰）共用这一个判据。
- **四件手搓清账**：FuseBag 'slotSpin' 删（onEnd 取代「杀指令不清闸门」的存在理由）；slotFinish 回执句柄删（宿主 done 直调 sequencer.finish，slotAnimDone 意图往返删）；slot.anim 瞬态删（spinning = 队列派生布尔）；120ms 轮询收进宿主实现唯一一份（机器模块 playSlotSpin）。
- **MapStage 降级路径 = 同一指令的另一宿主实现**：删 _syncSlotRoll 快照 diff（含 _slotRollId 防重播位），playSlotSpin 直接 play(→reset+done)。
- **产出特写呈现权移交**：maybeShowSlotPrize（45 行手搓，含对象身份去重/占用重试）删；stagePickerKit 新增 `openSlotPrizeShowcase`（快照驱动 + onSkip/onDismiss → 意图上行；面板转发走 panelHost，三舞台同享）；驱动持有「单件遗物奖直答」呈现策略与揭示横幅生命周期（问句落幕即清，未中奖横幅不动）。

**过程中修掉的一个真 bug（e2e 抓到）**：驱动直答单件遗物奖后没补 notify——面板与遗物差分特写停在旧拍（旧代码经 runMachines 包装层天然有 notify，协议化后直调 core 原语丢了这一拍）。修 = 驱动 ctx 补 notify。

**验证**：smoke 34/34（视图/四类应答/免费升级挂起-收尾/礼物优先级/onEnd 双路径+cancelAll 不落/特写等转轮/横幅生命周期/单遗物直答）；wireDiff 对基线 0 差异；npm test PASS；build ✓；浏览器 e2e 全绿（16 杆真拉杆：时序不变量「特写绝不与转轮同帧」0 违例、packSix 择卡入组、relicA 择遗物入包、注入+notify=恢复即重发、跳过=放弃钱不进账、安慰奖二选一→获得演出→自动离房）；soak PASS（pageErrors 0 / timeoutCount 0）。

**工具顺带**：browserHarness 补 `clickRelicCard` + clickPickerConfirm 遗物侧（原先只认 cardPicker——遗物 picker 确认链根本点不动，存量缺口）。

**手搓件清点**：删 ~120 行（maybeShowSlotPrize + 回执/保险丝/瞬态/双宿主 diff 驱动），新增 ~90 行（onEnd 词汇 15 行 + 问句扩 30 行 + playSlotSpin 双宿主 35 行 + kit 特写 10 行）。下一个交互（devour）接入仍是扩 currentQuestion 的形状。

### 9.9 P2 第三交互落地：devour（2026-10-14，已实施并验证）

**定位修正（实施时厘清）**：吞噬不进 core 问句——入口/「粉碎什么」选择都不改存档字节
（判别测试不过），违背协议边界判据；它的 P2 目标是删 shell 锁（单飞锁泄漏族）。
两问是**呈现层问句**，链尾一次 core 调用（devourSlot）。

**实现形态（单飞纪律归队列）**：
- 流程 = 一条 `room:devour-flow` 指令；再入请求排在首份后面，轮到时由 **entryOk 状态门**
  （房间/无 pending/devourReady/有候选）自灭——「实报：进两次选卡界面连碎两次」的再入源
  （投料口点选先于模态路由）被结构性堵死。
- 删 devourFlowBusy 手写锁 + 150ms「等选卡器收起」轮询 + quiescence 的吞噬检查项。
- start 内 try/catch/finally：链上抛错不悬挂指令（玩家节奏段不能上墙钟保险丝——同
  battle-span 时基裁决）。

**过程中修掉的一个真死锁（e2e 实抓，node 冒烟测不出来——假 cutscene 不走队列）**：
流程持有默认 `'all'` 串行指令不放，而 cutscene 剧本步骤也编译进同一队列等它——互等锁死
（症状：对话 play 被调但 state.script 恒 null）。修 = 设计里的标签代数：流程指令
`tags:['devour-flow'], tagAll:false`（剧本步骤/特写不等它）+ `waitTags:['all','devour-flow']`
（再入同类仍排队）。**教训进通用纪律：流程指令内部还要往同一队列排内容的，必须退出 'all'。**

**记录在案的行为变化**：首份流程「算了」取消后，排队的再入会照播（旧锁是静默吞掉）——
玩家点了两下投料口，播两次对话是可辩护语义。

**验证**：smoke 14/14（入口门/再入排队自灭/取消角落/抛错不悬挂/检查项退场，手动闸门
驱动假壳层）；wireDiff 对基线 0 差异；npm test PASS；build ✓；浏览器 e2e 全绿
（投料口→对话→选卡→确认→进度清零/卡离组/金币入账/特写在播/再入指令自灭/零 pageerror）。

**手搓件清点**：删 ~35 行（busy 锁 + 收起轮询 + 检查项），新增 ~20 行（指令壳 + 状态门）。
下一个交互 = training。

### 9.10 P2 第四交互落地：training（2026-10-14，已实施并验证）

**实现形态**：
- **两个状态面进问句协议**：`roomData.pendingUpgrade` → kind 'trainingUpgrade'（**必答**：
  欠升级态没有跳过出口；答案是多步的——twoC 两张、分叉带 targetId——不经 answerQuestion
  单发通道，应答走升级选卡意图链逐张 trainUpgrade 扣尽自清）；`roomData.drawChoices` →
  kind 'trainingDraw'（answer = defId / null 放弃——天然问句形状）。
- **尾款自动链指令化（devour 同型）**：删 upgradeFlowBusy 手写锁；流程 = 'training-flow'
  指令（tagAll:false + 自家标签互等——同 §9.9 死锁教训）。呈现权归问句驱动：抓牌落地拍、
  面板「继续修行…」重入、读档恢复（恢复即重发）三条路收敛成驱动的同一次 diff。
- leaveRoom 的 pendingUpgrade 专属门并入 hasOpenQuestion（单一事实源）。

**过程中修掉的一个真竞态（e2e 实抓）**：twoC 多选链是逐张「飞行→意图→notify」推进的，
中间拍问句还开着且选卡器已收——驱动此刻按 diff 重开升级选卡，与飞行链的下一张赛跑，
收尾悬空一只没人关的选卡器。修 = 流程指令**持有到尾款清账或演出落定**（升级/得卡飞行
指令在队 = 链还在走；玩家取消则放行重入）。**教训：多步问句的自动链要把「中间拍」
当一等公民——驱动 diff 的重呈现语义与链内推进天然赛跑，指令持有期覆盖整条链。**

**验证**：smoke 18/18（两问句视图/应答/门/驱动路由/旁路收口）；wireDiff 对基线 0 差异；
npm test PASS；build ✓；浏览器 e2e 全绿（训练→进阶幕间消化→四选一→领卡→尾款自动链→
twoC 双选清账→注入+notify=恢复即重发→义务门拦截→清账后离房，零 pageerror）。

**工具顺带**：saveForge 造训练档要跨过进阶门槛（`--training 1 --ascension 1`：训练次数
达到 1+count×2 即触发房内进阶幕间，且进阶会送删卡机会弹全屏选卡——e2e 必须先消化）。

**观察留档（非本批范围）**：升级选卡器的「取消」按钮（picker:back）在 e2e 坐标点击下
未见关闭界面——真实鼠标路径未验证，疑存量问题，待用户实测。

下一个交互 = bank。

### 9.11 P2 第五交互落地：bank（2026-10-14，已实施并验证）

**实现形态**：
- **demonRoll（恶魔词条三选一）进问句**：必答（null 拒答、abandon = forbidden——钱已到手）。
  浏览器应答仍经 bankDemonPick（chooseDemonDebuff 的结果驱动词条/焚卡/金币三拍演出），
  answerQuestion 通道只服务 headless/协议直答。呈现 = 老虎机恶魔形态（快照 diff 驱动，
  天然恢复即重发）+ 占位面板按钮，驱动不自动弹（slotGift 同款口径）。
- **bankOffer（词条附赠）进问句**：可放弃（null = takeBankOffer 弃置）；非 null 应答走
  选卡意图链（bankUpgradeOffer/bankBurnOffer）。呈现 = openBankOfferPicker（runShowcase
  暴露，驱动经 ctx 钩子调）——**修掉一个真恢复缺口**：旧代码 offer 只在恶魔演出链尾自动开
  一次，读档恢复带出的 offers 没有任何入口（面板按钮已删 = 死 offer）；驱动化后恢复即重发。
- leaveRoom/leaveSlot 的义务门随 hasOpenQuestion 自动覆盖 demonRoll（原 RoomStage
  pendingDuty 'demon' 拦截保留为 nudge 呈现）。

**验证**：smoke 14/14（两问句视图/必答拒 null/offer 放弃/优先级 demonRoll > slotPrize/
驱动路由/旁路收口）；wireDiff 对基线 0 差异；npm test PASS；build ✓；浏览器 e2e 全绿
（聚焦银行机→超额→首遇解说消化→转盘热区→点选词条→pendingRoll 清→义务门拦截→两拍演出链→
零 pageerror）。offer 分支本跑 rng 未触发（无附赠词条），单元层覆盖 + 入口是存量代码。
**e2e 坑（复用）**：恶魔 roll 首遇解说在超额那拍弹出会吞掉转盘点击——先 advance 消化。

**手搓件清点**：questions.js +18 行、驱动 +8 行、runShowcase 暴露 1 行——无删除（bank 侧
本就没有 shell 锁；本批收益 = 义务门统一 + offer 恢复缺口）。

P2 剩余：event/ascension 收尾（事件房是 shell 收集 core 结算的旧模式——原型先例，
问句化口径待定）。

### 9.12 P2 收官：event/ascension + flowInstruction 壳（2026-10-14，已实施并验证）

**实现形态**：
- **flowInstruction.js 公共壳**（rule of three 满额后收敛）：devour / training / event /
  ascension 四处同型流程统一为 `enqueueFlowInstruction(runSequencer, { tag, meta, entryOk, play })`
  ——退出 'all'（流程内部还要往同队列排 cutscene 步骤/特写链/切幕）+ 自家标签互等
  （再入排队尾）+ entryOk 状态门自灭 + 壳层兜 catch（play 自带 finally done）。
- **event/ascension 幕间锁指令化**：删 eventPlaying / ascensionPlaying 两把手写锁与
  quiescence 检查项；事件再入（面板安全阀/重复触发）与进阶再入（训练达标 + 离房兜底同拍）
  由队列串行 + eventResolved/gameStage 状态门自灭。chooseAscensionDimension / skipAscension
  的面板兜底路径原样（它们是 ascension 阶段的正路应答，不是幕间再入）。
- **过普查漏一处**：删 upgradeFlowBusy 变量后 quiescence 检查项仍引用它（采样即抛 =
  soak 全程违例 3 条）——soak 抓到即修。**教训：删变量必须全量清引用，静止态检查项
  与被检变量同生共死。**

**验证**：smoke 全绿（7 份：quiescence 15/15、sequencer 15/15、shop 18/18、slot 34/34、
devour 14/14、training 18/18、bank 14/14）；wireDiff 对基线 0 差异；npm test PASS；
build ✓；e2e 五链全绿（slotq/devourq/trainq/bankq/flowq）；soak PASS。
**e2e 坑（复用）**：事件房无 RoomStage（waitStage('room') 别 waitRoom）；事件/进阶对话
都有铺垫页，先 advance 到选项出现。

**P2 总账（五个交互 + 收官）**：
- 删：4 把手写单飞锁（devourFlowBusy/upgradeFlowBusy/eventPlaying/ascensionPlaying）、
  转轮四件手搓（FuseBag/回执句柄/slot.anim/双宿主轮询）、maybeShowSlotPrize 45 行、
  slotAnimDone 意图往返、MapStage 快照 diff 转轮、留房专属门 ×2。
- 增：sequencer onEnd 词汇、flowInstruction 壳、问句协议七种（shopPack/shopRelicPack/
  slotPrize/slotGift/trainingUpgrade/trainingDraw/demonRoll/bankOffer）、呈现驱动双向 diff。
- 真 bug 修 5：直答漏 notify、吞噬互等死锁、twoC 中间拍竞态、bankOffer 恢复死态、
  quiescence 残引用。
- 新能力（旧代码没有的）：恢复即重发（全问句）、旁路应答收口、defer 再呈现。

### 9.13 P3 边界审查轮（2026-10-14，expert 代理；2×P1 + 2×P2 已全修）

**审查维度**（用户指定：目标漂移/抽象健康/可简化/方法论，抽查 bug 其次）。总评：
「方法论 OK，批次质量高于 P1——机制与接线基本一致，歪的是『声称与实现』」。

**已修（本节落地）**：
1. **P1 问句取值序自相矛盾**：currentQuestion 是 demonRoll > slotPrize、answerQuestion 是
   slotPending > pendingRoll——共存态（拉杆产出未领 + 恶魔 roll，bankOverdraft 不挡
   slotPending，**真实可达**）协议直答会答错对象；被意图路由掩盖穿过了整个验证矩阵。
   修 = answerQuestion 改 `switch (currentQuestion(run)?.kind)` **单源分发**，顺带消掉
   bankOffer/slotGift 的 fall-through 落洞；新增共存态冒烟（smoke-questions-coexist 18/18：
   共存归属逐答验证 + 互斥不变量 + 义务门全覆盖）。
2. **P1「特写 dismiss = defer」是文档声称非代码事实**：ItemShowcaseObject 无分流，
   dismissModals 走的就是用户点击同路径 → onDismiss 替玩家收下；两条矛盾注释并存。
   今日靠义务门 + 换台 dispose 两条未言明的意外兜着（MapStage 常驻/不换台路径上仍活）。
   修 = 实装 `cancel()`（'cancel' 收场原因：出口回调全免）+ dismissModals 改走 cancel +
   两处注释对齐。P3 transitionStage 汇聚切幕前的排雷。
3. **P2 leaveSlot 残留 pendingUpgrade 专属门**（被 hasOpenQuestion 蕴含）——删。
4. **方法论补强**：验证矩阵补「共存态/交叉态」横向断言一类（已加）；落地记录的
   行为裁定类声称必须附 file:line 证据（本轮 #2 即「记录在案、代码缺席」）——写进纪律。

**审查确认成立的设计裁定**（实证过非推测）：onEnd 的 cancel 不落载荷在 event/ascension
成立（派生谓词 + persist 只在 prep/end + completeRoom 路由——半完成流程数学上不可入档）；
flowInstruction 的 entryOk 双检足够（中途安全由 core 义务门担保，建议壳注释点名分工）；
runQuestions ctx 是 runAdapter 种子非上帝接口（但斜率有限，P3 换声明表）。

**记 P3 的吸收项**（审查归类为 P3 正常工期，不构成前置债）：驱动 ctx 声明表化
（kind → {present, dismiss}）；rig.pull 落定回调（消 120ms 轮询的 API 不对称）；
三处轮询收编（等待源不同质，等真实第二消费者再收）；bossRemoveSettle 同型残留收编；
onEnd 单消费者观察（显示标量通道落地即正名，跳票则回收）；「流程播一半离局再读档」
专项冒烟（三机制合力，防 P3 拆环无声回归）。

**修后全绿**：7+1 份冒烟、wireDiff 0、npm test、build、e2e 五链（cancel 语义改后全跑）。

### 9.14 双 sequencer 拆分（2026-10-14 用户裁决 + 当日落地，已实施并验证）

**裁决原文要点（用户在代码审理中提出，经三轮自我推翻后定稿）**：P1/P2 把扩展词汇
（onEnd/owner/tagAll/finish-opts）加在经典 AnimationSequencer **类**上——虽然战斗侧
从未使用这些词汇，但类的 API 面被污染，信息流向有被打乱的隐患。正确形态 = **两个
sequencer 天然隔离**：
- `battleSequencer`（经典 AnimationSequencer，**git checkout 还原到与 HEAD 字节一致**）：
  后端单向数据流——bridge 排战斗 wire 指令、舞台在 battleBus 上回执。经典最小形态在
  无数卡牌动画改进与效果修正中被验证，不加任何干扰内容。
- `dedicatedSequencer`（新类 core/anim/dedicatedSequencer.js，同构不继承——两者词汇
  与生命周期已分叉，共享内部只会逼经典侧暴露扩展缝）：前端微演出编排的全部词汇
  （onEnd=apply-point 'end'、owner+cancelByOwner、tagAll:false、finish 带回值）。
  由前端逻辑 enqueue（房间/幕间/塔楼/问句呈现/流程指令壳），EventBus 收到的后端指令
  也在此编排呈现，resolve 后前端逻辑把决策传回后端。
- S2 的「battle/room/tower/cutscene 共队列」就此废除：终局→黑幕→塔楼的衔接本就走
  事件/承诺（endBattle 等 bridge 收尾后才起幕间链），共享队列只贡献了「前端编排的
  混沌波及战斗节拍」这一负资产。两实例各自总线（battleBus/animBus），动画执行器按
  指令来源分别回执（BattleStage 回执 bridge.frontendBus=battleBus 不变，房间侧回执
  animBus 不变——恰好零舞台侧改动）。

**实施中抓到的一个真隐患（自查发现）**：battle-span 闸门的谓词保险丝「无活动」判定
原本只看共享队列——拆分后战斗节拍在 battleSequencer，敌方回合演出期间 pendingInput
为空而 dedicated 空 → 必然误报卡死三拍引爆。修 = 谓词补 `battleSequencer.pendingCount === 0`。

**纪律更新（§4.2 词汇表修订）**：扩展词汇（owner/cancelByOwner/tagAll/onEnd/finish-result）
是 **DedicatedSequencer 专属**；经典类冻结（任何给它加词的提案默认拒绝——改 dedicated
或经用户裁决）。broadcast tap 镜像同步还原经典形态（finish(id, reason) 透传，cancelByOwner
镜像删除）；wire.js 本地词汇头注的适用对象改为 dedicated 侧。

**验证**：8 份冒烟全绿（smoke-sequencer-p1 改测 DedicatedSequencer 后 15/15）；wireFuzz +
wireDiff 对基线 0 差异（战斗 wire 走经典类零漂移）；npm test PASS；build ✓；soak PASS
（timeoutCount==0——battleBus 回执链完整）；e2e 五链全绿（flowq 三跑两绿一翻页竞态 flakes）。

**P3 影响**：显示标量通道（§4.6）的指令载荷/apply-point 词汇全部落在 dedicated 侧，
不再有「污染经典类」的顾虑；transitionStage 的切幕强杀走 dedicated 的 cancelByOwner。

### 9.15 残余混沌清剿批（2026-10-14 用户指令「继续迁移旧的混沌回调和 async 演出」，已实施并验证）

**用户指令**：在双 sequencer 模型上继续原始迁移计划——把旧的混沌回调/async 演出迁到
dedicatedSequencer，继续删旧逻辑简化代码。本批 = P2 交互迁移之后的「扫尾轮」，把
runShowcase/runMachines/runController 里最后一批手写编排收编进队列。

**迁移动作（五处）**：
1. **恶魔 roll 特写链**（runShowcase）：`showDemonReward` 的 playFrom 回调递归
   （onDismiss→playFrom(i+1)）+ `FuseBag('demon')` 保险丝 → 两条指令：`room:demon-reel-out`
   等待指令（等场景回执 demonAnimDone / durationMs 6000 两路收尾）+ `room:demon-flow`
   流程指令（词条→逐张焚毁→金币→附赠选卡，每拍 await 落定；焚毁 onDone 恰好一次有
   兜底计时器天然防悬死）。前置条件：ItemShowcaseObject 补 `onCancel` 出口（切幕
   cancel 此前**静默**——回调链会无声断链；现在显式给了 onCancel 的调用方收到中止
   信号，链中止后附赠 offer 由问句驱动下一拍 notify 兜底重呈现）。
2. **售货机出货**（runShowcase）：`shopDispensing` 手旗 + `FuseBag('shop')` → 逐商品一条
   `room:shop-dispense` 指令（回执按 index 匹配 / durationMs 4000 收尾都补 notify）；
   `isShopDispensing` 变成队列派生读数。并发购买各自的包等各自的回执（旧全局旗任何
   一次回执都放行全部——新实现更严）。
3. **Boss 删卡**（runMachines）：`bossRemoveSettle` 悬空回执位 + 手写 Promise +
   200ms setInterval → `run:boss-remove` 流程指令（返回的 Promise 在收尾拍 resolve，
   claimReward 的回塔链 await 语义保住）。等待谓词 = `waitFor(!uiBusy)`——确认/放弃/
   切幕静默收三条收起路径统一接住；**静默收 = 与放弃同判（机会作废）**，顺带修掉一个
   既有隐患：旧实现在切幕静默收后会永远等不到回执（悬死）。
4. **奖励收尾链**（runController claimReward）：`void (async () => { await 删卡; await
   afterRewardToFloor(); })()` 手写 IIFE → `run:reward-exit` 流程指令（tagAll:false，
   内部切幕/剧本步骤同队列无互等——同 devour/event 代数）。
5. **轮询收编**：flowInstruction.js 新增 `waitFor(pred, everyMs)`（**刻意无超时**——
   等待条件含玩家节奏段，墙钟保险丝会误杀，时基裁决同 battle-span）。训练流的
   150ms 内联轮询与 boss-remove 的 200ms 轮询统一换成它；slotMachine rig 的 120ms
   轮询是舞台层回调适配（stage 不得 import shell），维持原状。

**删掉的整件东西**：`src/shell/fuse.js`（FuseBag 机制整体退役——两根保险丝都被
durationMs 收尾拍取代：保险丝强杀时 onEnd 载荷照样应用，正是它取代「杀指令不清状态」
型兜底的形态）；2 个手旗（shopDispensing/bossRemoveSettle）；2 个 setInterval；
1 个手写 Promise + playFrom 递归。

**审阅后保留的既有口径**（非混沌，有意为之）：demonNarrateTimer 600ms 自来重试
（AGENTS「让位带重试」文档化模式）；battlePending/roomScenePending/restEntering/
endEntering 转场旗（P3 transitionStage 的正菜，现在逐个收编=零碎 churn）；遗物差分
特写队列（呈现驱动模式，与问句驱动同构）；slotTakeGift 的 onDismiss→leaveRoom
（单回调非链）。

**验收中抓到并修掉的两个既有缺陷**（都不是本批回归）：① harness 的选卡点击
（screenOfUi/clickPickerConfirm）只解析 RoomStage——战斗舞台上的选卡器（bossRemove
画在 battleStage）点不到，改活动舞台序（battle ?? room ?? stageManager._stage）；
② 上述 boss-remove 静默收悬死。

**验证**：7 份 node 冒烟全绿（shop18/slot34/training18/bank14/coexist18/devour14/
sequencer-p1 15）；wireFuzz+wireDiff 对基线 0 差异；npm test PASS；build ✓；e2e 七链
全绿（原五链 + 新 shopdisp 10/10 出货让位/回执/清账 + 新 bossq 9/9 秒杀→领奖→删卡
落账→揭幕回塔→队列排空；devourq 一次页面加载抖动复跑绿）；soak PASS（静止违例 0、
timeoutCount 0、pageErrors 0；campTraining 逃生舱 = 训练义务门既有口径）。

**P3 剩余**（未动）：runAdapter 声明式呈现表、stageDirector、transitionStage 单入口
（吞并四个转场旗 + roomScenePending）、显示标量通道；§9.13 吸收项中 rig 回执回调、
onEnd 单消费者观察仍开放。

### 9.16 转场收编批（2026-10-14 用户指令「收尾其他迁移」，已实施并验证）

**范围**：runController 里最后一批手写转场编排（4 把手旗 + 1 个重试定时器 + 1 个
双击窗口）全部收编为流程指令。至此 Shell 层的「async 演出编排」没有裸 Promise/
手旗/重试定时器了。

**五处**：
1. `startBattle` → `run:battle-entry`（删 battlePending）：入队口 findPending 挡重复
   入队；连点排队尾，轮到时 gameStage 已翻篇自灭（doSwap 在黑幕中点切 'battle'）。
   **注意 entryOk 不能含 findPending 自指**——指令 start 时刻自己就在队里（running
   也算 pending），自指谓词会把自己杀掉；在队检查放调用点。
2. `maybeEnterRestScene` → `run:room-entry`（删 restEntering）：Promise 在流程收尾拍
   resolve（唯一消费方 duckWind 回落兜底，语义零漂移）。
3. `enterEndScreen` → `run:end-entry`（删 endEntering）：notify 兜底分支在 tally 期间
   反复调，endStage 早退 + 入队口挡重复。
4. `leaveRoom/leaveSlot` 尾 → `run:room-exit`（新堵的双击窗口）：completeRoom 压在
   黑幕中点，上半段 wipe 期间 gameStage 还是 'room'——双击原本会排第二次切幕 +
   第二次 completeRoom；现在排队尾自灭。
5. `maybeNarrateDemonRoll` → `run:demon-narrate`（删 demonNarrateTimer + quiescence
   条目 + dispose 行）：600ms 自来重试 → 流程内 `waitFor(!uiBusy)`（等 uiBusy 落定，
   翻篇即不讲）；identity 标记改在入队时（重入不排第二份）。

**swapAnyToMap**（调试硬重置）只复位面板抑制位与揭示横幅——在途转场指令自走完/自灭。
quiescence 的 runController 条目只剩 roomScenePending 悬空与 pendingClearFx 残留两个
无界簿记（转场在队 = 队列忙，断言器自然不采样）。

**保留**（非混沌）：roomScenePending（面板抑制状态，claimReward 置位/换台清——它防
的是塔楼闪房间面板那一帧，队列派生不出来更简的等价物）；exitRestRoomScene 本体（wipe
细节无锁）；slotTakeGift 单回调；遗物差分队列。

**验证**：7 冒烟 + wireDiff 0 + npm test + build + e2e 七链（bossq 9/9 含战斗入场流、
slotq/trainq 含离房流、flowq/bankq/devourq/shopdisp）+ soak PASS（3 战斗入场 + 奖励
收尾 + 房间进出 + 终局入场全走新流程；timeoutCount 0、静止违例 0、campTraining 逃生舱
= 训练义务门既有口径）。

**下一步 = P3 本体**（runAdapter 声明表 / stageDirector / transitionStage 单入口 /
显示标量通道）——那是重构设计层的活，不再是「迁移混沌」。

### 9.17 P3 本体落地 + 收官审查（2026-10-14 用户指令「开始重构吧」，已实施并验证）

**P3-1 stageDirector + transitionStage 单一入口**：
- `src/shell/stageDirector.js`（新）：panel/fx/input/dismiss 四路由一处派生（refs 晚绑定
  getter）；runController 的 panelStage 重绑、cutscene getFxServices、切幕包装层循环、
  App.vue activeStage 全部指向它（ctrl 导出 director）。
- `transitionStage({migrate, holdMs})`（runController 内）：起幕 → 中点 dismissModals +
  migrate()（可返回 Promise，黑幕保持到兑现）+ **notify（中点纪律）** → 揭幕；
  'run:transition' 家族标签互等全局串行（transitionBusy 并发裸奔被结构性堵住——专家
  实证确认）。六个调用点收编（battle/room/end 入退场 + reward 回塔 + cutscene 退出），
  各 doSwap/beforeSwap 手放 notify 收回入口。**成文豁免**：内容幕间的 wipe step atCover
  （进阶 fromRoom——对话依赖剧本 nextBox 幕后就位）自理中点清算与 notify。
- 顺带修复（自查）：切幕包装层大括号箭头**丢弃 swap 的 Promise**——battle-entry 的
  预载就绪揭幕自包装层落地起被静默断掉；改 async 转发。
- 中点 notify 给 room-entry 带来行为改善：读档直入路径的 pending 问句「恢复即重发」
  （§4.3 机制需求）由此兑现。

**P3-2 声明表 + rig 回执 + 离局读档专项**：
- runQuestions 重写为 `KINDS: kind → {present, close}` 声明表（§9.13 吸收项）：加问句
  种类 = 加一行表项，ctx 钩子面不再长；收口条件扩为「问句清空或换 kind」（幂等 close）。
- rig.pull({onDone}) 落定回调（slotMachineRig：st.spin 收尾拍同步触发一次即弃）；
  拉杆被拒退回 isBusy 轮询兜底（唯一残存轮询）。§9.13「消 API 不对称」达成。
- `tmp/play/quitmid-e2e.mjs`（§9.13 专项）：拉杆中奖挂起问句 → 转轮在转时整页 reload
  → 存档重进恢复房内现场 → 问句回滚消失、队列排空、可再拉杆（cancelAll/检查点回滚/
  恢复即重发三机制合力）。e2e 知识：**未中奖不挂 pending 是 core 既定设计**
  （「未中奖不是产出」，slotMachine.js spinSlot）——断言必须拉到中奖杆。

**P3-3 显示标量通道（§4.6 最小形态）**：
- `src/shell/displayScalars.js`（新）：display = core + delta；`hold`（按住负增量——
  core 已 +N 显示等飞行）/`release`/`holdBeat`（**按住窗指令化旁挂**：tagAll:false +
  waitTags:[] 不拦后续 + 30s 真保险丝——§4.2.4 边界「payload 只管队列内指令」的实现
  依托）/`flight`（定时指令 apply-point 'end' 释放；**正常路径 start 内 manual 收尾**，
  durationMs 放大 ms+2000 只做真保险丝）/`reconcile`（空闲对账：notify 头部 + dispose/
  swapAnyToMap 强贴——演出中断自愈）。
- 读点：syncMapStatus 两处（setStatus + battleStage.topBar）走 scalars.read；面板
  money 仍读 core（§4.6 允许逐个迁，暂不迁）。首个消费者 = 恶魔 roll 金币拍
  （bankDemonPick hold + playDemonReward 飞行）+ 吞噬金币（onPick holdBeat + dismiss
  飞行 + cancel 立即释放）。SCALAR_FLIGHT_MS=450 占位旋钮（粒子演出落地后调）。
- `tmp/play/scalarch-e2e.mjs`：core 即时结算 + 特写在播顶栏按住旧值 → 落定飞行 →
  此刻才 +N → 空闲对账自愈 + dedicated 保险丝零触发，全绿。

**收官审查（expert 代理，方法论同 §9.13）**：总评「三个新抽象的结构判断全部成立，
但验收口径未达成」——3×P1 + 2×P2 + 6×P3，全部当日修复：
- **P1#1（陈年缺口，P2 时代「cancel 语义」只落地一半）**：dismissModals 实际仍走
  `showcase.dismiss('dismiss')`——cancel() 存在但全 src 无生产调用方，§9.13#2 的
  「切幕收呈现不收账」一直是文档声称。修 = dismissModals 改 cancel() + 吞噬金币特写
  补 onCancel（耦合点：不补则 holdBeat 孤儿化）。slotPrize 特写的隐式收下、恶魔链的
  cancel 中止分支自此才真正可达。
- **P1#2**：flight 原实现唯一完成路径 = durationMs 保险丝 → 每次金币飞行污染
  timeoutCount + warn；且全部 timeoutCount 门只盯 battle 经典侧（哨兵没看这条路）。
  修 = manual 收尾 + durationMs 升真保险丝；soak/scalarch 补 dedicated 侧
  timeoutCount==0 门。
- **P1#3**：transitionStage 声称「migrate 抛错也揭幕」——实际 unhandled rejection +
  幕布永久挂死（wipe step 的 await 不被 catch）。修 = mid 自兜 try/catch（notify 不缺席）。
- **P2#4/#5**：ascension fromRoom atCover 豁免成文 + 补 dismissModals；cutsceneFlows
  四处 beforeSwap 手放 notify 收净（completeRoomAndNotify 退役）。
- **P3 全收**：记名顺序提前（present 内同步 notify 重入的收口定向）；swapAnyToMap
  先 cancelAll 再对账（在队 flight 不把 delta 顶正）；:251 注释粘连；三处同拍重复
  syncMapStatus 删除；裸 hold 前提注释钉死；transitionStage enqueued 返回处理。
- 审查实证裁定（记录在案）：背靠背转场的 transitionBusy 微任务窗口被家族标签互等
  堵住为真（smoke-transition-trace）——该安全性依赖 waitTags 继续含家族标签。

**验证**：10 份冒烟（原 7 + 专家 3）+ wireFuzz/wireDiff 0 差异 + npm test + build +
九条 e2e（七链 + quitmid + scalarch）+ soak PASS（含新 dedicated 保险丝门；campTraining
逃生舱 = 训练义务门既有口径）。审查验收口径复核：路由一处派生 ✓ / 调用点清点归一 ✓
（六点收编 + 一处成文豁免）/ 标量通道最小形态 ✓（边界守住、代数正确、正常路径不烧
保险丝）/ rig 回执 ✓。

**P3 后状态**：重构主体（P0-P3）收官。剩余开放项 = P4a（idle-gated notify，须定义
最大延迟）、P4b（长期搁置）、P5（战斗内三口径类型化）+ ambient 约定（P4a 触发条件）。
全部未提交（k3-refactor）。


### 9.18 notify 重整批（2026-10-14 用户裁决「notify 是大杂烩，内容触发彻底下沉触发源」，已实施并验证）

**动机**：用户审阅 notify 后定调——它成了 run 层事实上的「变异后果 tick」，三层职责
焊死一体（显示投影 / 阶段协议 / 内容触发），maybeTutorDevour 之类纯内容挂在每次刷新
上重查。P4a（idle 门控）暂缓，先把这个函数拆干净；「该放弃的我们就放弃」。

**落地形态**：
- **notify 瘦身为纯显示投影**：roomScenePending 复位 + syncMapStatus + panelSnapshot
  三舞台分发 + questions.drive（问句呈现是协议不是内容，留下）。52 处调用点零改动。
- **settleStageEffects（阶段协议四件）**：persist 检查点 / prep 战前预热（自兜
  try/catch——陈年坏档死键只损失加载窗不炸构造）/ end 终局路由 / （STAGE_CHANGED
  已删）。宿主三个阶段落定点 = transitionStage 中点、swapAnyToMap 尾、**构造尾**。
  STAGE_CHANGED 整删（零监听方，runEvents.js 文件删除，YAGNI）；claimReward 终局
  分支改直调 enterEndScreen（不再借 notify 路由）；endBattle 败北显式路由。
- **内容触发彻底下沉触发源**（用户原话「这都是纯粹的内容」）：
  - 遗物获得特写：diffNewRelics 差分删除 → `showcase.presentRelic(id)` 显式入队，
    六处授予源 = endBattle（finishBattle 前后留影捕获 boss 掉落）/ gurpas buy /
    shopTakeRelic / slotTake（slot.lastSpin 留影）/ runQuestions slotPrize 直答分支 /
    runDebug 两 op；事件路径走 core `runEffects.gainRelic` 声明 presenter 意图
    （kind 'relic'）→ flushRunPresentations 路由。队列 = onDismiss 链式补排 +
    空闲沿补排（特写不占队列，通用 presenter 特写也补挂 onDismiss 补排钩）。
  - 吞噬教学 / 恶魔解说：迁入 runMachines；触发 = spin onEnd 揭示拍 / bankDo
    overdraft 尾拍 / onSlotRoomEntered 进房钩子（App.vue 读档 → enterRoomPresentation
    派发，恢复即重发）。触发源单源性已核对（slotDevour 只由 spinSlot 喂、pendingRoll
    只由 bankOverdraft 创建）。
- **scalars.reconcile + 特写补排 → 空闲沿家政**（offIdleHousekeeping，dispose 退订）。
- **DedicatedSequencer.onIdle**：忙→空翻沿、**queueMicrotask 延迟 + 触发前重查非空
  即自灭**（稳定空闲语义——实测缺陷：吞噬金币接力「holdBeat 收尾 → flight 入队」
  两条语句间队列瞬时真空，同步空闲沿把对账提前打、飞行 onEnd 又往已愈合基线 +9）。
- 清理：runBus（零发射零监听）删除；w6fight 陈年坏档（punch×5）重造；soak 启动
  等待改条件式（vite 冷转换下固定墙钟赶在 __shell 之前）。

**收官审查（expert，当日修毕）**：
- **P1**：构造期 settle 在 cutscene TDZ 内触发 end-entry 流程异常收尾，又被单飞守卫
  拦住 App.vue 补偿调用 = 登顶档「继续存档」软锁。修 = settle 挪构造尾（一切依赖
  就位，App.vue 重复调用被单飞幂等吸收）+ 新增 endsave-e2e 防回归闸（end 档起跑必
  出结算屏）。
- **P2**：prep 期 equip/unequip/useRelic 不再即时落盘 → 消耗型遗物可退出重进刷次数。
  修 = 三个意图处理器补 persist()。
- P3 采纳/存档：filler 重复授予对留影差分不可见（与旧差分同病，Boss 掉落透出待做）；
  slotTake 调试档恢复时 lastSpin=null 盲点（debug-only）；demon 金币「选词条瞬间
  先消失再飞回」观感（标量通道批次引入，观感裁决归用户）；runQuestions drive 的
  presented 无早退 = 让位机制承重（有意，spam 有界自灭）。

**验证**：9 冒烟 + wireFuzz/wireDiff 0 差异 + npm test + build + **十条 e2e**（九链
+ endsave）全绿 + soak（超时/静止/pageErrors/逃生舱口径全过；唯一 FAIL 类 =
ambientMotes.js 每发射器登记新粒子类型无缓存打满 64 上限——用户在途未跟踪文件的
独立缺陷，与本批正交，已上报待其定夺：类型回收 / 上限 / 参数折叠缓存）。

P4a 门控本体随后落地（§9.19）。

### 9.19 P4a 门控本体落地 + 收官审查（2026-10-14 用户令「继续P4」，已实施并验证）

**形态**（§9.18 重整即前置——纯投影才配门控）：
- **notify(opts) 门控**：`!force && pendingCount > 0` 跳过整个显示刷新；**空闲沿无条件补发**
  （非挂脏才发——漏喊的刷新在下一次排空自愈，「漏 notify」族由结构消灭）。无时间帽
  （用户裁决：排空前方的演出时长不可知，玩家节奏段旧值等待是正确语义）。
- **空闲沿家政合流**（一个订阅按序）：scalars.reconcile → notify 补发（先分布后 drive =
  问句呈现读到新鲜快照）→ 遗物特写补排。
- **force 六点**（各带契约注释）：transitionStage mid / 进阶 atCover（揭幕就位）、endBattle
  （奖励 overlay 即刻可交互）、无舞台快路径、训练流与抓牌开局（快照新鲜度——直开选卡读
  panelHost._snap，门控跳过分布 = 旧快照开卡）、拉杆拍（转轮窗内按钮即时置灰）。
  四域 ctx 的 notify 包装统一 opts 透传。

**收官审查（expert，2×P1 + 2×P2 当日修毕）**：
- **P1-1 免费升级链软锁**（P2-slot 批遗留，非门控引入但落在本批爆炸半径）：kit 的
  openSlotPrizeShowcase onDismiss 用**闭包捕获的旧快照**链式开升级选卡——slotTake 之前
  快照的 upgradeCards 恒空 → 选卡永不弹 → slotPending+slotUpgradePending 双挂死离房门
  （场景路径 100%，slotq 三分支断言从未强制覆盖该分支）。修 = 链收进编排器：slotTake
  检测 slotUpgradePending → force notify + 直开 openUpgradePicker('slot')（panelHost 读
  活 _snap）；kit 闭包链删。新增 fupq-e2e 防回归闸（**造档要过晋升门禁：--leino fire=2**，
  否则全牌组 enabled=false 开不出选卡——expert 探针曾被此与 F9 面板吞点击双重迷惑）。
- **P1-2 教学流程互等环**：tutor 的 waitFor(!slotPending && !uiBusy) 持队等待，玩家在
  150ms 轮询窗内再拉杆 → 产出特写被门控推迟（队被 tutor 占着）→ 玩家无法领取 → tutor
  永等（且标记入队即消费 = 永不重播）。修 = **限期让位语义**：等待期出现 slotPending 即
  放弃本次（流程指令对房间状态只做入队门槛 + 限期重试，不持队等待）、生涯标记挪到
  开播前消费、调用点 findPending 防重排。
- **P2-1 恶魔链尾选卡读陈旧快照**：showcase ctx 补 opts 透传 + playDemonReward 链尾
  openBankOfferPicker 前 force notify（候选不得含已焚卡——幻影卡播完演出 core 拒账）。
- **P2-2 shopBuy 硬化**：try/catch 对齐 bankDo/gurpasDo 惯例（门控把陈旧窗拉宽到出货
  指令全程，场景端按旧 affordable 放行的重复点击不得炸穿）。
- **P3 全收**：boss-remove 候选——**第一版 force notify 是错的**（窗口期 gameStage 已离
  reward，battleStage 面板分发是 setPanel(null)，force 把旧代码依赖的 reward 快照清掉 →
  opened=false 静默作废；bossq e2e 抓回）。修 = panelHost openUpgradePicker 支持
  **opts.snap 现场投影直喂**（流程自算 panelSnapshot(run,{})，不读分布式快照、不再 force）；
  holdBeat AFK 边界（30s 保险丝收走后 delta 已被对账清零）——收尾函数透传 finish 回执，
  devour 侧 false 即跳过 flight 防过冲；门控谓词注释钉死「pendingCount 含旁挂指令是近似，
  新增长期占队旁挂类型须重估」。
- 实测回归两处（slotq 抓）：**转轮防连点**——旧代码靠 notify 立即置灰拉杆按钮，门控推迟
  置灰后演出窗内可连点堆杆。修 = spin() 类型化队列守卫（findPending room:slot-spin 即拒）
  + 拉杆拍 force（置灰即时，手感平价）。**教学对话交错**——喂满那拍弹开的对话占队推迟
  横幅清除补发（对话盖着横幅玩家无感，排空即清）：e2e 改「边等横幅边消化对话」轮询。

**验证**：9 冒烟 + wireDiff 0 + npm test + build + **十一条 e2e**（十链 + fupq）全绿 +
soak（我的面全过；唯一 FAIL 类 = ambientMotes 粒子类型 64 上限——用户在途未跟踪文件
独立缺陷，两轮上报待定夺）。P0-P4a 至此全落地；剩 P5（战斗内三口径类型化，押后）与
ambient 约定（画廊入队，独立小活）。

## 附：证据索引

- bug 考古全表 + 散落模式 file:line 清单：调研会话输出（2026-10-13）。
- 第一轮对抗审查 + 六疑点裁决全文：评审会话输出（2026-10-13，三份，含全部 file:line 证据）。
- Stage 层视角上轮审查：`quest_prompts/FRONTEND_STRUCTURE_REVIEW.md`。

### 9.20 残留收尾批（2026-10-15，架构评审后用户四项裁决，已实施并验证）

评审定位的六处残留按用户裁决逐项落地：

1. **义务门收编 core（§4.3 决策补执行）**：completeRoom 挂问句硬门（`currentQuestion(run)`
   非空即抛、错误带种类）——训练房 trained 门保留，pendingUpgrade 专属门删除（被问句门
   蕴含）；执法单点在 core，shell/场景端只做提示 UX。roomSnapshot 新增 `duty` 字段
   （= 问句种类单一事实源下发）：RoomStage 继续键压暗泛化为 `machines ∪ duty`、机器没
   接手的种类在继续键上通用拦截提示；campTraining/vending/slotMachine 三机器的
   pendingDuty/onContinue 全部改读 duty 种类（trainingDraw/bankOffer 从此自动进门，
   新增问句种类零手改）。headless engine.mjs 的手写枚举门保留（UX 提示用途）。
2. **ascension 共享收尾**：场景对话路径与面板应答路径统一走 `ascensionTail`（结果页 →
   能力授予 → 退出切幕 → 跳过删卡）；chooseAscensionDimension/skipAscension 的两条
   `void async IIFE` 裸链删除，改 'ascension-finish' 流程指令（tagAll:false 同 devour
   代数）。行为一致性补齐：面板路径现在也播结果页、跳过也当场弹删卡（旧面板路径跳过的
   删卡机会要等下一场战斗后才被消费）。
3. **transitionBusy 删除**：sceneTransition 不再自带单飞——唯一调用方 transitionStage
   的家族标签互等已是结构担保；原「并发裸奔直切」降级路径恰是黑幕中点纪律要防的语义，
   属该删的死防御位（用户原则：兜底越少越好，最薄链路最接近完美形态）。
4. **rig 拒拉并圈**：pull 在转轮中不再返回 false，onDone 串到在转那圈的落定拍（与旧
   轮询等时零定时器）——slotMachine 机器的 120ms isBusy 轮询与 slotPoll 变量整体删除
   （dispose 残留引用一并清）。「唯一残存轮询」清零。
5. **bankOffer 应答统一进协议**：answerQuestion 加 `opts.kind` 定向参数（共存态点名答
   哪一问，不匹配返回 false 不落账）；runShowcase 的 onSkip 弃置与无候选自动弃置两处
   直调 takeBankOffer 改走 `answerQuestion(run, null, {kind:'bankOffer'})`，例外登记
   进 questions.js 头注（共存态承重场景由机制本身承载）。
6. **trainingDrawRoll 双保险删除**：手动直开选卡与手动 kick 升级链删除，呈现与自动链
   全走问句驱动（notify 尾 drive 同拍呈现；空闲沿补发驱动尾款链）——e2e 实证驱动链
   完整接棒。

顺带：settings.js 的 `import.meta.env?.DEV`（node 冒烟可直接 import shell 模块，浏览器
语义不变——此前 runMachines→settings 链让 devour 冒烟在 node 下必炸）。

**验证**：node 冒烟（questions 五份 + devour + sequencer + quiescence + transition 三份 +
scalars + 新增 kind-target 9/9 与 duty-gate 9/9）+ npm test PASS + build ✓ + e2e 四链
全绿（trainq 12/12、slotq 18/18、bankq 9/9、flowq 12/12 二跑——首跑 reload 后点击 flake
复跑绿）。

**过程中甄别的存量问题（非本批回归）**：① trainq-e2e 环境过期——重造档无升级目标
（尾款自然免除）+ 盲点对话在选项页命中「跳过进阶」→ 删卡选卡假阳成「四选一」；
已修脚本（forge 行补 `--leino fire=2`、进阶选项显式 cutsceneChoice）。② smoke-run
深潜局 floor 12 战斗 400 步卡死、smoke-camprules uniqueID 崩、smoke-shell-transition
引用已删卡 mountainCleave——均在未改动提交树上一致复现，属平衡/旧脚本漂移。

**开放任务（用户令）**：单独一轮「兜底代码没删干净 / 不需要的兜底逻辑与状态」全库排查
（已记 TODO.md）。


## 9.21 全库兜底排查 + 注释精简（用户令的独立清理轮）

三片只读排查（shell / stage / core+bridge）+ 七区注释编辑并行铺开，逐条裁决落地。

**兜底删除（行为零变化类）**：App.vue enterEndScreen 重复调用（构造尾单源）；quiescence
capMs 死参 + deadline 永假分支；transitionStage / maybeEnterRestScene 的 `if (!enqueued)`
永假分支；SceneWipeOverlay `??` 永假；claimReward 清 slot.lastSpin（问句 close 已单源）；
panelSnapshot canStartBattle 永真 flag（连同 prep.js 消费位）；ascension totalLeino 死导出；
stagePickerKit upgrading/burning 空挂 getter；rig paintBulbs 死参 / isDemon 死 API /
st 未初始化字段补齐；machines/slotMachine `_removeGift(0.5)` 被忽略实参；sync.js reconcile
路 _updateDoomMarks 重复刷新；RoomStage `_activate` 的 stagePanel 不可达分支；MapStage
arriveFloor 防御 _settleRise（onExit 收真路径）；campTraining 'train' 三层保险的最外不可达层；
cards.js DRAIN_FLIGHT_MS 固定延迟死路（光珠真到达已全覆盖）。

**兜底改 throw（静默降级 → 显式契约破裂）**：runDriver 训练尾款防御 break；gurpas /
shop 未知商品类型兜底；slotMachine takeSlotPrize 空候选硬化（decline 出口仍在）；runFlow
roomOf 无表现场随机（回落会静默消耗 rng 主账本）。

**真 bug 修复**：① toTitle/dispose 不停氛围床（营地 Esc 回主菜单篝火氛围一路响）——
stopAmbience 收进 runController.dispose 单源，enterEndScreen 的死位删除；②
stagePickerKit burnBusy 声明「同上吞指针」但三条路由都没查——补齐三处 + dispose 重置。

**恒真可选链成组清理**（同一进程内必真的 `?.`，headless 合法缺席的外层保留）：
runController / runShowcase / runMachines / runQuestions / runCutsceneFlows / stageDirector /
App.vue / BattleStage / battleBeats（units/sync）。⚠ `_drainFx?.` 保留——createResourceDrainFx
池缺位返 null 是真缺口（排查代理误判，已复核）。

**注释精简**：全库 ~160 文件，删日期/轮次/出处/旧版对照考古（规则留为现在时陈述），
删所见即所得复述与跨点重复；relies：核心抽象注释保留设计原则，口径/时序/不变量保留。

**保留的拿不准项（报用户裁决）**：panelSnapshot 'training'/'camp' 旧档分支（saveRestore
原样恢复旧 roomTable——存档截断日拍板）；event.js findScript 内容删除退回重抽（事件
注册表仍在活跃迭代）；runFlow+shell 的 ascensionReady 离房接棒双写（跨层恢复路径，两片
排查结论相左，保守双留）。

**验证**：冒烟（duty-gate 9/9、kind-target 9/9、devour 14/14、smoke-run 6 种子整局 ✓ +
floor12 预存卡死复现即已知问题）+ npm test PASS + build ✓ + e2e trainq/slotq 全绿。
