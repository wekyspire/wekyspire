# 前端结构性审查·待复核问题清单（2026-10-07）

> **用途**：交给独立评审会话的复核任务书。背景：同项目另一会话对前端交互/特效层做了一轮结构性审查（下称「原评审」），提出 9 条断言、3 条深层结构假设、一批改造方案。本文件是全部待复核内容的快照。评审者应以**对抗姿态**独立验证——先试图证伪，再下结论；不预设原结论正确。
>
> **产出要求见 §7。**

## 0. 项目背景与评审纪律

- 项目 `F:\wekyspire`：单人 Roguelike 卡牌爬塔网页游戏。Vue3 + Three.js/WebGPU，四层单向依赖 **Shell → Stage → Bridge → Core**（Core 禁 import 上层）。架构权威说明：根目录 `AGENTS.md`（评审前必读）与 `README.md`。
- 审查范围：`src/shell/`、`src/stage/`（重点 `stage/fx/` 施术特效区，近期开发集中地）、`src/bridge/` 输入相关部分。
- 分支 `k3-dev`，工作区有大量**未提交改动**——本文所有行号以 2026-10-07 工作树为准，复核时若行号漂移请按代码内容重新定位。
- **纪律**：只读评审，禁止修改任何文件；每条结论必须落到 `file:line` 证据；区分「我验证过的事实」与「我的推断」；对无法验证的点明说。

## 1. 原评审结论摘要

**断言 9 条**（§2 逐条展开）：
- A1 「择卡得卡」惯用法 6 份复制
- A2 灯池 punch 样板 ~10 份
- A3 施术特效调试样板散布（spelldebug/hold/release ×N）
- A4 「场景回执保险丝」2 份
- A5 三舞台「面板宿主 + pickerKit 转发层」平行实现
- A6 BattleStage 的 fx deps 服务袋三处手工拼装
- A7 隐式舞台协议无单点定义（缺方法 = 静默落空）
- A8 战斗常驻按钮双轨（CardObject 按钮 vs ButtonObject 按钮）
- A9 死代码/潜伏雷三件（orderedChant 未定义引用 / 空 if 块 / slashSweep 暗层空造）

**深层假设 3 条**（§3，原评审认为 A 系列若干条只是它们的表象）：
- H1 「演出占用/让位/重试仲裁」状态分散 → 缺「演出闸门」一等概念？
- H2 舞台路由谓词/枚举至少六处平行编码 → 缺单一舞台仲裁者？
- H3 deps 服务袋无契约 → 收敛 buildFxDeps 还是文档化契约？

**原评审同时认定的健康部分**（§1.1，可挑战但请给证据）。

**原改造方案优先级**（供复核）：① kit 内 confirmHook 三连抄收敛 → ② 灯池 punch 助手 → ③ 死代码清理 → ④ 面板宿主抽离（连带 grantCard 下沉）→ ⑤ deps 单一事实源 → ⑥ 舞台契约 dev 断言。①②③ 低风险局部；④⑤⑥ 触面大需单独成批过冒烟。

### 1.1 原评审认定的健康部分（不要浪费时间重查，除非有反证）

- `App.vue` 指针路由单入口（`onPointer(type)` 工厂）+ `activeStage()` 规则集中且有文档。
- `stage/picker/Picker.js`：三舞台共享的唯一 raycast 拾取基础设施（双相机路由：先 ui 后 world），无重复实现。
- BattleStage 拆分：`battleBeats/`（units/cards/input/sync 原型混入）+ `battleBeats.js` ANIM_BEATS 表驱动分发。
- `stage/stagePickerKit.js` 本身是一次成功抽离（文件头注释记录了它根治的三舞台三份分叉病灶）。
- shell 三域拆分（`runShowcase.js`/`runMachines.js`/`runCutsceneFlows.js`）约定一致：晚绑定 ctx（箭头闭包）+ intents 表登记。
- 施术特效三层（`fx/spells/blocks.js` 基础块 SDK / 一文件一模板 / `index.js` 决议链 CARD→SERIES→BASE）；`damageFx.js`/`enemyHitFx.js`/`fx/recipes.js`/`fx/chantSceneFx.js` 全部声明式表 + 单包络（k 逐帧缓动派生一切输出）。
- `uiBusy` 单点权威在 stagePickerKit（舞台只转发）。
- `StageManager.js` 相机唯一落笔点（cameraDirector.commit）、tone map 单点、RT 铁律注释完备。

