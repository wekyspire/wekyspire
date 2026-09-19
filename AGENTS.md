# AGENTS.md — 魏启尖塔（weiqi-chaos）

> 面向 AI 编码代理的项目导览。项目注释与文档主语言为**中文**，新代码与文档沿用中文注释。

## 项目概览

**魏启尖塔**：单人 Roguelike 卡牌爬塔网页游戏（无尽/故事两模式，存档隔离）；纯前端 SPA，无自建后端，产物是静态站点。核心循环与塔结构的设计见 `battle_gameplay/RUN_DESIGN.md`。

## 技术栈与配置

- **构建**：Vite 4 + `@vitejs/plugin-vue`（`vite.config.js`）。路径别名：`@` → `src/`、`@assets` → `src/assets`。`base` 由环境变量 `VITE_BASE` 控制，缺省 `./`。dev 端口 **5177**。
- **框架**：Vue 3（组合式 API，`<script setup>`）+ vue-router + mitt。
- **渲染**：Three.js（共享单个全屏 `<canvas>`）+ GSAP（补间）。
- **测试**：Vitest（node 环境）。入口 `index.html` → `src/shell/main.js`；`src/debug/main.js` 是遗留调试页，非正式入口。

## 常用命令

```bash
npm install        # 安装依赖
npm run dev        # 开发服务器（localhost:5177）
npm run build      # 产出 dist/
node tmp/smoke-*.mjs   # headless 冒烟脚本（逻辑改动的快速自验）
npm test           # vitest（存量；维护已暂停，见「测试」节）
```

不要用 dev 服务器验证编译/逻辑错误——改完跑相关冒烟脚本即可，浏览器行为由用户验收。

## headless 试玩与直播观战（dev 工具，不进构建产物）

- `tools/headlessPlay.mjs` — LLM/脚本可玩的**文本界面**（replay 式会话：`tmp/playtests/<名>.json` = `{seed, actions}`，每次调用全量重放 + 执行新动作，成功才入档）。引擎入口 `tools/playSession.mjs`，实现按职责拆在 `tools/session/`（engine/render/format/addressing/files）。
- `tools/broadcast.mjs` — **直播中继**（只读观察会话文件 + HTTP/SSE 推流，零新依赖）：把动画指令描述符推给浏览器、由本地 sequencer 重建播放，观战页因此复用 `BattleStage`/`BattleHud`/`TooltipOverlay` 全套真实渲染。观战页 `http://localhost:5177/watch.html?port=5199&session=<名>`（默认端口 5199），会话索引 `http://127.0.0.1:5199/`。
- 契约层：`src/bridge/wire.js`（指令描述符 ↔ 重建）、`src/bridge/remoteBridge.js`、`src/core/anim/sequencer.js`（指令的可选 `wire` 字段）、`src/bridge/stateSync.js`（标脏/补同步调度器）。
- **公网观战**：`https://wekyspire.hineven.site/watch.html`。链路 = 服务器观战页 → Apache 反代 `/relay/`（`flushpackets=on` 是 SSE 必备）→ SSH 反向隧道 `ssh -N -R 127.0.0.1:5199:127.0.0.1:5199 hineven.site` → 本机 `node tools/broadcast.mjs --origin https://wekyspire.hineven.site`。观战页在非 localhost 主机下自动走同源 `/relay`。

## 分支、协作与部署

- **上游仓库 = `https://github.com/wekyspire/wekyspire`**（remote 名 `wekyspire`，`master` 为唯一主干）。旧 `Hineven/wekyspire` 只是历史个人仓库（保留为 remote `hineven-origin`），不是交付目标。
- **多人并行：每人一条自己的长期开发分支 `<名字>-dev`**（如 `hineven-dev`），都推到 `wekyspire`；功能完成后开 PR 合进 `master`（**不要直接推 master**）。开工前先 `git fetch wekyspire && git merge wekyspire/master`（长期分支落后是冲突的主要来源）。合并冲突以**自己 dev 分支的实现为准**（冲突方是别人正在维护的模块时先沟通）。
- **线上站点由服务器 cron 部署**：`/usr/local/bin/wekyspire-deploy.sh`（每 5 分钟拉 `origin master` → `VITE_BASE=/ npm run build` → rsync 到 `/var/www/html/wekyspire`）。**要上线的新内容必须先合进 `master`**。国内网络拉不动 GitHub 时，可直接把本地 `dist/`（`MSYS_NO_PATHCONV=1 VITE_BASE=/ npx vite build`）tar 上传到站点目录，产物等价。
- **GitHub Pages workflow 已在上游删除**——不要再加回；推上去只会触发必然失败的 job。
- 仓库根 `dist/` 是构建产物（gitignore），不要手改。

