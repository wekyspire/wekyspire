# THREE_UI_MIGRATION — 休息阶段 UI 全量 three.js 化

> 状态：**v5（2026-09-10）**，已过两轮对抗性评审；§6 待定项已由所有者全部裁决；**P0 + P1 原语 + prep/reward 两个面板已执行**（见 §7）。
> 本文档是本次迁移的**单一事实源**；与 `THREE_REFACTOR_PLAN.md` 冲突时以该计划为准，并回写本文档。
>
> **v3 → v4**：①§6 六项待定全部裁决（测试暂停对本次迁移**豁免**；**滚动改为自实现全屏竖向滚动条**——
> 推翻 v1–v3 的「分页替代滚动」，见 §5.2）；②§4.3 契约门生效；③新增 §7 执行进度。
>
> **v4 → v5（执行进展）**：prep（锚定）+ reward（模态，含卡面三选一）已迁入 Three 并删除 Vue 组件；
> 新增 `core/skills/cardView.js`、`richtext/cardFaceDefaults.js`、`objects/cardMetrics.js` 三处抽取，
> 使卡面烘焙/尺寸在战斗与面板间**同源**（原本将出现第三份复制）。实施中由契约测试抓出并修掉两个真 bug：
> ①烘焙文本高于行框导致行重叠（现等比收进行框）②瓦片（横向组）点击路由查不到 action（改为显式 action 表）。
>
> **v1 → v2 修订记录**（评审：kimi k3 `expert` 子代理，逐条核对代码后提出 3 阻断 / 4 重要 / 8 处事实错误）：
> ①补 §2.3 tooltip 转发管道（v1 漏掉，P2 必爆）；②把老虎机演出改造并入 P2-RoomPanel（v1 分期自相矛盾）；
> ③快照推导下沉到 `core/run/` 纯函数并改掉错误的 DisplayModel 类比（§2.1 重写）；
> ④防线 1 改成可 grep 的红线（原文与现状冲突）；⑤PanelObject 分模态/锚定两形态（PrepPanel 非模态）；
> ⑥修正 `runPanels.css` 用户；⑦测试门与「测试维护暂停」的冲突列入 §6 待裁决；
> ⑧补长列表/删卡界面、MapStage 复杂度转移、可访问性三处逆向风险。
>
> **v2 → v3 修订记录**（第二轮核对）：B1–B7 与四类逆向风险经逐行读码**确认闭合**；
> 修正 v2 自己修过头的 `runPanels.css` 用户清单（真实用户只有 **Reward/Room/Ascension 三个**，
> PrepPanel/EndPanel/MenuDialog 各有一份 scoped 仿制）；补 §4.4 健康度终判与**净提升子集**；
> 补 §4.2-7 跨面板烂尾防线。

**这不是新方向，是补完已定的架构。** `THREE_REFACTOR_PLAN.md` §0 决策表已把职责划死：

- `:16` three.js 职责 =「牌桌、卡牌、角色状态、**战斗全部 UI、休息阶段全部 UI**」
- `:264`「**rest 阶段全部 UI 在 Stage 内实现**（按钮/列表走 hit map 模式）；Shell 在 rest 阶段只保留 tooltip 与弹窗」
- `:316` 计划第 7 项 =「**Rest 阶段 Stage 化**：奖励/商店/整备面板（hit map 按钮模式）」
- `:11` 每张烘焙表面同时产出 hit map（交互热区），**替代 DOM 交互**

当前仍由 Vue 渲染的休息阶段面板属于**该计划尚未执行完成的部分**。本次迁移的目标即补完它，
并借此提升项目健康度（§4，含诚实的收益与代价两侧）。

---

## 0. 决策记录