## 2. 逐条待复核断言

### A1 「择卡得卡」惯用法 6 份复制

**断言**：同一段「摘下被选卡 → close/_removePanel → busy 标记 → `playCardGrantFlight`（脉冲→飞向收编锚点）→ 演出落袋后才上行意图」存在 6 份：

kit 内部（`src/stage/stagePickerKit.js`，三段结构逐字相同，仅 confirmFn 闭包不同）：
- L473-486 `openTrainingDrawPicker` 的 `picker.confirmHook`
- L512-525 `openShopPackPicker` 的 `picker.confirmHook`
- L584-597 `openSlotPrizePicker` 的 `picker.confirmHook`

三舞台 `_onPanelAction` 的 grantCard 分支：
- `src/stage/stages/BattleStage.js` L541-553（上行出口 `this._onPanelIntent`）
- `src/stage/stages/MapStage.js` L215-227（上行出口 `this._onIntent`）
- `src/stage/stages/RoomStage.js` 约 L846-867（上行出口 `this._onIntent`；面板为 dock 非模态）

已知历史 bug：confirmHook 设在 `picker.open()` 之前会被 open 重置（kit L509-511 注释自记）——惯用法复制曾真实产生过缺陷。

**原方案**：kit 内抽 `grantCardFlight(picker, keys, fire)` 助手收敛 3 份；舞台侧 3 份随「面板宿主抽离」（A5）一并收。

**复核问题**：
1. kit 三段是否真逐字相同（逐行 diff）？
2. 三舞台版本的真实差异清单：`_onPanelIntent` vs `_onIntent`、`_removePanel` 语义差（MapStage 版会 close 两个 picker，BattleStage 版只 close cardPicker，见 A5）、`takeCard` vs `takeEntry` 的对象来源、`info.pickId` 从哪来——合并方案是否遗漏行为差异？
3. 舞台侧合并进 kit 是否可行（grantCard 需要面板对象与舞台 uiScene，kit 已持有后者）？

### A2 灯池 punch 样板 ~10 份

**断言**：「借 `light:fxN`（fx0/fx1 两灯池）→ `setRGB` → 挪位 → 两段 tween 快起慢落 → `ctx.onKill` 归零」散布于：
- `src/stage/fx/spells/blocks.js` L253-264（impactBurst，**await lampJob**）、L331-340（slashSweep，ctx.spawn）、L386-395（punchImpact，ctx.spawn）、L449-458（fireBurst，ctx.spawn）
- `src/stage/fx/spells/blockCast.js` L31、L61（fx0）
- `src/stage/fx/spells/chantOffCast.js` L50
- `src/stage/fx/spells/damageFx.js` L32-41（novaBlast：强度 2600×scale、attack 90ms/decay 620ms——量级与节奏都是特例）
- `src/stage/fx/spells/meltCast.js` L50
- `src/stage/fx/spells/selfFlame.js` L61

灯池铁律背景（AGENTS.md「fx 灯池铁律」条 + BattleStage.js L319-331）：演出中 new 灯 = 着色器重编译 1.2s 冻帧，故一律借池、只推参数。

**原方案**：blocks.js 下沉 `lampPulse(ctx, deps, { name, at, color, peak, attackMs, decayMs })`；模板侧各处改调它。

**复核问题**：
1. 各份差异精确表：attack/decay 时长比例（有按 ms×0.35/0.65、×0.5/0.9、×0.3/0.9 等多种）、fx0 vs fx1、await vs spawn（影响节拍占用——impactBurst 等灯收完才 notify，其余不等）、onKill 归零的重复注册。一个参数化助手能否无损覆盖？
2. novaBlast 是否该排除在合并外（量级/用途特殊）？
3. 助手放 blocks.js 是否正确（damageFx/novaBlast 与模板侧也 import blocks）？

### A3 施术特效调试样板散布

**断言**：
- `new URLSearchParams(location.search).get('spelldebug')` 在 `src/stage/fx/spells/` 5 个文件共 10 处（blocks.js 多处、selfFlame.js、fireWhirlCast.js、fistCast.js、sparkSalvo.js）。
- hold 定格分支（设 uniform 初值 → `await ctx.wait(3000)` → remove/dispose）6+ 份：blocks.js arcProjectile L158-173、slashSweep L323-329、punchImpact L381、fireBurst L437、groundRing L495-500；fistCast.js L46-49。
- `deps.scene.remove(quad); geo.dispose(); mat.dispose();` 在 spells/ 共 29 处。

