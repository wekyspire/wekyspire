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
npm test           # = vitest run，66 个测试文件 / 1811 用例（截至 2026-09 全绿）
npm run build      # 产出 dist/
npm run preview    # 本地预览构建产物
```

项目约定：**不要**用 dev 服务器代替测试来「验证编译错误」——改完跑 `npm test` 即可，浏览器行为由用户验收。

## headless 试玩与直播观战（dev 工具，不进构建产物）

- `tools/headlessPlay.mjs` — LLM/脚本可玩的**文本界面**（replay 式会话：会话文件 `tmp/playtests/<名>.json` = `{seed, actions}`，每次调用全量重放 + 执行新动作，成功才入档）。引擎在 `tools/playSession.mjs`（与守护进程共用 exec/render，输出不漂移）。
- `tools/broadcast.mjs` — **直播中继**（只读观察会话文件 + HTTP/SSE 推流，零新依赖）。它把 core + bridge presenter 产出的**动画指令描述符**推给浏览器，由浏览器用本地 sequencer 重建播放——因此观战页能复用 `BattleStage`/`BattleHud`/`TooltipOverlay` 全套真实战斗渲染。观战页 `http://localhost:5177/watch.html?port=5199&session=<名>`（默认端口 5199，避开 Vite 的 5177/5178），会话索引 `http://127.0.0.1:5199/`。
- 契约层：`src/bridge/wire.js`（指令描述符 ↔ 指令重建、payload 过线压平）、`src/bridge/remoteBridge.js`（浏览器端镜像 bridge）、`src/core/anim/sequencer.js` 指令的可选 `wire` 描述符字段、`src/bridge/stateSync.js`（生产 bridge 与中继共用的标脏/补同步调度器）。
- **公网观战**：`https://wekyspire.hineven.site/watch.html`。链路 = 服务器上的观战页 → Apache 反代 `/relay/`（`/etc/httpd/conf.d/wekyspire.conf`，`flushpackets=on` 是 SSE 必备）→ SSH 反向隧道 `ssh -N -R 127.0.0.1:5199:127.0.0.1:5199 hineven.site` → 本机 `node tools/broadcast.mjs --origin https://wekyspire.hineven.site`。观战页在非 localhost 主机下自动走同源 `/relay`（免 CORS 与混合内容）；本机开发仍用 `?port=5199`。
- 服务器自动部署：`/usr/local/bin/wekyspire-deploy.sh`（cron 每 5 分钟拉 `origin rewrite` → `VITE_BASE=/ npm run build` → rsync 到 `/var/www/html/wekyspire`）。国内网络常拉不动 GitHub/ghproxy（脚本会重试并回退镜像），必要时可直接把本地 `dist/`（`MSYS_NO_PATHCONV=1 VITE_BASE=/ npx vite build`）tar 上传到站点目录，产物等价。

## 部署

`.github/workflows/main.yml`：push 到 `master` 分支触发，`npm ci` → `VITE_BASE=<pages base_path> npm run build` → 部署 `dist/` 到 GitHub Pages。仓库根目录的 `dist/` 是构建产物，不要手改。

## 架构：四层单向依赖

依赖方向严格单向：`Shell → Stage → Bridge → Core`。**Core 不得 import 上层**；Core 的表现诉求只走 `ctx.presenter` 注入（headless 用 `createNullPresenter`，测试用 `createRecordingPresenter`）。

```
src/
├── core/        # 纯逻辑层：环境无关、纯对象（禁 Vue reactive）、可序列化
├── bridge/      # Core ↔ 前端的协议层：双事件总线 + 动画队列 + 状态投影
├── stage/       # Three.js 表现层：StageManager / 场景 / 对象 / 动画
└── shell/       # Vue 薄壳：场景编排、面板 UI、存档、设置、cutscene
```

### 三个场景层级（详见 README.md）

由 `src/shell/App.vue` 编排（`phase` / `gameStage`）：

1. **菜单层**：纯 Vue（StartScreen / GameMenu / EndPanel / 全局 toast）。
2. **大世界层（塔楼层）**：`MapStage`（Three.js 夜空+塔楼）+ PrepPanel/RoomPanel/AscensionPanel 等 Vue 面板叠加。
3. **战斗层（房间层）**：`BattleStage`（Three.js 战场）+ BattleHud/RewardPanel 叠加。

