# Wekyspire 大重构计划：three.js 重写

> 状态：已确认方向，待实施。本文档是重构的唯一权威设计依据。
> 日期：2026-07-30（v2：结算内核与触发/取消模型定稿）

## 0. 决策记录（已与所有者确认）

| 决策点 | 结论 |
|---|---|
| 保留的资产 | 前后端分离设计；Instruction 原语结算器；animationSequencer 标签屏障异步动画队列；前后端状态分离（backend/display 投影同步）机制 |
| 卡牌/富文本渲染 | 自研 RichTextEngine：markup 解析 + Canvas 2D 排版 → three 纹理；**每个烘焙表面同时产出 hit map（交互热区）**，替代 ColoredText 的 DOM 交互 |
| 场景维度 | 2.5D：近平行投影，卡牌平面摆放 + 厚度/倾斜等微 3D 表现，相机保留运镜能力 |
| 迁移策略 | **整体重写**。不要求中间产物可运行，不要求任何 backward compatibility |
| Core 纯化范围 | **大范围**：effect / skill / enemy 等 contract 全部重写。现有全部技能、敌人、能力内容删除，仅实现若干极简卡牌与极简敌人用于测试 |
| Vue 职责 | 仅幕间（Start/End）、dialogue、cutscene、菜单、tooltip popup、战斗日志、消息弹窗、音频控制 |
| three.js 职责 | 牌桌、卡牌、角色状态、战斗全部 UI、休息阶段全部 UI |
| 触发器模型（v2） | 不设独立事件系统：**订阅结算树**。指令的执行即事件，订阅挂在内核上，技能/效果/咏唱共用一套订阅机制 |
| POST 反应挂载（v2） | 反应指令作为**已完成节点的子节点**：节点弹出前先结算其全部反应（"一个指令没算完，直到它的后果都算完"） |
| PRE 修饰协议（v2） | 指令以**白名单**声明可修饰 payload 字段；PRE 订阅按 priority 顺序变换 payload |
| 取消语义（v2） | 三动词：**veto**（PRE 否决未执行节点，可带替代指令）/ **abort**（向上中止祖先、传播向下，规约限终局用）/ **inspect**（父检视子结果做分支，常规控制流不用取消） |
| 战斗抽象（v2） | 一场战斗 = 一棵以 BattleInstruction 为根的结算树；玩家回合 = 挂起（WAIT）指令；玩家操作作为回合指令的子指令提交 |

## 1. 总体架构与依赖方向

四层，依赖严格单向（上层可依赖下层，反之禁止；跨层只走协议）：

```
┌─ Shell（Vue，DOM 覆盖层）──────────────────────────┐
│ 幕间 / 对话 / cutscene / 菜单 / tooltip / 战斗日志  │
└──────────────────▲─────────────────────────────────┘
                   │ 协议事件（tooltip:show、display-dialog 等）
┌─ Stage（three.js，全屏 canvas）────────────────────┐
│ StageManager / CardObject / UnitObject /           │
│ StageAnimator / LayoutEngine / RichTextEngine /    │
│ Particles / Picker / ShaderEffects                 │
└──────────────────▲─────────────────────────────────┘
                   │ 动画指令协议（animate-element 等载荷，渲染无关）
┌─ Bridge（纯 JS，无 Vue 无 DOM 无 three）───────────┐
│ animationSequencer / displayState 投影 /           │
│ intent helpers（enqueueXxx）/ interactionHandler   │
└──────────────────▲─────────────────────────────────┘
                   │ backendEventBus + PlayerOperations.*（唯一操作通道）
┌─ Core（纯逻辑，零渲染依赖）────────────────────────┐
│ gameState / 结算内核 / effects / skills /          │
│ enemies / abilities / battle·rest·game             │
└────────────────────────────────────────────────────┘
```

**单向化手段**：Core 不 import 任何 Bridge 模块（现状的 `skill.js → animationSequencer`、`unit.js → battleInstructionHelpers → animationInstructionHelpers → gameState` 循环全部消除）。Core 的表现诉求只能通过两条路发出：① 结算树上的指令执行；② 向注入的 `presenter` 接口发"表现意图"，由 Bridge 的默认实现翻译成动画指令。Core 永远不向上 import，可注入录制型 presenter 做 headless 单测。

## 2. Core 层设计

### 2.1 状态底座

