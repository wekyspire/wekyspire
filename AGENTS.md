# AGENTS.md — 魏启尖塔（wekyspire）

> 面向 AI 编码代理的项目导览。项目注释与文档主语言为**中文**，新代码与文档沿用中文注释。

## 项目概览

**魏启尖塔**：单人 Roguelike 卡牌爬塔网页游戏（无尽/故事两模式，存档隔离）；纯前端 SPA，无自建后端，产物是静态站点。核心循环与塔结构的设计见 `battle_gameplay/RUN_DESIGN.md`。

## 技术栈与配置

- **构建**：Vite 4 + `@vitejs/plugin-vue`（`vite.config.js`）。路径别名：`@` → `src/`、`@assets` → `src/assets`。`base` 由环境变量 `VITE_BASE` 控制，缺省 `./`。dev 端口 **5177**（allowedHosts 只放 `wekyspire-dev.hineven.site` 公网验收口）。
- **框架**：Vue 3（组合式 API，`<script setup>`）+ vue-router + mitt。
- **渲染**：three **WebGPURenderer**（WebGPU / TSL 管线，已全量迁移，无 WebGL 回退——`quest_prompts/WEBGPU_MIGRATION.md`）+ GSAP（补间）。共享单个全屏 `<canvas>`。
- **入口**：`index.html` → `src/shell/main.js`；根目录的 `debug.html` / `*Gallery.html` 是调试与视觉验收页；`src/debug/main.js` 是遗留调试页，非正式入口。

## 常用命令

```bash
npm install        # 安装依赖
npm run dev        # 开发服务器（localhost:5177）
npm run build      # 产出 dist/
node tmp/smoke-*.mjs   # headless 冒烟脚本（逻辑改动的快速自验）
node tools/saveForge.mjs --out t2 --floor 2 --room campTraining   # 造调试存档（见「调试模式」节）
npm test           # 随机自对弈 fuzz（见「测试」节）
```

不要用 dev 服务器验证**编译/逻辑**错误——改完跑相关冒烟脚本即可。**浏览器行为**用 `tools/browserHarness.mjs`（真显卡，见下节）脚本化自验；手感与审美仍由用户验收。

## headless 试玩与直播观战（dev 工具，不进构建产物）

- `tools/headlessPlay.mjs` — LLM/脚本可玩的**文本界面**（replay 式会话：`tmp/playtests/<名>.json` = `{seed, actions}`，每次调用全量重放 + 执行新动作，成功才入档）。引擎入口 `tools/playSession.mjs`，实现拆在 `tools/session/`。
  - 两种建档：`new <种子>`（从零开局）｜ `load <存档名|路径.json>`（从存档快照起跑）——层数/卡组/遗物/能力/灵脉/体修等级/房内现场原样恢复。存档名解析到 `tmp/saves/<名>.json`；调试面板「存档」页导出的 JSON 可直接喂进来。
  - 恢复原语 = core 的 `src/core/run/saveRestore.js`（`restoreRunFromSave`，浏览器读档与 headless 共用）；`debugMode` 档恢复房内/进阶现场，真实档维持「检查点 = prep」。
- `tools/broadcast.mjs` — **直播中继**（只读观察会话文件 + HTTP/SSE 推流，零新依赖）：把动画指令描述符推给浏览器、由本地 sequencer 重建播放，观战页复用 `BattleStage`/`BattleHud`/`TooltipOverlay` 全套真实渲染。观战页 `watch.html?port=5199&session=<名>`，会话索引 `http://127.0.0.1:5199/`。
- 契约层：`src/bridge/wire.js`（指令描述符 ↔ 重建）、`src/bridge/remoteBridge.js`、`src/core/anim/sequencer.js`（指令的可选 `wire` 字段）、`src/bridge/stateSync.js`（标脏/补同步调度器）。
- **公网观战**：`https://wekyspire.hineven.site/watch.html`。链路 = 服务器观战页 → Apache 反代 `/relay/`（`flushpackets=on` 是 SSE 必备）→ SSH 反向隧道 `ssh -N -R 127.0.0.1:5199:127.0.0.1:5199 hineven.site` → 本机 `node tools/broadcast.mjs --origin https://wekyspire.hineven.site`。观战页在非 localhost 主机下自动走同源 `/relay`。

## 战斗特效预览台（dev 工具）

`fxGallery.html`——敌人演出/战斗特效的点播验收工作台（`src/debug/fxGallery.js`，dev only 不进产物）：

- **真渲染环境**：composeRoom 战场 + 战斗机位 + 月光 composer + GPU 粒子池 + 震屏（迷你导演偏移通道）——与 BattleStage 同链路，无 bridge/core 战斗开销。
- **目录点播**：起手族（families 五体态/施法/嚎叫/震颤）、形体件（fxPieces 电弧/声波环/引线圈/雾锋/光球/边光）、**逐敌逐拍**（下拉选敌 → 真实意图枚举拍列表 → enemyAct 注册表真分发）、命中三式+逐敌主题、生死拍（unitBeats 真代码 mixin + 死亡覆写 + 复苏 garnish）、aura 主题（burn/poison/stun/blastFuse）。
- **主题战生成器**：勾选编成+层数 → POST `/forge-save`（dev 中间件 spawn saveForge）→ 跳 `?debug=1&save=fxwork-*` 真战斗。
- **URL 参数**：`?enemy=<defId>` 预选目标敌（下拉同步；手动换敌会写回地址栏，刷新/热更新保持）；`?phase=2` 预设 Boss 相（逐拍 attack 走 P2 支路）。
- 探针：`node tmp/play/check-fxgallery.mjs`（点播抽播+端点+截图）。

## 调试模式与存档制作器（dev 工具）

**调试模式** = 游戏内一块 Vue 浮层面板，把 run 当表拨：层数/资源/卡组/遗物/灵脉/房间/战斗一击即改。

- **入口**：开始界面复选框（持久化 `settings.debugMode`）｜游戏内 **F9** 或「调试」按钮｜URL `?debug=1` 强制开启。
- **存档槽**：调试局只写 `wekyspire:save:debug`；**真实槽永不被污染**。兜底：普通局里从面板改了任何状态 → 该局立即转为调试局（toast 告知）。
- **分层**：core 原语 `src/core/debug/ops.js`（run 级）、`src/core/debug/battleOps.js`（战斗内，全部走既有指令——秒杀走正式伤害/死亡/胜利链）→ 门面 `src/shell/runDebug.js`（`ctrl.debug.*`，负责改完之后前端怎么刷新）→ UI `src/shell/components/DebugOverlay.vue`（只画界面）。加新调试能力：core 原语 → 门面包一层 → 面板加控件。
- **边界（有意为之）**：战斗中禁止改牌组/遗物/跳层（战场按旧牌组装配）→ 面板置灰提示「先秒杀/硬重置」；`?debug=1` 代码进构建产物但无开关时面板与热键不存在。