MapStage 与 BattleStage 共享同一 canvas，由 `StageManager` 切换。run 的 `gameStage`（prep/battle/reward/room/ascension/end）决定叠加哪些面板。对话与幕间转场由 `shell/overlay/CutsceneOverlay.vue` 跨层渲染。

### Core（`src/core/`）

- **`kernel/`** — 结算内核：`BattleKernel` 是「指令树 DFS 泵 + 订阅注册表 + 取消三动词（veto/abort/inspect）」。订阅 `{when, phase('pre'|'post'), filter, window('battle'|'turn'|'once'), priority, react, owner}`。铁律：POST 反应作为已完成节点的子节点提交；被 veto 的节点不触发任何 POST；取消入口只在内核。
- **`instructions/`** — 指令族：`BattleInstruction` 三返回值 `true/false/WAIT`，payload 白名单（`setPayload` 越界抛错）。combat / resources / effects / cards / skill / turn / battleRoot / input / aiAct / units（战斗中生成单位：`UnitSpawnInstruction` 尾插 enemies/allies，本回合行动循环快照已取、下回合起参战；敌方意图 kinds 含 'summon'）。
- **`state/`** — 纯对象状态：`Unit`（hp/shield/effects/`getStat` 读轨/`uniqueID`/side）、`Player`（run 级，跨战斗存活）、`AIUnit→Enemy/Ally`、`runState`/`battleState` 两层拆分、zones（hand/deck/burnt/pending——牌库为 FIFO 唯一循环区：顶抽底还，**无弃牌堆、无重洗**，离手非消耗卡一律落牌库底=数组尾；咏唱无槽——卡住四区，激活态在 skillRuntime.isActivated，压力走手牌上限加权口径）、种子 rng、`skillRuntime`（定义/运行时分离）。
- **`flow/battle.js`** — 战斗装配：`createBattle/startBattle/playerUseSkill/playerEndTurn/respondInput`。终局 abort 的是 TurnLoop 而非根节点，战后清理在树内执行。
- **`run/`** — run 层状态机：`runFlow.js`（createRun/enterBattle/finishBattle/advanceFloor…）、`runDriver.js`（headless 整局 SDK，自动应答结算期输入、自动开包与种子包）、rewards / ascension / prep、rooms/（camp、event、slotMachine、training）。
  - **奖励卡包制**（2026-09）：战后先选卡包再包内三选一；**体修包恒开（门禁看隐藏的 `player.bodyLevel`）**，灵脉包需 `leino[维度] ≥1`（门禁看该维度等级：0 级 D/C、1 级 B、2 级 A——专精昂贵是设计意图）；木/空无内容时自动隐藏；训练房抓牌走「已解锁卡包并集」。
  - **通用卡包**（2026-09）：汲取/魏启罐/激发/杂技等 15 张灰卡以 `pack: 'common'` 独立成包，**不可直接选择**，按 `COMMON_INJECT`（30% + 每 4 次开包保底）替换任意卡包三选一中的一张；门禁达 B 以上时剔除 D 级（保证「出现即有价值」）。
  - **进阶节奏**（2026-09）：**营地与训练场已合并为同一房**（`campTraining`，二者总是一起出现且固定：原训练层 4N-2 与 Boss 前保底层），其它自由楼层只在**事件/老虎机**之间随机——**回复来源因此集中在合并层**；合并房内营地部分与训练部分各可做一次，主动 `next` 离房（强绑抓牌未领时不许离）。**首进阶仅需 1 次训练（第 2 层）**，此后每 2 次训练 +1 级（节点约第 2/14/26/34/42 层）；封顶按总进阶次数（`maxAscensions: 6`，含跳过）。玩家**初始 30 金**（`PLAYER_BASE_MONEY`，2026-09-11 用户定）。
  - **跳过进阶**：不选灵脉，改记 1 点隐藏体修等级（`player.bodyLevel`，体修卡包门禁），同样享受全恢复与魏启上限 +1，但不触发种子包——故事模式暗线（体修大成）。
  - **种子包**（2026-09）：灵脉**首次 0→1** 时开九选三（可刷新一次），种子池限定该维度 D/C 基石卡并排除「需前置储备才生效」的组合件（排除表见 `ascension.js` 的 `SEED_EXCLUDED`，内容侧也可用 `seedEligible: false` 标注）。