| 决策点 | 结论 | 依据 |
|---|---|---|
| 迁移范围 | PrepPanel / RewardPanel / RoomPanel / AscensionPanel（休息·发育阶段） | 计划 :16、:264 |
| 不迁移 | EndPanel（**幕间**）、StartScreen、GameMenu / MenuDialog / MenuPopup、CutsceneOverlay、BattleHud（**战斗日志**） | 计划 :15 逐项明列 |
| tooltip | **保留 DOM**：`TooltipOverlay` + `tooltipHub` + `tooltip.js` | 计划 :15「tooltip popup」属 Vue；:264 同 |
| 卡片预览 | 保留 `CardFacePreview`，但其用户**只剩 TooltipOverlay 的整卡预览**；**面板内卡面一律走 Three `CardObject` + Picker**（复用 CardGalleryObject 协议），DOM 热区换算（`CardFacePreview.vue:84-94`）随面板删除 | 现状核实 |
| 面板容器形态 | `PanelObject` **分两形态**：模态（背板 + 居中，Reward/Room/Ascension）／锚定（无背板 + 定角，**PrepPanel**） | `PrepPanel.vue:44` 是 `fixed; left:12px; top:12px; width:250px` 侧锚面板，套全屏背板会压暗塔楼 |
| 滚动列表 | **自实现全屏竖向滚动条**（所有者裁决，推翻本表原「分页替代」结论）：只在全屏 overlay 中竖向滚动，边界即屏幕边界，不需要容器边界/嵌套交互 | §5.2 |
| 表单输入 | 不在 Three 内实现（无 `<input>` / checkbox） | 计划 :15 |
| 塔楼美术 | 不重做 `MapStage` 夜空/层块占位（待用户提供素材） | 非目标 |
| 特效时机 | **先搬过去 + 简陋占位**（纯色板/色块/文本 icon），美术到位后再做正式表现 | 所有者裁决（§6.4） |
| 商店形态 | 原语**预留**商店形态（近期与 relic 系统一起加入） | 所有者裁决（§6.5） |
| 回退策略 | 每期一个开关，先例 `runController.js:46` 的 `USE_PCG_ROOMS`（一键回退） | 项目既有范式 |
| 迭代成本 | 新增 `uiGallery.html` 浏览器视觉门 | 先例 `propGallery.html` / `roomGallery.html` |
| 测试门 | **生效**：所有者已对本次迁移显式豁免 AGENTS.md「测试维护暂停」 | 所有者裁决（§6.1） |
| 面板顺序 | 不按美术就绪度重排，全部先用占位实现 | 所有者裁决（§6.6） |

### 0.1 目标

1. **补完分工**：消除「同一层界面两套技术栈」的长期分裂。
2. **演出可编排**：休息阶段动画接入 run sequencer，为正式美术资源到位后的特效铺路。
3. **健康度提升**：按 §4 执行，收益与代价两侧都写明，且每项可验证或可 grep。

### 0.2 非目标

- 不重做塔楼/夜空美术（`MapStage._buildStars` / `setFloor` 的占位层块留待素材）。
- 不迁战斗层（BattleStage 内 UI 已是 Three）与菜单层。
- **不改 Core / Bridge 的结算协议**。本次只动 Stage、Shell，以及新增一个 core 纯函数（§2.1）。

---

## 1. 现状（证据）

### 1.1 目标面板与 DOM 依赖

| 面板 | 阶段 | 行数 | DOM 依赖 | 迁移难点 |
|---|---|---|---|---|
| `PrepPanel.vue` | prep | 65 | `position:fixed` 侧锚 + hover | 无（**试点首选**） |
| `RewardPanel.vue` | reward | 69 | fixed 模态 + hover + 卡面热区 | 低 |
| `AscensionPanel.vue` | ascension | 178 | CSS grid + 多选态 + 绝对定位角标 | 中 |
| `RoomPanel.vue` | room | 161 | **横向滚动条** + CSS keyframe + `@animationend` 当完成信号 | 高 |

共享资产：

- **`components/runPanels.css`（130 行）的真实用户只有三个：RewardPanel（8 处）、RoomPanel（21 处）、AscensionPanel（12 处）**
  （`App.vue:29` 全局引入）。
  **PrepPanel 不是用户**（自带 scoped `.prep/.climb/.section/...`，`PrepPanel.vue:17-38`）；
  **EndPanel 不是用户**（自带 scoped `.panel`，`EndPanel.vue:9,17-21`）；
  **MenuDialog 也不是用户**（类名全为 `menu-dialog-*`，`MenuDialog.vue:27-40`；`:3` 只是注释里说「visual 语言沿用 run-panel」）。
  即：除共享 CSS 外，还有 **三份各自抄写的面板视觉**（Prep / End / MenuDialog）——**这是比「共用 CSS」更直白的重复证据**。
- `CardFacePreview.vue`（Three 烘焙 → `toDataURL` → `<img>`，热区走同一套 `hitTestRegions`）
  —— 迁移后仅余 TooltipOverlay 一个用户（见 §0）。
- `TooltipOverlay.vue`（`position:fixed`，坐标强绑 `#game-frame` 局部像素）。

### 1.2 已有基建（全部为生产代码，非原型）