**存档制作器** `tools/saveForge.mjs` —— 声明式造任意状态的合法存档，浏览器一步起跑：

```bash
node tools/saveForge.mjs --out t2 --floor 2 --room campTraining --hp 40 --money 300 \
     --training 1 --leino fire=2 --add-card onePunch --relic frostBrooch
node tools/saveForge.mjs --from-session r20-a1-2 --out 现场1   # headless 会话现场转存档
# 浏览器起跑（dev 中间件把 tmp/saves/ 挂在 /debug-saves/）：
# http://localhost:5177/?debug=1&save=t2
```

- 一切经 core 真实构造函数与守卫（`createRun`/`grantRelic`/`refreshRunModifiers`/调试原语），产出必然是游戏自己认可的状态。spec 字段见文件头注释。
- 两个已守卫的坑：① `player.bodyLevel` 与 `player.leino.body` 是**同一字段**，同写不一致直接报错；② 上限类 `max*` 字段先于 `hp/mana/actionPoints` 落地（否则当前值被旧上限裁掉）。
- 面板「存档」页：**玩家存档库**（命名快照，localStorage `wekyspire:save:lib:*`——玩到关键楼层存一档即 build 检查点，列表加载/删除，保存是纯快照不转调试局）+ **文件档列表**（tmp/saves/，dev server `/debug-saves/?list=1` 端点，一键加载；档体 `origin` 字段分组——saveForge 缺省 `manual`、生成器等服务端 spawn 传 `--origin auto`，存量 `fxwork-*` 前缀回退 auto，自动组默认折叠防淹手动档）+ 导出当前局面 JSON / 粘贴导入重开 / 重载当前局面。

**快速复现 bug 的闭环（推荐姿势）**：① headless 走到现场 → ② `saveForge --from-session` 转存档 → ③ 浏览器 `?debug=1&save=<名>` 一步起跑 → ④ 面板微调 + 观察 → 导出 JSON 回传。别为了看某个房间状态逐层 Playwright 爬塔。

## 浏览器调试 harness（GPU，dev 工具）

`tools/browserHarness.mjs` = 真显卡的 Playwright 封装，**写浏览器验证脚本一律用它**。

- **性能事实**：慢的唯一原因是软渲染开关（`--use-gl=angle --use-angle=swiftshader` 之类 = 1.9fps）。去掉后同一无头 Chromium 在本机 **60fps**（无头也有真 GPU）。**不要**再加任何 `--use-gl / --use-angle` 开关。
- 60fps 下演出按**真实时间**播完——等的是真实条件：`h.waitFor(页面内表达式)` / `h.waitRoom()` / `h.waitCutsceneEnd()` / `h.waitStage('room')`。`pump()`（手动泵 tick）已废弃，新脚本不写。
- 常用口子：`h.goto('?debug=1&save=<名>')` 起跑 ｜ `h.state()` 状态速览 ｜ `h.log()` 面板回执 ｜ `h.dbgCall('setFloor', 6)` 调调试门面 ｜ `h.clickObject('training')` 点 3D 交互物 ｜ `h.clickPanelBtn('train:begin')` / `h.clickPanelCard(i)` ｜ `h.cutsceneChoice('火灵脉')` / `h.cutsceneAdvance()` ｜ `h.clickPickerCard(i)` + `h.clickPickerConfirm()` ｜ `h.shot('名字')` ｜ `h.fps()` 自查帧率与后端。
- **面板层次坑**：场景房的 dock 操纵条（`rs._panel`）与阶段模态面板（`rs._stagePanel`）会**同时存在**——点击助手一律优先阶段模态；自写页面内表达式同理。
- **演出期输入/读数坑**：长演出链期间点击会被输入仲裁**静默吞掉**（按钮 enabled 也照吞），快照只在 sync 节拍推进（积压期读 `_snapshot.turn` 永远是旧值）。操作前等演出落定（`waitFor` 快照条件），`waitIdleFrames` 只数 rAF 帧不管队列、不是「演出播完」。
- **自检**：`node tools/browserHarness.mjs --check [--save 名] [--headed]`——报帧率/WebGL/现场状态 + 截图 `tmp/play/harness-check.png`。
- **性能探针**：`node tools/perfProbe.mjs --scene map|battle|both`——帧率解锁跑真实帧成本，实验矩阵 = 分辨率阶梯（GPU 斜率）+ CDP CPU 节流（CPU 斜率）+ 主线程采样归并 + fxPost/月光档/渲染背板帽开关；报告落 `tmp/perf/`。harness 口子：`h.perf(ms)`（帧节拍 + renderer.info；WebGPU three 的 `info.render.calls` 是启动以来累计，每帧真值在 `drawCalls/frameCalls`）、`h.cpuProfile(ms)`、`h.cpuThrottle(rate)`。子树成本归因用「裸渲 + 逐子树隐藏 + h.perf」二分（GPU 时间戳的 pass 括号含队列等待，不能做子树归因）。
- 参考脚本：`tmp/play/check-train-real.mjs`。

## 分支、协作与部署

- **上游仓库 = `https://github.com/wekyspire/wekyspire`**（remote 名 `wekyspire`，`master` 为唯一主干）。旧 `Hineven/wekyspire` 只是历史个人仓库（remote `hineven-origin`），不是交付目标。
- **多人并行：每人一条长期开发分支 `<名字>-dev`**，都推到 `wekyspire`；功能完成后开 PR 合进 `master`（**不要直接推 master**）。开工前先 `git fetch wekyspire && git merge wekyspire/master`。合并冲突以**自己 dev 分支的实现为准**（冲突方是别人正在维护的模块时先沟通）。
- **线上站点由服务器 cron 部署**：`/usr/local/bin/wekyspire-deploy.sh`（每 5 分钟拉 `origin master` → `VITE_BASE=/ npm run build` → rsync 到 `/var/www/html/wekyspire`）。**要上线的内容必须先合进 `master`**。Apache 性能配置（HTTP/2 + brotli、hash 产物 `immutable`、`index.html`/`artpack-manifest.js` `no-cache`）在 `/etc/httpd/conf.d/wekyspire.conf`（改动前 `cp` 备份，`apachectl configtest` 过了再 `systemctl reload httpd`）。国内网络拉不动 GitHub 时可把本地 `dist/`（`MSYS_NO_PATHCONV=1 VITE_BASE=/ npx vite build`）tar 上传，产物等价。
- **GitHub Pages workflow 已删除**——不要再加回；推上去只会触发必然失败的 job。
- 仓库根 `dist/` 是构建产物（gitignore），不要手改。