- **注册表** — `registryFactory.js` 的 `createRegistry` 工厂产出同构注册表：skills/、abilities/、enemies/、allies/、relics/、effects/。内容是纯静态定义，由 `content/index.js` **显式 import 登记**（不用 `import.meta.glob`）。
- **老虎机（2026-09 第一批：转轮引擎 + 吞噬）** — `core/run/rooms/slotMachine.js`：**资源交换**。单价 5 起、每次 roll +6；保底＝小奖 18%+7%/次、大奖 2%+2%/次（未中累加、中奖各自重置；两者相加 >100% 时小奖按 100%−大奖 计）。奖项分小奖/大奖两档（档内权重是调参位），产出**挂 `run.slotPending` 等领取或放弃**（文档：产出总是可以放弃），未处理时不允许再拉杆。吞噬：每累积 7 次 roll 可粉碎一件遗物/一张卡换金币（价值表按稀有度/等阶；S 级嚼不动；诅咒卡送免费 roll）。故事模式节拍：第 5/11 次小奖必为苹果；**拿到两个苹果之后**的第 2 次大奖必为金苹果（计数从那一刻重新起算）。接口：`spinSlot` → `takeSlotPrize(choice)` / `declineSlotPrize` / `slotUpgrade` / `devourSlot` / `slotView`。**未实装**：银行机（存取款/连击利率/超额取款的恶魔 roll）与恶魔 roll 的 24 个词条——后者需要 `脆弱`/`伤残` 等尚未实装的效果与「下一场战斗」的跨战斗计时。前端目前是**占位 UI**（能用即可，视觉效果后做）。
- **商店（2026-09 第一批：瑞米售货机）** — `core/run/rooms/shop.js`：固定 4/8、15/19、25/29、36/40 层的休息阶段出现，**不占奖励房名额**（与老虎机/营地/事件并存，是常驻货架）。`ensureShopStock(run)` 在进房时按楼层掷货架并缓存（同层不重掷=买光不补，换层换新货）；货架 = 恢复药剂恒 1 件 + 卡包/C遗物/B遗物/苹果按权重。**故事模式才有瑞米联动**：被打跑则货架少一件（附道歉文案）、等级高则货位多且偶有 8 折；肉鸽模式恒满 3 件、无折扣、无苹果。遗物货走抽选 SDK 的 `sources: ['vending']`；卡包「买到即开」——先扣费并挂 `run.shopPending`（包内三选一），`takeShopCard` 收尾入组。UI：房间面板在商店层多一个入口按钮（本地动作 `openShop`），`MapStage` 以同一份快照切换视图（`_panelUi.shopOpen` → `buildShopPanel`），购买不消耗房间行动。**古尔帕斯之店（35 层）已实装**（`core/run/rooms/gurpas.js`）：35 层固定为该房（`roomOfFloor`），货架 = S 级遗物（不补货、不卖已拥有）+ 一件她中意的 A/B/C + 非槽位式遗物 + 若干 A 级遗物 + A/B 级卡包（**不走灵脉门禁**，全 A / 全 B 三选一）+ 删卡服务（每次最多两张，与 Boss 奖励删卡机会共用同一套选卡界面），并**收购 A/S 级遗物**（A 90–120 / S 150–200）；同层货架不重掷、买光不补。**17 件「仅在古尔帕斯的店出售」的遗物已标 `acquisition: ['gurpas']`**（不再进普通抽取池）。未实装：故事模式的跨轮回回购/捡漏 7 折/「最后一果」苹果与挑战战/初见对话（属故事模式大项）。
- **遗物系统（2026-09 第一批落地）** — 定义字段：`rarity`(C/B/A/S，抽选权重与定价依据)、`cost`(槽位**权重** 0–3)、`nonSlot`(非槽位式：拾起即恒生效、**不进装卸界面**)、`requires`(灵脉门禁 `{leino,min}`/`{anyLeino}`)、`acquisition`(来源标签，缺省 draft+shop；`event`=仅事件，`gurpas`=仅古尔帕斯之店)、`onAcquire`(拾起时)、`onCampRest`(营地休整)、`runModifiers`(**run 级数值修正：从 `player.baseStats` 重算**，不增量累加——增量会在每战叠加，PreBattle 不重置 maxHp/防御)、`onBattleStart`/`subscriptions`(战斗内，仅「已激活」遗物挂载)。**槽位 = 权重和口径**（Σcost ≤ relicSlots=3，0 槽可白装）；战斗挂载与 run 修正都按 `prep.activeRelics`（= 装备中 + 全部非槽位式）。**一局内遗物唯一**（重复获得抛错；唯一例外是池空兜底件）。**抽选一律走 `core/relics/draft.js`**（`draftRelic/draftRelics/relicPool`）：稀有度权重 + 灵脉门禁 + 已拥有排除 + 池空兜底（`FILLER_RELIC_ID`=塔的馈赠，唯一可重复获得）四处规则集中于此，老虎机/商店/事件/Boss 掉落**不得各自随机**。
- **`content/`** — 最小内容实现（技能/体修卡组/敌人/能力/遗物/效果/盟友）。技能设计意图见 **`skills/SKILL_DESIGN_PRINCIPLES.md`**（等阶 D→C→B→A，S/Z 阶梯外；升阶=局外 Transform；powerUp 养成轴已废弃）。晋升字段分离：**局外晋升**（营地/训练场 `promotion.js`）走 `promotesTo`；**局内转化链**（斩系列「打出后进阶」）走 `battlePromotesTo`——两者互不可见，斩卡永不出现在局外升级候选（用户 2026-09 定）。
- **`sdk/driver.js`** — `BattleDriver`：headless 声明式战斗装配 + 链式出牌 + `runToEnd`，测试与批量验证用。
- **`anim/sequencer.js`** — `AnimationSequencer`：演出指令队列，Shell 侧单协程消费，跨场景共享同一队列定序。