- `gameState` 为纯 JS 对象，**禁止 `reactive()`**。类实例（Player/Enemy/Unit）保持普通 ES class。
- backend→display 同步沿用现有机制：`projectToS` 快照（S 字段约定）+ 按 uniqueID reconcile + `enqueueState` 作为虚拟动画指令入队。因为同步本来就是显式快照而非依赖追踪，去掉 reactive 无功能损失。
- displayState 为纯对象 + 版本号；每次 `applyProjectionToDisplay` 后发 `state-updated` 通知，Stage 层据此 reconcile 可视对象。
- `getModifiedPlayer` 的 Proxy 修正管线废弃：属性修正改为结算内核的 PRE 订阅（见 §2.2），不再使用多层 Proxy。
- `cloneSkill` 手写递归深克隆废弃：Skill 实例改为"定义（不可变）+ 运行时状态（plain data）"分离，克隆 = 复制运行时状态。

### 2.2 结算内核（由 Executor 扩宽而来，Core 的心脏）

**保留**：DFS 栈 + parent 链 + children 的指令树结构；多阶段 `execute()`（返回 `true` 完成 / `false` 留栈进入下一 stage）；`uniqueID` 寻址；栈深上限（防失控）。

**扩宽一：WAIT 语义**。`execute()` 除 `true/false` 外可返回 **WAIT**：指令留栈、内核暂停泵，直到外部提交新子指令或令其完成。玩家回合、选牌输入（`AwaitPlayerInputInstruction` 退化为其特例）、确认弹窗，统一走 WAIT。

**扩宽二：订阅注册表（触发器的唯一形态）**。不设独立游戏事件系统——**指令的执行就是事件流**。订阅为数据：

```js
{
  when: DealDamageInstruction,      // 指令类型（或谓词 (instr) => bool）
  phase: 'pre' | 'post',
  filter: (instr, ctx) => bool,     // 含 zone 限定，如 owner.zone === 'hand'
  window: 'battle' | 'turn' | 'once',
  priority: 0,
  react(instr, ctx) {}              // post：提交反应指令；pre：变换 payload 或返回 veto
}
```

- **POST = 反应**：某指令结算完毕、弹出之前，内核收集匹配的 POST 订阅，把反应指令**作为该已完成节点的子节点**提交并结算——"一个指令没算完，直到它的后果都算完"。
- **PRE = 修饰 / 否决**：指令 `execute()` 前先构建**白名单声明的可变 payload**（伤害值、穿透、抽牌数、费用……），匹配 PRE 订阅按 priority 顺序变换；订阅也可返回 `veto`。`execute()` 只读最终 payload，并把结算结果写入 `result` 供 POST 订阅与父指令检视。
- 每条指令类型显式声明自己的 payload 白名单与 result 结构，文档化、可静态检查。

**扩宽三：取消三动词**。

- **veto（否决）**：仅 PRE 阶段、仅针对尚未执行的节点。被 veto 的节点直接弹掉，**不触发任何 POST 订阅**（它从未发生）。veto 可带**替代指令**，插入父节点中原位置——闪避 = veto 伤害指令 + 替代 `DodgeInstruction`；对替代节点的联动就是普通 POST 订阅，不设 onCancel 事件。
- **abort（中止）**：结算进行中，节点请求中止某个祖先；`cancelled` 沿父链检查（沿用 `isAlive()` 语义），传播严格向下，子树在 DFS 回退时逐个弹掉、不执行、不触发 POST。**机制上任何节点可中止祖先，规约上仅保留给终局条件**（战斗结束由内核统一判定后 abort 根/回合循环）。被 abort 时若正挂着 WAIT 的玩家输入请求，内核负责撤回（发协议事件让 Shell 关闭弹窗）。
- **inspect（检视）**：常规流程控制**不是取消**——父指令在下一 stage 读取子节点的 `cancelled` / `result` 自行分支。儿子永远不隐式打断父亲。
- 收口规约：只有内核的战斗结束检查（每条指令完成后统一判定，替代旧 Executor 与 battle.js 两处重复实现）和 PRE 订阅的 veto 能产生取消；技能/效果代码不得直接触碰 `cancelled`。取消必带 `reason`（victory / defeat / dodged / countered），存节点上供日志与回放。
- abort 不清动画队列（已发生的已发生），胜负演出追加到队尾。

