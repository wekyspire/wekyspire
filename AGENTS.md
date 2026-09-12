# AGENTS.md — 魏启尖塔（weiqi-chaos）

> 面向 AI 编码代理的项目导览。项目注释与文档主语言为**中文**，新代码与文档请沿用中文注释。

## 项目概览

**魏启尖塔**是一个单人 Roguelike 卡牌战斗网页游戏：玩家扮演「灵御」，沿 44 层塔（4 章 × 10 普通层 + 1 Boss 层）线性爬塔（无岔路），在「战斗 → 战后奖励 → 奖励房（**营地·训练场合并房** 或 事件/老虎机）→ 战前准备」的循环中成长。两种模式：无尽模式与故事模式（存档隔离）。

纯前端 SPA，无自建后端；产物是静态站点，部署到 GitHub Pages。

## 技术栈与配置

- **构建**：Vite 4 + `@vitejs/plugin-vue`（`vite.config.js`）。路径别名：`@` → `src/`、`@assets` → `src/assets`、`@data` → `src/data`（后者目前不存在）。`base` 由环境变量 `VITE_BASE` 控制（CI 部署时注入），缺省 `./`。dev 端口 **5177**。
- **框架**：Vue 3（组合式 API，`<script setup>`）+ vue-router + mitt（事件总线）。
- **渲染**：Three.js（共享单个全屏 `<canvas>`）+ GSAP（补间动画）。
- **测试**：Vitest 4（默认 node 环境，无 jsdom 配置）。
- 入口：`index.html` → `src/shell/main.js`（Vue 应用）。`src/debug/main.js` 是遗留的战斗调试冒烟页，非正式入口。

## 常用命令

```bash
npm install        # 安装依赖
npm run dev        # 开发服务器（localhost:5177）
npm test           # = vitest run，69 个测试文件 / 2035 用例（截至 2026-09 全绿）
npm run build      # 产出 dist/
npm run preview    # 本地预览构建产物
```

项目约定：**不要**用 dev 服务器代替测试来「验证编译错误」——改完跑 `npm test` 即可，浏览器行为由用户验收。

## headless 试玩与直播观战（dev 工具，不进构建产物）

- `tools/headlessPlay.mjs` — LLM/脚本可玩的**文本界面**（replay 式会话：会话文件 `tmp/playtests/<名>.json` = `{seed, actions}`，每次调用全量重放 + 执行新动作，成功才入档）。引擎入口是 `tools/playSession.mjs`（与守护进程共用 exec/render，输出不漂移）；实现按职责拆在 `tools/session/`：`engine.mjs`（状态机 + 动作解释器，按阶段分 exec* 函数）/ `render.mjs`（状态渲染）/ `format.mjs`（中文文本）/ `addressing.mjs`（编号+卡名寻址）/ `files.mjs`（会话文件）。
- `tools/broadcast.mjs` — **直播中继**（只读观察会话文件 + HTTP/SSE 推流，零新依赖）。它把 core + bridge presenter 产出的**动画指令描述符**推给浏览器，由浏览器用本地 sequencer 重建播放——因此观战页能复用 `BattleStage`/`BattleHud`/`TooltipOverlay` 全套真实战斗渲染。观战页 `http://localhost:5177/watch.html?port=5199&session=<名>`（默认端口 5199，避开 Vite 的 5177/5178），会话索引 `http://127.0.0.1:5199/`。
- 契约层：`src/bridge/wire.js`（指令描述符 ↔ 指令重建、payload 过线压平）、`src/bridge/remoteBridge.js`（浏览器端镜像 bridge）、`src/core/anim/sequencer.js` 指令的可选 `wire` 描述符字段、`src/bridge/stateSync.js`（生产 bridge 与中继共用的标脏/补同步调度器）。
- **公网观战**：`https://wekyspire.hineven.site/watch.html`。链路 = 服务器上的观战页 → Apache 反代 `/relay/`（`/etc/httpd/conf.d/wekyspire.conf`，`flushpackets=on` 是 SSE 必备）→ SSH 反向隧道 `ssh -N -R 127.0.0.1:5199:127.0.0.1:5199 hineven.site` → 本机 `node tools/broadcast.mjs --origin https://wekyspire.hineven.site`。观战页在非 localhost 主机下自动走同源 `/relay`（免 CORS 与混合内容）；本机开发仍用 `?port=5199`。
- 服务器自动部署：`/usr/local/bin/wekyspire-deploy.sh`（cron 每 5 分钟拉 **`origin master`**（`origin` = `https://github.com/wekyspire/wekyspire`，旧的 `Hineven/wekyspire` 保留为远端 `hineven-origin`；2026-09-11 由 rewrite 分支切换）→ `VITE_BASE=/ npm run build` → rsync 到 `/var/www/html/wekyspire`）。**要上线的新内容必须先合进 `master`**（日常开发在 `<name>-dev` 分支上，站点只跟 master）。国内网络常拉不动 GitHub/ghproxy（脚本会重试并回退镜像），必要时可直接把本地 `dist/`（`MSYS_NO_PATHCONV=1 VITE_BASE=/ npx vite build`）tar 上传到站点目录，产物等价。

## 分支与协作（2026-09-11 起）

- **上游仓库 = `https://github.com/wekyspire/wekyspire`**（remote 名 `wekyspire`，`master` 为唯一主干）。
  旧的 `origin`（`Hineven/wekyspire`）只是历史个人仓库，不再是交付目标。
- **多人并行：每人一条自己的长期开发分支 `<名字>-dev`**（如 `hineven-dev`、`xxx-dev`），
  都推到 `wekyspire`；功能完成后开 PR 合进 `master`（**不要直接推 master**）。
  分支从 `wekyspire/master` 起，**开工前先 `git fetch wekyspire && git merge wekyspire/master`**
  （长期分支落后是冲突的主要来源）。
- 合并冲突以**自己那条 dev 分支的实现为准**（若冲突方是别人正在维护的模块，先沟通）。
- 快速开工：
  ```bash
  git remote add wekyspire https://github.com/wekyspire/wekyspire   # 只需一次
  git fetch wekyspire && git checkout -b <名字>-dev wekyspire/master
  git push -u wekyspire <名字>-dev
  ```

## 部署

- **线上站点由服务器 cron 部署**：`/usr/local/bin/wekyspire-deploy.sh`（每 5 分钟拉它自己 clone 的上游分支
  → `VITE_BASE=/ npm run build` → rsync 到 `/var/www/html/wekyspire`）。脚本早前盯的是 `origin rewrite`，
  仓库迁到 `wekyspire` 组织后**应改为盯 `wekyspire/master`**（改脚本前以服务器实际配置为准）。
  国内网络常拉不动 GitHub/ghproxy（脚本会重试并回退镜像），必要时可直接把本地 `dist/`
  （`MSYS_NO_PATHCONV=1 VITE_BASE=/ npx vite build`）tar 上传到站点目录，产物等价。
- **GitHub Pages workflow 已在上游删除**（`d1541cf Delete .github/workflows/main.yml`）——
  不要再往仓库里加回 Pages 部署；本地分支若残留该文件，推上去只会触发一个必然失败的 job。
- 仓库根目录的 `dist/` 是构建产物（已 gitignore），不要手改。

## 版本与 changelog（用户 2026-09-13 定）

- 玩家可见的更新日志 = `public/changelog.md`（开始界面的「更新日志」弹层直接读它）。一条版本 =
  `## YYYY.M.D [Alpha X.Y.Z]` + `- 签名：Hineven` + 一个小节；新条目**加在文件最上方**，并把
  `package.json` 的 `version` 同步改掉（两者必须一致）。
- **写得短：整条版本的正文控制在 120 字以内，归纳成 2~3 条**。只挑玩家能感知的变化写——新内容、
  体验/手感改动、修好的明显 bug。**不要**逐条罗列 commit、不要写内部术语（模块名/函数名/架构词）、
  不要贴代码或参数。参考量级：`* 新增获得演出，统一各处获得物品时的反馈体验`。
- 反面教材是 0.7.1：把每一处改动都列了一遍（十来条、每条都长），玩家读不完。同样的内容按上面
  三条归纳即可。