### Bridge（`src/bridge/`）

`createBridge` 把 Core 战斗接到协议事件流：两条 mitt 总线（backendBus/frontendBus）+ AnimationSequencer + presenter 翻译层 + 状态投影（标脏 + 拉取缓存，`projection.js`）+ 意图层（`intents.js`）+ 结算期输入仲裁（`interactionHandler.js`）+ run 级显示状态权威 `DisplayModel`（`displayModel.js`）。事件名集中在 `events.js`（`EventNames`）。队列排空时自动补一次状态同步兜底。

### Stage（`src/stage/`）

Three.js 表现层：`StageManager`（舞台切换/resize/渲染循环；`CAMERA_ZOOM 0.79` 世界相机取景缩放（用户定 2026-09）——只缩世界相机距离，worldHeight/UI 视锥/布局坐标不动）、`stages/`（MapStage、BattleStage）、`scenes/`（skydome、dungeon3D、volumetricMoon 等场景件 + **场景素材管线**：`kit/`（propKit 契约本体——palette 主题调色板/五族共享材质/图元修饰器/撒布/合并，主会话维护、产出代理禁改）与 `props/`（道具资产库，一文件一资产，显式登记，契约测试按 fs 自动发现）、`rooms/`（**房型配方层（P3 已落地）**：`walls.js`/`floor.js` 程序化墙地（bay 分段 + 尖拱开洞 + 错位石板；**墙面大起伏处方**：扶壁肋粗墩 + 双腰线 + 墙裙，返回肋体区间 + bandSegs 供立面避让/皮肤抑制）、`wallSkin.js` **墙体皮肤 PCG（用户定 2026-09）**：2D 深度图 d(u,y)（+凸/-凹，墙=单侧视角，法线剖面压扁）→ **全带体素柱**（可见带内墙面 100% 由柱构成：抹灰 bay 逐块四级量化起伏 ±0.51 + 三色分档调色，砖 8×4.2/条石 17×8.5 课程，剥落/龟裂/风蚀坑/崩边环）；基底大墙盒在皮肤带**内退 SKIN_CAVITY=1.6 成暗腔**（wallSegments cavity 切分，腔外保持全墙厚挡光铁律）+ 暗腔背板封缝（透穿洞处背板让位露天空）——三代病灶备忘：①凹穴盒贴墙皮被大墙盒掩埋（"皮肤没效果"）②"旧大长方体仍在"：真凶是 leaningSlab 斜靠板打断体（2.2× 后 17 宽 × 65 高墙色巨板冒充墙体，三轮报障皆此）——已重设计为窄板 4~5.4 宽/低板 13~20 高/陡斜 42°+ + 深石异色 + 断口裂缝，墙 spots 概率 0.7→0.45；诊断教训：mergeStatic 后 staticRoot 原件不在场景图，按组名隐藏/拾取原件是空操作，隔离必须作用于 merged 网格或射线打当前场景 ③本代：皮肤带 [0..SKIN_TOP=120] 内基底盒完全不砌（纯体素柱 + 暗背板挡光，柱间缝透的光打在背板上不漏），上方视野外大盒挡光；窗/门洞 cell 标 THROUGH 真透空（潜伏 bug：早期柱从未给开口让位，靠贴面黑洞片遮）、`composeRoom.js` 红线法摆放器（L0 分区→L1 地块红线（含 midRight 右翼带/前景 front 带）→L2 立面（**结构叠加规则（用户定）**：bay 只被开口硬门约束，墙面结构允许同 bay 叠 2 件（二次 roll 排除同 def），扶壁肋只挡装饰不挡结构；墙面装饰=并集层——除开口/肋体外所有 bay 独立 roll 与结构共存）→L3 撒印 + **单调打断体 pass**（打破"两面墙+地板"：柱/断柱、墙角塌方体、岩堆、箱塔、贴墙斜板，按点位语义 rng 选型，**最先摆放**）+ 墙根角簇 pass（程序化 cratePile 货堆兜底）；keepout 由 battleLine+slots 派生；落地件走配方 scatter.scale 整体放大（2x+，墙带按带深收 cap 防穿墙）；构图火源被占时螺旋挪步；暴露 placements 供测试）、`lighting.js` 三布光预设（torch/moon/boss-rim + 房间中央虚拟光；**对比度处方：环境光总量必须压在 hemi~1.0/fill~0.12——逐项单开都不亮但叠加洗成牛奶蓝，火点光互叠是最大洗墙源；亮度交给局部光池**）、`floor.js` 错位石板（基底按地形口抠洞——`subtractRect`）+ `floor.patches` 战区外废墟铺地补丁、`terrain.js` **地形 heightmap 管线 v2（用户定）**：perlin 值噪声 fbm 高度场 → **单位占位 control**（keepout 距离场 smoothstep blend，站位区/战线走廊高度强制归零）→ 靠墙斜坡 carve → ridge 噪声窄带裂缝 carving（深沟/深不见底，岩浆河=塔基场景预留留空）→ 分类图（高/低谷阈值 + 连通域 + **分区 flatten** + 坑缘台缘裙边 + 0.5 量化）→ **体素柱几何**（每格一根 box 柱、块间 0.18 细缝、逐块确定性调色、深渊走 unlit 批——风格匹配体素美学；基底整板已被柱体取代，floor.js 退化为石板/苔斑装饰层）；摆放规则：低谷/平面/高台任意装饰与结构，裂缝/斜坡带（|∇h|>0.55 现判）仅 rubble、斜坡小件 **tiltX/tiltZ 垂直坡面法线**；生成于 keepout 后、摆放器前（`heightAt/zoneAt/tiltAt/pitRects` 供全部 pass）；战场水平铁律：占位 control 保证单位永不踏上地形、`presets.js` **爬塔四阶段风格流配方（用户定 2026-09）**：fortress（1-10 杂乱要塞：大起伏 amp16 + breaker×9）/ palace（12-21 宫殿：room.scale 0.85 空间收缩 + 高长窗列 + 立柱横梁高 structureProb + 画作旗帜）/ manor（23-32 衰败庄园：窗减渐暗 + maintenance 0.6 驱动**歪挂墙饰/蛛网 pass** + 居室书房道具）/ library（34-43 大图书馆：无窗 + 0.7225 再缩 + bookcaseTall 排架主导 + 地面崎岖 + 拥挤）/ boss / mezzanine（隔层花园：boss4 与研究层间不计层，整排高窄窗透月光 + 平整地面，SDK getRoomScene('mezzanine')）；配方字段：room.scale（右缘全率/近缘半率收缩，战斗几何不动）/maintenance（0..1 维护度）/floor.terrain.amp（起伏幅度）、`index.js` getRoomScene + sceneIdForFloor）、`objects/`（CardObject、UnitObject、ZonePileObject、TargetingArrowObject 等）、`richtext/`（卡面富文本解析/排版/纹理）、`animator/`、`layout/`、`picker/`（拾取）、`particles/`、`art/`（立绘/卡图缓存 unitArt·cardArtCache、战斗预取 preload、全量清单 assetManifest——`src/assets` 下位图经 import.meta.glob 自动入册，进网页统一预载并 warm 进共享缓存）。场景素材验收：`test/sceneProps.test.js`（headless 契约门）+ `propGallery.html`（浏览器视觉门）；房型 PCG 验收：`test/roomPcg.test.js`（确定性/keepout/不重叠/契约）+ `roomGallery.html`（浏览器视觉门，`?recipe=fortress|palace|manor|library|boss|mezzanine|dungeon&seed=`；相机默认已含 CAMERA_ZOOM；调参 knob：?dist= 相机距离、?nocomposer=1 关体积光、?hemi=&moon=&fill=&ba=&bb=&glow=&glowd=&cf=&cfd=&fire=&fired= 覆盖布光预设——焙入 lighting.js 前先在这 A/B）。战斗接线：`scenes/index.js getScene('pcg:*', seed)` + `runController.js USE_PCG_ROOMS` 开关（false 一键回退 dungeon）；BattleStage 按配方雾处方设置雾。**休息阶段 UI（Three 化，进行中）**：塔楼层/房间层的休息面板按 `quest_prompts/THREE_UI_MIGRATION.md` 逐个从 Vue 迁入 uiScene（补完 `THREE_REFACTOR_PLAN` 第 7 项「Rest 阶段 Stage 化」；方向=房间层整体入 three.js，塔楼层只留 dialogue/tooltip/cutscene 等无复杂动画逻辑的顶层覆盖）——原语 `objects/PanelObject.js`（锚定/模态容器 + 固定行高行流 + 网格/瓦片/卡面 widget）、`objects/ButtonObject.js`、`objects/TextBlockObject.js`、`objects/CheckBadgeObject.js`（「已选取」打勾徽标）、`objects/CardScrollPickerObject.js`（**全屏选卡界面**：竖向滚动卡阵 + 滚动条 + 返回/确认，滚出带外的卡置 invisible 故无需裁剪遮罩；营地/训练场「升级一张卡」在用，hover 预览**升级后**卡面）、`objects/SlotRollObject.js`（老虎机转轮，dt 驱动且**演出即结果揭示的闸门**）、`panels/*.js`（快照→widget 映射）；**数据下行唯一通道 = `core/run/panelSnapshot.js` 纯函数**（Stage 不得拉取 run 状态；放 core 使观战中继可同源复用），**意图上行 = `runController.dispatchPanelIntent`**（Stage 只上报「谁被点了」）；输入通道 = `MapStage.attachInput`（Picker）+ `App.vue` 指针路由（battle→BattleStage，其余→MapStage）；3D 源 tooltip 的**常驻**转发器 = `shell/tooltipForward.js`（BattleHud 那份只在战斗阶段挂载，观战页仍依赖它；两份并存安全，tooltipHub 按 token 去重、move/hide 幂等）。验收：`test/uiPanels.test.js`（headless 契约门，含 runController 端到端通道）+ `uiGallery.html`（浏览器视觉门，`?panel=prep&seed=&relics=&equip=&floor=`）。已迁：prep（`PrepPanel.vue` 已删）。待迁：reward（需 PanelObject 模态形态 + 卡面 widget）→ ascension → room（含老虎机演出改由 sequencer 回执驱动）；另有 `ScrollListObject`（全屏竖向滚动条）待牌库级选卡界面落地时实现。