## 版本与 changelog

- 玩家可见更新日志 = `public/changelog.md`（开始界面「更新日志」弹层直接读它）。一条版本 = `## YYYY.M.D [Alpha X.Y.Z]` + `- 签名：Hineven` + 小节；新条目**加在文件最上方**，并把 `package.json` 的 `version` 同步改掉（两者必须一致——**vite.config.js 构建期已自动校验**：不一致直接构建失败；开始界面版本行的编号/日期也由此注入，日期 = changelog 顶部条目日期，不是当天日期）。
- **写得短（红线：整条版本正文 ≤150 字，超线即违规）**：归纳 2~3 条，只写玩家能感知的变化（新内容 / 体验手感 / 修好的明显 bug）。不逐条罗列 commit、不写内部术语（模块名/架构词）、不贴代码参数。小节用「新增 / 改进与修复 / 已知问题」这类朴素词，空小节不留壳。

## 架构：四层单向依赖

依赖方向严格单向：`Shell → Stage → Bridge → Core`。**Core 不得 import 上层**；Core 的表现诉求只走 `ctx.presenter` 注入（headless 用 `createNullPresenter`，测试用 `createRecordingPresenter`）。

```
src/
├── core/        # 纯逻辑层：环境无关、纯对象（禁 Vue reactive）、可序列化
├── bridge/      # Core ↔ 前端协议层：双事件总线 + 动画队列 + 状态投影
├── stage/       # Three.js 表现层：StageManager / 场景 / 对象 / 动画
└── shell/       # Vue 薄壳：场景编排、Vue 浮层、存档、设置
```

### 场景层级

三层场景（菜单纯 Vue / 塔楼 MapStage / 战斗+房间 Three 化）、`gameStage → PANEL_BUILDERS` 面板映射的权威说明在 `README.md`「场景层级」。此处只记两条实现铁律：仍由 Vue 渲染的只有对话 / cutscene / tooltip / `BattleHud`（战斗日志/回合数）与菜单层组件；**幕间黑幕是独立一层**（`sceneWipe.js` + `SceneWipeOverlay.vue`，z 压过内容层）——黑幕的目的地可以是任何东西（3D 舞台或一段 cutscene 内容），wipe 在全黑中点调下一步的 `preStage()` 让内容幕后就位。

### Core（`src/core/`）