| 能力 | 载体 | 现状 |
|---|---|---|
| UI 二次渲染 pass | `StageManager.js:195-206` 正交 `uiCamera` + `uiScene`；`WORLD_HEIGHT = 100`（`:13`） | 战斗与地图都在用 |
| **10px 逻辑像素 = 1 世界单位** | 约定在**烘焙层**，不是 StageManager：`buttonFace.js:3`、`CardGalleryObject.js:195`、`TopResourceBarObject.js:28`（`_ppw = 10`） | 新原语须沿用 |
| 烘焙文本 | `richtext/texture.js` `renderRichTextBlock` + `richtext/layout.js`（产 `hitRegions`）+ `textBakers.js` `bakeBoldText` | `TopResourceBarObject`、`PlayerStatusObject`、卡面在用 |
| 可点击按钮 | `richtext/buttonFace.js` `bakeButtonFace`（enabled/active/disabled 三态）+ `CardObject` 当按钮 | `BattleStage.js:246-256`（`addPickable` 在 `:254`），点击分发 `:1436`/`:1450` |
| **全屏模态面板** | `objects/CardGalleryObject.js`（212 行）：模态背板 plane + 烘焙标题/提示 + 自适应网格 + hover 抬升 + `ownsHit` 点背景关闭 | 牌库查看器；**几乎就是本次要的模态容器** |
| 拾取 | `picker/Picker.js`：`addPickable(id, obj, {kind, space})`、`pick()`、`hover()`（发 `TOOLTIP_SHOW/MOVE/HIDE`）、隐藏对象不可命中 | BattleStage 已接（`:171`）；**MapStage 未接** |
| 状态件先例 | `TopResourceBarObject.js`（金币 + 遗物槽，含签名 diff 免重烘）、`PlayerStatusObject.js` | `MapStage` 已在用 |

### 1.3 四个缺口（管道 / 原语 / tooltip 转发 / 滚动）

1. **管道**：`MapStage.js:25` 构造器不接收 picker；`App.vue:96-104` 的 `onPointer` 硬编码
   「只转发 battleStage，且限 `gameStage === 'battle'`」。塔楼层/房间层**没有任何 canvas 内交互通道**。
2. **原语**：Panel / Button / TextBlock / 网格布局都锁在 BattleStage 与 CardGalleryObject 内部。
   这是「搬家」，不是「发明」。
3. **tooltip 转发链**（v1 漏项）：3D 源 tooltip 的**唯一转发器是 `BattleHud.vue:19-29`**，
   它订阅 `bridge.frontendBus` 转调 `tooltipHub`；而 **BattleHud 只在 `stage === 'battle'` 挂载**
   （`App.vue:154`）。所以 rest 阶段 3D 面板内的卡面 `/named` `/effect` 热区**没有任何转发器**。
4. **滚动**：`RoomPanel` 的候选行是 `overflow-x:auto` + 自定义滚动条，`runPanels.css:41-45`
   还有为**滚动可达性**写的注释。这是唯一一个新机制（§5.2 决定绕开）。

---

## 2. 目标架构

### 2.1 数据流（**承重决策**：决定了整个迁移的健康度真假）

**铁律：Stage 不得自行拉取 run 状态。** 现在 Vue 面板直接读 `ctrl.run` 并直调 `ctrl.equip()` 等
（`PrepPanel.vue:31-34`）；Three 对象是命令式的、无响应式追踪，若放任各面板自行取状态，
`Stage` 会开始依赖 `core` 的**状态模块**，健康度不升反降。

> **但注意红线不是「Stage 不许 import core」**——现状 `MapStage.js:3` 就 `import { isBossFloor }`
> 自 `core/run/runFlow.js`，`cardFace.js:21-23`、`art/preload.js:7` 也在读只读定义注册表。
> 真实红线是「**Stage 不许拉取 run 状态与可变单例**」（§4.2-1）。

**唯一通道（两步，缺一不可）：**

```js
// ① 快照推导：core 纯函数（新文件 src/core/run/panelSnapshot.js）——纯数据、可序列化、无函数
export function panelSnapshot(run) {          // run → 面板状态
  return { kind: 'room', roomType: 'slot', title: '老虎机', wallet: 42,
           choices: [{ id, label, sublabel, enabled, disabledReason, tags: [] }],
           cards: [{ uniqueID, defId }], result: null };
}
// ② 编排器只做透传（不在这里推导，否则观战/headless 拿不到）
mapStage.setPanel(panelSnapshot(run));
// ③ 意图上行：舞台只上报「谁被点了」，不解释游戏语义
onPanelIntent({ kind: 'room', action: 'spin' });        // → runController 分发到 Core
```

**为什么纯函数必须放 `core/run/` 而不是 runController**：观战中继 `tools/broadcast.mjs` 经
`tools/playSession.mjs` 的 `freshState` **直驱 Core、从不经过 Shell 的 runController**；
放 Shell 则中继永远拿不到，只能自行重抄一遍推导 → **第二事实源**。
放 core 则中继同源复用，休息阶段的状态推导只有一个实现。