**战斗作为一棵根指令**：

```
BattleInstruction（根；完成=战斗结束）
├── PreBattleInstruction（重置玩家战斗字段、克隆构筑进牌库、洗牌、
│   注册技能/能力订阅、能力 onBattleStart、初始意图、起手抽牌）
├── TurnLoopInstruction（多阶段，交替提交玩家/敌方回合）
│   ├── PlayerTurnInstruction（阶段机：开始结算 → 冷却 → 抽牌（首回合跳过）→
│   │   友方 AI（瑞米）依次行动 → WAIT 挂起等玩家输入，出牌/换牌作为其子指令提交）
│   └── EnemyTurnInstruction（开始结算 → 敌人按数组序依次 AIActInstruction →
│       预算下回合意图 → 结束结算）
└── PostBattleInstruction（记录结果、注销全部 battle 窗口订阅、播报 battleEnd）
```

> **落地修正（v3）**：终局时内核 abort 的目标是 **TurnLoopInstruction 而非根**——
> 根存活，TurnLoop 子树回退后根继续推进到 PostBattleInstruction，
> 战后清理因此在树内正常执行（若 abort 根，清理会被取消传播一并杀死）。

**秩序规则（定死）**：① 同时匹配多个订阅：priority 降序，同 priority 按注册序，禁止依赖遍历序；② 触发链深度上限（如 32，独立计数，超限抛错）——互触发死循环必须有明确死法；③ 取消传播即上述规则，无例外通道。

### 2.3 Effect 系统（并轨进订阅模型）

三处硬编码（Unit getter / 回合效果 switch / DealDamageInstruction if 链）**不是移走，是删除**。效果 = 数据面 + 订阅包：

```js
{
  id: 'burn',
  type: 'debuff',                 // buff | debuff | neutral
  stacking: 'count',              // count | duration | boolean
  // 行为 = 一组内核订阅（层数/持续时间的推进本身也是订阅，
  // 如"回合末减一层"= 对回合结束指令的 POST 订阅）
  subscriptions: (unit, stacks) => [ /* {when, phase, filter, window, priority, react} */ ],
  // 展示元数据（沿用 effectDescription 的角色）：名称、描述、图标、颜色
}
```

- `unit.effects` 为 `[{ effectId, stacks }]`；效果 id 用英文 slug。
- 燃烧 = 对回合开始指令的 POST 订阅；力量/集中 = 对伤害指令的 PRE 修饰；飞行/暴怒/执着/灼烧的受伤联动 = 对 `DealDamageInstruction` 的 PRE/POST 订阅。
- 属性修正管线（原 `getModifiedPlayer` Proxy）并入 PRE 修饰：attack/defense/magic 的计算就是对应指令 payload 的变换。

### 2.4 Skill 新契约（重写）

```js
{
  id: 'punch',
  name: '冲拳', type: 'normal', tier: 'D',
  series: 'punch',                // 系列名（原 skillSeriesName）
  subtitle: '',
  keywords: ['slowStart', 'exhaust', ...],  // 数据驱动，由通用指令/内核消费
  cost: { mana: 1, actionPoint: 1 },        // 基础费用（数据）
  charges: { max: Infinity, cooldownTurns: 0 },
  cardMode: 'normal',             // normal | chant
  // chant 专用：激活态生命周期；其触发行为同样走订阅（zone 视为 'chantSlot'）
  activated: {
    onEnable(ctx) {}, onDisable(ctx, reason) {},
    subscriptions(ctx) { return []; },
  },
  // 技能自身触发行为 = 订阅声明（如"在手牌中时，用牌即刻冷却"），
  // 随技能实例的 zone 变化由注册表自动挂载/卸载
  subscriptions(ctx) { return []; },
  canUse(ctx) {},
  use(ctx, stage) {},             // 多阶段；只提交指令，禁止任何表现层调用
  describe(ctx) {},               // 返回富文本 markup 字符串（沿用 /effect /named /skill 语法）
  meta: { spawnWeight, precessor, leinoModifiers, poolGating },  // 卡池生成元数据，战斗侧不可见
}
```

