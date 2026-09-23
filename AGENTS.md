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
node tools/saveForge.mjs --out t2 --floor 2 --room campTraining   # 造调试存档（见「调试模式」节）
npm test           # vitest（存量；维护已暂停，见「测试」节）
```

不要用 dev 服务器验证**编译/逻辑**错误——改完跑相关冒烟脚本即可。**浏览器行为**如今 agent 也能自验：
`tools/browserHarness.mjs` 走真显卡（60fps，见「浏览器调试 harness」节），配 `tools/saveForge.mjs`
造档起跑，常见流程（房间/幕间/选卡/战斗）都能脚本化跑通；手感与审美仍由用户验收。

## headless 试玩与直播观战（dev 工具，不进构建产物）

- `tools/headlessPlay.mjs` — LLM/脚本可玩的**文本界面**（replay 式会话：`tmp/playtests/<名>.json` = `{seed, actions}`，每次调用全量重放 + 执行新动作，成功才入档）。引擎入口 `tools/playSession.mjs`，实现按职责拆在 `tools/session/`（engine/render/format/addressing/files）。
  - **两种建档**：`new <种子>`（从零开局）｜ **`load <存档名|路径.json>`**（从存档快照起跑，2026-09-21 加）——层数/卡组/遗物/能力/灵脉/体修等级/房内现场原样恢复，等于在文本界面里接着打一个调好的构筑，不用每次重造档或开浏览器。存档名解析到 `tmp/saves/<名>.json`；带路径分隔符或 `.json` 后缀按路径读，**调试面板「存档」页导出的 JSON 可直接喂进来**。
  - 恢复原语是 core 的 `src/core/run/saveRestore.js`（`restoreRunFromSave`，浏览器读档与 headless 共用同一份，两边局面必然一致）；`debugMode` 档恢复房内/进阶现场，真实档维持「检查点 = prep」。
- `tools/broadcast.mjs` — **直播中继**（只读观察会话文件 + HTTP/SSE 推流，零新依赖）：把动画指令描述符推给浏览器、由本地 sequencer 重建播放，观战页因此复用 `BattleStage`/`BattleHud`/`TooltipOverlay` 全套真实渲染。观战页 `http://localhost:5177/watch.html?port=5199&session=<名>`（默认端口 5199），会话索引 `http://127.0.0.1:5199/`。
- 契约层：`src/bridge/wire.js`（指令描述符 ↔ 重建）、`src/bridge/remoteBridge.js`、`src/core/anim/sequencer.js`（指令的可选 `wire` 字段）、`src/bridge/stateSync.js`（标脏/补同步调度器）。
- **公网观战**：`https://wekyspire.hineven.site/watch.html`。链路 = 服务器观战页 → Apache 反代 `/relay/`（`flushpackets=on` 是 SSE 必备）→ SSH 反向隧道 `ssh -N -R 127.0.0.1:5199:127.0.0.1:5199 hineven.site` → 本机 `node tools/broadcast.mjs --origin https://wekyspire.hineven.site`。观战页在非 localhost 主机下自动走同源 `/relay`。

## 调试模式与存档制作器（dev 工具）

**调试模式** = 游戏内一块 Vue 浮层面板，把 run 当表拨：层数/资源/卡组/遗物/灵脉/房间/战斗一击即改，改完立刻在真实前后端链路上看到结果。它取代了旧的「无敌模式」（无敌成了面板里的一项：无敌效果开关 / 发一张 GM 卡「一拳」`onePunch`）。

