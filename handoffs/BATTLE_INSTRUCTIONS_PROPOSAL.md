# 新后端战斗结算方案提案（结算树 + 协程执行 + 取消/异步）

本提案结合现有仓库实现与`quest_prompts/NEW_BACKEND_LOGIC.md`目标，给出一套可落地、可渐进迁移的战斗结算机制：以“结算原语（BattleInstruction）”为节点、以全局执行器为协程驱动，对结算树进行深度优先遍历，原生支持取消传播与异步等待，并与现有动画与事件体系保持对齐。

---

## 目标与约束
- 以DFS形式执行结算树节点（元语），子元语可在父元语`execute`中动态提交。
- 原生支持“取消”传播：父节点取消，整条子链均不可执行。
- 原生支持“暂停/等待玩家输入”：通过`AwaitPlayerInputInstruction`与事件总线实现。
- 与现有后端状态/动画/事件保持兼容，逐步替换旧的硬编码流程（`battle.js`/`battleUtils.js`）。
- 将“使用技能（useSkill）”明确拆分为“消耗资源”和“发动技能（activateSkill）”。
- 提供渐进迁移策略与验证用例。

---

## 架构概览
- 抽象基类：`BattleInstruction`
  - 字段：`uniqueID`、`parentInstruction`、`cancelled`
  - 方法：`execute()`（抽象）、`canExecute()`（含父链检查）、`cancel()`、`getDebugInfo()`
- 执行器：`BattleInstructionExecutor`
  - 维护栈（DFS）、并发保护、统计信息。
  - 事件：`BATTLE_SETTLEMENT_START/COMPLETE`、`INSTRUCTION_EXECUTED`。
- 全局执行器接口：`battleInstructions/globalExecutor.js`
  - `initializeGlobalExecutor()`、`submitInstruction()`、`runGlobalExecutor()`、`getCurrentInstruction()`、`cleanupGlobalExecutor()`。
- 元语集合（已存在 + 拟补充拆分）：
  - combat: `LaunchAttackInstruction`、`DealDamageInstruction`、`GainShieldInstruction`、`ApplyHealInstruction`。
  - card: `DrawSkillCardInstruction`、`DropSkillCardInstruction`、`BurnSkillCardInstruction`、`DiscoverSkillCardInstruction`。
  - core: `UseSkillInstruction`（顶层）、`ConsumeSkillResourcesInstruction`、`ActivateSkillInstruction`。
  - async: `AwaitPlayerInputInstruction`。
  - effect: `AddEffectInstruction`（已存在于helpers导入）。
- 动画与事件：复用`animationInstructionHelpers.js`与`utils/animationHelpers.js`、`backendEventBus`与`EventNames`。

---

## 关键点修正与对齐
1. 父元语句柄传播
   - 问题：技能内部调用helpers创建子元语时，未设置`parentInstruction`，导致取消链丢失。
   - 方案：`battleInstructionHelpers.js`默认从全局执行器`getCurrentInstruction()`获取父元语，除非显式传入。已实现。
   - 补充：`ActivateSkillInstruction`通过`context.parentInstruction = this`将自身句柄传入`skill.use(player, enemy, stage, context)`，技能若有特殊需要可显式使用该句柄。已实现。

2. 动画/卡牌操作一致性
   - 参考`battleUtils.js`的最新动画流程（如抽卡`enqueueCardAnimation`的from/anchor、burn/drop组合原语），现有指令已基本对齐；如遇差异，以`battleUtils.js`为准持续微调。

3. 元语拆分建议
   - 焚毁流程：建议拆为两阶段（后续PR）
     - A: `SkillLeaveBattleInstruction`（调用`onLeaveBattle`，做必要state/事件）
     - B: `BurnSkillCardInstruction`（只做容器迁移 + 动画 + 事件）
   - 其他可能的细化：护盾/治疗加入统一的日志与HP条动画效果原语，便于组合。

---