**先例（准确的那一个）**：`runController.js:117-132` 的 `syncMapStatus` → `MapStage.setStatus`
（纯标量推流）；**不是** `bridge/displayModel.js`——它是战斗卡牌 zone 的节拍权威，与直推快照不同物。
`bridge/intents.js:7-8`（「UI 操作 → flow API 的唯一入口」）是上行侧的准确先例。

**与战斗侧的差异（有意收紧，不假装同构）**：战斗侧 Stage 持有 bridge 并直调
`bridge.intents.playCard/...`，自己还做可用性判断（`BattleStage.js:837`、`:1426`、`:1444-1445`）；
本方案的 `onPanelIntent` 比它更严（Stage 连可用性都不判断，`enabled` 由快照下发）。

### 2.2 对象模型（新增，全部放 `src/stage/objects/`）

| 对象 | 职责 | 泛化自 |
|---|---|---|
| `PanelObject` | **两形态**：模态（背板 + 标题/副标题/提示 + 居中内容区 + `ownsHit`）／锚定（无背板 + 定角 + 尺寸约束）。PrepPanel 用锚定，其余三个用模态 | `CardGalleryObject` |
| `ButtonObject` | 烘焙按钮 + hover/active/disabled + Picker `kind:'button'` 注册 + `onClick` | `BattleStage.js:246-256` 的接线 |
| `TextBlockObject` | `renderRichTextBlock` → plane，带 `hitRegions`（token → tooltip 自动打通） | `TopResourceBarObject` |
| `TileGrid` / `ListLayout` | 瓦片与列表锚点计算（列数/间距/安全带） | `CardGalleryObject` 的网格 + `layout/LayoutEngine.js` 的锚点表模式 |
| `ScrollListObject` | **全屏竖向滚动列表 + 滚动条**（牌库级选卡界面用，见 §5.2）：模态背板 + 内容裁切 + 滚轮/拖拽 + 滚动条几何；滚出可视区的项 `visible=false`（Picker 的 `visibleUp` 守卫使其不可命中）。**消费者就位时再落地** | `CardGalleryObject`（背板）+ 新建的滚动/裁切 |
| 面板内卡面 | 直接用 **`CardObject` + Picker**（`kind:'card'` + `cardObject` 引用 → 卡面 token 走 `hitTestUV` 二级查询） | `CardGalleryObject` 协议 |

**不得**把这些写成 `layout/LayoutEngine.js` 的新分支——那是手牌专用力学，继续专物专用。

### 2.3 输入路由与 tooltip 转发（P0 的两件交付物）

- **指针路由**：`MapStage` 增 `new Picker({ stageManager, bus })` + `handlePointerMove/Down/Up(x,y)`
  （照抄 `BattleStage.js:171`、`:1325-1331`，含 hover 前 `uiScene.updateMatrixWorld(true)`）。
  `App.vue` 的 `onPointer` 改为「转发给当前舞台」：`battle` → battleStage，其余 → mapStage。
- **bus 选择（已定）**：用 run 级 `animBus`——它在 `runController.js:80` 创建一次、
  以 `frontendBus` 注入每场战斗（`:178`），**跨阶段存活**，正是 rest 阶段也需要的生命周期。
- **tooltip 转发管道（v1 漏项，P0 必须建）**：新增一个**常驻**转发器（挂在 `App.vue`
  或 `TooltipOverlay` 层，不随 `gameStage` 卸载），订阅 `animBus` 的
  `TOOLTIP_SHOW/MOVE/HIDE` → 调 `tooltipHub` 的 `tooltipShow/Move/Hide`。
  订阅关系：

  ```
  rest 阶段：MapStage.Picker ──animBus──▶ [常驻转发器] ──▶ tooltipHub ──▶ TooltipOverlay(DOM)
  战斗阶段：BattleStage.Picker ──frontendBus(=animBus)──▶ BattleHud(现有转发器) ──▶ tooltipHub
  DOM 源：  CardFacePreview ──(直调 tooltipHub)──▶ tooltipHub        ← 随面板迁移逐步退役
  ```

  注意两条转发器会**同时**存在（BattleHud 战斗中挂载、常驻器始终在）。**必须避免同一事件被转发两次**：
  常驻转发器只在 `gameStage !== 'battle'` 时消费，或改为把 BattleHud 的转发职责整体移入常驻器
  （二选一，P0 内定，并在契约/视觉门里锁住「战斗内 tooltip 不抖动」）。
- **键盘不变**：`App.vue:124` 的 Esc 是 window 全局监听，与 DOM 无关。
- **面板显示时屏蔽世界层拾取**（等价于现状 DOM 面板盖住 canvas）：由 Picker 优先级 + `ownsHit` 保证，
  须进验收。

### 2.4 演出