- **`kernel/`** — `BattleKernel`：指令树 DFS 泵 + 订阅注册表 + 取消三动词（veto/abort/inspect）。订阅 `{when, phase('pre'|'post'), filter, window('battle'|'turn'|'once'), priority, react, owner}`。铁律：POST 反应作为已完成节点的子节点提交；被 veto 的节点不触发任何 POST；取消入口只在内核。
- **`instructions/`** — 指令族：`BattleInstruction` 三返回值 `true/false/WAIT`，payload 白名单（`setPayload` 越界抛错）。combat / resources / effects / cards / skill / turn / battleRoot / input / aiAct / units（战斗中生成单位尾插，下回合起参战，敌方意图 kinds 含 'summon'）。
- **`state/`** — 纯对象状态：`Unit`（hp/shield/effects/`getStat` 读轨/`uniqueID`/side）、`Player`（run 级，跨战斗存活）、`AIUnit→Enemy/Ally`、`runState`/`battleState` 两层拆分、zones（hand/deck/burnt/pending）、种子 rng、`skillRuntime`（定义/运行时分离）。初始值常量：`PLAYER_BASE_HP / PLAYER_BASE_MONEY / PLAYER_BASE_AP`（禁止裸数字）。
- **`flow/battle.js`** — 战斗装配：`createBattle/startBattle/playerUseSkill/playerEndTurn/respondInput`。终局 abort 的是 TurnLoop 而非根节点，战后清理在树内执行。
- **`run/`** — run 层状态机：`runFlow.js`（createRun/enterBattle/finishBattle/advanceFloor…）、`runDriver.js`（headless 整局 SDK，自动应答/自动开包）、`rewards.js` / `ascension.js` / `prep.js` / `promotion.js`（局外晋升）、`rooms/`（campTraining/event/slotMachine/bank/shop/gurpas/training）。**玩法细则不在本文件**——卡包门禁与开包分布、进阶节奏与跳过补偿见 `battle_gameplay/RUN_DESIGN.md`，老虎机/银行/恶魔 roll 见 `SLOT_MACHINE.md`，商店见 `SHOP.md`。实现侧口径：开包等阶分布与 S 直出白名单的事实源是 `rewards.js` 的 `PACK_TIER_TABLE`/`S_SPAWN_WHITELIST`；房间产出挂 `run.slotPending`/`shopPending`/`pendingDebuffs`，未处理完不许离房。
  - **事件系统**：事件 = 对话 + 选项 + 逻辑，定义进 `core/events/registry.js`，内容在 `core/content/events/`（一文件一事件，`content/events.js` 显式装配；字段 `{id,name,art,mode,weight,requires,pages,choices,resolve}`）；抽取确定性、记 `run.roomData.eventId`（同次不重抽）。**效果由 `resolve` 直接调 `core/run/runEffects.js` 原语**（原语负责改 run + 记 log + 声明表现意图），`resolve` 只返回结果页——Shell 对「事件做了什么」一无所知，加新效果不必改编排器。run 级表现走 `createRunContext` 的 `presenter.showcase` → `shell/runPresenter.js` 排队、runController 在**退出切幕之后**统一 `drain()`（获得演出排揭幕后，否则被黑幕吞半截）。剧情分支记忆 = `run.eventFlags`。
  - **遗物系统**：字段契约 = `rarity`(C/B/A/S) / `cost`(槽位**权重** 0–3，Σ ≤ relicSlots) / `nonSlot`(非槽位式拾起恒生效) / `requires`(灵脉门禁) / `acquisition`(来源标签，`gurpas`/`event` = 只走该渠道) / `onAcquire` / `onCampRest` / `runModifiers`(**从 `player.baseStats` 重算，不增量累加**——增量会逐战叠加) / `onBattleStart` / `subscriptions`。一局内遗物唯一（池空兜底件除外）。**抽选一律走 `core/relics/draft.js`**（稀有度权重 + 门禁 + 已拥有排除 + 兜底集中于此），老虎机/商店/事件/Boss 掉落不得各自随机。遗物个体设计见 `battle_gameplay/RELICS.md`。
- **注册表** — `registryFactory.js` 的 `createRegistry` 产出同构注册表：skills/abilities/enemies/allies/relics/effects/events。内容是纯静态定义，由 `content/index.js` **显式 import 登记**（不用 `import.meta.glob`）。
- **`sdk/driver.js`** — `BattleDriver`：headless 声明式战斗装配 + 链式出牌 + `runToEnd`，测试与批量验证用。
- **`anim/sequencer.js`** — `AnimationSequencer`：演出指令队列，Shell 侧单协程消费，跨场景共享同一队列定序。
- **`content/`** — 最小内容实现（技能/敌人/能力/遗物/效果/盟友/事件）。技能设计意图见 `skills/SKILL_DESIGN_PRINCIPLES.md`。晋升链分离：**局外晋升**（营地/训练场 `promotion.js`）走 `promotesTo`，**局内转化链**（斩系列打出后进阶）走 `battlePromotesTo`——两者互不可见。

### Bridge（`src/bridge/`）

`createBridge` 把 Core 战斗接到协议事件流：mitt 双总线（backendBus/frontendBus）+ AnimationSequencer + presenter 翻译层 + 状态投影（标脏 + 拉取缓存，`projection.js`）+ 意图层（`intents.js`）+ 结算期输入仲裁（`interactionHandler.js`）+ run 级显示状态权威 `DisplayModel`。事件名集中在 `events.js`。队列排空时自动补一次状态同步兜底。

### Stage（`src/stage/`）