- 运行时状态（remainingUses、currentCooldown、power、isActivated）为 plain data，与定义分离；克隆 = 复制运行时状态。
- 技能 `listener_` 全局监听模式废弃：一切事件响应走订阅注册表，窗口（battle/turn/once）到期或 zone 离开自动注销，战斗结束统一清理。
- 费用修正、条件增益、转换类效果一律用 PRE 订阅表达；`canUse` 与资源消耗指令读管线求值后的费用。
- 注册表不再硬编码 import 列表：技能目录按约定自动收集（`import.meta.glob`）。
- `ctx` 约定：`{ player, enemy, zones, history, rng, presenter }`。zones 暴露有序区域（hand / deck / discard / burnt / chantSlot）与位置查询（neighborsOf、deckTop/deckBottom、handIndexOf）；history 提供本回合出牌/弃牌/抽牌计数支撑条件类机制；rng 注入种子保证 headless 可测。

### 2.5 单位契约：Player / Enemy / Ally（多单位，v3 重写）

战斗是**双边多单位**：敌方可有数个敌人，我方除玩家外可有 AI 队友（瑞米）。

- **三态单位**：`Player`（人类操作，run 级实体，跨战斗存活）/ `Enemy` / `Ally`。后两者同为 **AI 驱动单位**，共享 `AIUnit` 基类（defId + 行动游标 + intention），阵营由 `side`（'player' | 'enemy'）区分。
- **battleState**：`enemies[]` + `allies[]` 有序数组（顺序即行动顺序）；死亡单位留在数组中靠 `isDead()` 过滤。选择器：`aliveEnemies / aliveAllies / firstAliveEnemy / unitsOfSide / allAliveUnits`。
- **回合行动序**：玩家回合 = 开始结算 → **allies 依次行动** → 玩家 WAIT 输入；敌方回合 = enemies 按数组序依次行动。
- **AI 单位定义契约**（Enemy/Ally 同构）：`{ id, name, createUnit(), act(actx), getIntention?(unit) }`。`act` 只提交指令（actx = { ...ctx, unit, def }），固定序列按 actionIndex 分支；执行器是共用的 `AIActInstruction({ unit, resolveDef })`（死亡跳过、游标不推进）。
- **胜负判定**：victory = enemies 全灭；defeat = 玩家死亡（队友死亡不算败北）。
- **history 按阵营统计**：瑞米的输出计入 damageDealt、承伤计入 damageTaken。
- **主语/宾语**：指令一律显式 source/target；目标解析（默认 = 第一个存活敌人）经选择器完成。
- 预留方向：意图未来可对 `act` 做 dry-run 自动生成；初版保留显式 `getIntention`。

### 2.6 流程编排

- `game.js` / `battle.js` / `rest.js` 保留职责（阶段编排、奖励/商店生成），但回合驱动逻辑让位给 TurnLoopInstruction，battle.js 瘦身为"战斗根指令的装配与启动"。
- 监听器统一在入口函数注册、统一在收尾注销，禁止模块顶层 `backendEventBus.on`。
- backendEventBus 职责缩减为：`PlayerOperations.*` 输入通道 + 阶段编排（gameStage 流转）+ 少量生命周期广播。旧的游戏触发类事件（SKILL_USED、EFFECT_CHANGED、SKILL_DRAWN 等）删除，由结算树订阅取代。
- `PlayerOperations.*` 仍是 Shell/Stage → Core 的唯一操作通道。

### 2.7 最小测试内容

旧内容全部删除后，实现最小集合验证全链路：

- 技能 ×4：① 纯伤害攻击牌；② 获得护盾牌；③ 施加/触发效果牌（验证 effect 订阅）；④ 咏唱牌（验证 activated 生命周期 + WAIT 挂起回合）。
- 敌人 ×2：① 固定行动序列杂鱼；② 带效果联动的小 Boss。
- 能力 ×1：验证 ability 管线（ability 行为同样走订阅）。
- 触发器验证牌（随 ③④ 覆盖即可）：PRE 修饰（伤害翻倍）、POST 反应（用牌后抽牌）、veto（闪避）各至少一例。
- 对话/cutscene 各 1 条样例。

## 3. Bridge 层设计