## 版本与 changelog

- 玩家可见更新日志 = `public/changelog.md`。一条版本 = `## YYYY.M.D [Alpha X.Y.Z]` + `- 签名：Hineven` + 小节；新条目**加在最上方**，`package.json` 的 `version` 同步改（**构建期自动校验**，不一致直接失败；开始界面版本行由此注入，日期 = changelog 顶部条目日期）。
- **版本号纪律：只有「大更新」才升中版本号**——限五类：成体系重构、全新底层机制、大规模视觉效果更新、全新系统加入、大主题成批内容加入。**「大规模视觉效果更新」门槛（2026-10-11 用户定）= 几乎所有视觉资产的美术重置，或全新视觉维度的加入（如场景级破坏交互）**；卡面批量重绘/特效翻新按修订号走。其余（数值平衡、新卡补簇、流程改版、bug 修复、文案精简……）**一律只升修订号**。
- **写得短（红线：整条版本正文 ≤150 字）**：归纳 2~3 条，只写玩家能感知的变化；不逐条罗列 commit、不写内部术语、不贴参数。小节用「新增 / 改进与修复 / 已知问题」，空小节不留壳。

## 架构：四层单向依赖

依赖方向严格单向：`Shell → Stage → Bridge → Core`。**Core 不得 import 上层**；Core 的表现诉求只走 `ctx.presenter` 注入（headless 用 `createNullPresenter`，测试用 `createRecordingPresenter`）。

```
src/
├── core/        # 纯逻辑层：环境无关、纯对象（禁 Vue reactive）、可序列化
├── bridge/      # Core ↔ 前端协议层：双事件总线 + 动画队列 + 状态投影
├── stage/       # Three.js 表现层：StageManager / 场景 / 对象 / 动画
└── shell/       # Vue 薄壳：场景编排、Vue 浮层、存档、设置
```

三层场景（菜单纯 Vue / 塔楼 MapStage / 战斗+房间 Three 化）+ 终局结算屏 `stages/EndStage.js`（gameStage='end' 时经黑幕切入的第四舞台；数据源 = run.stats 战绩统计，写入一律经 `core/run/runStats.js`）、`gameStage → PANEL_BUILDERS` 面板映射的权威说明在 `README.md`「场景层级」。两条实现铁律：仍由 Vue 渲染的只有对话 / cutscene / tooltip / `BattleHud` 与菜单层组件；**幕间黑幕是独立一层**（`sceneWipe.js` + `SceneWipeOverlay.vue`，z 压过内容层）——黑幕目的地可以是任何东西，wipe 在全黑中点调下一步的 `preStage()` 让内容幕后就位。

### Core（`src/core/`）

- **`kernel/`** — `BattleKernel`：指令树 DFS 泵 + 订阅注册表 + 取消三动词（veto/abort/inspect）。订阅 `{when, phase('pre'|'post'), filter, window('battle'|'turn'|'once'), priority, react, owner}`。铁律：POST 反应作为已完成节点的子节点提交；被 veto 的节点不触发任何 POST；取消入口只在内核。
- **`instructions/`** — 指令族：`BattleInstruction` 三返回值 `true/false/WAIT`，payload 白名单（`setPayload` 越界抛错）。combat / resources / effects / cards / skill / turn / battleRoot / input / aiAct / units（战斗中生成单位尾插，下回合起参战，敌方意图 kinds 含 'summon'）/ cardMods（卡牌 modifier 挂载/移除）。
- **`state/`** — 纯对象状态：`Unit`（hp/shield/effects/`getStat` 读轨/`uniqueID`/side）、`Player`（run 级，跨战斗存活）、`AIUnit→Enemy/Ally`、`runState`/`battleState` 两层拆分、zones（hand/deck/burnt/pending）、种子 rng、`skillRuntime`（定义/运行时分离）。初始值常量：`PLAYER_BASE_HP / PLAYER_BASE_MONEY / PLAYER_BASE_AP`（禁止裸数字）。
- **`flow/battle.js`** — 战斗装配。终局 abort 的是 TurnLoop 而非根节点，战后清理在树内执行。
- **`run/`** — run 层状态机：`runFlow.js`、`runDriver.js`（headless 整局 SDK）、`rewards.js` / `ascension.js` / `prep.js` / `promotion.js`（局外晋升）、`rooms/`、`runEffects.js`（内容改 run 的唯一入口原语）。**玩法细则不在本文件**——卡包门禁与开包分布见 `RUN_DESIGN.md`，等阶分布事实源 = `rewards.js` 的 `PACK_TIER_TABLE`/`S_SPAWN_WHITELIST`；老虎机/银行/恶魔 roll 见 `SLOT_MACHINE.md`，商店见 `SHOP.md`。房间产出挂 `run.slotPending`/`shopPending`/`pendingDebuffs`，未处理完不许离房。**房间表开局定死**：`run.roomTable`（`buildRoomTable(seed)` 走独立派生 rng，不消耗 run.rng 主账本）= 同种子同塔，消费走 `roomOf(run, floor)`（勿再直接调 `roomOfFloor` 现场掷）；小标尺房型线头符号与 hover 文案读此表。
  - **模式分野**：`run.storyMode` —— 故事模式 = 肉鸽骨架 + 瑞米（战斗盟友/营地游荡/状态栏瑞米区/果实养成）+ 故事事件与幕间剧本；肉鸽（无尽）模式**无瑞米**，老虎机 special 小资源恒为训练次数。事件 `mode` 门控见 `core/run/rooms/event.js`；幕间剧本门控见 `cutscenePlayer.js`。
  - **事件系统**：事件 = 对话 + 选项 + 逻辑，定义进 `core/events/registry.js`，内容在 `core/content/events/`（一文件一事件，显式装配）。**效果由 `resolve` 直接调 `runEffects.js` 原语**，`resolve` 只返回结果页——Shell 对「事件做了什么」一无所知。剧情分支记忆 = `run.eventFlags`。
  - **遗物系统**：字段契约 = `rarity`(C/B/A/S) / `cost`(槽位权重 0–3，Σ ≤ relicSlots) / `nonSlot` / `requires` / `acquisition` / `onAcquire` / `onCampRest` / `runModifiers`(**从 `player.baseStats` 重算，不增量累加**) / `onBattleStart` / `subscriptions`。一局内遗物唯一。**抽选一律走 `core/relics/draft.js`**，不得各自随机。