- **入口**：开始界面复选框「调试模式（仅调试用）」（持久化到 `settings.debugMode`）｜游戏内 **F9** 或右上角「调试」按钮开合面板｜URL `?debug=1` 强制开启。新开局勾选时开局直发一张「一拳」。
- **存档槽**：调试局只写 `wekyspire:save:debug`（`saves.modeOf(run)` 统一归一）；**真实槽永不被污染**。兜底安全网：普通局里从面板改了任何状态 → 该局立即转为调试局（含 toast 告知）。
- **分层**：core 原语 `src/core/debug/ops.js`（run 级）、`src/core/debug/battleOps.js`（战斗内，**全部走既有指令**：秒杀走正式伤害/死亡/胜利链）；Shell 门面 `src/shell/runDebug.js`（`ctrl.debug.*`，负责"改完之后前端怎么刷新"）；UI `src/shell/components/DebugOverlay.vue`（只画界面，读写都经门面）。加新调试能力：core 原语 → 门面 `act(...)` 包一层 → 面板加控件。
- **边界（有意为之）**：战斗中禁止改牌组/遗物/跳层（战场按旧牌组装配，`promoteCard` 还会原地改战斗中的同一批 runtime）→ 面板置灰并提示「先秒杀/硬重置」；写 `?debug=1` 时代码照常进构建产物，但没有开关时面板与热键都不存在。

**存档制作器** `tools/saveForge.mjs` —— 造出任意状态的合法存档，浏览器一步起跑（零新依赖）：

```bash
# ① 声明式造档（spec 文件或命令行 flag；亦可 --from-session 把 headless 会话现场转成存档）
node tools/saveForge.mjs --spec tmp/specs/t2.json
node tools/saveForge.mjs --out t2 --floor 2 --room campTraining --hp 40 --money 300 \
     --training 1 --leino fire=2 --add-card onePunch --relic frostBrooch
node tools/saveForge.mjs --from-session r20-a1-2 --out 现场1
# ② 浏览器从该状态起跑（真实前后端；dev 中间件把 tmp/saves/ 挂在 /debug-saves/）
#    http://localhost:5177/?debug=1&save=t2
```

- spec 字段与守卫：见文件头注释；**一切经 core 真实构造函数与守卫**（`createRun`/`grantRelic`/`refreshRunModifiers`/调试原语），产出必然是游戏自己认可的状态（不会因手写缺字段造出假 bug）。`debugMode: true` 的档会额外恢复 `gameStage/currentRoom/roomData/encounter`（真实档仍维持"检查点 = prep"旧语义）。
- 两个易踩的坑（工具已守卫，知道即可）：① **`player.bodyLevel` 与 `player.leino.body` 是同一个字段**（体修等级）——同时写且不一致会直接报错；② 上限类 `max*` 字段会**先于** `hp/mana/actionPoints` 落地（否则当前值会被旧上限裁掉，写 `hp:70/maxHp:70` 会造出 65/70）。
- 面板「存档」页可导出当前局面 JSON / 粘贴导入重开 / 重载当前局面（重建舞台）——调试中把现场回传或复现同一状态都靠它。

**快速复现 bug 的闭环（推荐姿势）**：

```
① headless 走到现场   node tools/headlessPlay.mjs <会话> <动作…>
② 转成存档            node tools/saveForge.mjs --from-session <会话> --out repro1
③ 浏览器一步起跑       http://localhost:5177/?debug=1&save=repro1   （或 Playwright goto 一次）
④ 面板/F9 微调 + 观察 → 导出存档 JSON 回传
```

⚠ 别再为了看某个房间/某层状态去"Playwright 逐层打过去"：直接用 saveForge 造档 + 一次 goto 就是那个现场。

## 浏览器调试 harness（GPU，dev 工具）

`tools/browserHarness.mjs` = 真显卡的 Playwright 封装 + 本项目常用助手，**写浏览器验证脚本一律用它**。

- **性能事实（2026-09-19 实测）**：慢的唯一原因是老 harness（`tmp/play/harness.mjs`）里那几行
  `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`（软件渲染）——实测 **1.9 fps**。
  去掉后同一个 headless Chromium 在这台机器上 **60 fps**（ANGLE / NVIDIA RTX 3090 + D3D11；
  **无头也有真 GPU**，不需要开窗口）。所以：**不要**再加任何 `--use-gl / --use-angle` 开关，
  只保留防降帧那几条（harness 已内置）。