`runController.js:81` 已有**跨塔楼/房间/战斗/剧本共享的** `AnimationSequencer`；
`arriveFloor` 与老虎机 roll 已在走它（`:230`、`:293`）。迁移把 CSS 的东西收进同一时钟：

- **老虎机 roll（必须在 P2-RoomPanel 当期一并改造）**：现行完成信号是 DOM 的 `@animationend`
  （`RoomPanel.vue:128` → `ctrl.reportSlotAnimDone` → `runController.js:292-313` 的 `slotFinish`），
  且揭示语义依赖它（`:304`），`runController.js:298` 只有 4000ms 保险丝兜底。
  **删除 RoomPanel.vue 的瞬间这条回执来源消失** → 必须同期换成 **MapStage 侧回执**
  （`arriveFloor({ onDone })` 是现成范式），否则「roll 落定才开闸」会被破坏。
- 渐进揭示（训练候选、奖励入账）→ sequencer 分拍指令。
- hover 抬升等纯视觉 → 对象内部 `update(dt)`，不进 sequencer（不必阻塞队列）。

---

## 3. 分期计划

每期独立可验收、可回退；**未过门不进下一期**。

| 期 | 内容 | 出口标准 |
|---|---|---|
| **P0 管道** | ①MapStage 接 Picker + `App.vue` 指针路由泛化；②**常驻 tooltip 转发器 + 双重转发裁决** | 塔楼/房间阶段能收到 canvas 内 pointer 事件；**画面与行为零变化**；战斗内 tooltip 行为不回归 |
| **P1 原语** | `PanelObject`（两形态）/ `ButtonObject` / `TextBlockObject` / `TileGrid`；`panelSnapshot` 纯函数 | `uiGallery.html` 可独立调参预览；`panelSnapshot` 有确定性用例（若 §6.1 解禁测试） |
| **P2 面板** | PrepPanel（试点，**锚定形态**）→ RewardPanel → AscensionPanel → RoomPanel（**含老虎机 sequencer 改造**） | 每个面板：Vue 版删除、开关可回退、过视觉门；prep **塔楼可见性不回退**；老虎机揭示语义不变 |
| **P3 收尾** | 训练候选渐进揭示 + 正式特效接入 | 无 DOM 动画事件残留；演出由 sequencer 编排 |

**顺序理由与解耦**：P0（管道 + tooltip 转发）与 P1（原语）是**纯增量、无争议**，可先落地；
P2 允许**按美术就绪度重排或缩减**——美术临近时，某面板可跳过「占位翻译」直接按正式设计做 Three 版
（四个面板现均为占位 UI，`runPanels.css:3-5`、`AscensionPanel.vue:143`、`RoomPanel.vue:3` 注释明写「美术到位后换图」）。
PrepPanel 最轻却一次跑通「容器 + 按钮 + 文本 + 指针路由 + tooltip」整条链路，仍作 P2 试点。
RoomPanel 最重（滚动 + 老虎机演出），放最后。

---

## 4. 健康度：度量与防线

### 4.1 提升项（诚实标注真实性）

1. **架构一致性｜真实**。计划 `:16`/`:264`/`:316` 原文核实无误，四个 Vue 面板确属第 7 项未执行部分；
   「同一层两套技术栈」是事实（`App.vue:153-157`）。
2. **可测性｜潜在收益，当前被政策阻断**。技术论证成立（测试环境 node 无 jsdom 见 AGENTS.md；
   Three 对象可 headless 构造，`MapStage.js:165-170` 有 `bakeLabel:null` 退化先例，
   `test/mapStageStatus.test.js`、`test/battleStage.test.js` 是范式），**但 AGENTS.md 的
   「测试维护暂停」明确「本条与下方各条冲突时以本条为准」，覆盖了其引用的「测试范围方针」**。
   裁决见 §6.1；裁决前此收益不计入。
3. **去重｜真实，但规模有限、且净 LOC 大概率反升**。四面板重复的是**结构**（card-choices /
   pick-row / option-tile / skip-link / result-banner 五套，样式靠 runPanels.css 共享）；
   另有 `EndPanel.vue:17-21` 的第三份面板样式。收益是「**单一实现可改一处**」。
   删除侧约 600 行（473 行 SFC + 130 行 CSS），新建侧（四个原语 + `panelSnapshot` + 接线 + uiGallery）
   按 `CardGalleryObject`（212 行）类推**很可能净增**。本项**不以行数记功**。
4. **去 DOM 脆弱性｜收益打折**。`#game-frame { transform: translateZ(0) }` 这条包含块技巧
   （`App.vue:176-180`）**必须保留**（tooltip/菜单/toast 仍是 fixed）。实际收益是
   「依赖它的组件从 5 个减到 1 个（tooltip）」，而代价是引入烘焙/重烘/双相机拾取的新复杂度——
   净收益为正，但远小于「消除脆弱性」的字面。

