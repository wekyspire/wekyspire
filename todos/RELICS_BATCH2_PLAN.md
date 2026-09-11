# 遗物第二批（新机制）实施计划

> 状态：**待实施**。第一批（31 件，无新机制）已上线，见 `src/core/content/relics.js`。
> 本文件是第二批（RELICS.md 中剩 17 件「需要新机制」）的实施台账：每件遗物 → 需要的引擎能力 → 落地口径。
> 引擎现状由只读调研确认（结论写在每条的「机制」行），不要凭印象改。

## 一、机制现状总览（调研结论）

| 需要的能力 | 现状 | 结论 |
| --- | --- | --- |
| 生成卡（加入手牌 / 洗入牌库） | `AddCardInstruction({ defId, toZone, index })`，`toZone:'hand'`、`index:'random'` | **现成**（`cards.js:129-151`，内容侧范式 `bladeSkills.js:207` 洗碎铁） |
| 负面效果免疫 | 效果定义有 `type:'buff'|'debuff'`；PRE veto `AddEffectInstruction` | **现成**（范式 `effects.js` 的 dodge/stall veto） |
| 受伤后钩子 | `DealDamageInstruction` + `phase:'post'`，`instr.result.dealt` | **现成**（大锤已是此写法） |
| 战斗结束钩子 | `PostBattleInstruction` + `phase:'post'`，react 里 `c.kernel.verdict` | **现成**（无独立「胜利」指令，用 verdict 判） |
| 打空手牌钩子 | `UseSkillInstruction` POST + `c.battleState.zones.hand.length === 0` | **现成**（奥薇邦妮已用） |
| 结算期选牌（从牌库/手牌自选） | `AwaitPlayerInputInstruction` + `requestDeckSelection`/`selectHandCard` + `respondInput`；全链路（内核 WAIT 留栈 → `pendingInput` 单槽 → bridge `interactionHandler` → headless 自动应答）**与提交者无关**，遗物提交同样能跑 | **有非技能先例**：`test/asyncInput.test.js` 的 `CounterInputInstruction`（订阅回调里提交 WAIT 请求 + 确认后追加动作）。**两个硬约束**：①`onBattleStart` 早于初始抽牌（`battleRoot.js:61-68` vs `:135-137`）→ 选**手牌**类必须改挂 `DrawCardsInstruction` POST；②候选为空会 UI 死锁（`interactionHandler.js:22-25` 要求 selection ⊆ candidates）→ 提交前必须判空 |
| 战斗级数值上限修正（本场 maxMana / maxHandSize / maxActionPoints ±） | **无读轨修正层**：三字段是 `Player` 裸字段，各消费点直接读；战斗语义读取点收敛到 6 处（`helpers.js:57 handLimitOf`、`cards.js:17,45`、`battleRoot.js:38-39`、`turn.js:73`、`resources.js:31`） | **需范式**：`battleState.statDelta` 记账 + `PostBattleInstruction` **单点集中回滚**（详见 §四-1；不要用「每件遗物各自 once 订阅」） |
| 易伤（受伤增加） | 效果表里**没有**「易伤」；EFFECTS.md 定义的 **伤残**＝「所有来源伤害增加层数层」 | **口径重复**：战术目镜/埃文斯冠冕的「易伤」按**伤残同口径**落地，并在代码注释标注待用户定名 |
| 脆弱 / 伤残 | 效果表里**都没有**（SLOT_MACHINE 的恶魔 roll 需要） | **需新增两个效果定义**（口径 EFFECTS.md 已给：脆弱＝获得护盾量 −层数；伤残＝受伤 +层数） |

## 二、逐件落地口径（17 件）

### A. 纯现成能力，无引擎改动（8 件）