- **驱动姿势**：60fps 下演出按**真实时间**播完，所以等的是真实条件——
  `h.waitFor(() => 页面内表达式)` / `h.waitRoom()` / `h.waitCutsceneEnd()` / `h.waitStage('room')`。
  `pump()`（手动泵 tick）是软渲染时代的产物，新脚本不要再写。
- **常用口子**：`h.goto('?debug=1&save=<名>')` 起跑 ｜ `h.state()` 后台状态速览 ｜ `h.log()` 调试面板回执 ｜
  `h.dbgCall('setFloor', 6)` 直接调调试门面 ｜ `h.clickObject('training')` 点房间 3D 交互物 ｜
  `h.clickPanelBtn('train:begin')` 点面板按钮 ｜ `h.clickPanelCard(i)` 点面板卡阵 ｜
  `h.cutsceneChoice('火灵脉')` / `h.cutsceneAdvance()` 推幕间 ｜ `h.clickPickerCard(i)` +
  `h.clickPickerConfirm()` 全屏选卡 ｜ `h.shot('名字')` 截图 ｜ `h.fps()` 自查帧率与 WebGL 后端（确诊是否又跑回软渲染）。
- **面板层次坑**：场景房的 dock 操纵条（`rs._panel`）与阶段模态面板（`rs._stagePanel`）会**同时存在**
  （进阶期间 dock 仍挂着过时内容）——harness 的点击助手一律**优先阶段模态**；自己写页面内表达式时也要注意。
- **自检**：`node tools/browserHarness.mjs --check [--save 名] [--headed]` —— 起一次、报帧率/WebGL/现场状态，
  落一张截图到 `tmp/play/harness-check.png`。
- 参考脚本：`tmp/play/check-train-real.mjs`（从存档起跑，真时间走完「训练桩 → 房内进阶 → 种子包 → 抓牌 → 尾款升级」全流程，约 16 秒）。

## 分支、协作与部署

- **上游仓库 = `https://github.com/wekyspire/wekyspire`**（remote 名 `wekyspire`，`master` 为唯一主干）。旧 `Hineven/wekyspire` 只是历史个人仓库（保留为 remote `hineven-origin`），不是交付目标。
- **多人并行：每人一条自己的长期开发分支 `<名字>-dev`**（如 `hineven-dev`），都推到 `wekyspire`；功能完成后开 PR 合进 `master`（**不要直接推 master**）。开工前先 `git fetch wekyspire && git merge wekyspire/master`（长期分支落后是冲突的主要来源）。合并冲突以**自己 dev 分支的实现为准**（冲突方是别人正在维护的模块时先沟通）。
- **线上站点由服务器 cron 部署**：`/usr/local/bin/wekyspire-deploy.sh`（每 5 分钟拉 `origin master` → `VITE_BASE=/ npm run build` → rsync 到 `/var/www/html/wekyspire`）。**要上线的新内容必须先合进 `master`**。国内网络拉不动 GitHub 时，可直接把本地 `dist/`（`MSYS_NO_PATHCONV=1 VITE_BASE=/ npx vite build`）tar 上传到站点目录，产物等价。
- **GitHub Pages workflow 已在上游删除**——不要再加回；推上去只会触发必然失败的 job。
- 仓库根 `dist/` 是构建产物（gitignore），不要手改。

## 版本与 changelog

- 玩家可见更新日志 = `public/changelog.md`（开始界面「更新日志」弹层直接读它）。一条版本 = `## YYYY.M.D [Alpha X.Y.Z]` + `- 签名：Hineven` + 小节；新条目**加在文件最上方**，并把 `package.json` 的 `version` 同步改掉（两者必须一致——**vite.config.js 构建期已自动校验**：不一致直接构建失败；开始界面版本行的编号/日期也由此注入，日期 = changelog 顶部条目日期，不是当天日期）。
- **版本号纪律（2026-09-18 用户定）：只有「大更新」才升中版本号（X.Y.0）**——限五类：成体系重构、全新底层机制、大规模视觉效果更新、全新系统加入、大主题成批内容加入。除此之外（数值平衡调整、新卡补簇、流程改版、bug 修复、文案精简……）**一律只升修订号**（0.8.3 → 0.8.4）。
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