### 4.2 防线（禁止项；违反即视为健康度下降）

1. **Stage 不得拉取 run 状态与可变单例**：禁止 `src/stage/` import `core` 的**状态模块**
   （`core/state/*`、`core/run/runState.js` 等）与 `shell/*`；**纯函数与只读定义反查豁免**
   （现状豁免清单：`MapStage.js:3` `isBossFloor`、`cardFace.js:21-23`、`art/preload.js:7`）。
   本红线须可 grep。
2. **面板对象不持有游戏逻辑**：只上报 intent，连 `enabled` 都不判断（由快照下发）。
   比战斗侧现状更严（`BattleStage.js:837` 是自行判断的）——**有意收紧**。
3. **不新增 DOM 依赖**：面板对象在无 `document` 的 node 下必须可构造（烘焙缺省退化为占位）。
4. **必须实现 `dispose()`**：geometry / material / texture 全释放，并挂进舞台 dispose 链；
   **若对象内直接用 gsap tween，tween 必须随 dispose 终止**（`StageAnimator.js:195` 是 kill 先例；
   现状 `MapStage.arriveFloor` 的 tween 未 kill，靠对象移除后写入无害兜底——新代码不得沿用这个侥幸）。
   验收含「反复进出舞台资源不增长」。
5. **不留双实现**：面板迁完即**删除**对应 Vue 组件与只属于它的 CSS（AGENTS.md「重构时删除废弃旧代码，含 CSS」）。
   `runPanels.css` 在 Reward/Room/Ascension 三个用户迁完后**直接整文件删除**（MenuDialog 不消费它，无存废依赖）。
6. **不动 Core / Bridge 结算协议**：本迁移不产生任何结算语义变化；新增的只是一个 core 纯函数。
7. **禁止跨面板烂尾**（新增，针对本迁移独有的失败模式）：§3 允许 P2 按美术就绪度重排，但**不允许**
   把「一半面板在 Three、一半在 Vue」的状态长期化——那比现状的双栈分裂更糟。
   每个面板要么整块迁完并删除 Vue 版，要么不动；**任一时刻最多允许一个面板处于迁移中间态**。

### 4.3 双门验收（沿用项目惯例）

- **视觉门** `uiGallery.html`：`?panel=prep|reward|ascension|room&seed=` 独立调参，
  与 `propGallery.html` / `roomGallery.html` 同范式。**这是本次唯一确定可用的门**，
  同时缓解「Three UI 视觉微调需重烘纹理、迭代比 Vue SFC 慢」这个真实成本。
- **headless 契约门** `test/uiPanels.test.js`：**已落地**（18 例）。覆盖快照推导、原语 headless 可构造、
  行流布局不重叠/不越界、点击路由与 disabled 拦截、重建幂等、`setPanel(null)`/`dispose` 无残留、
  tooltip 转发与**同事件转发两次的幂等**。所有者已豁免测试暂停（§6.1），本门为验收硬门槛。

### 4.4 健康度终判与验收锚点（两轮评审结论）

**确定性净提升子集 = P0 + P1 + PrepPanel + RoomPanel。**

| 子集 | 为什么是净提升 |
|---|---|
| P0 管道 | 零行为变化，且顺带补齐 rest 阶段 3D tooltip 这条**当前根本不存在**的链路 |
| P1 原语 + `panelSnapshot` | 红线收益（Stage 不拉 run 状态）+ 观战同源入口，可独立验证 |
| PrepPanel | 一次跑通「容器 + 按钮 + 文本 + 指针 + tooltip」全链路，风险最低 |
| RoomPanel | 集中了全部 DOM 高危依赖（横向滚动 + `animationend` 回执 + sequencer 耦合），边际收益最大 |

**Reward / Ascension 两面板 DOM 依赖轻、占位性质强** → 延后到美术就绪再做，不减健康度。

**健康度净下降的三个触发条件（必须避免）**：

1. **P2 烂尾**：只做一半停下 →「一半 Three、一半 Vue」比现状的双栈分裂更糟（已由 §4.2-7 禁止）。
2. **§6.1 裁决为「维持测试暂停」**：可测性收益归零，收益只剩「架构一致性」一项软收益，
   而 LOC 反升、迭代变慢的成本照付。
3. **美术长期不到位**：占位 UI「翻两遍」的成本兑现，第二遍零收益。

> **结论（对「务必保证健康度提升」的回答）**：把验收锚定在上面那个子集上，
> 它是**确定性净提升**；**全量四面板应作为美术驱动的后续批次**，不作为本期承诺。
> 这样即使第 2、3 条触发，本项目仍处于净提升状态。

---

## 5. 风险与取舍（含 v1 未提的逆向项）