| 遗物 | 稀有度/槽 | 效果 | 落地口径 |
| --- | --- | --- | --- |
| 澈晶石 | B/1 | 回合开始时若魏启为 0 则 +1 魏启 | `TurnStartInstruction` POST + filter `c.player.mana === 0` → `GainManaInstruction` |
| 谐振弹 | B/2 | **非 Boss 战**开始时随机赋予一敌人晕眩 1 | `PreBattleInstruction`/`onBattleStart` + 非 Boss 判定（`isBossFloor(run.floor)`）+ 随机取一敌 → `AddEffectInstruction('stun',1)` |
| 埃文斯冠冕 | S/2 | 战斗开始：对所有敌人 4 点**固定伤害** + 虚弱 2 | 群伤范式（飞镖的 `dartVolley`）+ `fixed:true`；虚弱 2 走 `AddEffectInstruction('weaken',2)` |
| 冉晶石 | A/3 | 每回合开始：+1 魏启，并对**所有单位** 1 点固定伤害 | `TurnStartInstruction` POST → `GainManaInstruction` + 群伤（含玩家自身；自伤不吃闪避） |
| 黑晶剑残片 | A/1 | 战斗开始 +力量 2；每回合开始你受 2 伤害 | `onBattleStart` → `AddEffectInstruction('strength',2)`；`TurnStartInstruction` POST → `DealDamageInstruction({target: player, amount: 2})`（**不走 fixed**：这是真受伤，受防御/护盾影响？→ 待定，见 §三-2） |
| 霜雪胸针 | S/1 | 每场战斗一次：生命降至一半以下时 +力量 3 +格挡 3 | `DealDamageInstruction` POST + `filter: !used && c.player.hp*2 <= c.player.maxHp` → 力量 3 + `GainShieldInstruction(3)`；`used` 旗标放 `subscriptions` 工厂闭包（每场战斗重建 = 每场一次） |
| 皇晶石 | B/非槽位 | 每场战斗胜利后额外 +4 金币 | `PostBattleInstruction` POST + `c.kernel.verdict === 'victory'` → `c.runState.player.money += 4` |
| 古书序章 | B/3 | 战斗开始：抽 1；**本场**手牌上限 +1 | `onBattleStart`：`DrawCardsInstruction(1)` + 直写 `player.maxHandSize += 1`，挂 `PostBattleInstruction` once 回滚 |

### B. 纯现成能力 + 需要新增卡牌定义（4 件）

| 遗物 | 稀有度/槽 | 效果 | 落地口径 |
| --- | --- | --- | --- |
| 阿罗那 III | C/1 | 战斗开始把 1 张〈速射〉加入手牌 | `AddCardInstruction({defId:'rapidFire', toZone:'hand'})`；**新增卡**〈速射〉：0AP 3伤 消耗 |
| 黑火 H-3 | B/1 | 战斗开始把 1 张〈点射〉洗入牌库 | `AddCardInstruction({defId:'pointShot', index:'random'})`；**新增卡**〈点射〉：5伤 抽1 |
| 祈祷制度 | A/1 | 战斗开始把 1 张〈压制射击〉洗入牌库 | 同上；**新增卡**〈压制射击〉：1AP 15群伤 短暂 |
| 低语苍鹰 Z | S/1 | 战斗开始把 1 张〈贯穿射击〉洗入牌库 | 同上；**新增卡**〈贯穿射击〉：1AP 18穿透伤 抽1 冷却3 |

> 4 张衍生卡都是**不可获取**的衍生牌（不进卡包/训练抓牌/商店），只由遗物生成。要确认卡包门禁与 `pack` 归属：按现有衍生牌惯例（如碎铁）走「无卡包/不入池」；卡面 `describe` 只写效果语言。

### C. 战斗级数值修正（3 件，需要新范式但无引擎障碍）