- **StageManager**：舞台切换/resize/渲染循环。世界相机基准机位构造时落一次（`cameraBase`/`restoreBaseCamera()` 供借机位舞台还原）；`CAMERA_ZOOM 0.79` 只缩世界相机距离，布局坐标不动。
- **场景件**：`scenes/`（skydome、dungeon3D、volumetricMoon 等）、**场景素材管线** `scenes/kit/`（propKit 契约：palette/共享材质/图元修饰器/撒布/合并，产出代理禁改）与 `scenes/props/`（道具资产库，一文件一资产，显式登记）、**房型 PCG** `scenes/rooms/`（`walls.js`/`floor.js` 程序化墙地、`wallSkin.js` 墙体皮肤体素柱（皮肤带内基底盒不砌、暗腔背板挡光）、`terrain.js` heightmap 管线（单位占位 control 保证战场水平铁律）、`composeRoom.js` 红线法摆放器（keepout 由 battleLine+slots 派生）、`lighting.js` 布光预设、`presets.js` 爬塔四阶段风格流 fortress/palace/manor/library + boss/mezzanine、`index.js getRoomScene`）。
- **布光两处方**：环境光总量压在 hemi~1.0/fill~0.12（逐项单开不亮叠加洗成牛奶蓝），亮度交给局部光池；所有灯色与单位染色底过 kit 的 `desatColor`（保持亮度、冷色多去一档）。调参先在 `roomGallery.html` 的 knob A/B 再焙入。
- **对象**：`objects/`（CardObject、UnitObject、ZonePileObject、TargetingArrowObject、**ItemShowcaseObject** 公共获得演出（`Stage.showcaseItem`；`skippable:true` 双出口）、**SpeechBubbleObject/BubbleLayer** 头顶泡泡（放 uiScene 恒定屏幕尺寸）、PanelObject（锚定/模态/dock 形态）、ButtonObject、TextBlockObject、ScrollPickerObject 全屏选择骨架、CardScrollPicker/RelicScrollPicker、SlotRollObject 等）。
- **休息阶段 Three 化**：`stages/RoomStage.js` = 与塔楼/战斗并列的第三舞台。`runController` 在 `restRecipeFor(roomType)` 有配方时（slot→casino、campTraining→camp、shop→shop）经幕间黑幕切房间 PCG 场景；离开再黑幕回塔楼；没配方的房走塔楼层 + 占位面板。**机器逻辑按机器下沉到 `stage/machines/`**（每台机器一个模块：rig 创建/取景覆盖/面板 builder/专属拾取/快照同步/义务门，`machines/index.js` 登记一行，数组顺序 = 义务门优先级）——**加新机器只改 machines/**。房间内通用机制：点机器相机推近才弹操纵 UI；**dock 面板一律不给「返回房间」键**（退出口 = 点面板外拉远）；hover 反馈只在全景（聚焦时不响应）；交互物浮标 y 必须落在 `FLOOR_Y`；「继续前进」在奖励没领完时压暗 + 思索泡泡提示（判据 `RoomStage._pendingRoomDuty()`）。进房/离房节拍：进房 `roomScenePending` 置位不推塔楼面板；离房黑幕中点执行 `completeRoom + notify`。
- **选卡/选遗物/获得特写三件套统一走 `stage/stagePickerKit.js`**：`createStagePickerKit({uiScene,getPicker,bakeFace,bus,onIntent})` 惰性持有三件套 + 统一 source 表（camp/training/bankUpgrade/bankBurn/slot/gurpasRemove/bossRemove 七源并集）。**全屏选卡界面必须拿到 kit 的 `bakeFace` + `bakeText`**（缺了 = 候选卡隐身，hover 预览却正常）。这三件套一律画在当前活动舞台的 uiScene（`panelStage() = roomStage ?? mapStage`——只有活动舞台会被渲染）。
- **切幕器与 cutscene 播放器分离**：黑幕目的地可以是任何东西（3D 舞台或一段 cutscene）。wipe 在全黑中点调下一步的 `preStage()`（内容幕后就位）；紧跟 wipe 的对话在揭幕段就挂上；cutscene 退出回舞台也走切幕（`runController.exitSceneAfterCutscene(beforeSwap)`）。
- **战斗→奖励→塔楼节拍**：战斗终局**先落战后奖励、不切幕**——奖励 overlay 画在战斗舞台 uiScene（面板模态吞掉拖牌/瞄准/战场点击）；领取/跳过后才切幕，黑幕中点 `swapBattleToMap()`，揭幕后楼层 clear 动画 → 战后剧本 → 进房演出。`App.vue` 的 `activeStage()` 在战斗舞台存活期间由它接管指针。
- **面板与数据流**：休息面板快照→widget 映射在 `stage/panels/`（`index.js` 只装配 `PANEL_BUILDERS` + 转发；builder 按域居 prep/reward/ascension/shop/room 各文件，共享件在 shared.js）。**数据下行唯一通道 = `core/run/panelSnapshot.js` 纯函数**（Stage 不得拉取 run 状态）；**意图上行 = `runController.dispatchPanelIntent`**（Stage 只上报「谁被点了」）。3D 源 tooltip 常驻转发器 = `shell/tooltipForward.js`；tooltip 内容契约除 effect/relic/card/named/intention/shift 外还有 **`item`**（`{title,body,tint}` 通用文本）。cutscene dialogue step 支持选项与 `step.bg` 幕间 CG。验收：`uiGallery.html` / `roomGallery.html` / `propGallery.html` 浏览器视觉门（调参 knob 见各页）。

### Shell（`src/shell/`）

- `App.vue` — 三层场景编排 + canvas 生命周期 + 全局 toast（`provide('showMenuPopup')`）+ 指针路由（battle→BattleStage，其余→MapStage）。
- `runController.js` — run 层唯一编排器：Vue 薄壳与 core run 状态机之间的唯一通道；run 经 `reactive()` 暴露；读档恢复在此（存档语义 = prep 检查点）。**分域拆分**：编排器本体只剩战局装配/舞台生命周期/奖励与房间迁移/存档；交互域抽成同构工厂模块（`create*(ctx)`，ctx 引用晚绑定箭头闭包）——`shell/runShowcase.js` = 到手演出编排；`shell/runMachines.js` = 房间机器流（意图→core 调用→notify→附带演出）；`shell/runCutsceneFlows.js` = 幕间流（随机事件 + 进阶）。**意图上行表驱动**：`dispatchPanelIntent` = 本地表 + 三域 intents 合并，未知 action 静默忽略——加新机器/幕间在对应域模块加方法 + intents 登记，主体不再生长。
- `saves.js`（两模式隔离）、`settings.js`、`audio.js`、`tooltip.js`。
- `components/`（剩余 Vue 组件）：菜单层（StartScreen/GameMenu/EndPanel/MenuDialog·MenuPopup/ChangeLog）、`BattleHud`（战斗日志/回合数）、`TooltipOverlay`/`CardFacePreview`、`AssetLoadingScreen`（全量美术预载门：**全部成功前挡住开始界面，失败卡住不放行并给重试**；进度条按下载体积驱动，stats 计数字段是 `done`，App.vue 必须映射回 `loaded`——整条替换会抹掉它）。
- `overlay/`：cutscene 播放器 `cutscenePlayer.js` + 内容层 `CutsceneOverlay.vue` + 切幕层 `sceneWipe.js`/`SceneWipeOverlay.vue` + 剧本 `scripts.js` + 事件图 `eventArt.js`（真素材丢 `src/assets/images/events/<art>.webp` 自动顶替）。

## 测试

- **测试维护暂停（用户定，提速优先）**：新改动不再新增/同步测试，不以 `npm test` 全绿为验收门槛——存量测试失效属预期，不要为其花工时。逻辑改动跑 `node tmp/smoke-*.mjs` 冒烟自验；浏览器行为由用户验收。本条优先级高于本文件其它与测试相关的描述。
- 若确需写测试：只测后端结算逻辑、程序骨干（gameflow/状态机）与基础设施（加载卸载/订阅退订/绘制同步竞态）；**不测视觉样式与演出参数**（颜色/曲线/粒子/时长——必然反复调整，断言即炸）。战斗测试用 `BattleDriver`/`RunDriver` 驱动真实结算，不 mock Core；断言注册表内容先 `import '../src/core/content/index.js'` 触发登记。
- `tmp/` 是一次性产物（冒烟脚本、Playwright 截图、试玩会话），无需维护。

## 代码约定（踩坑备忘）

- 编辑前先读文件，不破坏无关逻辑；重构时删除废弃旧代码（含 CSS、未用函数）。
- 可抽离的共用逻辑尽量抽离，避免重复。
- Core 状态只放 id/slug + 标量（可序列化），定义引用一律经注册表反查。
- 牌库顶 = 数组 index 0（FIFO：顶抽底还，**无弃牌堆、无重洗**；弃牌/打出/换牌等非消耗离手卡一律回牌库底 = 数组尾）；牌的 zone 不显式存储，用 `zoneOf/moveCard` 反查，数组是唯一事实源。
- **pending 结算区惯例**：结算中的卡（主语或宾语）在 pending 区——发动卡在 `UseSkillInstruction` stage 1 离手（hand→pending，静默裸 moveCard），收尾落位；对发动卡的引用以 `sctx.self` + 出牌时点捕获（`sctx.handIndexAtPlay`，经 `helpers.handIndexAtPlay/handNeighborsAtPlay` 读）为准，**不扫 hand**。单节拍原子指令（弃/焚/移）不经 pending；未来「离场→跨节拍处理→落位」机制按同一惯例书写：先入 pending、末段 `zoneOf` 校验后落位，落地指令对「目标不在预期区」静默落空（`DiscardCardInstruction` 为范式）。
- **PRE/POST 反应纪律**：PRE 只做 payload 修饰（`setPayload`）或 veto，世界变更（改 zone/资源/生命）一律 POST 子节点提交；「额外一张」类计数语义优先改写被观察指令 payload（替代效应，每事件至多一次），其次 POST 追加。PRE 内提交「自身资源记账」类子指令合法；PRE 禁的是与被观察指令操作同一 zone/资源的变更指令。
- 伤害/面板修正三段式：`amount = 基础值 + getStat(面板)` → `payload = PRE 修饰流水线(amount)` → `execute(payload)`（固定公式：减防御→护盾吸收→minHp 地板）。PRE 流水线顺序敏感（priority 降序 + 注册序），不做固定乘区。
- 效果订阅由 `AddEffectInstruction` 在首次获得时挂载（owner=`effect:{unit}:{effect}`），层数扣尽注销；技能订阅战斗开始注册一次，zone 限定写 filter；咏唱双态（无槽）：发动=付费回手点亮，再次打出=免费解除并按特性离场，任何离手路径由指令层统一熄灭；咏唱压力走手牌上限加权口径（激活咏唱按 chantWeight 计多张，发动合法性 = 激活后加权数 ≤ player.maxHandSize）。
- 卡牌计数器放 `skillRuntime`，不藏闭包；技能算伤害与 `describe` 显式读 `getStat`（同源不漂移）。
- **设计稿术语口径（防臆测乌龙）**：实现设计文档里的卡面效果语言前，先按既定主语约定读稿——**裸写「效果X N」（如「燃烧3」「格挡2」）= 赋予自己**效果 X N 层；**「赋予效果X / 目标获得X」= 赋予卡牌目标**（通常是敌人）。**术语不理解务必查权威文档**：效果规则查 `battle_gameplay/skills/EFFECTS.md`、机制词查 `core/skills/namedTerms.js`（NAMED）与对应体系设计稿——**禁止凭语感臆测**；NAMED 已定义的语义与写法（含尾缀数字参数如 `衰败2`）必须照办，不得自创同义写法。**查不到定义的术语 = 不实现**，向用户上报待定义。
- **新卡数值意识（设计铁律）**：设计新卡必须先做数值对标——与同阶基础卡、其他体系的同类功能卡逐项比（盾对盾、伤对伤、抽对抽），确认落在既有包络内再写定义，**不许凭感觉给数**。**彻底 0 开销卡（0AP+0 魏启+无冷却）必须谨慎**——免费即每回合白嫖，默认冷却 1 起步。条件加成卡的拆分口径：**基础值对标同阶白板、加成值才是体系溢价**，无条件部分不许比同阶白板强。
- 卡面描述双轨：`describe`（应用前，无战斗上下文，纯文本）/ `battleDescribe`（结算中，数字按实时局面）。
- **UI 风格：扁平 / 白字 / 淡蓝按钮**：按钮与面板走"深底 + 白字 + 淡蓝细描边"（`richtext/buttonFace.js` 的 THEMES 是唯一事实源——**无渐变、无自体发光**），面板不大圆角（按钮可小圆角，其余 ≤4px）；**金色只留给金钱相关内容**，标题与提示用白 `#e8eefb` / 淡蓝灰 `#c3cee0`。对话框 = 黑色半透明扁平框。内容语义色（稀有度 `RARITY_COLORS`、灵脉维度色、敌人名红）不受此约束。
- **公共"获得演出"三件套**：任何"到手一拍"都应走 `Stage.showcaseItem(payload)`（`skippable: true` + `onSkip/onDismiss` 表示可放弃）；无素材的 key 由组件程序化占位。新增获得路径不要绕过它自画 UI。
- **卡面文本只写效果语言**：费用/等阶/充能/冷却/关键词（消耗/固有/短暂/锁定/缓启）走徽章与页脚词条行（`cardFace.js` 的 `drawFooter`），**不要在 `describe`/`battleDescribe` 里复述**（如「冷却8」「消耗。」）。咏唱卡的「咏唱N：」前缀由渲染层自动加（`chantPrefixedText`），**激活前后文案不变**。
- **通用机制词走 named 术语**：跨卡复用的机制关键词定义在 `core/skills/namedTerms.js`（含特征色 + tooltip 描述，名称可带尾缀数字参数），卡面 markup 用 `/named{术语}`；机制本体写进 def 字段/订阅，不要把长机制文本摊在卡面上。**词条双轨**（2026-09-18 定）：`describe` = 玩家版（短文案）；`agent` = headless/LLM 版（「幼稚园模式」程序化细则——触发时机/判定口径/不生效情形写全，防 agent 误读规则），headless 的 `terms` 视图读 agent 版（`listNamedTerms({ agent: true })`）；新词条两版都要写。
- **卡间引用走 `/card{卡id, k=v, ...}`**：卡面文本提及另一张卡一律用 id 引用（改名不失配），hover 热区弹**整卡预览**；不要写「卡名」裸文本。
- **卡牌威力提升（power）一律走 `cardKit.gainPower(sctx, card, n)`**，不要裸改 `card.power += n`：它还发 `presenter.cardPowerUp` → `ANIM_CARD_POWER_UP` 公共节拍——「这张牌状态变了」玩家要看得见。
- **手牌弹簧弃管必须「离手即摘」**：卡离开手牌（展示毕待离场/弃/焚/迁移/视图销毁）时**立刻** `springs.release(id)`，绝不能等下一次重算兜底——空窗期里 idle 的卡会被弹簧从展示位拉回手牌锚点（「打出 → 飞回手牌 → 再飞牌库」病灶已多次回归）。
- **刀法牌 = `series: 'blade'`**（`cardKit.isBladeCard`：series 命中**或** keywords 含 blade）——碎铁/出鞘这类"斩的衍生与处理牌"也算刀法牌，吃养刀术/锻刀术/练刀/砺刀系效果；它们 keywords 不带 `blade`。
- `.trae/rules/project_rules.md` 关于 `backendGameState/displayGameState`、`animationSequencer.js` 的描述是**旧架构**残留——以本文件与 README 为准。

## 权威设计文档

- `README.md` — 场景层级总纲与数据系统说明。
- `battle_gameplay/` — 战斗与 run 层设计总纲：`battle.md`（战斗总则/结算时序公理/数值基准）、`RUN_DESIGN.md`（核心循环/养成/卡包/进阶/奖励房）、`REWARD.md`（卡包等阶分布/通用注入/训练抓牌的调参表）、`SLOT_MACHINE.md`（老虎机/银行/恶魔 roll）、`SHOP.md`（售货机/古尔帕斯之店）、`RELICS.md`（遗物个体设计）、`REMI.md`、`ENEMIES_1.md`/`ENEMY_GENERATION.md`（敌人）、`ENEMY_ART_LIST.md`（立绘待办）。
- `battle_gameplay/skills/` — 各体系卡牌设计稿 + `EFFECTS.md` 效果目录；`SKILL_DESIGN_PRINCIPLES.md` 在 `src/core/skills/` 下。
- `quest_prompts/` — 重构与实现设计文档（THREE_REFACTOR_PLAN / STAGE_DESIGN / SCENE_* / THREE_UI_MIGRATION 等）。
- `handoffs/` — 历史交接记录（含关键约定，注意核对时效）。

## 安全注意事项

- `tools/seedream/` 是美术素材生成管线（火山引擎方舟 API）：`ARK_API_KEY` 经环境变量传入，**不要**把密钥写进代码或提交。
- `tools/compress_art.py` 是美术压缩管线（PIL）：`src/assets` 下 PNG 原位转 WebP（立绘 q90 保 alpha、插画/背景 q85，删原件）；素材解析层按去扩展名查表，png/webp 混放透明切换——新素材丢进 assets 后跑一次即可。
- 存档存于浏览器 localStorage（`saves.js`），不涉及服务端凭据；仓库无后端、无数据库——引入新的网络请求或远程依赖须说明理由。