### 富文本（文本层唯一事实源）

文本里可写行内 markup：`/card{卡id, k=v}`（**卡间引用一律用 id**，改名不失配）、`/named{术语}`、`/effect{效果名}`、`/红绿蓝紫色名{文本}`。解析器 = `stage/richtext/parser.js`（纯函数，token 流），**外观解析唯一事实源 = `stage/richtext/appearance.js`**（`effectLook` / `namedLook` / `cardLook` + 色表 + `cardTheme` / `seriesGlyph`）——所有渲染环境都必须接它，否则引用会退化成「● 原始 id」。

三个渲染环境，同一份 token/外观口径：

| 环境 | 入口 | 交互 |
|---|---|---|
| 卡面烘焙 | `richtext/cardFace.js` `bakeCardFace` | ✅ 随纹理成对返回 `hitRegions`——CardObject 3D 拾取 / CardFacePreview DOM 命中（同一 `hitTestRegions`）→ hover 弹整卡预览/术语（**老约定，只此一处**） |
| 3D 单行文本 | `objects/textBakers.js` `bakeRichLine`（走 `renderRichTextBlock`） | ❌ 只出图（面板行/特写/状态栏只要"印对"） |
| DOM 浮层正文 | `richtext/inline.js` `inlineSegments` → `shell/components/RichTextInline.vue` | ❌ 纯呈现（**tooltip 内不做 hover**，见下） |