| 遗物 | 稀有度/槽 | 效果 | 落地口径 |
| --- | --- | --- | --- |
| 微型 AWFD | A/1 | 战斗开始 +1 魏启；**本场**魏启上限 +1 | `onBattleStart`：`GainManaInstruction(1)` + 直写 `player.maxMana += 1` + PostBattle once 回滚 |
| 海神戟 | A/2 | 前 3 回合手牌上限 −1；第 4 回合开始 +力量 5 | `onBattleStart` 直写 `maxHandSize -= 1`；`TurnStartInstruction` POST 在 `turn.count === 4` 时 `maxHandSize += 1` 并 +力量 5；PostBattle once 兜底回滚（防中途结束残留） |
| 植入式魏启罐（已上线，仅核对） | C/1 | 战斗开始 +1 魏启**上限**（不恢复） | 已实装 ✓ 无需改动 |

### D. 需要新效果定义（2 件）

| 遗物 | 稀有度/槽 | 效果 | 落地口径 |
| --- | --- | --- | --- |
| 老旧的战术目镜 | C/1 | 战斗开始随机赋予一敌人**易伤 1** | 需「易伤」；按 EFFECTS.md 的**伤残**同口径落地（受伤 +层数）。**先新增 `maim`（伤残）效果定义**，战术目镜复用它（描述沿用 RELICS.md 的「易伤」并在注释标注待定名） |
| 界尘 | A/1 | 战斗开始后免疫**第一次**负面效果赋予 | `AddEffectInstruction` **PRE veto** + `type==='debuff'` + 闭包 `used` 旗标（范式同 dodge） |

### E. 需要新交互/机制（2 件，风险最高）

| 遗物 | 稀有度/槽 | 效果 | 落地口径 / 风险 |
| --- | --- | --- | --- |
| 胚胎 | S/1 | 战斗开始时**寻找 1**（从牌库中找 1 张牌自选抽取） | 组合 `AwaitPlayerInputInstruction({request:{kind:'selectDeckCard',...}})` + `AddCardInstruction(toZone:'hand')`。**风险**：遗物 `onBattleStart` 在 `PreBattleInstruction` 内提交输入请求，`startBattle` 会停在 WAIT——机制上可行但**无先例**；须先写最小回归（headless 与 RunDriver 的自动应答都要过） |
| 原初拟态基质 | A/3 | 每场战斗一次：复制你手牌中的一张牌 | 同上传入 `selectHandCard` 请求 + 复制（`AddCardInstruction({defId: 选中卡.defId, toZone:'hand'})`）+ 每场一次闭包旗标。风险同上（第二种输入请求形态） |

### F. 不实装（1 件）

| 遗物 | 原因 |
| --- | --- |
| 阿瓦凡 | 仅故事模式的「神剑」事件获得，且认主瑞米后需要**瑞米动作：模仿玩家打出的最后一张卡**——依赖尚未实装的瑞米行动与跨轮回状态，等故事模式主线一起做 |

## 三、实施顺序与待定问题（框架扩展的收敛结论见 §四）

**顺序（每步都可独立提交、可试玩）**
1. **C 组（战斗级上限修正）**：先把「直写 + PostBattle once 回滚」范式固化成一个小工具（`battleScopedStat(ctx, field, delta)` 之类），微型 AWFD / 海神戟 / 古书序章 三件一起上。
2. **A 组（8 件纯现成）**：澈晶石 / 谐振弹 / 埃文斯冠冕 / 冉晶石 / 黑晶剑残片 / 霜雪胸针 / 皇晶石（+已上线的核对）。
3. **B 组（4 件 + 4 张衍生卡）**：新增衍生卡定义 + 卡面文案，走 `AddCardInstruction`。
4. **D 组（新旧效果）**：新增 `脆弱`/`伤残` 效果定义（口径 EFFECTS.md 已给，恶魔 roll 也要用），战术目镜 / 界尘 落地。
5. **E 组（两件输入交互）**：先写最小回归验证「遗物发起输入请求」，再上胚胎 / 原初拟态基质。
6. 全组完成后：`npm test` + 批量 headless 试玩（第 3 轮）+ RELICS.md 的实装状态标注。