**原方案**：URL 参数模块级解析一次；`spellQuad()` 返回 `release()` 闭包统一回收。

**复核问题**：
1. 各 hold 分支结构差异（uProg 初值 0.5/0.65/0.75/0.55、多 uniform、scale 设置、lamp 处理）——强抽公共 holdPath 是否破坏「定格帧与实况同形」取证语义（blocks.js 注释反复强调）？
2. 模块级解析 URL 在 node 单测环境（无 `location`）的陷阱——现有代码怎么防的（`typeof location !== 'undefined'`？逐处查）。
3. release() 闭包与现有 onKill + onComplete 双路径叠加会不会双 dispose（THREE 对象二次 dispose 是否安全/告警）？

### A4 「场景回执保险丝」2 份

**断言**：`src/shell/runShowcase.js` L87（demonFuse，6000ms，等恶魔 roll 场景退场回执）与 L251-260（shopFuse，4000ms，等售货机出货回执；超时时**还要清 shopDispensing 标记**）。同一惯用法（等场景回执、超时强放演出）写两遍。
另有关联但不同构的：runController.js L248-251 demonNarrateTimer 600ms 自来重试（让位重试，非保险丝）。

**原方案**：抽 `withSceneFuse` 小助手。
**复核问题**：两份语义差异（shopFuse 清状态、demonFuse 不清）强合会不会错？值不值得抽（只有 2 份）？

### A5 三舞台「面板宿主 + pickerKit 转发层」平行实现

**断言**：每舞台携带 80-120 行同构代码：`setPanel/_renderPanel/_onPanelAction/_removePanel/setPanelIntentHandler/setRunSequencer/_grantBusy/playCardUpgrade/dismissModals/uiBusy getter/handleWheel/openUpgradePicker 转发/showcaseItem 转发`（BattleStage 是子集，见 §4 矩阵）。其中 `_onPanelAction` 的 local/grantCard/busy 三态分流规则三家各自维护——加新 local 动作要改三处（openShop 系列只在 RoomStage 有）。

**原方案**：`createPanelHost(stage)` 工厂/原型混入收敛，舞台只留各自 local 动作表。

**复核问题**（关键——判定该方案是「正确抽离」还是「伪抽象」）：
1. 三家差异的真实大小：
   - MapStage：`_panelUi.shopOpen` 本地视图态、面板 kind 切换重建规则（L179-196 setPanel/_renderPanel：`shopOpen && snap.shop ? 'shop' : snap.kind` 决定 builder）、`_removePanel` 里 close 两个 picker（L408-420）。
   - BattleStage：模态语义——setPanel 时压暗全部 HUD 按钮（L520-523）；`_removePanel` 只 close cardPicker（L573-582）。
   - RoomStage：`_panel` 是 **dock 操纵条非模态** + `_stagePanel` 阶段模态双轨（输入路由见 L394-457）；dock 不吞指针，靠 `_grantBusy` 守。
   这些差异是「参数」还是「本质分叉」？共享宿主会不会变成 `if (stageKind)` 的伪抽象？
2. 若整宿主不合适，正确切法是什么——只抽 `_onPanelAction` 意图分流核心（local 表 + grantCard + 上行）？只抽 grantCard 段（与 A1 联动）？
3. RoomStage 的 `_stagePanel`（阶段模态）与 `_panel`（dock）双轨在共享宿主方案里怎么安放？

### A6 BattleStage 的 fx deps 服务袋三处手工拼装

**断言**：三袋共享约十个键，组装分散：
- `src/stage/stages/battleBeats/cards.js` L285-346 `_spellDeps()`（施术拍与伤害拍共用——这步抽取本身是对的）+ L348-384 `_runSpellFx` 补充段（cardView/targets/unitAnchor/unitFeet/cardTipWorld）
- `src/stage/stages/BattleStage.js` L1009-1022 `fxServices()`（**不含 scene/uiScene**）与 L977-1005 `_scriptBeat` 内联袋（= fxServices + scene + uiScene + args）
- `MapStage.js` L557-573 / `RoomStage.js` L520+ 的 `fxServices()` 又是两份（MapStage 版 particles/shake/vignette 全 null 且无 scene/uiScene——靠注释约定「塔楼层 cutscene fx step 只做运镜/等待」来补偿，见 MapStage L146-148）