- **auto 烘焙（默认口径）**：`bakeAutoLine` = 含 markup 走 `bakeRichLine`，否则**原样走 `bakeBoldText`**（纯文本行零回归）。它是 `TextBlockObject` 的缺省烘焙，面板 / 获得特写 `ItemShowcaseObject` / 房间 dock 操纵条 / 卡牌画廊都用它——**加新文本面直接用它，别自己写烘焙**。
- `hasMarkup(text)` 是「走富文本还是纯文本」的唯一判据（3D auto 烘焙与 tooltip 正文同源）；tooltip 模型里 `markup: true` 即由它产生（`tooltip.js` 的 relic/effect/named/item）。
- **tooltip 内不做 hover（用户 2026-09-19 定，勿再引入）**：tooltip 全局唯一、随叫随到，正文里的引用只**渲染**（特征色 + 图标 + 系列字形徽章），不弹嵌套浮层。理由：`tooltipShow` 换 token 即换内容，热区一旦在指针底下消失就会触发 leave → 还原 → 再进入的**自激振荡**（当年因此放弃）；要做得稳就得引入嵌套槽位、指针分层、双向宽限期三套机制，复杂度不划算。带热区的引用只保留在**卡面**上（那里引用就印在卡面里，不存在"内容被替换"的问题）。
- `.tooltip` 整体 `pointer-events: none`（含整卡预览）——这是"嵌套 hover 一层即止"的实现方式，也是浮层不抢指针、可随叫随到的前提。

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
- **卡面手牌数口径（2026-09-20 用户定）**：卡面写「手牌 / N 张手牌 / 每张手牌」一律按**裸张数**实现（手牌区张数，激活咏唱算 1 张）——**不加权**，不得顺手用 `effectiveHandCount`。只有明写「手牌压力」「超载」「咏唱容量」（named 术语）的效果才走加权口径；「抽满手牌」类按容量填满的表述属容量语义（`drawToHandLimit`），不属数量计数。总纲见 `battle_gameplay/battle.md` §1 基础约定。
- **卡牌设计元逻辑（2026-09-21 用户定，设计第一标准）**：① **交互紧密**——卡的边缘应指向其他卡而非只指向战场；自检：每张新卡至少改变两张以上既有卡的价值，自给自足的孤卡即设计缺陷。② **机制统一**——体系内共用少量机制动词做参数化组合，不为单卡发明一次性机制；统一是**体系内**的统一，各体系的资源与机制抽象各有特色，不跨体系照搬。③ **描述简单可归纳**——一行说清一张卡是①②的自然结果，不是文风目标。④ 设计稿用**陈述式**：只写当前设计，修订纪事与定价论证归 commit，不归文档。
- **新卡数值意识（设计铁律）**：设计新卡必须先做数值对标——与同阶基础卡、其他体系的同类功能卡逐项比（盾对盾、伤对伤、抽对抽），确认落在既有包络内再写定义，**不许凭感觉给数**。**彻底 0 开销卡（0AP+0 魏启+无冷却）必须谨慎**——免费即每回合白嫖，默认冷却 1 起步。条件加成卡的拆分口径：**基础值对标同阶白板、加成值才是体系溢价**，无条件部分不许比同阶白板强。
- 卡面描述双轨：`describe`（应用前，无战斗上下文，纯文本）/ `battleDescribe`（结算中，数字按实时局面）。
- **UI 风格：扁平 / 白字 / 淡蓝按钮**：按钮与面板走"深底 + 白字 + 淡蓝细描边"（`richtext/buttonFace.js` 的 THEMES 是唯一事实源——**无渐变、无自体发光**），面板不大圆角（按钮可小圆角，其余 ≤4px）；**金色只留给金钱相关内容**，标题与提示用白 `#e8eefb` / 淡蓝灰 `#c3cee0`。对话框 = 黑色半透明扁平框。内容语义色（稀有度 `RARITY_COLORS`、灵脉维度色、敌人名红）不受此约束。
- **公共"获得演出"三件套**：任何"到手一拍"都应走 `Stage.showcaseItem(payload)`（`skippable: true` + `onSkip/onDismiss` 表示可放弃）；无素材的 key 由组件程序化占位。新增获得路径不要绕过它自画 UI。
- **卡面文本只写效果语言**：费用/等阶/充能/冷却/关键词（消耗/固有/短暂/锁定/缓启）走徽章与页脚词条行（`cardFace.js` 的 `drawFooter`），**不要在 `describe`/`battleDescribe` 里复述**（如「冷却8」「消耗。」）。咏唱卡的「咏唱N：」前缀由渲染层自动加（`chantPrefixedText`），**激活前后文案不变**。
- **通用机制词走 named 术语**：跨卡复用的机制关键词定义在 `core/skills/namedTerms.js`（含特征色 + tooltip 描述，名称可带尾缀数字参数），卡面 markup 用 `/named{术语}`；机制本体写进 def 字段/订阅，不要把长机制文本摊在卡面上。**词条双轨**（2026-09-18 定）：`describe` = 玩家版（短文案）；`agent` = headless/LLM 版（「幼稚园模式」程序化细则——触发时机/判定口径/不生效情形写全，防 agent 误读规则），headless 的 `terms` 视图读 agent 版（`listNamedTerms({ agent: true })`）；新词条两版都要写。
- **卡间引用走 `/card{卡id, k=v, ...}`**：卡面文本提及另一张卡一律用 id 引用（改名不失配），hover 热区弹**整卡预览**；不要写「卡名」裸文本。
- **任何文本都可能带 markup**：遗物/效果/卡牌描述里的 `/card{}` `/named{}` `/effect{}` 在**所有**渲染面（卡面、面板行、获得特写、状态栏、tooltip 正文）都要渲染成图标 + 特征色名称。做法是用 `textBakers.bakeAutoLine`（3D）/`RichTextInline`（DOM），**别自己写烘焙、别在文案里裸写卡名**；如果某个面印出了 `/xxx{`，就是那处没接 `richtext/appearance.js` 的解析器（详见 Stage 节「富文本」）。**引用的热区只保留在卡面上**，tooltip 正文里不做 hover（用户 2026-09-19 定）。
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