- 小节标题用「新增 / 改进与修复 / 已知问题」这类朴素词；没有内容的小节不要留空壳。

## 架构：四层单向依赖

依赖方向严格单向：`Shell → Stage → Bridge → Core`。**Core 不得 import 上层**；Core 的表现诉求只走 `ctx.presenter` 注入（headless 用 `createNullPresenter`，测试用 `createRecordingPresenter`）。

```
src/
├── core/        # 纯逻辑层：环境无关、纯对象（禁 Vue reactive）、可序列化
├── bridge/      # Core ↔ 前端的协议层：双事件总线 + 动画队列 + 状态投影
├── stage/       # Three.js 表现层：StageManager / 场景 / 对象 / 动画
└── shell/       # Vue 薄壳：场景编排、Vue 浮层（菜单/HUD/cutscene/tooltip）、存档、设置
```

### 三个场景层级（详见 README.md）

由 `src/shell/App.vue` 编排（`phase` / `gameStage`）：

1. **菜单层**：纯 Vue（StartScreen / GameMenu / EndPanel / 全局 toast / MenuDialog）。
2. **大世界层（塔楼层）**：`MapStage`（Three.js 夜空+塔楼+玩家状态栏+资源条+**全部阶段操作面板**）；
   塔楼层已几乎没有 Vue 面板（只剩 dialogue / cutscene / tooltip 等无复杂动画逻辑的顶层覆盖）。
3. **战斗层（房间层）**：`BattleStage`（Three.js 战场 + 手牌/资源/按钮等 HUD 物件）+ `BattleHud`（Vue，仅战斗日志/回合数）。

MapStage 与 BattleStage 共享同一 canvas，由 `StageManager` 切换。run 的 `gameStage`（prep/battle/reward/room/ascension/end）决定构建哪块 Three 面板（`MapStage` 的 `PANEL_BUILDERS` 分发），以及挂哪些 Vue 浮层。对话/幕间内容由 `shell/overlay/CutsceneOverlay.vue` 渲染，**幕间黑幕是独立一层**（`SceneWipeOverlay.vue` + `sceneWipe.js`，z 压过内容层——见 Shell 段「切幕器与内容播放器分离」）。

### Core（`src/core/`）

- **`kernel/`** — 结算内核：`BattleKernel` 是「指令树 DFS 泵 + 订阅注册表 + 取消三动词（veto/abort/inspect）」。订阅 `{when, phase('pre'|'post'), filter, window('battle'|'turn'|'once'), priority, react, owner}`。铁律：POST 反应作为已完成节点的子节点提交；被 veto 的节点不触发任何 POST；取消入口只在内核。
- **`instructions/`** — 指令族：`BattleInstruction` 三返回值 `true/false/WAIT`，payload 白名单（`setPayload` 越界抛错）。combat / resources / effects / cards / skill / turn / battleRoot / input / aiAct / units（战斗中生成单位：`UnitSpawnInstruction` 尾插 enemies/allies，本回合行动循环快照已取、下回合起参战；敌方意图 kinds 含 'summon'）。
- **`state/`** — 纯对象状态：`Unit`（hp/shield/effects/`getStat` 读轨/`uniqueID`/side）、`Player`（run 级，跨战斗存活）、`AIUnit→Enemy/Ally`、`runState`/`battleState` 两层拆分、zones（hand/deck/burnt/pending——牌库为 FIFO 唯一循环区：顶抽底还，**无弃牌堆、无重洗**，离手非消耗卡一律落牌库底=数组尾；咏唱无槽——卡住四区，激活态在 skillRuntime.isActivated，压力走手牌上限加权口径）、种子 rng、`skillRuntime`（定义/运行时分离）。
- **`flow/battle.js`** — 战斗装配：`createBattle/startBattle/playerUseSkill/playerEndTurn/respondInput`。终局 abort 的是 TurnLoop 而非根节点，战后清理在树内执行。
- **`run/`** — run 层状态机：`runFlow.js`（createRun/enterBattle/finishBattle/advanceFloor…）、`runDriver.js`（headless 整局 SDK，自动应答结算期输入、自动开包与种子包）、rewards / ascension / prep、rooms/（camp、event、slotMachine、training）。
  - **奖励卡包制**（2026-09）：战后先选卡包再包内三选一；**体修包恒开（门禁看隐藏的 `player.bodyLevel`）**，灵脉包需 `leino[维度] ≥1`（门禁看该维度等级：0 级 D/C、1 级 B、2 级 A——专精昂贵是设计意图）；木/空无内容时自动隐藏；训练房抓牌走「已解锁卡包并集」。
  - **通用卡包**（2026-09）：汲取/魏启罐/激发/杂技等 15 张灰卡以 `pack: 'common'` 独立成包，**不可直接选择**，按 `COMMON_INJECT`（30% + 每 4 次开包保底）替换任意卡包三选一中的一张；门禁达 B 以上时剔除 D 级（保证「出现即有价值」）。
  - **进阶节奏**（2026-09）：**营地与训练场已合并为同一房**（`campTraining`，二者总是一起出现且固定：原训练层 4N-2 与 Boss 前保底层），**商店层整层是商店房**（`shop`，2026-09-12 用户定），其它自由楼层在**事件/老虎机**之间随机（事件房现为**幕间播片**：cutscene 的 CG + 对话 + 选项，不做 3D 场景、也不走旧 UI 面板，2026-09-12）——**回复来源因此集中在合并层**；合并房内营地部分与训练部分**各可做一次、也都可以不做**（用户定 2026-09-12：训练本就可选，直接点「继续前进」离开即可——所以训练面板**不再有「跳过」键**（面板里再放"跳过"是与"离开"重复的第二个出口），`RoomStage._pendingRoomDuty` 也**不因"没训练"拦人**；营地的休整保留为**软提示**——第一次点继续弹一句"还没在火边歇过呢"，**再点一次即离房**；只有**升级后的强绑抓牌**与"钱已到手"的选择题（恶魔 roll / 卡包待选）才是硬拦）。**首进阶仅需 1 次训练（第 2 层）**，此后每 2 次训练 +1 级（节点约第 2/14/26/34/42 层）；封顶按总进阶次数（`maxAscensions: 6`，含跳过）。**进阶事件 = cutscene + 对话（2026-09-12 改版）**：训练达标离开营地房时**由进阶幕间接棒那段切幕**（黑幕中点做 `completeRoom` + 换台，揭幕揭开的就是进阶对话）→ 旁白 + 「择维度」**对话选项**（维度 + 跳过；文案与面板同源 `DIM_META`）→ 结果页 →（首次 0→1）九选三面板收尾 → **结束时切幕回塔楼**。CG 走 `eventArtUrlNamed('ascension', …)`（占位；真素材丢 `src/assets/images/events/ascension.webp` 自动顶替）。面板里的维度选择保留为 headless/兜底路径。玩家**初始 30 金**（`PLAYER_BASE_MONEY`，2026-09-11 用户定）。
  - **跳过进阶**：不选灵脉，改记 1 点隐藏体修等级（`player.bodyLevel`，体修卡包门禁），同样享受全恢复与魏启上限 +1，但不触发种子包——故事模式暗线（体修大成）。
  - **种子包**（2026-09）：灵脉**首次 0→1** 时开九选三（可刷新一次），种子池限定该维度 D/C 基石卡并排除「需前置储备才生效」的组合件（排除表见 `ascension.js` 的 `SEED_EXCLUDED`，内容侧也可用 `seedEligible: false` 标注）。
