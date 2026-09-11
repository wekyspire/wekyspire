# 魏启尖塔

这是一个使用Vite构建，基于Vue 3框架，使用Javascript和HTML的单人肉鸽文字冒险型网页小游戏。

## 场景层级（架构总纲）

应用共三个场景层级，切换由 `src/shell/App.vue` 编排（phase / gameStage）：

| 层级 | 别名 | 渲染方式 | 主要内容 |
|---|---|---|---|
| 菜单层 | 菜单级 | 纯 Vue | 开始界面 StartScreen、游戏内菜单 GameMenu、终局 EndPanel、全局 toast/MenuDialog |
| 大世界层 | 塔楼层 | ThreeJS 为主 | MapStage（夜空 + 塔楼侧视图 + 左下玩家状态栏 + 顶部资源条 + **全部阶段操作面板**） |
| 战斗层 | 房间层 | ThreeJS 为主 | BattleStage（战场 + 手牌/资源/按钮等 HUD 物件）；BattleHud（Vue，仅战斗日志与回合数）叠加其上 |

- ThreeJS 部分共享同一 `<canvas>`，由 StageManager 在 MapStage ↔ BattleStage 间切舞台。
- **塔楼层/房间层的操作界面绝大多数已 Three 化**（`src/stage/panels/index.js` 的 widget 构建器
  + `PanelObject` 等原语，画在 uiScene 里）：战前准备 / 战后奖励 / 进阶（灵脉）/ 休息房 / 商店
  全部是 Three 面板，对应的 Vue 组件已删除（`PrepPanel` / `RewardPanel` / `AscensionPanel` /
  `RoomPanel`）。数据下行只走 `core/run/panelSnapshot.js` 的纯函数快照，意图上行只走
  `runController.dispatchPanelIntent`。
- 仍由 Vue 渲染的只有这几类：**对话（dialogue）、cutscene 幕间转场（CutsceneOverlay）、
  tooltip（TooltipOverlay / CardFacePreview）、战斗内的 BattleHud（日志/回合数）**，以及菜单层组件。
- run 的 gameStage（prep/battle/reward/room/ascension/end）决定当前构建哪块 Three 面板
  （`MapStage` 的 `PANEL_BUILDERS` 按快照 kind 分发；App.vue 只决定用哪个舞台与挂哪些 Vue 浮层）。

## 数据说明

内容与逻辑**完全分离**：一切"定义"都是 `src/core/content/` 下的纯静态对象，由
`content/index.js` 显式 import 登记进注册表；运行时状态只存 **id/slug + 标量**（可序列化），
要用定义就经注册表反查。注册表由 `core/registryFactory.js` 的 `createRegistry` 工厂产出
（skills / abilities / enemies / allies / relics / effects 同构）。细化约定见 `AGENTS.md`。

### 敌人

`core/content/enemies.js` 按等阶定义；强度按楼层/进度挑选。行为走 `core/instructions/aiAct.js`
的意图序列（意图 kinds 含 attack / defend / summon / stun 等），不写在敌人定义里。

### 技能（卡牌）

`core/content/` 下按体系分文件（`fireEmberSkills.js` / `bodySkills.js` / `bladeSkills.js` …），
聚合在 `skills.js`。等阶 D→C→B→A（S/Z 在阶梯外）、升阶与转化的两类晋升链、
卡面文本双轨（`describe` / `battleDescribe`）等设计意图见
`src/core/skills/SKILL_DESIGN_PRINCIPLES.md`。

### 能力

`core/content/abilities.js`（精英/大师能力）；能力同样只是定义 + 订阅，不持有运行时状态。

### 效果

`core/content/effects.js`。效果**不再**是 Player/Enemy 上的 getter 或 `addEffect/removeEffect`
方法：首次获得时由 `AddEffectInstruction` 挂载其订阅（`owner = effect:<单位>:<效果>`，
window 限定本场战斗），层数扣尽时按 owner 注销。

数值口径统一走两条路，不散落在各卡里：
- **面板修正 → `unit.getStat(字段)` 读轨**（修正器 + 运行时重算模型，见
  `core/run/prep.js` 的 `refreshRunModifiers`）；
- **伤害三段式**：`amount = 基础值 + getStat(面板)` → PRE 修饰流水线（内核订阅改写 payload）
  → 执行（减防御 → 护盾吸收 → minHp 地板）。

## 功能特性

- 回合制战斗系统
- 技能系统
- 敌人生成系统
- 奖励和商店系统
- 多种游戏界面

## 开发指南

### 安装依赖

```bash
npm install
```

### 启动开发服务器

```bash
npm run dev
```

### 构建生产版本

```bash
npm run build
```

## 游戏规则

玩家将扮演一个灵御（能使用魏启这种神奇能量的战士），随着游戏进行，不断击败越来越强大的敌人，并在每场战斗后收集金钱、获得技能、升级能力、恢复状态、购买物品、触发随机事件等，攀升到尖塔的高处并击败最终敌人。