**待定问题（实施中遇到再定，不阻塞开工）**
1. **易伤 vs 伤残**：EFFECTS.md 只有「伤残＝受伤 +层数」，RELICS.md 的「易伤」没有定义——当前按同口径落地。若两者应不同（如易伤＝受到攻击伤害 ×1.5），需补 EFFECTS.md 定义。
2. **黑晶剑残片的「每回合受 2 伤害」**：是否走 `fixed:true`（不吃护盾）还是普通伤害（吃防御/护盾）？文档只说「受 2 伤害」。**倾向普通伤害**（可与护盾交互，符合「黑晶剑很痛但护盾能挡」的直觉）；实施时先按普通伤害，记为可调点。
3. **衍生卡的获取口径**：4 张射击衍生卡是否允许被其他途径（老虎机/商店）产出？倾向**完全不可获取**（只由遗物生成），与碎铁同口径。
4. **战斗级上限修正的残留风险**：`maxHandSize/maxMana` 直写在「中途退出战斗」等非常规路径下可能残留一回合；现有内容（燃元/膨胀）已有同样风险，先沿用同范式，不做额外加固。

---

## 四、框架扩展方案（工程健康度评估，2026-09-11）

> 原则：**能用既有范式就不新增层**；确实要新增时，新增点必须**单一、可测、不引入双通道**（前后端显示不一致是这类改动最典型的线上事故）。
> 本节结论基于两条只读调研链路（战斗级数值修正 / 结算期输入请求），全部有 `文件:行号` 支撑。

### 1. 战斗级数值上限修正 → **`battleState.statDelta` + PostBattle 单点回滚**（不建读轨层）

**现状**：`maxMana`/`maxHandSize`/`maxActionPoints` 是 `Player` 裸字段，消费点直接读（完整清单见 §一 与调研记录）。内容侧已有先例：燃元（`fireEmberSkills.js:82-97`）直写 `maxMana` 并把增量记账在**卡 runtime 的动态字段** `self.gainedMaxMana`，膨胀（`fireBurstSkills.js:555-563`）直写 `maxHandSize` 并**每打出一次就注册一条** once 回滚订阅。

**为什么不建「战斗级修正读轨层」**（评估后的否决）：
- 读完轨要改 **7 个文件 8 个读取点**（`handLimitOf`/`cards.js`×2/`battleRoot.js`×2/`turn.js`/`resources.js`/`projection.js`/`BattleStage.js`），其中 `projection.js:100-102` 是**独立数据通道**——漏改就是「core 按修正值截断、前端资源条显示旧上限」，而这类不一致最难在测试里抓到。
- 收益主要是「免回滚」，但**已有第二道安全网**：`refreshRunModifiers`（`prep.js:48-65`）每场 PreBattle 从 `baseStats` **覆盖式重算**（`battleRoot.js:32`），任何残留最多污染一场，下场自动纠正。
- 效果定义承载（`statModifiers: { maxMana }`）看着可行（`unit.js:72-79` 是字段无关累加器，`minHp` 已证明非实体字段可进轨），但**效果表没有 `hidden`/`internal` 标记**，而投影（`projection.js:32-44`）与渲染（`UnitObject.js:354-360`）会对每个效果**无条件**上屏——等于为了实现三条遗物去改投影+渲染+效果定义三处，成本更高、语义更歪。

**采用方案（2026-09-11 定案：修正 + 运行时重算，无回滚）**：遗物（以及一切数值修正源）一律看成 **modifier**——修正跟着它的**生命周期**存在（装上 / 战斗中 / 卸下），run 时**重算**（base + 全部生效修正）。战斗级修正的生命周期 = 一场战斗，所以它随 `battleState` 一起消失，**根本不需要回滚动作**：重算函数在战后被调一次，值自然回到基准。