- **事件系统（2026-09-13 内容化重构）** — 事件 = **对话 + 选项 + 逻辑**，不再写死在房间逻辑里。
  - **定义进注册表**：`core/events/registry.js`（同构注册表），内容在 `core/content/events/`（一文件一事件，`content/events.js` 显式 import 装配）。字段：`{ id, name, art, mode('both'|'story'|'endless'), weight, requires(run), pages, choices(run,ctx), resolve(run,choiceId,ctx) }`。抽取 = 在「本模式可用 + requires 通过」的池里按 `weight` 用 `run.rng` 确定性抽一个，记进 `run.roomData.eventId`（同一次遇到不重抽、不再消耗 rng）。
  - **效果由事件自己主动施加**（用户定 2026-09-13）：`resolve` 里直接调 `core/run/runEffects.js` 的原语（`gainMoney/healPlayer/damagePlayer/grantManaBonus/gainRelic/gainCard/spendMoney` + 剧情旗标 `setFlag`），原语负责 ①改 run ②记 `ctx.log` ③按需声明表现意图。**`resolve` 只返回结果页（叙事）**，不返回 `{money:15}` 之类载荷——Shell 对"事件做了什么"一无所知，加新效果不必改 runController（此前 `res.money>0` 的获得演出解释就长在编排器里，是本次重构要根除的病灶）。
  - **run 级表现通道**：`core/run/runContext.js` 的 `createRunContext(run,{presenter})`（类比战斗的 `ctx.presenter`；headless 缺省 noop）。`core` 只声明意图（`presenter.showcase({kind,title,desc,…})`），Shell 侧 `shell/runPresenter.js` **排队**、由 runController 在**退出切幕之后**统一 `drain()` 播（获得演出必须排在揭幕后，否则被黑幕吞掉半截——时序归 Shell，内容不管）。外观策略（artKey/tint/时长）在 runPresenter 的 VISUALS 表里。遗物特写仍由 Shell 的**拥有集差分**自动兜（`gainRelic` 不声明特写，免得演两遍）。
  - 剧情分支记忆：`run.eventFlags`（`setFlag/hasFlag`，随存档留存）；跨局的持久进度以后放 `run.profile`。
- **注册表** — `registryFactory.js` 的 `createRegistry` 工厂产出同构注册表：skills/、abilities/、enemies/、allies/、relics/、effects/、events/。内容是纯静态定义，由 `content/index.js` **显式 import 登记**（不用 `import.meta.glob`）。
- **老虎机（2026-09 第一批：转轮引擎 + 吞噬）** — `core/run/rooms/slotMachine.js`：**资源交换**。单价 5 起、每次 roll +6；保底＝小奖 18%+7%/次、大奖 2%+2%/次（未中累加、中奖各自重置；两者相加 >100% 时小奖按 100%−大奖 计）。奖项分小奖/大奖两档（档内权重是调参位），产出**挂 `run.slotPending` 等领取或放弃**（文档：产出总是可以放弃），未处理时不允许再拉杆。**中奖即唤起获得演出（用户定 2026-09-12）**：转轮停稳揭示产出后，编排器直接播 `ItemShowcaseObject` 特写（奖项文案 + 老虎机小奖/大奖），**点任意处 = 收下**（需要"选一张"的奖项留在面板/全屏选卡里选；免费指定升级收下后自动开选卡界面），**点「跳过」= 放弃这份产出**（`onSkip → declineSlotPrize`）；操纵条里**不再有「领取」键**（只剩「放弃」兜底）。吞噬：每累积 7 次 roll 可粉碎一件遗物/一张卡换金币（价值表按稀有度/等阶；S 级嚼不动；诅咒卡送免费 roll）。故事模式节拍：第 5/11 次小奖必为苹果；**拿到两个苹果之后**的第 2 次大奖必为金苹果（计数从那一刻重新起算）。接口：`spinSlot` → `takeSlotPrize(choice)` / `declineSlotPrize` / `slotUpgrade` / `devourSlot` / `slotView`。银行机已实装（`core/run/rooms/bank.js`：存款每层结息 + 连击档利率、取款断连击、死亡清空、超额取款 → 恶魔 roll）。**恶魔 roll 交互流（2026-09-12 全链闭环）**：超额取款立刻入账并挂 `run.bank.pendingRoll`（三个不同词条）→ `RoomStage` 把**视角切到老虎机**、机器 `demonEnter()` 关闸换恶魔盘 + 灯池染暗红 → **自动开转** → 停稳后**转轮本身就是选项**（三根转轮各认一个词条——转出来的就是诅咒本身；悬停出 tooltip、点转轮承受，用户定 2026-09-13）→ `demonExit()` 换回普通盘 → 镜头回银行机 → 回执 `demonAnimDone` 后播**奖励特写**（那笔钱 + 代价）。24 个词条分黄/红/黑三档，立即/永久/跨战斗三类效果（跨战斗走 `run.pendingDebuffs`，战斗开始折入 `battleState.debuffs`）；黑色级通过记 `blackCleared` + `lockout`（下次见面不许再超额取款）。守卫：恶魔 roll 挂着时不能拉杆、不能离房。`run.bank` 与 `run.pendingDebuffs` 已进存档。
- **商店（2026-09 第一批：瑞米售货机；2026-09-12 改成"整层商店房"）** — `core/run/rooms/shop.js`：固定 4/8、15/19、25/29、36/40 层——这些楼层 `roomOfFloor` 直接返回 `'shop'`（**整层就是一间商店房**，不再与老虎机/营地/事件同层）。`ensureShopStock(run)` 在进房时按楼层掷货架并缓存（同层不重掷=买光不补，换层换新货）；货架 = 恢复药剂恒 1 件 + 卡包/C遗物/B遗物/苹果按权重，商品带 `name`/`effect`（货架 billboard 与获得特写都用）。**故事模式才有瑞米联动**：被打跑则货架少一件（附道歉文案）、等级高则货位多且偶有 8 折；肉鸽模式恒满 3 件、无折扣、无苹果。遗物货走抽选 SDK 的 `sources: ['vending']`；卡包「买到即开」——先扣费并挂 `run.shopPending`（包内三选一），`takeShopCard` 收尾入组（**`defId = null` = 放弃这个卡包**，用户定 2026-09-12：三选一必须可以放弃）。**交互（用户定 2026-09-12）**：点售货机 → 相机怼脸到货架（`FOCUS_OF.vending` 框货架区），商品以 **billboard**（遗物立绘 / 药水色块 + 名称 + 价格，**不加底板/外框**——素材自带 alpha、柜内色彩干净，文字直接浮在图下）立在货位锚点上（`vendingMachine.js` 只给 `parts.slots[].anchor` + `parts.bay`，卡片由 `vendingMachineRig.setStock` 按快照立/收）；**每件货都有 hover 说明**：遗物走 `{type:'relic'}`、其余走 core 算好的 `{type:'item'}` 文本（药水给效果；卡包给"随机 3 张 + 概率分布"，分布由 `shopItemTip` 按 reward 的等阶权重实算）；**点商品即买**——买不起时价格是红字 + 机器摇头 + 泡泡"还差 N 金"；买到 → 机器开门掉货（rig 演出）→ 演出**播完**回执 `shopAnimDone` → 编排器再播获得特写（遗物走全局差分那条线；**卡包同样有获得特写，演完自动开包**——全屏 `CardScrollPickerObject` 三选一，确认入组 / 返回放弃；顺序反了全屏特写会盖掉出货）。三选一没选完点「继续前进」会被拉回货架（UI 级守卫）。`buildShopPanel` 分两态：dock（场景，点 3D 货架买，不带按钮、**不带"离开售货机"键**——点面板外拉远）/ standalone+buttons（无 3D 的占位路径，带按钮）。**布光改冷白中性**（`shop` 预设：环境光压到赌厅一档、亮度交给中央中性冷白光池 + 售货机自带灯池，焦点补光也是冷白；用户定"售货机是纯中立玩意、人格化交给故事模式"）。**古尔帕斯之店（35 层）已实装**（`core/run/rooms/gurpas.js`）：35 层固定为该房（`roomOfFloor`），货架 = S 级遗物（不补货、不卖已拥有）+ 一件她中意的 A/B/C + 非槽位式遗物 + 若干 A 级遗物 + A/B 级卡包（**不走灵脉门禁**，全 A / 全 B 三选一）+ 删卡服务（每次最多两张，与 Boss 奖励删卡机会共用同一套选卡界面），并**收购 A/S 级遗物**（A 90–120 / S 150–200）；同层货架不重掷、买光不补。**17 件「仅在古尔帕斯的店出售」的遗物已标 `acquisition: ['gurpas']`**（不再进普通抽取池）。未实装：故事模式的跨轮回回购/捡漏 7 折/「最后一果」苹果与挑战战/初见对话（属故事模式大项）。
- **遗物系统（2026-09 第一批落地）** — 定义字段：`rarity`(C/B/A/S，抽选权重与定价依据)、`cost`(槽位**权重** 0–3)、`nonSlot`(非槽位式：拾起即恒生效、**不进装卸界面**)、`requires`(灵脉门禁 `{leino,min}`/`{anyLeino}`)、`acquisition`(来源标签，缺省 draft+shop；`event`=仅事件，`gurpas`=仅古尔帕斯之店)、`onAcquire`(拾起时)、`onCampRest`(营地休整)、`runModifiers`(**run 级数值修正：从 `player.baseStats` 重算**，不增量累加——增量会在每战叠加，PreBattle 不重置 maxHp/防御)、`onBattleStart`/`subscriptions`(战斗内，仅「已激活」遗物挂载)。**槽位 = 权重和口径**（Σcost ≤ relicSlots=3，0 槽可白装）；战斗挂载与 run 修正都按 `prep.activeRelics`（= 装备中 + 全部非槽位式）。**一局内遗物唯一**（重复获得抛错；唯一例外是池空兜底件）。**抽选一律走 `core/relics/draft.js`**（`draftRelic/draftRelics/relicPool`）：稀有度权重 + 灵脉门禁 + 已拥有排除 + 池空兜底（`FILLER_RELIC_ID`=塔的馈赠，唯一可重复获得）四处规则集中于此，老虎机/商店/事件/Boss 掉落**不得各自随机**。
- **`content/`** — 最小内容实现（技能/体修卡组/敌人/能力/遗物/效果/盟友）。技能设计意图见 **`skills/SKILL_DESIGN_PRINCIPLES.md`**（等阶 D→C→B→A，S/Z 阶梯外；升阶=局外 Transform；powerUp 养成轴已废弃）。晋升字段分离：**局外晋升**（营地/训练场 `promotion.js`）走 `promotesTo`；**局内转化链**（斩系列「打出后进阶」）走 `battlePromotesTo`——两者互不可见，斩卡永不出现在局外升级候选（用户 2026-09 定）。
- **`sdk/driver.js`** — `BattleDriver`：headless 声明式战斗装配 + 链式出牌 + `runToEnd`，测试与批量验证用。
- **`anim/sequencer.js`** — `AnimationSequencer`：演出指令队列，Shell 侧单协程消费，跨场景共享同一队列定序。