deps 键名全靠消费侧约定，组装漏键 = 调用侧静默 undefined。

**原方案**：`buildFxDeps(stage)` 单一事实源，三舞台 fxServices 只做增删；`_scriptBeat` 袋改为 `fxServices()` 展开补 scene/uiScene/args。

**复核问题**：
1. **消费面审计**（原评审未完成，见 §5）：`grep -oE "deps\.[a-zA-Z_]+" src/stage/fx -r | sort | uniq -c` 列出全部消费键；对照各生产袋键集；产出「消费了但某条可达路径不提供」与「提供但无人消费」两张表。
2. 观战链路（`src/bridge/remoteBridge.js`、`src/shell/watch/`）是否也组装 deps / 重建施术演出——收敛会不会碰 wire 兼容？
3. 判定 H3（§3）：真问题是「多处组装」还是「无契约文档」？

### A7 隐式舞台协议无单点定义

**断言**：runController/shell 经 `panelStage()?.X` 等 optional-chain 消费 16+ 个舞台方法，缺方法即静默落空。历史实报 bug 中至少三个是此结构直接产物：
1. BattleStage 漏 `handleWheel`（「删卡界面滚轮无响应」——`battleBeats/input.js` L79-81 注释自记）
2. BattleStage 建 pickerKit 漏传 bakeFace（候选卡隐身——stagePickerKit.js L1-11 头注释记录的三份分叉病灶之一）
3. 战斗常驻按钮漏喂 hover（「结束回合和换卡没有 hover 效果」——input.js L62-67 注释自记）

**原方案**：`stageContract.js` 导出方法清单 + dev 模式启动时对活动舞台 assert。

**复核问题**：
1. §4 矩阵显示契约**天然按舞台可选**（BattleStage 故意不实现 showcaseItem 等 7 个方法——战斗内获得演出走 bridge 节拍）。扁平 assert 会误报；如何分层（核心输入契约 vs 可选表现面）？
2. 纯 JS 项目里最便宜的形态是什么（文档对象？JSDoc @typedef + 启动 assert？基类？）——结合团队「注释极简纪律」（AGENTS.md 代码约定）权衡。
3. 三个历史 bug 的归因是否成立（读注释核实，别只信转述）。

### A8 战斗常驻按钮双轨

**断言**：战斗主/换卡按钮是挂在舞台上的 **CardObject**（`_bakeButtonFace` 烘焙 + `_btnHover` 手工喂 hover + `_setButtonState` 重烘，见 `battleBeats/input.js` L62-78；签名缓存 `_buttonSigs/_btnData` 在 battleBeats/sync.js——**原评审未读该文件，需补**）；休息面板按钮走 `PanelObject.onHover → ButtonObject.setHovered`。两套按钮栈两套 hover 链路，其中一套需手工喂且已实报漏喂。

**原方案**：未给完整方案，仅指出双轨。候选：迁 ButtonObject，或共享 hover 喂入点。

**复核问题**：
1. 读 `src/stage/objects/ButtonObject.js` 与 `CardObject.js` 能力对照：战斗按钮实际用到 CardObject 的什么（C0 卡面 fx 压暗档 setVisualState/updateFx、bakeButtonFace 流、`_updateDoomMarks` 挂 main 按钮、endTurn 锁态、`_btnData` 签名重烘机制）——ButtonObject 是否都接得住？
2. 判定：是「该迁但成本中」还是「CardObject 承载是合理特例」？若后者，更轻的修法（如把 `_syncButtonHover` 喂入挪进共享层）是否成立？

### A9 死代码/潜伏雷三件

1. **`BattleStage.js:873` `orderedChant` 未定义引用**：`const idx = orderedHand.includes(id) ? orderedHand.indexOf(id) : orderedChant.indexOf(id)`。原评审论证不可达：`onStage` 集合由 `orderedHand` 构建（L841-842），守卫 `this._entering.has(id) && onStage.has(id)`（L869）为真则 `orderedHand.includes(id)` 必真。**复核**：通读 `_layoutAndTrack`（约 L837-925）与 `_entering` 全部写入点（battleBeats/sync.js、cards.js L54-57），严格证明或推翻；全库 grep `orderedChant` 确认无别处定义/注入；若不可达，删 else 支是否零风险。
2. **`BattleStage.js:1296-1297` 空 `if (typeof window !== 'undefined') {}` 块**：确认是残留（git log/blame 可查来历）。
3. **`blocks.js` slashSweep 暗层空造（L293-311）**：`SPELL_DARK_LAYER = false`（TSL Fn 管线缓存坑暂缓项，L306-308 注释），但 `dGeo/dMat` 在判定**前**构造（L298-301）、onKill 照挂（L311），从不进场景。slashSweep 是伤害节拍高频件（每次刀法命中）。**复核**：确认构造顺序；评估代价（MeshBasicNodeMaterial 仅构造不渲染是否触发 WGSL 管线编译？TSL 节点图每次重建的 JS 开销量级）；建议形态（条件构造 / 哨兵空对象 / 保留）。