- `battleState.modifiers = { maxMana, maxActionPoints, attack, defense, maxHandSize }`（新增；照抄同文件 `swapCount` 的「battleState 存本场标量」范式。battleState 每场新建 → 生命周期天然正确）。
- `refreshRunModifiers(run, battleState = null)` 的公式扩成**一条**：`值 = baseStats + Σ已激活遗物 runModifiers + Σ本场 battleModifiers`。不传 battleState（prep 装备/卸下/拾取）时本场项为 0，**行为与现状逐字一致**。
- 内容侧只留**一个 helper**（放 `prep.js`）：`applyBattleModifier(ctx, field, delta)` → 改 `battleState.modifiers` 并**立刻重算**，杜绝「忘了重算导致字段失配」。`ctx` 同时持有 `runState` 与 `battleState`，是天然的收口点（注意 `battleState` 目前**没有** run 反向引用，见 `flow/battle.js:31-37`，所以必须传 ctx）。
- 遗物增可选声明字段 `battleModifiers`（本场恒定不变的那些，如「本场手牌上限 +1」）→ PreBattle 在重算前统一折入；战斗中会变的（海神戟第 4 回合、燃元的战中获得）走 helper 触发重算。
- 战后：`PostBattleInstruction` 里调一次 `refreshRunModifiers(runState, null)`（本场项归零）。**这一步看起来像"回滚"，但它不是特殊机制，就是同一个重算函数在战后被调一次**——幂等、顺序无关、无记账。

**为什么这版比前两版都好**：
- 读取点**零改动**（值仍写在 `player` 字段上）→ 现有测试、投影、渲染全不动，HUD 显示的就是生效值；
- 不需要逐字段 delta 记账、也不需要 once 订阅——顺手删掉燃元的 `skillRuntime.gainedMaxMana` 动态字段与膨胀「每打一次注册一条回滚订阅」的写法；
- 校验点收敛为**一个纯函数**，可以直接写「重算幂等」「重算 = base + Σ修正」的单元测试；
- 与既有 `refreshRunModifiers` 是同一条路，不引入新概念。

**唯一纪律**：任何战斗级修正的变更都必须经 helper（否则字段不重算 → 静默失配）。收口到单一 helper 就是为了让内容侧无处可忘。

### 2. 缺失的效果定义（脆弱 / 伤残 / 易伤）→ **纯内容层，无框架改动**

- `EFFECTS.md` 已给口径：**脆弱**＝获得护盾量 −层数（不可小于 0）；**伤残**＝所有来源伤害 +层数。
- 落地即「效果定义 + 订阅」的既有范式，不需要动框架：脆弱 = `GainShieldInstruction` 的 PRE 修饰（`setPayload` 后 clamp ≥0）；伤残 = `DealDamageInstruction` 的 PRE 修饰。同类先例：`weaken`（`statModifiers`）、`dodge`/`stall`（PRE veto）。
- 「易伤」在 EFFECTS.md **没有定义**，与伤残同口径 → 见 §五-1 待定。
- 注意：这两个效果**老虎机恶魔 roll 也要用**，所以先做实它们比先做实某件遗物更划算（顺手解锁恶魔 roll 的一半）。

### 3. 遗物发起「选牌」→ **就地提交 + 一个共享多阶段指令原语**；胚胎需要补前端