### 5.1 观战页：不受影响（已核实）

观战页**从未复用**这些面板——它只 `import` `BattleStage` / `BattleHud` / `TooltipOverlay`
（`watch/WatchApp.vue:7-18`），非战斗阶段用自研 DOM `moment` 卡（`:250-275`），且不加载 `MapStage`。
故本迁移对观战页**既无收益也无回归**。若日后要求观众看到真实房间画面，需让中继传「面板状态 + MapStage」，
**另行立项**（`panelSnapshot` 放 core 已为此留好同源入口，但不等于零成本）。

### 5.2 滚动：自实现全屏竖向滚动条（所有者裁决，推翻分页方案）

**背景（推翻 v1–v3 结论的原因）**：有些演出需要**整个牌库一起参与**——例如某事件从牌库中
选 5 张牌升阶：一个 screen 滚动展示整个牌库，勾选完成后 5 张卡的升阶动画同时播放。
分页范式表达不了这件事，因此滚动必须自实现。

**难度被约束条件压到很低**（所有者给定）：

1. **只在全屏 overlay 容器里出现**（全面呈现所有牌库卡牌，并** block 其它输入捕获**）；
2. 因此只有**竖向**滚动，不需要横向；
3. 边界即**屏幕边界**——不需要容器边界、嵌套滚动、滚动嵌套拾取等复杂交互。

**实现要点**（`ScrollListObject`，待其消费者就位时落地）：

- 全屏模态背板（复用 `CardGalleryObject` 的背板做法）+ 内容裁切（scissor 或 stencil）；
- 滚轮 / 拖拽驱动 `scrollY`，内容整体位移；
- 滚动条 = 轨道 + 滑块两个面片，滑块高度 ∝ 可视比例、位置 ∝ `scrollY`；
- 拾取必须随内容位移（Picker 用世界矩阵射线，位移后自然正确）；滚出可视区的卡要**不可命中**
  （Picker 已有 `visibleUp` 守卫——收起内容时把不可见子对象 `visible=false` 即可）；
- 勾选态是**决策相关**状态 → 进快照（§2.1 用户规则）；滚动位置/惯性等播放态 → 留对象。

> 本项**不阻塞**当前已执行的切片：它服务于牌库级选卡界面（删卡奖励 / 升阶事件），
> 与四个休息阶段面板无关。§6.2 的「长列表」担忧由此关闭。

### 5.3 其它风险

| 风险 | 缓解 |
|---|---|
| **占位 UI 翻两遍**：四面板现均为占位，美术到位后 Three 版还要再翻一轮 | P2 按美术就绪度重排/缩减（§3）；uiGallery 加速迭代 |
| **MapStage 复杂度转移**：从 170 行纯展示舞台变成「picker + 四面板 + 演出回执」的宿主，体量对标 BattleStage 的一部分 | 这是复杂度**转移**而非消除；靠 P1 原语把它挡在面板对象内部 |
| 视觉迭代变慢（重烘纹理） | `uiGallery.html` 调参门 |
| 早期分期留下「两套面板并存」 | 开关 + **当期即删 Vue 版**；不跨期留双实现 |
| 拾取与 tooltip 回归（尤其双重转发） | P0 先跑通并锁住；见 §2.3 裁决 |
| 纹理/几何/tween 泄漏 | §4.2-4 |
| **可访问性丢失**：DOM `<button>` 的焦点/键盘/语义（MenuDialog 有 `role="dialog"`）在 Three 面板全灭 | **显式声明为可接受**（单人游戏、无键盘导航需求）；若日后需要，须在 Stage 侧重造焦点模型 |

### 5.4 回退

每期一个布尔开关（先例 `USE_PCG_ROOMS`）。Vue 组件在对应面板验收通过前不删除；回退 = 关开关，
且**不依赖任何数据迁移**——`panelSnapshot(run)` 是纯函数，可从 Core 状态随时重建。

---

## 6. 待定 —— **已由所有者全部裁决（2026-09-10）**

| # | 问题 | 裁决 |
|---|---|---|
| 6.1 | 测试门与「测试维护暂停」冲突 | **对本次迁移显式豁免** → `test/uiPanels.test.js` 契约门生效，为硬门槛 |
| 6.2 | 长列表形态（删卡界面 / 牌库级选卡） | **自实现全屏竖向滚动条**（见 §5.2），不用分页 |
| 6.3 | 面板本地瞬态归属 | **播放进度流对象留 Stage**（老虎机 spin 的速度/位置等）；**headless 需要的**（影响决策与游戏逻辑流程）**才进 snapshot** |
| 6.4 | 特效时机 | **先搬过去 + 简陋占位**（纯色 panel、色块、文本 icon）；美术到位后再做正式表现 |
| 6.5 | 商店面板形态 | **预留**——商店是接下来与 relic 系统一起增加的内容（近期下一步） |
| 6.6 | 面板顺序是否按美术就绪度重排 | **不需要**，先用占位实现即可 |