## 3. 深层结构假设（复核重点）

> 原评审的核心猜想说：A 系列若干条只是以下三个深层问题的表象。请逐条裁决「成立/不成立/部分成立」，成立则给抽象形态与迁移边界，不成立则说明为什么手写是合理的。

### H1 「演出占用/让位/重试仲裁」分散 → 缺「演出闸门」一等概念？

观察到的全部占用/让位/重试状态位（原评审清点，需抽查核实）：

| 状态位 | 位置 | 语义 |
|---|---|---|
| kit `grantBusy/upgradeBusy/burnBusy` | stagePickerKit.js（L291 汇成 uiBusy） | 选卡确认后的得卡演出占用 |
| kit `showcase.busy`、`cardPicker.opened`、`relicPicker.opened` | 同上 | 特写/全屏界面占用 |
| 舞台 `_grantBusy` ×3 | BattleStage L544 / MapStage L218 / RoomStage ~L856 | 面板动作吞bit |
| `slot.anim` | runController.js L121（reactive 瞬态） | 转轮播放闸门（特写等它落定） |
| `narratedDemonRoll` + `demonNarrateTimer` 600ms | runController.js L241-251 | 让位+自来重试（uiBusy 时） |
| `shownSlotPrize`「播成功才记已播」 | runShowcase.js L174-209 | 幂等去重+失败重试 |
| `shopPendingShow/shopDispensing` | runShowcase.js L34-36 | 出货演出与特写互斥 |
| `demonFuse`/`shopFuse` | runShowcase.js L72/87/251-260 | 场景回执超时兜底 |
| RoomStage uiBusy 联动 | RoomStage.js L900（`uiBusy ? 0.18 : ...` 透明度） | 占用的视觉反馈 |
| AGENTS.md 记载的 slotFinish 闸门补丁 | 「老虎机」节 | sequencer 保险丝不清 slot.anim → spin 自带同 ms 兜底定时器 |

假设：这些全是「core 已结算、演出是异步资源、需要占用仲裁 + 让位重试 + 超时兜底」同一问题的手写实现。
**裁决问题**：成立吗？若成立，正确抽象是什么（一个 gate/presentation-transaction 原语？）迁移边界在哪（哪些状态该进、哪些该留——注意 kit 内部的细分 busy 有各自语义）？若不成立，为什么（规模/语义差异/已有 runSequencer 串行化已是该抽象）？

### H2 舞台路由谓词/枚举多点平行 → 缺单一舞台仲裁者？

原评审初步清点出**六处**「当前哪些舞台存在/谁是活动舞台」的编码（已由原评审亲自核实存在，行号可信）：

1. `src/shell/App.vue` L212-220 `activeStage()`：battle ?? (room 且 gameStage∈{room,ascension}) ?? map——**指针输入**路由。
2. `src/shell/runController.js` L492 `panelStage()` = roomStage ?? mapStage（**不含 battle**）——面板/获得演出路由。
3. 同 L203-206 `roomPresentedOnScene()`：gameStage∈{room,ascension} && stageManager && (roomScenePending || roomStage) && (event 房 || 有配方)——决定塔楼是否画房间面板。
4. 同 L306 `getFxServices: (battleStage ?? roomStage ?? mapStage)`——fx 服务袋。
5. 同 L314-319 切幕清算循环 `[battleStage, roomStage, mapStage]` 全员 dismissModals。
6. 同 L148-165 `syncMapStatus()` 对三舞台无条件 fan-out（`?.` 链）。

已知的同步机制 = 注释互指（App.vue L203-211 与 runController L198-201 互相注释引用对方规则）。历史病灶：App.vue 注释记载的「种子包 hover/点选失效」（输入喂了 MapStage、面板画在 RoomStage）正是两份谓词失同步的实例。