- **animationSequencer**：原样迁入，零改动（标签屏障、durationMs 超时强杀、`animation-instruction-finished` 回调协议）。
- **状态投影**：`projectToS` / `applyProjectionToDisplay` / `enqueueState` / backend 脏标记从 `animationInstructionHelpers.js` 拆出为独立模块 `projection.js`。脏标记从 Vue `watch` 改为内核统一标脏（指令 POST 钩子调 `markDirty()`）。
- **intent helpers**：`enqueueUI/enqueueParticles/enqueueSound/enqueueDialog/enqueueLockControl/enqueueHurtAnimation/enqueueUnitDeath` 及 `animationHelpers.js` 的卡牌动画封装，拆为 `intents.js` / `cardIntents.js`，实现为 Core presenter 接口的默认实现。
- **事件枚举**：frontendEventBus 补齐 `EventNames` 枚举，全部约 30 种事件名收口；backendEventBus 枚举补裸字符串事件（`REQUEST_PLAYER_INPUT` 等）。
- **interactionHandler**：仲裁逻辑保留（结合 display/backend 状态判断可用性、发操作事件），输入源从 DOM 事件换成 Stage Picker 的命中事件。

## 4. Stage 层设计（three.js，2.5D）

### 4.1 StageManager

- 单全屏 canvas，近平行投影相机（大焦距小视角的透视，或 OrthographicCamera 微调——实施时定）。约定：屏幕高度映射固定世界单位（如 100 单位高），布局以世界坐标计算，resize 只改相机。
- 场景切换：`BattleStage` / `RestStage` 两个场景图，由 displayState.gameStage 驱动切换；幕间/对话期间 canvas 可暂停渲染循环省电。
- 层级：世界内用 renderOrder/z 分层（背景 < 牌桌 < 卡牌 < 粒子 < 特效），DOM 覆盖层（Shell）始终在 canvas 之上，现有 z-index 变量表收编为两份约定。

### 4.2 CardObject

- 结构：牌面 plane（RichTextEngine 烘焙纹理）+ 费用/名称等分区纹理（可合批为一张 atlas）+ 可选厚度盒体。
- 内容变化（`card-content-updated`）→ 重烘纹理 + 替换 hit map。
- 状态视觉（禁用灰显、高亮、冷却脉冲、升级闪光、焚毁溶解）以 ShaderMaterial/uniform 实现，移植 `renderers/effects/` 的 Pixi 逻辑（burn 噪声溶解 GLSL 思路直接可用，Filter 包装重写）。

### 4.3 UnitObject

- 玩家/敌人：立绘 sprite + 血条 + 效果图标条 + 意图图标（敌人），均为场景内对象（血条/图标用 billboard quad）。
- 受击/死亡/治疗演出（现 HurtAnimationWrapper 的 CSS class 动画）重写为 tween + 粒子 + shader 闪红。

### 4.4 LayoutEngine

- 手牌扇形/悬浮展开布局（移植 SkillsHand.vue:75-131 算法，输出世界坐标）、咏唱位、牌桌锚点（center/deck/restDeck 从 DOM 锚点改为场景内命名锚点）。
- **寻址契约不变**：`updateAnchors(containerKey, Map<uniqueID,{x,y,scale,rotation}>)` 接口签名原样保留，仅坐标系从屏幕像素改为世界坐标。

### 4.5 StageAnimator（animator.js 的 three 版重写）

- 注册表 `uniqueID → Object3D`，状态机 `idle|tracking|animating|dragging` 契约保留；GSAP 保留，tween 目标从 CSS 属性换成 Object3D 属性。
- 消费 `animate-element` / `animate-element-to-anchor` / `enter-element-*` 协议事件，载荷格式不变，完成后回发 `animation-instruction-finished`。
- 删除：`getTransformsSnapshotByAdapter` 逐帧对表桥（动画与渲染同人，不再需要）。

### 4.6 RichTextEngine（核心新组件）

- 语法：沿用 `/颜色{}`、`/effect{}`、`/named{}`、`/skill{}` markup；解析器与 ColoredText.vue 的 4 条正则逻辑等价，输出 token 流。
- 排版：Canvas 2D 逐 token 布局（自动换行、行内图标对齐），绘制到离屏 canvas → `THREE.CanvasTexture`。中文直接用系统字体，无 SDF 成本。
- **hit map 协议（铁律）**：每次排版同时产出 `hitRegions: [{type, payload, rect}]`，rect 用排版局部坐标（与烘焙分辨率无关）。纹理与 hit map 永远成对替换。
- 图标 token（`/effect{}` 等）绘制成行内图标，不单独建 mesh。
- hover 反馈：Picker 命中热区后盖半透明高亮 quad（不碰纹理）；需要下划线等样式时再做局部重烘。