- **卡牌 modifier（`core/skills/cardModifiers.js`）** — 可挂载的卡牌修正，设计定稿 `quest_prompts/CARD_MODIFIERS.md`，**审核页 `modGallery.html`**（注册表逐项挂样本卡：真卡面/真特效层/页脚词条热区 tooltip，dev only）。要点：卡实例 `modifiers:[{modId,source,data}]`（存储序即优先级）；**有效卡视图 = def ⊕ patch fold 纯函数派生**（keywords 增删 / cost / cooldown；单条内 set→add→min→max；X 费免疫、无冷却卡以 0 为基；legacy 费用通道折视图末端）；费用/词条/冷却读点已全部换视图，**禁止直改字段的旁路**。行为面 `onAttach`/`onDetach`/`subscriptions`（`onDraw`/`turnEndInHand` 是糖）+ `mutesHand`/`unplayable` 旗标；订阅 owner = `uniqueID:mod:<modId>`，移除序 = 先注销订阅再 onDetach。作用域 = 落点即作用域（战斗克隆丢弃 / run 牌组持久，克隆与存档已深拷贝）。内建 `locked` = 焚毁烙印（**不拦出牌**，回合末仍在手则焚毁；卡面页脚「锁定」词条 + hover tooltip + CardFxLayer 烙印视觉）。run 级挂载原语 = `runEffects.attachCardModifier/detachCardModifier`。
- **注册表** — `registryFactory.js` 的 `createRegistry` 产出同构注册表：skills/abilities/enemies/allies/relics/effects/events/cardModifiers。内容是纯静态定义，由 `content/index.js` **显式 import 登记**（不用 `import.meta.glob`）。
- **`sdk/driver.js`** — `BattleDriver`：headless 声明式战斗装配 + 链式出牌 + `runToEnd`，测试与批量验证用。
- **`anim/sequencer.js`** — `AnimationSequencer`：演出指令队列，Shell 侧单协程消费，跨场景共享同一队列定序。默认严格串行（tags 自动含 `'all'`）；并行出口 = `tagAll:false` + 语义标签（死亡拍先例：`['death','unit:<uid>']` 旁挂，「不等某类前序」用「让该类退出 all 集合」表达，不引入负向集合语法；要等旁挂拍的指令把标签显式写进 `waitTags`，如终局闸门等 `'death'`）。
- **`content/`** — 内容实现（技能/敌人/能力/遗物/效果/盟友/事件/诅咒卡）。技能设计意图见 `skills/SKILL_DESIGN_PRINCIPLES.md`。晋升链分离：**局外晋升**（`promotion.js`）走 `promotesTo`，**局内转化链**走 `battlePromotesTo`——两者互不可见。

### Bridge（`src/bridge/`）

`createBridge` 把 Core 战斗接到协议事件流：mitt 双总线（backendBus/frontendBus）+ AnimationSequencer + presenter 翻译层 + 状态投影（标脏 + 拉取缓存，`projection.js`）+ 意图层（`intents.js`）+ 结算期输入仲裁（`interactionHandler.js`）+ run 级显示状态权威 `DisplayModel`。事件名集中在 `events.js`。队列排空时自动补一次状态同步兜底。

### Stage（`src/stage/`）