**原评审新发现的一个疑点（未验证完，请重点查）**：`panelStage()` 不含 battle，而 `runShowcase.flushRelicShowcase`（runShowcase.js L37-55）只挡 `gameStage === 'battle'`、**不挡 'reward'**。reward 期间 battleStage 是活动/渲染舞台，但 panelStage() 返回 mapStage（roomStage 为 null）——若 reward 阶段有任何遗物入账（Boss 掉落遗物走哪条路？查 `core/run/runFlow.js` finishBattle 与 rewards 链），获得特写会画在**未渲染的 mapStage** 上：不可见、且 `showcasing` 标记可能卡住后续特写。请验证：①reward 期遗物入账是否真实可达；②ItemShowcaseObject 在不可见舞台上的状态会不会卡死（autoDismiss/click 都不可达时谁解锁）；③这是不是「谓词分离」的现行活例。

**裁决问题**：六处枚举/谓词是否构成深层问题（vs 各司其职的合理分布）？若成立，「单一舞台仲裁者」（runController 暴露 `activeStage()`/`stages()`，App.vue 输入路由也从它取）是否正确收敛方向？迁移风险：App.vue 与 runController 初始化顺序（App.vue L135 先 createRunController 后 attachInput）、菜单期 ctrl 为 null、battle 奖励期「battle 活着但 panel 已收」的语义差。

### H3 deps 服务袋无契约（见 A6 复核问题）

MapStage fxServices 无 scene/uiScene 但靠注释约定补偿（cutscene fx step 在塔楼只做运镜/等待）——「缺键被文档而非类型挡住」是 H3 成立的现有证据。请补全 §5 的审计后裁决：收敛 buildFxDeps vs 契约文档 vs 两者。

## 4. 已核实事实（原评审自查增量，可直接引用，建议抽查）

### 4.1 舞台契约矩阵（grep 核实于 2026-10-07）

| 方法 | BattleStage | MapStage | RoomStage |
|---|---|---|---|
| handlePointerMove/Down/Up | ✅（input.js 混入） | ✅ | ✅ |
| handleWheel | ✅（input.js L82，后补） | ✅ | ✅ |
| setPanel/setPanelIntentHandler/setRunSequencer | ✅ | ✅ | ✅（另有 `_stagePanel` 阶段模态双轨） |
| setFloor | ❌ | ✅ | ❌ |
| setStatus | ❌（battle 内走 bridge reconcile） | ✅ | ✅ |
| showcaseItem | ❌ | ✅ | ✅（L354） |
| get uiBusy | ❌ | ✅（L282） | ✅（L363） |
| playCardUpgrade | ✅（L569） | ✅ | ✅（kit） |
| playCardBurn | ❌ | ❓（未见） | ✅（L333） |
| roomUnitCommand | ❌ | ❌ | ✅（L242） |
| openUpgradePicker | ✅（仅 bossRemove，L561-566） | ✅ | ✅ |
| openShopPackPicker/openShopRelicPackPicker | ❌ | ✅ | ✅（L339/341） |
| openSlotPrizePicker | ❌ | ❓ | ✅（L345） |
| openTrainingDrawPicker | ❌ | ✅ | ✅（L348） |
| openDevourPicker | ❌ | ✅ | ✅（L351） |
| fxServices | ✅（L1009） | ✅（L557） | ✅（L520） |
| dismissModals | ✅（L571） | ✅ | ❓（查） |
| _fxScripts 剧本池 | ✅（L266+） | ✅（L149） | ✅（L102） |
| _fxDisposeHooks | ✅ | ✅（L150） | ❓（查） |

（❓ = 原评审未确认，需补查。）**推论**：契约天然按舞台可选，扁平 dev-assert 会误报。

### 4.2 其余已核实点

- A1/A2/A3 全部行号（见 §2，均出自原评审亲读）。
- `runController.js` 全文已读：panelStage/roomPresentedOnScene/getFxServices/dismissModals 循环/syncMapStatus fan-out 六处中五处的行号（见 H2）。
- `runShowcase.js` 全文已读（demonFuse/shopFuse/shownSlotPrize/shopDispensing 语义见 H1 表）。
- MapStage/RoomStage/BattleStage 三家 `_onPanelAction` 已读（差异见 A5）。
- `stagePickerKit.js` L1-120（头注释+UPGRADE_SOURCES 表）与 L440-620（三个 confirmHook + openDevourPicker）已读。
- `stage/fx/spells/` 的 blocks/index/fistCast/manaCast/fuelCast/damageFx 已读；enemyHitFx 头部已读（结构健康）。