- 链路**零改动**即可复用：内核 WAIT 留栈（`BattleKernel.js:158-164`）、`pendingInput` 单槽（`input.js:14`）、bridge 仲裁（`interactionHandler.js:34-48`）、headless 自动应答（`runDriver.js:73-83`、`playSession.mjs:396-432`）全部只认 `battleState.pendingInput`，**与谁提交无关**。多件遗物同时要选 → 它们是 `pre` 的并列子节点，DFS 串行，第一个 WAIT 停泵、答完才跑第二个 → **天然排队，不需要排队代码**。
- 但「提交请求」和「应答后把牌搬过去」是两件事，遗物 hook 是**一次性同步函数、没有第二段**：所以需要**新增一个多阶段指令原语**（`BattleStartPickInstruction extends AwaitPlayerInputInstruction`，覆写 `execute`：首次 WAIT，应答后按语义提交 `AddCardInstruction` / `MoveCardInstruction`）。范式直接照抄 `test/asyncInput.test.js` 的 `CounterInputInstruction`（订阅内提交 WAIT 请求 + 确认后追加动作，是仓内唯一非技能先例）。
- **两个硬约束必须写进原语里**：
  1. **空候选守卫**：候选为空时不能提交（`interactionHandler.js:22-25` 要求 selection ⊆ candidates，空集无合法应答 → 界面死锁）。技能侧是靠调用方判空（`cardKit.js:170-176` 不做保护），遗物侧必须在原语里统一判。
  2. **节拍**：`onBattleStart` 在 PreBattle stage 0、**初始抽牌之前**（`battleRoot.js:61-68` vs `:135-137`）→ 胚胎（选**牌库**）没问题；**原初拟态基质（选且复制手牌）不能挂在 `onBattleStart`**，要挂 `DrawCardsInstruction` 的 POST（`window:'once'`，首次抽牌后触发）或让原语自带「先抽后选」。
- **前端缺口（工程健康度重点）**：`selectDeckCard` 在战斗界面**协议层支持但没有可点入口**——`BattleStage.js:1459-1464` 的命中来自场景里可见的卡（手牌/咏唱区），牌库查看器（`BattleStage.js:1433-1436`）是只读的。所以**胚胎在 GUI 里目前无法选取**，只有 headless 能用。这不违反「文档先行」，但违反「GUI 可玩」→ 二选一（见 §五-2）。
- 不采用「声明式 `battleStartPick` 字段 + `battleRoot` 统一处理」：原初拟态基质的**复制**语义（要保留升级态/不保留？见 `AddCardInstruction` 只按 `defId` 新建）落到最后仍要每件遗物一个专属分支，而 `battleRoot` 的 stage 是固定序、无法在 WAIT 应答后回到「收集循环里的某一件」，声明式的收益被抵消。**结论：声明式不值得**。

### 4. 战斗胜利后的 run 级结算（皇晶石）→ **新增 run 层遗物钩子**，禁止战斗订阅直写 run 状态

- 现在能做到的「歪路」：在 `PostBattleInstruction` 的 POST 里判 `c.kernel.verdict === 'victory'` 然后直写 `c.runState.player.money += 4`（`ctx.runState` 确实可见）。**但金币是 run 层资源**（入账在 `rewards.js:161-162`），战斗层直写 run 状态会破坏「四层单向依赖」的语义边界，且以后每加一件「战斗结束后给 run 级收益」的遗物都会复制这段歪路。
- **方案**：在 `finishBattle`（`runFlow.js:91-107`）里加一次 run 层钩子调用（形如 `for (const id of activeRelics(run)) getRelicDefinition(id).onBattleVictory?.(run, battle)`），皇晶石只声明 `onBattleVictory(run) { run.player.money += 4; }`。改动 = 定义契约加一个可选字段 + `finishBattle` 一处循环 + 一件遗物。**这是本次唯一新增的「框架级」钩子，且它同时是未来跨战斗计时器（恶魔 roll 的「下一场战斗」）的承接点**，值得一次做对。

### 5. 明确不做（避免为了三件遗物动骨架）

| 不做 | 理由 |
| --- | --- |
| 战斗级数值「读轨层」（`scopedStat` 改全部读取点） | §四-1 定案：走「修正 + 运行时重算」即可，读取点零改动；读轨层要多改 7 文件 8 点且把上限变成前后端双通道，收益为负 |
| 用效果定义承载上限修正 | 无 `hidden` 标记 → 要改投影 + 渲染，且语义错位 |
| 声明式 `battleStartPick` 字段 | §四-3：复制语义仍需专属分支，`battleRoot` 固定 stage 无法处理 WAIT 回来后的循环位置 |
| 让战斗订阅直写 run 状态 | §四-4：用 run 层 `onBattleVictory` 钩子代替 |
| 「逐字段 delta 记账 + 战后减回去」的回滚 | 上两版方案的产物；定案口径下副作用随 `battleState` 消失，重算一次即可，不需要记账 |
| 跨战斗计时器（「下一场/下三场」） | **本批 17 件遗物一件都不需要**（皇晶石是即时结算、海神戟/古书序章/微型 AWFD 是本场、界尘是本场）；恶魔 roll 需要时再一起做，`onBattleVictory` 已留好承接点 |