- **StageManager**：舞台切换/resize/渲染循环。世界相机基准机位构造时落一次（`cameraBase`/`restoreBaseCamera()` 供借机位舞台还原）；`CAMERA_ZOOM 0.79` 只缩世界相机距离，布局坐标不动。
- **后处理层 `stage/post/`**：全屏 pass 唯一事实源 `passes.js`（VERT/FRAG_*/`GLSL_TONE_LIB`/`makeFullScreenPass`），`bloomChain.js`（bright→半分辨率 H/V blur 三段）、`uiComposer.js`（uiScene 后处理链：卡牌/UI → HalfFloat RT(MSAA×4) → bloom → tone map，premultiplied 盖回屏幕）。**RT 合成两条铁律**：① 终段 premultiplied（与直渲逐像素等价）；② uiScene 加法发光件一律 `additiveLight()`（普通 AdditiveBlending 会让光斑在 RT 里「占地」挡世界）。HDR 约定：内容色 ≤1，发光件乘算推过阈值才进 bloom。**bloom offset 通道（`fx/bloomOffset.js`）**：FX 件挂 `BLOOM_LAYER`(7) + 材质接 `bloomPassFlag`，composer 主渲后清黑重渲该层得偏移 RT（共享场景深度，遮挡正确），bright 段判定前把 R 通道加进亮度——起晕可声明而不必拉爆 HDR。开关 `settings.fxPost`（`?uipost=0` 强制关）。**月光链质量档**：`?moonq=half|low` / `settings.renderQuality` 三档调 march/EMA 链分辨率（步数不砍）；偏移 pass 有写入件门控（无可见 BLOOM_LAYER 件整段跳过）。
- **单位特效四层（`fx/unitFxLayer.js` 的 UnitFxLayer 统一宿主，对位 CardFxLayer）**：L0 本体（`unitBodyFx.js` 挂 `_body` 材质，单 program 多 uniform）／L1 贴体 sprite 叠层／L2 笼罩壳罩件／L3 表意件，L1–L3 分组挂 billboard 子组。**悬挂点铁律**：采样本体纹理的 sheet 件挂 `_standee`（吃姿态通道、不与本体脱锚）；世界向粒子/sprite 挂 L 分组；脚下水平假透视件（椭圆环）挂 `_rig`（yaw 对准后长轴与立牌底边平行）。UnitObject 分 `_rig`（yaw 层：status 血条/盾/效果行/意图 + 地面件）与 `_billboard`（倾倒轴：standee/裂半/L1-L3）——死亡倾倒只转 billboard。**状态入口唯一** = AuraHost + `recipes.js` 的 `UNIT_AURA_THEMES`（声明式主题表，diff 驱动，enter/update/exit 只推 level 标量）。纪律：赋予/消除过渡演出拉长 level 斜坡驱动**派生造型**（不许只做透明度渐变）；生命周期 uniform 闲置值必须**中性**（包络用 `sin(clamp(x)·π)` 或双 smoothstep 夹峰，`(1-x)²` 形闲置态恒亮）；变速旋转用积分相位；`UnitObject.update` 逐件 try/catch 就地摘除病灶件；aura 补间 `overwrite:'auto'` + `onInterrupt` 同落地。**Boss 机制状态件 = `fx/bossStateFx.js`**（2026-10-09）：aura 按效果 id 驱动，Boss 机制状态（MEFM 装甲=defense、卡达斯电弧=rage、穿山甲热缝=momentum）按单位 defId 驱动——注册表 `registerBossStateFx`（sync.js place() 的 aura 对账后每拍调，director 只推 overlay/setLevel 目标值，件内 tick 缓动收敛）+ `registerBossHurtFx`（units.js _damageHit 目标侧受击补充，fire-and-forget）；新剪影壳件走 `makeShellPiece` 基座（stasisShell 样板通用化：剪影纪律/自愈重绑/共享 uTime），现件 = hexShield（蜂窝力场：受击涟漪 impact()/转段碎裂 shatter()）/rageArcs/plateArmor/sporeVeins。内容注册在各 `fx/scripts/bosses/*.js`。
- **粒子池 v2（`fx/gpu/`，设计 `quest_prompts/PARTICLE_SYSTEM_V2.md`）**：WebGPU compute 粒子底座，**唯一 GPU 粒子事实源**（WebGL 时代 GPGPU 池与 CPU 池均已删除）。结构 = `particlePool.js`（池本体：类型行 + 锚点槽 + pass 链 + alive 计数 + `onDrained` 生命周期）+ `particleTypes.js`（`defineParticleType` 懒注册）+ custom 类型通道（`custom.build(ctx)`）+ 风场 `wind.js`。**CPU/GPU 分工铁律：默认一律走 GPU 池**（含一次性爆发、常驻发射、场影响）；CPU 门面 floatFx **只许**承接同时满足「需要 per-粒子独立纹理/文本或行为特别复杂」且「总量十几个以内」的粒子——飘字/贴图之外新增点粒子发射一律走 GPU（`particles.spawnEmitter` 经 `ambientMotes.js` uber 类型转接）。⚠ TSL 两坑：uniform(数组) 不支持（抛错且同步打死 rAF）；storage 表 CPU 写 needsUpdate 后 compute 侧读回仍全零。渲染三件套照旧：additiveLight + bloom offset + BLOOM_LAYER；UI 池关 depthTest（正交相机不衰减尺寸，uProj11 须补 `proj[5]×半高`）。destination 汇聚是 arrival 行为（目标速度 `min(steerK, dist×8)`）；资源汇聚特效 = `resourceDrainFx.js`。
- **场景件**：`scenes/`（skydome、dungeon3D、volumetricMoon 等）、**素材管线** `scenes/kit/`（propKit 契约：palette/共享材质/撒布/合并，产出代理禁改）与 `scenes/props/`（一文件一资产，显式登记）、**房型 PCG** `scenes/rooms/`（程序化墙地/墙体皮肤/heightmap（单位占位 control 保证战场水平） /`composeRoom.js` 红线法摆放/布光预设/四阶段风格流 presets + boss/mezzanine/`index.js getRoomScene`）。
- **施术演出模板系统（`fx/spells/`）**：三层——基础块 SDK `blocks.js`（块纪律：shader 主笔几何辅助、自建对象 onKill 自收、灯只借 light:fx0/fx1/fx2 池）；一文件一模板的动画逻辑生成器（`build(params)` 返回 async 协程；notify 时机三档：小卡演完放行 / 大卡主体落定即放行 / 实体锁全 hold）；决议链 `index.js`（`CARD_SPELLS[defId]` 逐卡覆写 → `SERIES_SPELLS[series]` 体系行 → BASE 零回归）。**命中本体在伤害节拍**（`damageFx.js`：伤害量/攻击来向/卡名方向语义只在伤害节拍有真值，多段伤害逐拍触发）。**投掷物从主角手上起飞**（deps.playerAnchor）。场景参数演出：deps 补 `camera`（fov 压迫、onKill 必 `flyHome`）与 `markCleaveSplit`（立牌断裂：半宽几何+半幅 UV）；压暗/白闪走 uiScene 顶层覆盖面不改 post；`ScreenShake.sustain(level)` 收尾/onKill 必归零。**群伤拍目标口径**：AOE 卡要敌阵全员走 `deps.allEnemies()`（模板以 `aoe`/`from:'all'` 声明），逐敌命中交代在伤害拍。火系共享原语 `fireBlocks.js`（`burnSeed`/`burnSiphon`）。**span 画布加宽纪律**：命中冲出 quad 直边的根治 = quad 宽 ×SPAN + shader 内坐标补偿保形 + 边缘熄灭 mask 贴真边缘。TSL 纪律全集见 `spells/shaders.js` 头注（颜色烘常量 vec3、项式平铺 add、smoothstep 正向、发光面片带边缘熄灭）。**验证纪律**：断言一律**事件锚定**不写定长 sleep；调参画布 `?spelldebug=hold`。**敌方 act 剧本可提前放行节拍**：剧本收到 `releaseBeat()`，在演出半途调用即让 sequencer 立刻泵后续指令（命中/受击拍与剩余弹幕并行），剧本余段继续自己播。
- **咏唱场景演出（`fx/chantSceneFx.js` 主题槽化）**：咏唱激活把战场推向体系氛围。**快照对账驱动**（hand 里 isActivated → 主题注册表 → 包络目标），注册表 = `THEMES` 主题表 + `SERIES_ROW`/`CARD_ROW` 两行，加新体系一行。**双持合成**：同链只取最强；不同链同主题叠加（cap 1）；不同主题并存复合（每主题一条槽，全场输出由基值 + 全部活槽逐帧重算复合）；绕身 orbit 按 kind 分派。粒子型施术预热 = `warmSpellFx` 预激活（首个 compute 提交即编译管线）。
- **布光两处方**：环境光总量压在 hemi~1.0/fill~0.12，亮度交给局部光池；灯色与单位染色底过 kit 的 `desatColor`。调参先在 `roomGallery.html` 的 knob A/B 再焙入。
- **对象 `objects/`**：CardObject、UnitObject、ZonePileObject、TargetingArrowObject、ItemShowcaseObject（公共获得演出，`skippable:true` 双出口）、SpeechBubbleObject/BubbleLayer（uiScene 恒定屏幕尺寸）、PanelObject、ScrollPickerObject 骨架、CardScrollPicker/RelicScrollPicker、SlotRollObject 等。**卡牌变换演出走 `fx/cardTransform.js`**（模式注册表；**双脸难题 = 预烘焙新脸 + 叠层双纹理，落幕一刻才 `applyBakedFace`**——调用点不许先 setCard）。
- **休息阶段 Three 化**：`stages/RoomStage.js` 与塔楼/战斗并列。`runController` 在 `restRecipeFor(roomType)` 有配方时经幕间黑幕切房间 PCG 场景。**机器逻辑按机器下沉 `stage/machines/`**（rig/面板 builder/专属拾取/快照同步/义务门，`machines/index.js` 登记一行，数组序 = 义务门优先级）——**加新机器只改 machines/**。房内通用：点机器相机推近才弹操纵 UI；**dock 面板一律不给「返回房间」键**（退出口 = 点面板外拉远）；hover 反馈只在全景；交互物浮标 y 落 `FLOOR_Y`；「继续前进」在奖励没领完时压暗 + 思索泡泡。**训练/老虎机/银行交互全 overlay 化**：场景路径面板只留主按钮；产出特写在 notify 链尾自动唤起（闸门 = 演出忙/待领会自动让位**带重试**——纯让位会把解说永久吞掉）；特写必须等转轮落定；生涯首次教学走 `settings.*Tutored` 电平触发。**恶魔 roll 词条兑现全演出化**：词条特写 → 逐张卡牌焚毁（`cardBurnFlight`，选卡确认原地燃尽）→ 金币 → 附赠 offer 自动开全屏选卡。**房间活物朝向按素材逐个标**：RoomUnitObject art 表条目 `{file, facing}`（+1 面右 / -1 面左），镜像 = 逻辑朝向 × facing。
- **选卡/选遗物/获得特写统一走 `stage/stagePickerKit.js`**：`bakeFace` + `bakeText` 必须带上（缺了 = 候选卡隐身）；画在当前活动舞台的 uiScene。多选 `open({multi, picks, minPicks})`；选中件序号角标是 picker 自有子件；**picker 候选件的 fx 收敛靠宿主 tick**——活动舞台必须每帧 `pickerKit.update(dt)`。
- **切幕器与 cutscene 播放器分离**：黑幕目的地可以是任何东西；紧跟 wipe 的对话在揭幕段挂上；cutscene 退出回舞台也走切幕。
- **战斗→奖励→塔楼节拍**：战斗终局**先落战后奖励、不切幕**（奖励 overlay 画在战斗舞台 uiScene）；领取/跳过后黑幕中点 `swapBattleToMap()`，揭幕后楼层 clear 动画 → 战后剧本 → 进房演出。`App.vue` 的 `activeStage()` 在战斗舞台存活期间由它接管指针。
- **面板与数据流**：快照→widget 映射在 `stage/panels/`。**数据下行唯一通道 = `core/run/panelSnapshot.js` 纯函数**（Stage 不得拉取 run 状态）；**意图上行 = `runController.dispatchPanelIntent`**。3D 源 tooltip 常驻转发器 = `shell/tooltipForward.js`；tooltip 内容契约：effect/relic/card/named/intention/shift/item（`{title,body,tint}` 通用文本）。视觉验收：`uiGallery.html` / `roomGallery.html` / `propGallery.html`。

### 富文本（文本层唯一事实源）

行内 markup：`/card{卡id, k=v}`（卡间引用一律用 id）、`/named{术语}`、`/effect{效果名}`、`/红绿蓝紫色名{文本}`。解析器 = `stage/richtext/parser.js`，**外观解析唯一事实源 = `stage/richtext/appearance.js`**——所有渲染环境必须接它，否则引用退化成「● 原始 id」。

| 环境 | 入口 | 交互 |
|---|---|---|
| 卡面烘焙 | `richtext/cardFace.js` `bakeCardFace` | ✅ 随纹理返回 `hitRegions`（3D 拾取与 DOM 预览共用）——**引用热区只保留在卡面** |
| 3D 单行文本 | `objects/textBakers.js` `bakeAutoLine` | ❌ 只出图 |
| DOM 浮层正文 | `richtext/inline.js` → `RichTextInline.vue` | ❌ 纯呈现 |

- `bakeAutoLine` = 含 markup 走 `bakeRichLine`，否则原样走 `bakeBoldText`（纯文本行零回归）。面板/获得特写/dock 操纵条/画廊的缺省烘焙，**加新文本面直接用它**。
- **tooltip 内不做 hover（用户定，勿再引入）**：tooltip 全局唯一、正文里的引用只渲染不弹嵌套浮层（自激振荡问题，复杂度不划算）。`.tooltip` 整体 `pointer-events: none`（含整卡预览）。

### Shell（`src/shell/`）

- `App.vue` — 三层场景编排 + canvas 生命周期 + 全局 toast + 指针路由（battle→BattleStage，其余→MapStage）。
- `runController.js` — run 层唯一编排器（Vue 薄壳与 core run 状态机之间的唯一通道）。**分域拆分**：编排器本体只剩战局装配/舞台生命周期/奖励与房间迁移/存档；交互域抽成同构工厂模块（`create*(ctx)`，ctx 晚绑定箭头闭包）——`runShowcase.js`（到手演出）、`runMachines.js`（房间机器流）、`runCutsceneFlows.js`（幕间流）。**意图上行表驱动**：`dispatchPanelIntent` = 本地表 + 三域 intents 合并，未知 action 静默忽略。
- `saves.js`（两模式隔离 + 调试槽）、`settings.js`、`audio.js`、`tooltip.js`。
- `components/`（剩余 Vue 组件）：菜单层、`BattleHud`、`TooltipOverlay`/`CardFacePreview`、静态启动壳（**index.html 内联**的加载门——白屏根治；watch.html 有同款瘦身壳，改视觉两处同步）。
- `overlay/`：cutscene 播放器 + 内容层 + 切幕层 + 剧本 + 事件图。

## 测试

- **`npm test` = 随机自对弈 fuzz**（`tools/fuzz/battleFuzz.mjs`）：真实 Core 全链路自对弈 + 不变量断言 + 超时保险丝（保险丝计数 == 0 是最强信号）——**逻辑/架构改动的回归门**。`npm run test:fuzz`（150 局）/ `test:browser`（浏览器版）。
- 逻辑改动另跑 `node tmp/smoke-*.mjs` 冒烟自验（一次性脚本，无需维护）。
- **内容不写测试**：视觉样式与演出参数（颜色/曲线/粒子/时长）必然反复调整，断言即炸；数值平衡交试玩验证。若确需写测试：只测结算逻辑与程序骨干，用 `BattleDriver`/`RunDriver` 驱动真实结算、不 mock Core；断言注册表内容先 import `content/index.js` 触发登记。
- `tmp/` 是一次性产物（冒烟、截图、试玩会话），无需维护。

## 代码约定（踩坑备忘）

- 编辑前先读文件，不破坏无关逻辑；重构时删除废弃旧代码（含 CSS、未用函数）。可抽离的共用逻辑尽量抽离。
- Core 状态只放 id/slug + 标量（可序列化），定义引用一律经注册表反查。
- **卡牌 id 命名（2026-10-11 定）**：**卡面阅读以中文名为准，英文 id 仅作索引标签无任何语义承诺**。非 Z 卡 id = `series + [中缀] + 阶`（`xxxC/xxxB/xxxA(/xxxS)`，无下划线）：series+阶 唯一裸写（`punchC`）；并行链撞阶加语义中缀（`fireBallBarrageA`）；Unbound/Free 变体孪生尾加变体词；链内异名 S 直接 `series+S`（`fierceFistS`）。Z 卡单英文单词。美术键、效果 id、能力 id、敌人招式 id、房型预设 id 与卡 id 是**独立命名空间**——卡 id 改名不动美术键；美术分配只认中文名（同名同图/异名异图）。
- **series 是无等阶家族名**（如 `fireWhirl`/`blade`/`block`）：禁止带等阶后缀、禁止照搬链首卡 id。消费方 = `spells/index.js`、`spells/damageFx.js`、`chantSceneFx.js`、core 检索、奖励亲和、`cardArtCache` 回落层——改任一侧 series 值必须全量核对所有消费方。
- 牌库顶 = 数组 index 0（FIFO：顶抽底还，**无弃牌堆、无重洗**；非消耗离手卡一律回牌库底 = 数组尾）；zone 不显式存储，`zoneOf/moveCard` 反查。
- **pending 结算区惯例**：结算中的卡在 pending 区——发动卡在 `UseSkillInstruction` stage 1 离手，收尾落位；对发动卡的引用以 `sctx.self` + `handIndexAtPlay` 为准，**不扫 hand**。单节拍原子指令（弃/焚/移）不经 pending；未来跨节拍机制同惯例：先入 pending、末段 `zoneOf` 校验落位，落地指令对「目标不在预期区」静默落空。
- **PRE/POST 反应纪律**：PRE 只做 payload 修饰或 veto，世界变更一律 POST 子节点提交；「额外一张」类计数语义优先改写被观察指令 payload（每事件至多一次），其次 POST 追加。PRE 禁与被观察指令操作同一 zone/资源的变更指令。**preview 干跑（卡面预估）会真实执行 PRE react**：其中任何直改世界状态的分支必须以 `ctx.isPreview` 短路（once 订阅干跑不注销，但监听器自身的副作用要自己挡）。
- **焚毁唯一原语**：一切「到坟场」语义（消耗打出/消耗咏唱离手/锁定结算/敌方吞噬/`MoveCard` 落点 burnt）都展开到 `BurnCardInstruction` 子节点——焚毁 veto（斩）与焚毁订阅（业火）对全部来源同口径可见。威力提升同理唯一轨：`cardKit.gainPower` 提交 `GainCardPowerInstruction`，不裸改 `card.power`。
- 伤害/面板修正三段式：`amount = 基础值 + getStat(面板)` → `payload = PRE 修饰流水线` → `execute`（减防御→护盾吸收→minHp 地板）。流水线顺序敏感，不做固定乘区。
- 效果订阅由 `AddEffectInstruction` 首次获得时挂载（owner=`effect:{unit}:{effect}`），层数扣尽注销；技能订阅战斗开始注册一次，zone 限定写 filter；**咏唱冷却一律自终止起算**（`deactivateChant` 单点锚定，一切终止路径都锚定）；**咏唱的 POST 触发一旦产出效果必须 `reactFx(sctx, sctx.self, 'benefit', ...)` 打反馈**（触发无卡面动画 = 玩家看不见）；PRE 纯修饰型与自焚离场型不打；咏唱压力走手牌上限加权口径。
- 计数器/一次性旗标不藏订阅闭包（重注册静默归零、dump 不可见）：卡级放 `skillRuntime`，战斗寿命的内容私有标量一律放 `battleState.scratch`（共享通道扁平语义键，私有键带内容 id 前缀如 `'ability:boxer:plays'`）；技能算伤害与 `describe` 显式读 `getStat`（同源不漂移）。
- **设计稿术语口径**：裸写「效果X N」= 赋予自己；「赋予效果X / 目标获得X」= 赋予卡牌目标。术语不理解务必查权威文档：效果规则查 `battle_gameplay/skills/EFFECTS.md`、机制词查 `core/skills/namedTerms.js` 与体系设计稿——**禁止凭语感臆测**；NAMED 已定义的语义必须照办。**查不到定义的术语 = 不实现**，向用户上报待定义。
- **卡面手牌数口径**：卡面写「手牌 / N 张手牌」一律按**裸张数**（激活咏唱算 1 张），不加权；只有明写「手牌压力」「超载」「咏唱容量」（named 术语）才走加权口径；「抽满手牌」类属容量语义（`drawToHandLimit`）。
- **卡牌设计元逻辑（设计第一标准）**：① 交互紧密（每张新卡至少改变两张以上既有卡的价值，孤卡即缺陷）；② 机制统一（体系内共用少量机制动词参数化组合，不跨体系照搬）；③ 描述简单可归纳；④ 设计稿用**陈述式**（只写当前设计，论证归 commit）。
- **新卡数值意识**：先与同阶基础卡、同类功能卡逐项对标，落在既有包络内再写；**彻底 0 开销卡（0AP+0蓝+无冷却）默认冷却 1 起步**；条件加成卡 = 基础值对标白板、加成值才是体系溢价。
- **卡面描述双轨**：`describe`（应用前，无战斗上下文）/ `battleDescribe`（结算中，数字按实时局面）。**battleDescribe 铁律**：战斗卡面**不许**用「计算结果摘要」顶替原始机制叙述——完整保留机制句式、数值换算成实时值、局面以括注补充；条件子句与比率规则一律不许从战斗面消失。自检：describe 每个子句与战斗文本逐条对照。
- **UI 风格：方角 + 厚边框 + 黑白主题**（2026-10-11 用户定，定义文档 = `quest_prompts/UI_LANGUAGE.md`）：一切 UI 铬件 0 圆角 + 厚描边（3D ≈3 逻辑 px / DOM 2px）、配色无彩（黑底白/灰阶，hover 灰阶提亮；`richtext/buttonFace.js` THEMES 按钮唯一事实源——无渐变无自体发光）；**icon 类按钮无底无框**（纯带 alpha 图标）；**有素材的展示物直出素材**（遗物展示不画底片边框，无素材回落方角厚框占位）；**金色只留给金钱相关**；内容语义色不受此约束。
- **公共获得演出三件套**：任何「到手一拍」走 `Stage.showcaseItem(payload)`（`skippable:true` + onSkip/onDismiss 可放弃）；无素材 key 程序化占位；新增获得路径不要绕过它自画 UI。
- **卡面文本只写效果语言**：费用/等阶/充能/冷却/关键词走徽章与页脚词条行，**不复述**在 describe/battleDescribe；咏唱前缀由渲染层自动加。
- **少用「·」类分隔符（2026-10-12 用户定）**：玩家可见文本（卡面/UI 文案/tooltip/意图）与项目文档都少用间隔号等分隔符，优先写成正常语句；并列枚举用「、」。
- **通用机制词走 named 术语**：跨卡复用的机制关键词定义在 `core/skills/namedTerms.js`（特征色 + tooltip），卡面 markup 用 `/named{术语}`；**词条双轨**：`describe` 玩家版 / `agent` headless-LLM 版（触发时机/判定口径/不生效情形写全），headless 的 `terms` 视图读 agent 版，新词条两版都要写。
- **卡间引用走 `/card{卡id}`**：hover 热区弹整卡预览；不写卡名裸文本。
- **任何文本都可能带 markup**：遗物/效果/卡牌描述里的 markup 在**所有**渲染面都要渲染成图标 + 特征色（用 `bakeAutoLine`/`RichTextInline`，别自己写烘焙）；哪面印出 `/xxx{` 就是那处没接解析器。
- **卡牌威力提升一律走 `cardKit.gainPower(sctx, card, n)`**（发公共节拍），不裸改 `card.power`。
- **卡牌两态模型（2026-10-11 统一）**：zone 是所有权记录，`model.setZone` 是**唯一写入门**——card-zone 事件 → `_cardZoneDoor`（摘弹簧目标/摘拾取/deck→hand 标记入场弧），别再手写第二份副作用。animator 两态 = free（idle，HandSprings 朝 zone 静止位收敛）/ leased（animating|dragging），租约结束（onComplete **或被顶杀**——onInterrupt 缺省取 onComplete）自动回落 free 由弹簧零速收养；离手摘弹簧随 zone 门自动发生，手改 `springs.release` 只在绕过 zone 写的旁路（不该存在）里需要。
- **焚卡演出必须覆盖非手牌来源**：牌库里的卡视图 `visible=false` 永不烘面——直接 `_burnOut` = 烧隐形空白。链路：`presenter.cardBurnt` 代投影 `cardView`，`BattleStage._departureBeat` 对不可见卡先 `setCard` 烘面显形、飞中央展示位落定再 `_burnOut`。core 焚卡保持单节拍原子。**run 层删卡（2026-10-12 全覆盖）**：一切从牌组删卡的界面（Boss 奖励/进阶反哺/古尔帕斯/老虎机吞噬/银行自选焚毁/恶魔词条）确认时统一「摘卡原地燃尽、演完才上行意图」——来源表条目标 `burn: true` 或 `openDevourPicker` 的 confirmHook，底层都是 `stagePickerKit.playCardBurn`（cardBurnFlight）；新删卡点照此接，不许静默删。
- **单位行动姿态走 `_pose` 通道**：姿态字段在 `UnitObject.update` 每帧合成，**别直接改 standee.scale**（被呼吸覆盖）；效果姿态只在获得/叠层时摆；受击击退方向 = 远离伤害源；瑞米补刀按 `src._defId === 'remi'` 特判升级配方。
- **刀法牌 = `series: 'blade'` 或 keywords 含 blade**（`cardKit.isBladeCard`）；碎铁/出鞘等衍生处理牌也算。
- `.trae/rules/project_rules.md` 是旧架构残留——以本文件与 README 为准。

## 权威设计文档

- `README.md` — 场景层级总纲与数据系统说明。
- `battle_gameplay/` — 战斗与 run 层设计总纲：`battle.md`（战斗总则/结算时序/数值基准）、`RUN_DESIGN.md`、`REWARD.md`、`SLOT_MACHINE.md`、`SHOP.md`、`RELICS.md`、`REMI.md`、`ENEMIES_1/2.md`、`ENEMY_GENERATION.md`、`BOSSES_1/2/4.md` 等。
- `battle_gameplay/skills/` — 各体系卡牌设计稿 + `EFFECTS.md` 效果目录；`SKILL_DESIGN_PRINCIPLES.md` 在 `src/core/skills/` 下。
- `quest_prompts/` — 重构与实现设计文档（WEBGPU_MIGRATION / PARTICLE_SYSTEM_V2 / **CARD_MODIFIERS** / STAGE_DESIGN / UI_LANGUAGE / SCENE_* 等）。
- `handoffs/` — 历史交接记录与已归档设计文档（含关键约定，注意核对时效）。

## 安全注意事项

- 美术素材生成与压缩管线在 `tools/`（genEnemies/genCardArt 等与 `compress_art.py`）：API 密钥经环境变量传入，**不要**写进代码或提交；`compress_art.py` 把 `src/assets` 下 PNG 原位转 WebP（素材解析层按去扩展名查表，png/webp 混放透明切换）。
- 存档存于浏览器 localStorage（`saves.js`），不涉及服务端凭据；仓库无后端、无数据库——引入新的网络请求或远程依赖须说明理由。