## 5. 未完成的验证（原评审未做或未做完，正是留给本会话的活）

1. **deps 消费面审计**（A6/H3 核心）：
   ```bash
   grep -roE "deps\.[a-zA-Z_]+" src/stage/fx | sort | uniq -c | sort -rn
   ```
   对照生产袋：`_spellDeps`（cards.js L285-346）、`_runSpellFx` 补充段（L348-384）、`BattleStage.fxServices`（L1009-1022）、`_scriptBeat` 袋（L977-1005）、`MapStage.fxServices`（L557-573）、`RoomStage.fxServices`（L520+，**内容未读**）。产出两张表：可达路径上缺供的键 / 从未被消费的键。
2. **观战链路**：`src/bridge/remoteBridge.js`、`src/shell/watch/` 是否组装 deps 或重建施术演出（收敛 deps 的 wire 兼容风险）。
3. **H2 疑点链**：reward 期遗物入账路径（core/run/runFlow.js finishBattle → rewards；Boss 掉落遗物在哪拍入账）；ItemShowcaseObject 卡死风险（`src/stage/objects/ItemShowcaseObject.js` 的 autoDismiss/占位语义）。
4. **A8 补读**：`battleBeats/sync.js`（`_buttonSigs/_btnData/_setButtonState/_syncButtons`，全文未读）；`objects/ButtonObject.js` 能力对照。
5. **A9-1 完整证明**：`_entering` 全部写入点 + `_layoutAndTrack` 守卫逻辑的不可达证明。
6. **RoomStage.fxServices 内容**与 `_fxDisposeHooks`/`dismissModals` 在 RoomStage 的存在性。
7. **fxScripts/_fxDisposeHooks 生命周期簿记三舞台重复**（原评审附带提出未展开）：是否值得抽 `createFxScriptPool()`，还是规模太小不值得——给裁决。

## 6. 原改造方案 × 批判点对照表

| # | 原方案 | 主要批判点（复核时逐一回答） |
|---|---|---|
| 1 | kit 内 `grantCardFlight(picker, keys, fire)` 收敛 3 份 confirmHook | 逐字相同性；舞台侧 3 份是否该进 kit；与 A5 的关系 |
| 2 | blocks 下沉 `lampPulse(ctx, deps, {...})` | await/spawn 差异；比例参数化；novaBlast 排除否；铁律兼容 |
| 3 | spellQuad 返回 `release()` 闭包 + URL 模块级解析 | 双 dispose 风险；hold 取证语义；node 环境 |
| 4 | `withSceneFuse` 助手 | 两份语义差（shopFuse 清状态）；仅 2 份值不值 |
| 5 | `createPanelHost(stage)` 收敛三舞台宿主层 | 三家差异是参数还是分叉；RoomStage 双轨安放；会不会伪抽象 |
| 6 | `buildFxDeps(stage)` 单一事实源 | 审计先行；观战兼容；vs 契约文档 |
| 7 | `stageContract.js` + dev assert | 按舞台可选导致误报；分层形态；纯 JS 最便宜形态 |
| 8 | （隐性）单一舞台仲裁者收敛 H2 六处 | 初始化顺序/菜单期/reward 期语义；panelStage 不含 battle 是特性还是坑 |
| 9 | 按钮迁移 ButtonObject 或共享 hover 喂入 | 能力对照（sync.js 未读）；合理特例判定 |
| 10 | 死代码三件清理 | orderedChant 零风险证明；暗层处理形态 |

## 7. 评审输出格式要求

按 A1-A9、H1-H3 逐条输出：

- **(a) 核实结论**：准确 / 不准确（+修正）/ 部分准确——附你自己读到的 file:line。
- **(b) 深层判定**：独立问题 / 深层问题的表象（指出根）/ 两者兼有。
- **(c) 方案评审**：原方案可行 / 有坑（列出）/ 应改为 X。

最后给**总判断节**：原评审整体结论中哪些被推翻、哪些降级、哪些升级；给出你自己的修复优先级排序（可与原排序不同，说明理由）。

> 附：原评审的自我局限声明——本文件由原评审会话撰写，其「已核实」部分（§4）可能同样有误，抽查是评审者义务；行号基于 k3-dev 未提交工作树。