### Shell（`src/shell/`）

- `App.vue` — 三层场景编排 + canvas 生命周期 + 全局 toast（`provide('showMenuPopup')`）。
- `runController.js` — run 层唯一编排器：Vue 薄壳与 core run 状态机之间的唯一通道；run 经 `reactive()` 暴露；读档恢复逻辑在此（存档语义=prep 检查点）。
- `saves.js` — 存档（两模式隔离）；`settings.js`、`audio.js`、`tooltip.js`；`components/`（各阶段 Vue 面板，含顶层加载门 AssetLoadingScreen——美术预载完成前挡住开始界面）、`overlay/`（cutscene 播放器与脚本）。

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
- **手牌弹簧弃管必须「离手即摘」**：卡离开手牌（展示毕待离场 `held`、弃/焚/迁移、视图销毁）时**立刻** `springs.release(id)`，绝不能等下一次 `_layoutAndTrack` 重算目标表兜底——弹簧目标表只在 sync 节拍重算，空窗期里动画已结束（idle）的卡会被弹簧从展示位拉回手牌锚点，产生「打出 → 飞回手牌 → 再飞牌库」。此病灶已多次回归，改动手牌/弹簧/展示逻辑时必跑 `battleStage.test.js` 的「空窗期不被弹簧拉回手牌」回归用例。
- 卡面描述双轨：`describe`（应用前，无战斗上下文，纯文本）/ `battleDescribe`（结算中，数字按实时局面）。
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