### 6. 收敛后的改动清单（按「新增点是否单一」排序）

| 步骤 | 改动面 | 新增点 | 是否动骨架 |
| --- | --- | --- | --- |
| ① 效果：脆弱 / 伤残（+易伤口径） | `core/content/effects.js` + 定义文件 | 2 个效果 | 否 |
| ② 战斗级上限修正 | `battleState.js`（+`statDelta`）、`battleRoot.js`（PostBattle 集中回滚）、一个 shared helper；迁移燃元/膨胀 | 1 个字段 + 1 个函数 | 否（不碰读取点） |
| ③ 生成卡 4 件 | `relics.js` + 4 张衍生卡定义（`AddCardInstruction` 已现成） | 4 张卡 + 4 件遗物 | 否 |
| ④ 纯钩子 8 件（澈晶石/谐振弹/冉晶石/埃文斯冠冕/黑晶剑残片/霜雪胸针/古书序章/微型 AWFD/海神戟/界尘） | `relics.js` | 若干订阅 | 否 |
| ⑤ run 层胜利钩子 + 皇晶石 | `relics/registry.js` 契约注释、`runFlow.js` `finishBattle` 一处循环 | 1 个可选钩子字段 | 是（唯一一处，且是未来跨战斗承接点） |
| ⑥ 选牌原语 + 胚胎/原初拟态基质 | 新增 `BattleStartPickInstruction`（content 层）+ 2 件遗物；**胚胎另需前端牌库选取入口** | 1 个指令类 | 否 |

### 7. 前置修复：进阶的「魏启上限 +1」被重算抹掉（**现存 bug，优先级最高**）

- 根因：`ascension.js:171` 直写 `run.player.maxMana += ASCENSION_PLACEHOLDER.manaGain` **没有抬 `baseStats`**，而 `refreshRunModifiers` 是**覆盖式重算**（`p.maxMana = base.maxMana + 修正`）。
- 实测（探针）：进阶后 `maxMana=4` → 调一次 `refreshRunModifiers` → **回到 3**。触发点很多：每场 PreBattle 第一件事（`battleRoot.js:32`）、以及任何一次拾取/装备/卸下遗物（`prep.js:80/95/103/118`）。
- 活证据：`r1c-s301`（进阶 1/6、灵脉火1）面板 `魏启 2/3`，上限本该是 4。这也解释了试玩里反复出现的「3 费卡差 1 点魏启打不出」——不是数值偏紧，是进阶成长根本没生效。
- 对照：`gainMaxHp`（`prep.js:34` 注释写明「**必须同时抬 baseStats**，否则下一次 refreshRunModifiers 会把成长抹掉」）因此不丢。**根因是这条纪律没有被强制。**
- 修法：新增 `gainMaxMana(run, n)`（镜像 `gainMaxHp`：`baseStats.maxMana += n`、`maxMana += n`、`mana += n`），`ascension.js` 改调它；并把「**一切永久成长必须走 gainXxx / 不得直写 `player` 字段**」写成 `player.js` 与 `prep.js` 的显式纪律注释。
- 全量核查（`grep '\.maxHp|maxMana|attack|defense|maxHandSize|maxActionPoints *+=' src/`）：除 ascension 外无第二处「永久成长直写字段」。`fireEmberSkills.js:87`/`fireBurstSkills.js:556` 是有意为之的**本场**修正（本次迁移到 `battleState.modifiers`）；`floorEnemyGenerator.js:61` 写的是敌方单位的模板加成，不涉及 run 级对象。