### 4.7 Picker

- raycast 拾取卡牌/单位/按钮；命中卡面后 UV → 局部坐标 → hit map 查找：
  - 命中 token 热区 → 发 `tooltip:show/move/hide`、`card-tooltip:*`（Shell 消费）；
  - 未命中 → 整卡 hover/click/drag，交 interactionHandler 仲裁。
- 优先级：token 热区 > 整卡 > 场景按钮 > 背景。
- 拖拽：射线与牌桌平面求交驱动拖动，进入 dragging 状态时通知 StageAnimator。

### 4.8 Particles

- `spawn-particles` 载荷 schema 原样保留（纯数据），解释器重写为 three Points/InstancedMesh 池。`particleHelper.js` 的预设工厂可移植。

### 4.9 音频

- 维持 HTMLAudio 轨道模型（AudioController 留 Shell），`play-sound` 协议不变。

## 5. Shell 层设计（Vue）

保留并重写为薄壳：StartScreen、EndScreen、ChangeLog、DialogScreen、CutsceneScreen、BossShowup、MessagePopup、FloatingTooltip、FloatingCardTooltip、BattleLogPanel、PlayerInputController（结算期选卡/确认）、AudioController、菜单（新增）。

- Shell 组件**不 import 任何 Core/Bridge 状态单例**，只订阅协议事件；需要状态快照时由 Bridge 提供只读视图接口。
- FloatingCardTooltip 需要展示整张卡：Bridge 提供"按技能 id 生成预览纹理/数据"接口，Shell 用 `<canvas>`/`<img>` 展示 Stage 烘焙产物，不再渲染 DOM 版 SkillCard。
- ColoredText.vue 保留（对话、日志、tooltip 内的富文本仍走 DOM），但不进牌桌。
- rest 阶段全部 UI 在 Stage 内实现（按钮/列表走 hit map 模式）；Shell 在 rest 阶段只保留 tooltip 与弹窗。

## 6. 目录结构

```
src/
  core/
    state/gameState.js  state/player.js  state/unit.js
    kernel/ (BattleInstruction, Executor/内核, 订阅注册表, 取消模型)
    instructions/ (全部指令类)
    effects/registry.js  effects/definitions/
    skills/registry.js  skills/definitions/
    enemies/registry.js enemies/definitions/
    abilities/
    flow/game.js  flow/battle.js  flow/rest.js
    content/ (最小测试技能/敌人/能力/对话)
  bridge/
    events.js (两条总线 + EventNames 枚举)
    sequencer.js
    projection.js
    intents.js  cardIntents.js
    interactionHandler.js
  stage/
    StageManager.js  stages/BattleStage.js  stages/RestStage.js
    objects/CardObject.js  objects/UnitObject.js
    layout/LayoutEngine.js
    richtext/parser.js  richtext/layout.js  richtext/texture.js
    animator/StageAnimator.js
    picker/Picker.js
    particles/ParticleSystem.js
    shaders/ (burn, hit-flash, cooldown-pulse...)
  shell/
    main.js  App.vue  GameApp.vue
    components/ (保留清单见 §5)
```

旧目录（`src/data/`、`src/components/battle|rest|global`、`src/utils/animator.js`、`src/webgl/`、`src/renderers/`、`deprecated/`、`src/data/enemies/deprecated/`）整体删除。

## 7. 依赖变化

- 新增：`three`。
- 删除：`pixi.js`、`html2canvas`、`@zumer/snapdom`、`rfdc`（若克隆重写后无用）。
- 保留：`vue`、`vue-router`（可评估是否还需要路由）、`gsap`、`mitt`。

## 8. 工作分解（按依赖序，rewrite 分支一次性推进）