## 使用技能流程（use vs activate）
- `UseSkillInstruction` 顶层流程：
  1) 添加日志、中心动画（与旧逻辑一致）。
  2) 子元语：`ConsumeSkillResourcesInstruction`（AP/Mana/Uses）。
  3) 子元语：`ActivateSkillInstruction`（执行`skill.use`多阶段逻辑）。
  4) 完成后：根据`cardMode`与`willSkillBurn`处理“入咏唱/回牌库/焚毁”。
- `ActivateSkillInstruction`：
  - 在`stage=0`时处理`processSkillActivationEffects`。
  - 每次`execute`调用前，将`context.parentInstruction`刷新为当前实例。
  - 调用`skill.use(player, enemy, stage, context)`，允许内部通过helpers提交子元语，形成清晰父子关系。

---

## 异步输入（协程暂停）
- `AwaitPlayerInputInstruction`：
  - 向前端发送`REQUEST_PLAYER_INPUT`，携带`instructionID`、`inputType`与`options`。
  - 监听`PLAYER_INPUT_RESPONSE`，Promise resolve 后继续执行器循环。
  - `cancel()`覆盖：移除监听并resolve(null)，保证取消链干净退出。

---

## 取消语义
- 任意节点`cancel()`后，`canExecute()`通过父链检查使所有子树不可执行。
- 典型触发：
  - 目标死亡、战斗结束：上层节点检测并发出`BATTLE_VICTORY`，随后上层/当前节点可以`cancel()`，剩余未执行节点被跳过。

---

## 渐进迁移方案
1. 引入执行器生命周期（在战斗开始`enterBattleStage`时`initializeGlobalExecutor()`，在战斗结束时`cleanupGlobalExecutor()`）。
2. 将旧的`useSkill()`入口替换为提交`UseSkillInstruction`并`runGlobalExecutor()`。
3. 选择一个简单技能进行迁移：
   - 将其`use`实现内的结算改为调用helpers（如`createAndSubmitLaunchAttack`、`createAndSubmitDrawSkillCard`等），如需异步输入则插入`createAndSubmitAwaitPlayerInput`并在多阶段读取结果。
4. 验证通过后，逐步迁移其他技能与敌人行为。

---

## 测试与验证
- 单元/集成：
  - UseSkill完整链路：资源消耗 → activate → drop/burn/chant。
  - combat结算：`LaunchAttackInstruction`与`DealDamageInstruction`的结果一致性（对齐`battleUtils.js`）。
  - 异步输入：模拟`REQUEST_PLAYER_INPUT`/`PLAYER_INPUT_RESPONSE`事件流，断言协程暂停/恢复。
  - 取消传播：在阶段1后取消父元语，确保子元语不再执行。
- 手动回归：
  - 抽/弃/焚/发现动画与状态同步与旧逻辑一致。
  - 咏唱位替换/停用生命周期。

---

## 后续工作清单
- [ ] 将`battle.js`内“玩家使用技能”入口切到`UseSkillInstruction` + `runGlobalExecutor()`。
- [ ] 拆分`BurnSkillCardInstruction`，引入`SkillLeaveBattleInstruction`。
- [ ] 梳理`effect`类原语：提供`RemoveEffectInstruction`（或沿用AddEffect负层数但统一校验/事件）。
- [ ] 为执行器与关键原语补充轻量单测与一个示范技能迁移用例。
- [ ] 统一动画tags/waitTags规范，减少动画叠帧。

---

## 附：关键代码对齐
- helpers已默认绑定当前父元语（通过`getCurrentInstruction()`），无需技能手动传参即可保持取消链。
- `ActivateSkillInstruction`通过`context.parentInstruction`向`skill.use`暴露句柄，满足“技能能拿到自身指令”的需求。
- 现有`DrawSkillCardInstruction`等卡牌操作类已尽量复用`battleUtils.js`中的动画风格；如有视觉差异，将按旧逻辑微调。

此提案与本次提交的最小调整共同构成“接线层”，保证你可在不大改前端的前提下，开始把技能逐步迁移到结算原语框架中。