### Bridge（`src/bridge/`）

`createBridge` 把 Core 战斗接到协议事件流：两条 mitt 总线（backendBus/frontendBus）+ AnimationSequencer + presenter 翻译层 + 状态投影（标脏 + 拉取缓存，`projection.js`）+ 意图层（`intents.js`）+ 结算期输入仲裁（`interactionHandler.js`）+ run 级显示状态权威 `DisplayModel`（`displayModel.js`）。事件名集中在 `events.js`（`EventNames`）。队列排空时自动补一次状态同步兜底。

### Stage（`src/stage/`）

Three.js 表现层：`StageManager`（舞台切换/resize/渲染循环；**世界相机的基准机位在构造时落一次**，`cameraBase`/`restoreBaseCamera()` 供借用机位的舞台（休息房聚焦机器）还原；`CAMERA_ZOOM 0.79` 世界相机取景缩放（用户定 2026-09）——只缩世界相机距离，worldHeight/UI 视锥/布局坐标不动）、`stages/`（MapStage、BattleStage、**RoomStage**）、`scenes/`（skydome、dungeon3D、volumetricMoon 等场景件 + **场景素材管线**：`kit/`（propKit 契约本体——palette 主题调色板/五族共享材质/图元修饰器/撒布/合并，主会话维护、产出代理禁改）与 `props/`（道具资产库，一文件一资产，显式登记，契约测试按 fs 自动发现）、`rooms/`（**房型配方层（P3 已落地）**：`walls.js`/`floor.js` 程序化墙地（bay 分段 + 尖拱开洞 + 错位石板；**墙面大起伏处方**：扶壁肋粗墩 + 双腰线 + 墙裙，返回肋体区间 + bandSegs 供立面避让/皮肤抑制）、`wallSkin.js` **墙体皮肤 PCG（用户定 2026-09）**：2D 深度图 d(u,y)（+凸/-凹，墙=单侧视角，法线剖面压扁）→ **全带体素柱**（可见带内墙面 100% 由柱构成：抹灰 bay 逐块四级量化起伏 ±0.51 + 三色分档调色，砖 8×4.2/条石 17×8.5 课程，剥落/龟裂/风蚀坑/崩边环）；基底大墙盒在皮肤带**内退 SKIN_CAVITY=1.6 成暗腔**（wallSegments cavity 切分，腔外保持全墙厚挡光铁律）+ 暗腔背板封缝（透穿洞处背板让位露天空）——三代病灶备忘：①凹穴盒贴墙皮被大墙盒掩埋（"皮肤没效果"）②"旧大长方体仍在"：真凶是 leaningSlab 斜靠板打断体（2.2× 后 17 宽 × 65 高墙色巨板冒充墙体，三轮报障皆此）——已重设计为窄板 4~5.4 宽/低板 13~20 高/陡斜 42°+ + 深石异色 + 断口裂缝，墙 spots 概率 0.7→0.45；诊断教训：mergeStatic 后 staticRoot 原件不在场景图，按组名隐藏/拾取原件是空操作，隔离必须作用于 merged 网格或射线打当前场景 ③本代：皮肤带 [0..SKIN_TOP=120] 内基底盒完全不砌（纯体素柱 + 暗背板挡光，柱间缝透的光打在背板上不漏），上方视野外大盒挡光；窗/门洞 cell 标 THROUGH 真透空（潜伏 bug：早期柱从未给开口让位，靠贴面黑洞片遮）、`composeRoom.js` 红线法摆放器（L0 分区→L1 地块红线（含 midRight 右翼带/前景 front 带）→L2 立面（**结构叠加规则（用户定）**：bay 只被开口硬门约束，墙面结构允许同 bay 叠 2 件（二次 roll 排除同 def），扶壁肋只挡装饰不挡结构；墙面装饰=并集层——除开口/肋体外所有 bay 独立 roll 与结构共存）→L3 撒印 + **单调打断体 pass**（打破"两面墙+地板"：柱/断柱、墙角塌方体、岩堆、箱塔、贴墙斜板，按点位语义 rng 选型，**最先摆放**）+ 墙根角簇 pass（程序化 cratePile 货堆兜底）；keepout 由 battleLine+slots 派生；落地件走配方 scatter.scale 整体放大（2x+，墙带按带深收 cap 防穿墙）；构图火源被占时螺旋挪步；暴露 placements 供测试）、`lighting.js` 布光预设（torch/moon/casino/camp/shop/boss-rim + 房间中央虚拟光；**对比度处方：环境光总量必须压在 hemi~1.0/fill~0.12——逐项单开都不亮但叠加洗成牛奶蓝，火点光互叠是最大洗墙源；亮度交给局部光池**；**去饱和处方**：所有灯色（含 PCG 道具的 `lampColor`）与单位染色底都过 kit 的 `desatColor`（`LIGHT_DESAT` = k0.5/cap0.3/blueBias0.22，保持 Rec.709 亮度、冷色多去一档）——起因是 tone mapping 后场景过饱和偏蓝，根因是颜色压在灯上（用户 2026-09-11））、`floor.js` 错位石板（基底按地形口抠洞——`subtractRect`）+ `floor.patches` 战区外废墟铺地补丁、`terrain.js` **地形 heightmap 管线 v2（用户定）**：perlin 值噪声 fbm 高度场 → **单位占位 control**（keepout 距离场 smoothstep blend，站位区/战线走廊高度强制归零）→ 靠墙斜坡 carve → ridge 噪声窄带裂缝 carving（深沟/深不见底，岩浆河=塔基场景预留留空）→ 分类图（高/低谷阈值 + 连通域 + **分区 flatten** + 坑缘台缘裙边 + 0.5 量化）→ **体素柱几何**（每格一根 box 柱、块间 0.18 细缝、逐块确定性调色、深渊走 unlit 批——风格匹配体素美学；基底整板已被柱体取代，floor.js 退化为石板/苔斑装饰层）；摆放规则：低谷/平面/高台任意装饰与结构，裂缝/斜坡带（|∇h|>0.55 现判）仅 rubble、斜坡小件 **tiltX/tiltZ 垂直坡面法线**；生成于 keepout 后、摆放器前（`heightAt/zoneAt/tiltAt/pitRects` 供全部 pass）；战场水平铁律：占位 control 保证单位永不踏上地形、`presets.js` **爬塔四阶段风格流配方（用户定 2026-09）**：fortress（1-10 杂乱要塞：大起伏 amp16 + breaker×9）/ palace（12-21 宫殿：room.scale 0.85 空间收缩 + 高长窗列 + 立柱横梁高 structureProb + 画作旗帜）/ manor（23-32 衰败庄园：窗减渐暗 + maintenance 0.6 驱动**歪挂墙饰/蛛网 pass** + 居室书房道具）/ library（34-43 大图书馆：无窗 + 0.7225 再缩 + bookcaseTall 排架主导 + 地面崎岖 + 拥挤）/ boss / mezzanine（隔层花园：boss4 与研究层间不计层，整排高窄窗透月光 + 平整地面，SDK getRoomScene('mezzanine')）；配方字段：room.scale（右缘全率/近缘半率收缩，战斗几何不动）/maintenance（0..1 维护度）/floor.terrain.amp（起伏幅度）、`index.js` getRoomScene + sceneIdForFloor）、`objects/`（CardObject、UnitObject、ZonePileObject、TargetingArrowObject、**`ItemShowcaseObject`（获得物特写：中央淡入放大带弹跳 + 上帝光 + 三行文本；素材查 `assets/items|props`，无图退化色块；宿主 API = `Stage.showcaseItem(payload)`；**支持"可跳过奖励"**——`show({ skippable:true, onSkip, onDismiss })` 时下方多一个「跳过」按钮，点任意处 = 收下/关闭、点跳过 = 放弃，两个出口各自回调，用户定 2026-09-12）**、**`SpeechBubbleObject` + `BubbleLayer`（角色头顶的对话/思索泡泡，用户定 2026-09-11：通用四元组「位置 + 文本 + 持续时间 + 类型 speech|thought」；原点=尾巴尖故放缩=从头顶冒出，自带 冒出→停留→放缩淡出 时序，纯文本自烘不折富文本；美术 `assets/ui/bubble_speech|bubble_thought.webp`，锚点在屏幕右半边自动镜像（尾巴换边）；**放在舞台 uiScene → 恒定屏幕尺寸且永远在最前**，宿主 API = `BattleStage.say(uniqueID, {text,kind,duration,tint})` / `MapStage.sayAtWorld(key, {x,y,z}, data)`，锚点逐帧跟随；首个使用者=手牌被上限挡下时骑士思索「我无法掌控更多手牌了！」）** 等）、`richtext/`（卡面富文本解析/排版/纹理）、`animator/`、`layout/`、`picker/`（拾取）、`particles/`、`art/`（立绘/卡图缓存 unitArt·cardArtCache、战斗预取 preload、全量清单 assetManifest——`src/assets` 下位图经 import.meta.glob 自动入册，进网页统一预载并 warm 进共享缓存）。场景素材验收：`test/sceneProps.test.js`（headless 契约门）+ `propGallery.html`（浏览器视觉门）；房型 PCG 验收：`test/roomPcg.test.js`（确定性/keepout/不重叠/契约）+ `roomGallery.html`（浏览器视觉门，`?recipe=fortress|palace|manor|library|boss|mezzanine|dungeon&seed=`；相机默认已含 CAMERA_ZOOM；调参 knob：?dist= 相机距离、?nocomposer=1 关体积光、?hemi=&moon=&fill=&ba=&bb=&glow=&glowd=&cf=&cfd=&fire=&fired= 覆盖布光预设——焙入 lighting.js 前先在这 A/B）。战斗接线：`scenes/index.js getScene('pcg:*', seed)` + `runController.js USE_PCG_ROOMS` 开关（false 一键回退 dungeon）；BattleStage 按配方雾处方设置雾。**场景式休息房（2026-09-11 起）**：`stages/RoomStage.js` = 与塔楼/战斗并列的第三舞台。`runController` 在 `gameStage==='room'` 且 `restRecipeFor(roomType)` 有配方时（现登记 `slot → casino`、`campTraining → camp`、`shop → shop`）经 **cutscene 幕间黑幕**切进房间 PCG 场景，离开（右下角 `ContinueButtonObject`「继续前进」大箭头 / 离开键）再黑幕回塔楼；没配方的房间继续走塔楼层 + 占位面板。房间内：机器 rig + **头顶浮标（`objects/MachineMarkerObject.js`：一枚跳动的发光箭头，箭尖朝下指着机器；用户定 2026-09-12 大幅简化——去掉原来的地面光环与光柱，只留箭头）**（world 空间 Pickable；⚠ 浮标的 y 必须落在 `FLOOR_Y` 上——道具都摆在 FLOOR_Y 平面，写 y=0 会飘到半空 30 世界单位，2026-09-12 已修），**点机器 → 相机推近（整机占屏 50%、中心抬到屏高 76%，由 `FOCUS.fracH/bottom` 反解距离与视轴下移；老虎机/售货机另有怼脸覆盖（各机器模块的 `focusOf`：前者框转轮窗+拉杆，后者框货架区 `parts.bay`）→ 推到位才弹出该机器的操纵 UI**（`PanelObject` 新增 **dock 形态**：下沿停靠、无全屏背板，房间始终可见）。**机器逻辑已按机器下沉到 `stage/machines/`（2026-09-13）**：每台机器一个模块——`slotMachine.js`（老虎机 + 恶魔 roll 演出 + 离房安慰奖）、`vendingMachine.js`（货架同步/溢出柜生成/商品拾取对账/购买流）、`bankMachine.js`、`campTraining.js`（无 rig 陈设样板：篝火/训练桩）；模块 Own 本机的 rig 创建/取景覆盖/面板 builder（slot/bank/camp/training/shop(+shop2 溢出柜)）/专属拾取/快照同步/帧驱动/义务门提示，RoomStage 只剩通用舞台机制（相机聚焦机械/浮标/面板停靠/拾取主干/状态栏）——**加新机器只改 machines/**（加一个模块文件 + 在 `machines/index.js` 登记一行，数组顺序 = 义务门优先级），RoomStage 主体不再生长；占位路径的 `buildRoomPanel` 输出不变。**合并房的篝火与训练桩各开各的面板**（用户定 2026-09-12 修正：早先两件都开同一份"营地+训练"合并面板，玩家点哪件都没区别、交互物形同虚设）：篝火只给营地选项、训练桩只给训练选项；**dock 面板一律不给"返回房间/离开售货机"键**——退出口统一为**点面板外的房间空白处**（`_focusMachine(null)` 拉远回全景）。**hover 反馈只在全景**：机器 rig 与无 rig 的陈设交互物（篝火/训练桩，`RoomStage._tick` 里给整体轻微放大）都在 hover 时反馈"这件能点"，但**已 zoom-in 时不响应 hover**（`handlePointerMove` 在聚焦时喂 null——那时玩家已在交互，跟着鼠标缩放只会让人以为画面在抖）。非机器交互物（篝火/训练桩）**没有 rig**，只要浮标 + 拾取 + 推近。**售货机（商店房）**：`parts.pickBody` 是机身合批件、**不含玻璃门**——整机登记的话门会先被射线命中，柜内商品卡永远点不到；商品卡是 rig 立在货位锚点上的 billboard（`goodsTargets()` → `room:goods:<全局下标>`），**没怼脸时点它只是推近**（先看清再买），怼脸后点它才成交。「继续前进」在奖励没领完时**压暗**（`ContinueButtonObject.setDim`）且点了给一句思索泡泡提示而不是离房：判据 = `RoomStage._pendingRoomDuty()`（恶魔 roll / 卡包待选 / 强绑抓牌 / 合并房两部分都处理完才放行）。**合并房（营地·训练场）的两部分各开各的面板**：点篝火开 `buildCampPartPanel`、点训练桩开 `buildTrainingPartPanel`（强绑三选一挂起时训练面板只给训练组），**进房不自动弹任何 UI**。**进房/离房的节拍（用户定 2026-09-12）**：进房那一刻 `roomScenePending` 置位 → `notify()` **不给塔楼层推房间面板**（否则选完奖励会先闪一帧营地面板，幕间黑幕随后才盖住）；离房先把幕间黑幕拉起，`completeRoom + notify` 放在**黑幕中点**执行（`exitRestRoomScene(beforeSwap)`）——核心阶段迁移引发的前端 invalid 帧全部被黑幕吞掉；`RoomStage.setPanel` 只认 `kind === 'room'` 的快照（离房时编排器会先推一份 prep 快照，照单全收会让已开面板用错快照重绘 = 用户报的"营地 UI 突变"）。选卡/选遗物/获得物特写**一律画在当前活动舞台**的 uiScene（`panelStage() = roomStage ?? mapStage`——只有活动舞台会被渲染）。这三件套由 **`stage/stagePickerKit.js`** 统一承载（2026-09-13 抽取：此前三舞台各抄一份且已分叉——MapStage 漏 slot 源、RoomStage 漏删卡源、BattleStage 漏 bakeText 三处漂移）：`createStagePickerKit({ uiScene, getPicker, bakeFace, bus, onIntent })` 持有惰性 CardScrollPicker/RelicScrollPicker/ItemShowcase 三件套 + 统一 source 表的 `openUpgradePicker(source, snap)`（camp/training/bankUpgrade/bankBurn/slot/gurpasRemove/bossRemove 七源并集一表）+ `openShopPackPicker/openDevourPicker/showcaseItem/routeHover/routeClick/handleWheel/uiBusy/update/dispose`；舞台只留面板装配与各自特定指针尾部。

**休息阶段 UI（Three 化，进行中）**：塔楼层/房间层的休息面板按 `quest_prompts/THREE_UI_MIGRATION.md` 逐个从 Vue 迁入 uiScene（补完 `THREE_REFACTOR_PLAN` 第 7 项「Rest 阶段 Stage 化」；方向=房间层整体入 three.js，塔楼层只留 dialogue/tooltip/cutscene 等无复杂动画逻辑的顶层覆盖）——原语 `objects/PanelObject.js`（锚定/模态容器 + 固定行高行流 + 网格/瓦片/卡面 widget）、`objects/ButtonObject.js`、`objects/TextBlockObject.js`、`objects/CheckBadgeObject.js`（「已选取」打勾徽标）、`objects/ScrollPickerObject.js`（**全屏选择界面共用骨架**：背板/标题/提示/滚动带/滚动条/选中态/确认可用性/返回/tooltip/拾取登记——滚出带外的候选置 invisible 故无需裁剪遮罩）、`objects/CardScrollPickerObject.js`（选卡：升级/删卡/焚毁/粉碎入口共用，hover 预览卡面）、`objects/RelicScrollPickerObject.js`（**选遗物**：程序化藏品卡=稀有度色描边 + 徽标 + 名字 + 换行描述，遗物还没有美术资源；hover 走 `{type:'relic'}` tooltip）、`objects/SlotRollObject.js`（老虎机转轮，dt 驱动且**演出即结果揭示的闸门**）、`panels/`（快照→widget 映射，**2026-09-13 按域拆分**：`index.js` 只装配 `PANEL_BUILDERS` + 转发公共件；builder 按域居 `prep/reward/ascension/shop/room`（分发器）`roomCamp`（营地·训练）`roomSlot`（老虎机·银行·恶魔 roll）`roomGurpas` 各文件，共享小件在 `shared.js`——加面板进对应域文件，不要再堆回单文件）；**数据下行唯一通道 = `core/run/panelSnapshot.js` 纯函数**（Stage 不得拉取 run 状态；放 core 使观战中继可同源复用），**意图上行 = `runController.dispatchPanelIntent`**（Stage 只上报「谁被点了」）；输入通道 = `MapStage.attachInput`（Picker）+ `App.vue` 指针路由（battle→BattleStage，其余→MapStage）；3D 源 tooltip 的**常驻**转发器 = `shell/tooltipForward.js`（BattleHud 那份只在战斗阶段挂载，观战页仍依赖它；两份并存安全，tooltipHub 按 token 去重、move/hide 幂等）。验收：`test/uiPanels.test.js`（headless 契约门，含 runController 端到端通道）+ `uiGallery.html`（浏览器视觉门，`?panel=prep&seed=&relics=&equip=&floor=`）。**已全部迁完**（prep / reward / ascension / room 四个 Vue 面板组件均已删除；`PANEL_BUILDERS` 按快照 kind 分发，prep 走 anchored、其余走 modal）——塔楼层/房间层现在的 Vue 只剩 dialogue / cutscene / tooltip / BattleHud。另有 `ScrollListObject`（全屏竖向滚动条）待牌库级选卡界面落地时实现。⚠ 选择界面的文本必须走 `stagePickerKit` 的 `bakeText`（honors fontPx/tint/maxWidth；旧名 `MapStage._pickerBakeText` 已并入 kit）——`_bakeLabel` 是牌桌时代给塔楼常驻控件的壳，把 style/maxWidth 写死，字号与颜色会被丢掉；**全屏选卡界面必须拿到 `bakeFace` + `bakeText`**（RoomStage 曾漏 bakeFace、BattleStage 曾漏 bakeText，症状="候选卡一张都看不到、但 hover 预览正常"——预览走 tooltip 的 DOM 卡面，不经过它，用户 2026-09-12 报的"营地升级界面的卡隐身了"；经 kit 统一构造后此类遗漏不再可能）。tooltip 内容契约 `shell/tooltip.js` 除 effect/relic/card/named/intention/shift 外还有 **`item`**（`{title, body, tint}` 通用文本说明：售货机的药水/卡包这类无卡面/立绘的东西）。`shell/overlay/` 的 **cutscene dialogue step 支持选项**：`pages[].choices` + `step.onChoice(id)` + `player.choose(id)`（带选项的页不响应点背板翻页）；也支持 **`step.bg` = 幕间背景 CG**（常驻在对话层之下、遮罩自动压浅，见 `CutsceneOverlay` 的 `.has-bg`）。**切幕器与 cutscene 内容播放器分离（用户定 2026-09-12 的架构修正）**：黑幕是**独立一层**——状态机 `shell/overlay/sceneWipe.js`（`createSceneWipe()`，`enter→cover→reveal`）+ 渲染 `SceneWipeOverlay.vue`（z-index 120，压过内容层 100）；`CutsceneOverlay.vue` 只管 fade/image/dialogue。原因：黑幕的**目的地可以是任何东西**（3D 舞台、也可以是一段 cutscene 内容），同层时"切到 cutscene"会退化成"黑幕播完内容才蹦出来"。现在 wipe step 在**全黑中点**调用下一步的 `preStage()`（内容在幕后就位），揭幕揭开的就是目的地本身：**切幕开始 → 目的地就位 → 切幕结束**；紧跟 wipe 的 dialogue 在揭幕段就已经挂上（回归用例见 `test/cutscenePlayer.test.js` 的「黑幕之后的对话在揭幕前就位」）。**cutscene 退出回舞台也要切幕**：`runController.exitSceneAfterCutscene(beforeSwap)`（不换舞台，黑幕中点跑 beforeSwap → 揭幕露出刷新后的舞台）；事件房出场（`completeRoom + notify`）与 Boss 战后剧本出场（`postBoss`，只在真有剧本播放时加这道幕）都走它。`runController` 把共享的 `sceneWipe` 交给播放器（`createCutscenePlayer({ wipe })`）并透出给 `App.vue` 渲染。**战斗→奖励→塔楼的节拍（用户定 2026-09-12）**：战斗终局**先落战后奖励、不切幕、也不换舞台**——奖励 overlay 直接画在**战斗舞台**的 uiScene 上（`BattleStage` 也有 `setPanel`/`setPanelIntentHandler`：共享 `panels/index.js` 的 `PANEL_BUILDERS`，modal 形态；面板模态期间吞掉一切拖牌/瞄准/战场点击），背景保持战斗房间；玩家**领取/跳过**后（`claimReward → afterRewardToFloor`）才切幕，并在**黑幕中点** `swapBattleToMap()`（换到塔楼舞台 + 释放战斗舞台 + 推新阶段面板）→ 揭幕后 **楼层 clear 动画**（`awaitFloorArrive`，当前层高亮块长出）→ 战后剧本（Boss 层 `postBoss`）→ 进房演出（`enterRoomPresentation`）。此前是“战斗一结束就瞬切塔楼”，奖励面板浮在塔楼前（用户报“背景已经不是战斗房间了”）；`App.vue` 的 `activeStage()` 也据此改为“战斗舞台存活期间一律由它接管指针”。无战斗舞台（headless/降级）时面板自然落在塔楼层。**随机事件 = 对话 + 选项 + 逻辑（2026-09-12 改版）**：`core/run/rooms/event.js` 管内容与结算（`eventView(run)` / `resolveEvent(run, choiceId)`；抽取确定性且记进 `run.roomData.eventId`，只结算一次），Shell 侧 `runController.playEventScene()` 用 cutscene 播——**进事件房（`enterRoomPresentation()` 派发：事件房播幕间 / 有配方的房切场景）即自动播**切幕 → CG + 对话 → 选项 → 结果页 → 切幕回塔楼（进出都是幕间）；事件背景图走 `shell/overlay/eventArt.js`（真素材丢 `src/assets/images/events/<art>.webp` 自动顶替，缺图用程序化 SVG 占位）。事件房在塔楼层的面板只剩一句话 + 安全阀入口「看看发生了什么」（`triggerEvent`，正常路径看不到）；**事件给的金币也播一次获得特写**（用户定 2026-09-12：大多时候"获得"都该走获得演出，别让数字悄悄变），获得演出排在**出场揭幕之后**（不然会被黑幕吞掉半截）。

### Shell（`src/shell/`）

- `App.vue` — 三层场景编排 + canvas 生命周期 + 全局 toast（`provide('showMenuPopup')`）。
- `runController.js` — run 层唯一编排器：Vue 薄壳与 core run 状态机之间的唯一通道；run 经 `reactive()` 暴露；读档恢复逻辑在此（存档语义=prep 检查点）。**分域拆分（2026-09-13 完成三域）**：编排器本体只剩战局装配/舞台生命周期/奖励与房间迁移/存档，交互域抽成同构工厂模块（`create*(ctx)`，ctx 引用一律**晚绑定**箭头闭包——`notify()/panelStage()/roomStage()` 在构造后才初始化）——① `shell/runShowcase.js` = 「到手那一拍」的演出编排（遗物拥有集差分特写 / 老虎机中奖特写 / 恶魔 roll 两拍特写 / 售货机购买特写 / 离房安慰奖 / runPresenter 排水）：core 结算已发生，它只管"什么时候播、播在哪个舞台、播完接什么"，`dispose()` 连带清恶魔/售货机两条兜底定时器；② `shell/runMachines.js` = 房间机器流（老虎机 spin/领奖/吞噬、银行机存取/超额/词条、古尔帕斯买卖/删卡、Boss 删卡、售货机卡包收尾），「意图 → core 调用 → notify → 附带演出触发」；③ `shell/runCutsceneFlows.js` = 幕间流（随机事件幕间 + 进阶幕间，「切幕 → 对话+选项 → 同步结算 → 结果页 → 切幕出场」同构流；lifecycle 回注 completeRoom/换台/退幕）。**意图上行已表驱动**：`dispatchPanelIntent` = 本地 12 条 + `...machines.intents` + `...cutsceneFlows.intents` + `...showcase.intents` 合并表（42 个 action，未知静默忽略）——**加新机器/新幕间 = 在对应域模块加方法 + intents 登记，runController 主体不再生长**；某台机器长大（如古尔帕斯的故事模式联动）可剥成独立文件，继续暴露 intents 即可并入。
- `saves.js` — 存档（两模式隔离）；`settings.js`、`audio.js`、`tooltip.js`；`components/`（**剩余的 Vue 组件**：菜单层 StartScreen/GameMenu/EndPanel/MenuDialog·MenuPopup/ChangeLog、战斗 `BattleHud`（日志/回合数）、`TooltipOverlay`/`CardFacePreview`、顶层加载门 AssetLoadingScreen——全量美术**全部成功**预载前挡住开始界面；失败**卡住不放行**并给重试（用户定 2026-09-12：掐断下载不得带着缺图进游戏）。**进度条按下载体积驱动**（用户定 2026-09-13：按张数时小图瞬间刷满、大图干等；字节来自 HEAD 探测，全部落定强制 100%，整段探测缺席退化为按张数），旁显已下载/总大小、平均网速与 ETA——体积走 `assetManifest.preloadAllArt` 的 HEAD 探测（无 `Content-Length` 时退化），`onStats` 回调给原始量（⚠ stats 计数字段是 `done`，App.vue 必须映射回 `loaded`——整条替换会抹掉它，进度条 NaN%）、`overlay/`（cutscene 播放器 `cutscenePlayer.js` + 内容层 `CutsceneOverlay.vue` + **切幕层** `sceneWipe.js`/`SceneWipeOverlay.vue` + 剧本 `scripts.js`/事件图 `eventArt.js`）。**阶段操作面板已不在 Vue 里**（迁入 `stage/panels/`，见 Stage 段）。

## 测试

- **测试维护暂停（用户 2026-09 定，提速优先）**：新改动不再新增/同步测试，也不再以 `npm test` 全绿为验收门槛——存量测试随之失效属预期，不要为其花工时。浏览器行为由用户验收。本条与下方各条冲突时以本条为准。
- 全部测试在 `test/*.test.js`，Vitest 直接跑，无 setup 文件。命名按主题（kernel / battle / fireVein / runFlow / cardFace …）。
- 战斗类测试用 headless SDK（`BattleDriver` / `RunDriver`）驱动真实结算，不 mock Core；断言依赖注册表内容时先 `import '../src/core/content/index.js'` 触发登记。
- **测试范围方针**：只测后端结算逻辑、程序骨干逻辑（gameflow/路由/状态机）与基础设施逻辑（资源加载卸载、订阅退订、前端绘制同步竞态、几何绕序回归等）。**前端视觉样式与演出特效一律不写测试**——布局/颜色/淡入淡出曲线/脉动，以及一切演出特效参数（粒子数量/颜色/尺寸、震荡与渐晕的强度/时长曲线、动画时长/缓动/位移距离、死亡倒地演出等）：这些是必然反复调整的视觉调参，精确断言改动即炸、维护纯属浪费；浏览器视觉由用户验收。若测试必须触碰演出路径，只保留**鲁棒的语义/骨架断言**（如「节拍正常 finish 不卡队列」「A 场景比 B 场景粒子多」「对象最终退场」），绝不断言具体数值。
- 加新技能/敌人/遗物等内容时：定义进 `src/core/content/*` 并在 `content/index.js` 登记，同时补对应 `test/*.test.js`。
- `tmp/` 目录是 Playwright 截图等一次性产物，无需维护。

## 代码约定（踩坑备忘，源自 handoffs/ 与 .trae/rules）

- 编辑前先读文件，不破坏无关逻辑；重构时删除废弃旧代码（含 CSS、未用函数）。
- 可抽离的共用逻辑尽量抽离，避免重复。
- Core 状态只放 id/slug + 标量（可序列化），定义引用一律经注册表反查。
- 牌库顶 = 数组 index 0（FIFO：顶抽底还，弃牌/打出/换牌等非消耗离手卡一律回牌库底 = 数组尾）；牌的 zone 不显式存储，用 `zoneOf/moveCard` 反查，数组是唯一事实源。
- **pending 结算区惯例**：结算中的卡（主语或宾语）在 pending 区——发动卡在 `UseSkillInstruction` stage 1 离手（hand→pending，静默裸 moveCard），收尾落位（咏唱回手点亮/burnt/牌库底）；对发动卡的引用以 `sctx.self` + 出牌时点捕获（`sctx.handIndexAtPlay`，经 `helpers.handIndexAtPlay/handNeighborsAtPlay` 读）为准，**不扫 hand**。单节拍原子指令（弃/焚/移）不经 pending；未来任何「离场→跨节拍处理→落位」的宾语机制按同一惯例书写：先入 pending、末段 `zoneOf` 校验后落位，落地指令对「目标不在预期区」静默落空（`DiscardCardInstruction` 为范式）。
- **PRE/POST 反应纪律**：PRE 只做 payload 修饰（`setPayload`）或 veto，世界变更（改 zone/资源/生命）一律 POST 子节点提交；「额外一张」类计数语义优先改写被观察指令 payload（替代效应，每事件至多一次），其次 POST 追加（目标结算时重选，天然无冲突）。PRE 内提交「自身资源记账」类子指令（block 层数 -1）是合法范式；PRE 禁的是与被观察指令操作同一 zone/资源的变更指令。
- 伤害/面板修正三段式：`amount = 基础值 + getStat(面板)` → `payload = PRE 修饰流水线(amount)` → `execute(payload)`（固定公式：减防御→护盾吸收→minHp 地板）。PRE 流水线顺序敏感（priority 降序 + 注册序），不做固定乘区。
- 效果订阅由 `AddEffectInstruction` 在首次获得时挂载（owner=`effect:{unit}:{effect}`），层数扣尽注销；技能订阅战斗开始注册一次，zone 限定写 filter；咏唱双态（无槽）：发动=付费回手点亮（owner=卡牌订阅注册），再次打出=免费解除并按特性离场（消耗→焚毁，否则→牌库），任何离手路径由指令层统一熄灭；咏唱压力走手牌上限加权口径（激活咏唱按 chantWeight 计多张，发动合法性=激活后加权数 ≤ player.maxHandSize）。
- 卡牌计数器放 `skillRuntime`，不藏闭包；技能算伤害与 `describe` 显式读 `getStat`（同源不漂移）。
- **卡牌威力提升（power）一律走 `cardKit.gainPower(sctx, card, n)`**，不要裸改 `card.power += n`：它改数值之外还发 `presenter.cardPowerUp` → bridge 的 `ANIM_CARD_POWER_UP` 公共节拍（BattleStage `_cardPowerBeat`：卡面放缩脉冲 + 金色闪光；手牌由弹簧层收养后弹回锚点）——「这张牌状态变了」玩家要看得见（用户定 2026-09-12）。
- **手牌弹簧弃管必须「离手即摘」**：卡离开手牌（展示毕待离场 `held`、弃/焚/迁移、视图销毁）时**立刻** `springs.release(id)`，绝不能等下一次 `_layoutAndTrack` 重算目标表兜底——弹簧目标表只在 sync 节拍重算，空窗期里动画已结束（idle）的卡会被弹簧从展示位拉回手牌锚点，产生「打出 → 飞回手牌 → 再飞牌库」。此病灶已多次回归，改动手牌/弹簧/展示逻辑时必跑 `battleStage.test.js` 的「空窗期不被弹簧拉回手牌」回归用例。
- **刀法牌 = `series: 'blade'`**（`cardKit.isBladeCard`：series 命中 **或** keywords 含 blade）——碎铁/出鞘这类"斩的衍生与处理牌"也算刀法牌，吃养刀术/锻刀术/练刀/砺刀系的一切效果（用户定 2026-09-12）；它们 keywords 不带 `blade`（页脚不多一个无意义的词条）。
- 卡面描述双轨：`describe`（应用前，无战斗上下文，纯文本）/ `battleDescribe`（结算中，数字按实时局面）。
- **UI 风格：扁平 / 白字 / 淡蓝按钮**（用户定 2026-09-12）：按钮与面板走"深底 + 白字 + 淡蓝细描边"（`richtext/buttonFace.js` 的 THEMES 是唯一事实源——**无渐变、无自体发光**），面板不做大圆角（按钮可留小圆角，其余一律 ≤4px）；**金色只留给金钱相关内容**（金币数值/价格/AP 金币等），标题与提示用白 `#e8eefb` / 淡蓝灰 `#c3cee0`——不要再新增大金色字体或 `text-shadow` 发光。对话框 = 黑色半透明扁平框（`CutsceneOverlay.vue`）。内容语义色（稀有度 `RARITY_COLORS`、灵脉维度色、敌人名红）不受此约束。
- **公共"获得演出"三件套**：任何"到手一拍"（金币/物品/奖励/中奖）都应走 `Stage.showcaseItem(payload)`（`objects/ItemShowcaseObject.js`）；`skippable: true` + `onSkip/onDismiss` 表示"可放弃"（老虎机产出用它），无素材的 key 由组件程序化占位（如 `artKey: 'gold'` → 金币堆）。新增获得路径不要绕过它自画 UI。
- **卡面文本只写效果语言**：费用/等阶/充能/冷却/关键词（消耗/固有/短暂/锁定/缓启）走徽章与页脚词条行（`cardFace.js` 的 `drawFooter`），**不要在 `describe`/`battleDescribe` 里复述**（如「冷却8」「消耗。」）；系统信息复述是卡面臃肿的主要来源。咏唱卡的「**咏唱N：**」前缀由渲染层自动加（`cardFace.js` 的 `chantPrefixedText`，named 热区），**激活前后文案不变**——不写「已激活」。
- **通用机制词走 named 术语**：跨卡复用的机制关键词（斩/衰败等）定义在 `core/skills/namedTerms.js`（含特征色 + tooltip 描述，名称可带尾缀数字参数如 `衰败2`），卡面 markup 用 `/named{术语}`（热区自动接 tooltip）；机制本体写进 def 字段/订阅（如 `cooldownZones`、`decay`），不要把长机制文本摊在卡面上。
- **卡间引用走 `/card{卡id, k=v, ...}`**：卡面文本提及另一张卡（洗入/发现的衍生牌等）一律用 id 引用（卡面印出的名字按 id 反查，改名不失配），hover 热区弹**整卡预览**（TooltipOverlay 内嵌 CardFacePreview，应用前口径，params 经 `ctx.params` 透传 `describe` 插值）；不要写「卡名」裸文本。
- 注意：`.trae/rules/project_rules.md` 中关于 `backendGameState/displayGameState`、`animationSequencer.js` 的描述是**旧架构**残留——现行架构见本文件与 README（Bridge + projection + EventNames），以代码为准。

## 权威设计文档

- `README.md` — 场景层级总纲与数据系统说明。
- `battle_gameplay/battle.md` — 战斗玩法总则（策划文档）：回合轮转/阶段/胜负/单位/资源/牌区与出牌/结算时序公理/数值基准。
- `quest_prompts/` — 重构与玩法设计文档：`THREE_REFACTOR_PLAN.md`（重构权威依据）、`RUN_DESIGN.md`（run 层玩法循环）、`STAGE_DESIGN.md`、`NEW_BACKEND_LOGIC.md`、`SCENE_PROP_WORKFLOW.md`（场景素材生产管线契约 + 交互模板扩展设计）、`SCENE_PCG_CATALOG.md`（地块红线摆放法 + 85 件道具清单）、`SCENE_TASKS.md`（场景生成/改进任务分解）、`SCENE_FLASH_DISPATCH.md`（flash 派发总指令）、各体系卡牌提案。
- `src/core/skills/SKILL_DESIGN_PRINCIPLES.md` — 技能体系设计意图，各体系「已验证/已敲定」状态在此标注。
- `handoffs/` — 历史交接记录（含大量关键约定，但注意核对时效）。

## 安全注意事项

- `tools/seedream/` 是美术素材生成管线（Python，火山引擎方舟 API）：`ARK_API_KEY` 经环境变量传入，**不要**把密钥写进代码或提交。
- `tools/compress_art.py` 是美术压缩管线（Python/PIL）：`src/assets` 下 PNG 原位转 WebP（立绘 q90 保 alpha、插画/背景 q85，删原件）；素材解析层（`stage/art/imageCache.js` 的 `indexArtUrls`）按去扩展名查表，png/webp 混放透明切换——新素材丢进 assets 后跑一次即可。
- 存档存于浏览器 localStorage（`saves.js`），不涉及服务端凭据。
- 仓库无后端、无数据库；不要引入新的网络请求或远程依赖而不说明理由。