1. **仓库手术**：删除旧内容/旧渲染层/旧依赖；引入 three；搭新目录骨架。
2. **Core** ✅（v3 完成，57 测试全绿）：状态底座（纯对象）→ 结算内核（指令树 + WAIT + 订阅注册表 + 取消三动词）→ effect 并轨 → skill/enemy/ability 新契约 → 战斗根指令装配 → 最小测试内容。产出：注入录制 presenter 的 headless 结算可跑通一场战斗（node 环境单测，含触发链、veto、abort、WAIT 用例）。
3. **Bridge**：事件枚举收口 → sequencer 迁入 → projection（内核标脏）→ intents → interactionHandler。
4. **Stage 基座**：StageManager + 相机约定 → RichTextEngine（parser/layout/texture/hit map）→ CardObject → LayoutEngine → StageAnimator → Picker。产出：手牌可渲染、可 hover（tooltip 打通）、可拖拽出牌。
5. **Stage 战斗完整化**：UnitObject → 粒子 → shader 特效移植（burn/hit/cooldown/disabled）→ 意图/血条/效果条 → 受击死亡演出。
6. **Shell**：薄壳重写 + tooltip/日志/对话/幕间/菜单 + 卡牌预览接口。
7. **Rest 阶段 Stage 化**：奖励/商店/整备面板（hit map 按钮模式）。
8. **联调收尾**：全链路（start→battle→rest→boss→end）+ 音频 + cutscene。

## 9. 验收标准

- Core 可在无 DOM 环境跑完一场测试战斗（headless 结算 + presenter 录制断言），覆盖：触发链顺序、PRE 修饰、veto（含替代指令）、abort（终局清树）、WAIT 挂起与恢复。
- 浏览器内完整闭环：开始 → 战斗（出牌/效果/敌人行动/胜负）→ 休息（奖励/商店/整备）→ Boss → 结局。
- 牌面富文本 token hover 弹 tooltip 与旧版行为等价；`/skill{}` 弹卡预览。
- 手牌布局/抽牌/焚毁/出牌动画观感不低于旧版。
- 全仓库 grep 不到 `pixi`、`snapdom`、`html2canvas`、`reactive(`（Shell 外）、`from 'vue'`（core/bridge 内）。

## 10. 风险与备注

- **文本烘焙清晰度**：卡牌缩放（hover 放大）时纹理模糊——按最大显示尺寸烘焙 + mipmap，或 hover 时重烘。实施时在 §8.4 验证。
- **RichTextEngine 排版能力**只需覆盖现有语法与矩形行内排版，不做弧形/异形文字（hit map 矩形近似）。
- **触发链复杂度**：订阅模型表达力强，要靠 §2.2 秩序规则（priority、链深上限）与 headless 测试约束，警惕"什么都能做"退化成"什么都没法推理"。
- **单人重写体量**：§8 每步内部再拆小提交；Core 先行保证逻辑正确，Stage 可先用纯色 placeholder 纹理占位接通链路，再补视觉。
- 旧仓库内容（技能/敌人数据）删除前打 tag 或保留分支，供日后回迁内容时参考文本。

## 11. v3 落地记录（Core 实施确认项）

Core 实施过程中确认/修正的约定，与上文有出入处以本节为准：

- **多单位改造**：见 §2.5（v3 重写）。Unit 补 `uniqueID`（投影 reconcile / presenter 寻址）与 `side`；`ctx.enemy` 便利字段取消，目标一律经选择器解析。
- **abort 目标**：终局 abort TurnLoopInstruction 而非根（见 §2.2 落地修正）。
- **牌库约定**：顶 = 数组 index 0；**首回合不抽牌**（起手 = `config.initialDraw`，`drawPerTurn` 自第二回合起）。
- **护盾**：在己方阵回合开始清零（玩家护盾覆盖整个敌方回合）。
- **效果订阅生命周期**：`AddEffectInstruction` 在首次获得效果时挂载其 subscriptions（window:'battle'，owner=`effect:{unit}:{effect}`），层数扣尽自动注销；addEffect 支持负层数扣减。
- **技能触发订阅**：战斗开始时每张卡注册一次（window:'battle'），zone 限定写在 filter（匹配时查 zoneOf），卡牌换 zone 无需重注册；咏唱 activated 订阅在入槽时注册、停止时按 owner 注销。
- **位置敏感冷却**：`def.cooldownZones`（默认 `['hand','deck']`）。
- **费用管线**：技能消耗提交 `ConsumeMana/ConsumeActionPointsInstruction` 子指令，PRE 改费订阅因此对技能费用生效。
- **内容注册**：Core 内显式 import 登记（保持环境无关，不用 import.meta.glob）；应用层如需自动收集可自行 glob。
- **注册表工厂**：effect/skill/enemy/ally/ability 五表同构（`createRegistry`）。