---

## 7. 执行进度

| 期 | 状态 | 落地物 |
|---|---|---|
| **P0 管道** | ✅ 完成 | `MapStage.attachInput/handlePointer*`（Picker + 按下/抬起命中配对）；`App.vue` 指针路由泛化为「当前舞台」（battle → BattleStage，其余 → MapStage）；**常驻 tooltip 转发器** `shell/tooltipForward.js`（补上 rest 阶段 3D tooltip 的链路缺口）；`test/uiPanels.test.js` 覆盖前两项与转发的**幂等**契约 |
| **P1 原语** | ✅ 主体完成 | `core/run/panelSnapshot.js`（纯函数，数据下行唯一通道）；`PanelObject`（**锚定 + 模态两形态** + 固定行高行流 + 等比收敛 + 按钮/瓦片/卡面三类 widget + 点击路由）；`ButtonObject`（三态 + 签名 diff）；`TextBlockObject`；`core/skills/cardView.js`（卡面视图，与 CardFacePreview 共用，消除重复）；`richtext/cardFaceDefaults.js` + `objects/cardMetrics.js`（从 BattleStage 抽出的卡面烘焙/尺寸，战斗与面板同源）；`stage/panels/index.js`（快照 → widget 构建器注册表）。**待补**：`TileGrid`/`ListLayout` 独立化（当前瓦片行流已够用）、`ScrollListObject`（随牌库级选卡界面） |
| **P2 面板** | ✅ 完成 | **prep**（锚定）、**reward**（模态 + 卡面三选一）、**ascension**（模态 + 九选三网格 + 面板本地勾选态）、**room**（模态 + 四子房 + 老虎机转轮演出）全部迁入 Three，四个 Vue 组件均已删除；`runPanels.css` 随最后一个用户消失而整文件删除（AGENTS.md「删除废弃旧代码含 CSS」） |
| **P3 收尾** | ⬜ 未开始 | 渐进揭示 + 正式特效 |

**验收门**：`test/uiPanels.test.js`（40 例：快照推导 / 原语 headless 可构造 / 布局不重叠不越界 /
按钮与卡面点击路由 / disabled 拦截 / 重建幂等 / 释放无残留 / tooltip 转发幂等 / runController 端到端通道）
+ `uiGallery.html`（`?panel=prep|reward|ascension|room&seed=&relics=&equip=&floor=&offering=1&room=slot&money=20`，
面板内按钮与卡面可点、真实走 core 意图）。浏览器视觉验收按项目惯例**由所有者验收**（prep 观感与遮挡关系已验收通过）。

**执行中发现并修掉的既有 bug（迁移动机的意外收获）**：`runController.endBattle` 等待塔楼抵达
动画的 Promise **漏了 resolve**，导致网页端每次战后 `playPendingCutscenes()` 与 `notify()` 都不执行
（奖励面板不出现、金币停在旧值）。此前奖励面板是 Vue 组件、靠 `run.rewards` 的 reactive 自行刷新，
把这个洞掩盖了；面板迁入 Three（依赖 `notify` 推快照）后才暴露。已抽成可测函数 `awaitFloorArrive`
并补齐「回执放行 + 等待侧保险丝」两处。同时修掉模态层序：文本/按钮落在背板之后被遮挡。
→ 教训已写进 §4.2-1 的同源要求：**迁移到推流驱动的 UI 时，必须确认推流时机本身没有既有的断点**。

**老虎机揭示闸门（room 落地时收口）**：旧的完成信号是 `RoomPanel.vue` 的 DOM `@animationend`，
现在由舞台自己的 `SlotRollObject` 给出——dt 驱动（与舞台 tick 同时钟，headless 可直接 `update(dt)`
推演，不依赖 rAF），播完经意图通道上报 `slotAnimDone` → `runController.reportSlotAnimDone` 开闸。
「roll 落定才揭示结果」的渐进揭示语义保持不变；转动中拉杆禁用（防连点）。

**下一步**：P3 收尾（渐进揭示 + 正式特效接入，等美术资源）。

**面板本地交互态的实现口径（ascension 落地后定型）**：勾选缓冲这类「被确认前是纯 UI 态」的数据
**留在舞台**（`MapStage._panelUi`，换面板即清空），动作标 `local: true` 由舞台自己消化并就地重绘，
确认时才把选中的 id 作为 intent 载荷上报（对应 §6.3 裁决：影响决策与游戏逻辑流程的才进快照）。
