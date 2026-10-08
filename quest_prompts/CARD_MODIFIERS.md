# 卡片 Modifier 机制（设计定稿 2026-10-08）

> 用户三轮讨论拍板的机制设计。消费者：怪异瑞米诅咒卡（BOSSES_4.md）、锁定机制迁移、
> 未来事件/敌人/遗物对卡的自由修正。实装分四期，见文末。

## 0. 核心抽象

```
有效卡视图 = def ⊕ 依序合成(卡上 modifiers 的 patch)     ← 纯函数，随时重算，永不落库
modifier   = { patch?, hooks? }                          ← 对外只有一种东西
```

modifier def 契约字段：`patch.keywords = { add?, remove? }`（词条增删）、
`patch.cost.{ mana | actionPoint }` 与 `patch.cooldown` = 数值 ops `{ set?, add?, min?, max? }`
（键名与 def.cost 同词汇表：`mana` / `actionPoint`，不用 `ap` 缩写）。

- **拉取式（pull）不是推写式（push）**：属性修正是取值问题——摘除零成本（detach 即生效，
  无逆写）、干跑/预览/实结算同源（纯函数，无 divineShell 式 PRE 直改泄漏）、序列化只存
  补丁不存结果。项目三次判例同向：遗物 runModifiers 重算不叠加、紧勒/涨墨走 getStat 轨、
  PRE 禁直改状态。
- modifier 实例挂在卡 runtime 上：`card.modifiers = [{ modId, source, data }]`，
  **同 modId 不叠**（重挂 = 覆盖 data + 重播挂载演出）。

## 1. 作用域：落点即作用域（无 persist 开关）

战斗牌库是 run 牌组的克隆（battleRoot PreBattle `cloneSkillRuntime` 逐卡复制，战后无回写）：

- 战斗中挂的（Boss 塞诅咒、蓄能锁定）→ 落克隆上，战斗结束随克隆丢弃；
- 非战斗挂的（事件腐化）→ 直接写 `player.deck` runtime，随既有存档持久（一次游玩）。

⚠ `cloneSkillRuntime` 与 `saveRestore` 均为浅拷贝（`{...rt}`）——modifiers 数组必须
深拷贝，否则战斗内摘除污染 run 卡。

## 2. 属性补丁代数（v1 四域）

| 域 | 操作 | 合并 |
|---|---|---|
| keywords | 增、删 | 基础词条 → 按 modifier 存储序 fold（单条内先增后删）；只改视图不动 def |
| cost（AP） | set / add / min / max | 数值 fold（见下）；X 费免疫 |
| mana | set / add / min / max | 同上；X 费免疫 |
| cooldown | set / add / min / max | **无冷却卡以 0 为基**（可被 patch 出冷却）；只改时长，不碰 currentCooldown |

- **优先级 = 卡上的存储相对顺序**（后挂者后算）；单条 modifier 内部操作顺序固定
  `set → add → min → max`（工程裁决：确定性 + clamp 收尾）。
- **corner case（用户点名）**：卡片本身 cost/mana 为 `'X'` → 该费种不吃任何相关
  modifier（按费种各自判定）；无冷却卡 cooldown 基数 0。
- min/max 语义：`min: c` → 与常数 c 取小；`max: c` → 取大。
- **legacy 三通道折进视图末端**（工程裁决）：`costOverride` = 末端合成 set、无 override 时
  `manaCostDelta`/`apCostShift` = 末端合成 add——精确复刻现行「override 存在则压制 delta」
  语义，零行为回归；新内容一律走显式 modifier，legacy 渐进退役。
- 生效时机跟随属性既有读点（固有/缓启 enterBattle 读一次——战斗中途挂固有下场才生效，
  run 级事件挂的天然赶上）。

## 3. 行为面：生命周期钩子 + 任意战斗事件订阅（2026-10-08 用户补定）

modifier def 的行为契约（与效果/技能/能力/遗物的 subscriptions 同构）：

| 字段 | 语义 |
|---|---|
| `onAttach(mod, sctx)` | 挂载落地时（指令子节点语境，可提交子指令做一次性结算/自设状态） |
| `onDetach(mod, sctx)` | **一切移除路径**的 cleanup 唯一出口：显式 Remove、enterBattle 重推导摘旧项、转化/晋升换绑（leaveBattle）、战斗结束（clearWindow 兜底） |
| `subscriptions(mod, sctx)` | 监听任意战斗事件（`{when, phase, filter, react, priority?, window?}` 全语法） |
| `mutesHand` | 旗标：手中**别的**卡带此 modifier → 其余卡不可打（canUseSkill 通用规则） |
| `unplayable` | 旗标：本卡带此 modifier → 不可打 |

- `onDraw(mod, sctx)` / `turnEndInHand(mod, sctx)` 是**糖**：编译进同一订阅通道
  （onDraw = DrawCardsInstruction POST + result.drawn 含本卡；turnEndInHand =
  PlayerTurnEndInstruction POST + zone=hand），诅咒卡一行即写，通用订阅写法永远可用。
- 订阅注册 owner = `uniqueID:mod:<modId>`（精确到单条 modifier，任意路径按 owner 注销）。
- 顺序铁律：**先注销订阅、再跑 onDetach**（防 cleanup 动作被自己的监听捕获）。
- run 层（战斗外）attach/detach 无 kernel 语境：原语只动数据，钩子在下次 enterBattle
  对账时生效。

⚠ 语义澄清（2026-10-08 核实纠正）：现有 `card.locked` **不拦截出牌**——「锁定」是
**回合末焚毁烙印**（打出即得救，BOSSES_4「回合结束时仍在手则焚毁」）。内建 `locked`
modifier 保留此语义；`unplayable`（禁打本卡）是独立旗标，两者不是一回事。

## 4. 指令与生命周期

- `AddCardModifierInstruction({ uniqueID, modId, data, source })` /
  `RemoveCardModifierInstruction({ uniqueID, modId })`——与 AddEffect 同范式，含 presenter
  播报（cardModAttached / cardModRemoved）。挂载序：写入实例 → 编译注册订阅 → onAttach；
  移除序：注销订阅 → onDetach（顺序铁律见 §3）。同 modId 重挂 = 原位覆盖 data（存储序不变）。
- **def 声明式打包**：卡 def 写 `modifiers: ['muteHand', ...]`，enterBattle 自动挂
  （source = `def:<defId>`）；enterBattle 时先摘除不属于当前 defId 的 def 来源旧项再挂新项
  （转化/晋升后重新推导，防残留旧定义行为）。非 def 来源（事件/敌人）随 uniqueID 延续。
- 焚卡随卡消失；TransformCardInstruction / 局内外晋升 uniqueID 延续 → 非 def 来源随行。

## 5. 锁定机制迁移（第一期做）

`card.locked` 布尔 → 内建 `locked` 焚毁烙印 modifier（**不拦出牌**，语义见 §3 澄清）。
`LockCardsInstruction` 对外动词不变、内部改挂 modifier；读点 `card.locked`（bosses.js
神兵/无人战体、chapter2.js）改 `hasCardModifier(card, 'locked')`，回合末清标改提交
RemoveCardModifierInstruction；`projection.js` 照旧投影派生布尔 `locked`（stage sync.js
零改动），另加 `mods` 数组。

## 6. 读点接线面（已核实的清单）

- keywords 7 处：skill.js exhaust、battleRoot 固有、helpers anchored / mini×2 / slowStart、
  cardKit isBladeCard → `keywordsOf(rt)`。
- 费用 2 处：canUseSkill 可用性检查、结算侧费用消耗（ConsumeSkillResources）→ `costOf(rt)`。
- cooldown：enterBattle 初始化、打出后冷却时长写入、入库冷却推进（tickCooldownOnEnterDeck）。
- 烘焙/投影：`bakeCardFace(card)` 收 def 形状对象——`effectiveDefOf(rt)` 产出同形状对象喂入，
  烘焙链结构零改动（挂上的词条自动进页脚词条行）。

## 7. 前端

- 投影：卡投影加 `mods: [{ id, name, icon, color }]`。
- 徽章 = CardObject 独立子件（锚页脚词条行区，**不烘进卡面纹理**）——挂/卸动画天然可做，
  烘焙缓存零影响。
- 挂/卸动画：core 播报 → bridge ANIM 节拍 → 徽章弹入 + 卡身脉冲（C0 高亮通道）／徽章溶解 +
  词条飘字（floatFx）。
- tooltip：徽章 hover → 既有 `item` 型 tooltip 契约。
- （视觉参数默认轻，具体强度用户自调——只保证通道就位。）

## 8. 诅咒卡形态（消费者，三期）

六张卡 = Z 阶白板 def + modifier 打包：痛楚 = onDrawPain + lock、缄默 = muteHand + 换所有牌、
歪曲 = onDrawTax、忘却 = onDrawBuffLoss、邪咒 = turnEndInHand 转移、恶意 = 消耗 + 自伤 +
抽 3（活页范式，def use）。Boss 侧照 BOSSES_4.md 塞新卡；战斗内塞的卡战后随克隆消失
（躲闪/墨渍同款现行语义；44 层是终塔，对本 Boss 无实际影响）。

## 9. 分期

1. **Core 底座 + 锁定迁移**：registry / runtime 字段 / 深拷贝修正 / 指令 / canUseSkill 规则 /
   def 打包 / 钩子编译 / 四域视图 + 读点替换。冒烟：补丁代数全操作、X 免疫、cooldown 基 0、
   锁定回归（神兵蓄能）、钩子触发、转化重推导、克隆隔离。
2. **表现层**：投影 mods / 徽章子件 / 挂卸动画 / tooltip。
3. **内容**：灵态效果 + 六诅咒卡 + 怪异瑞米（360 血/灵态开局/五拍循环/每回合塞诅咒）+
   BOSS_OF_FLOOR[44] 入池 + BOSSES_4.md id 回填。
4. **run 级原语**：`runEffects.attachCardModifier`（事件用；机制就位，事件内容等设计稿）。

## 遗留（未拍板不实装）

- charges（充能上限）域、power 威力域——用户未点，等需求。
- 调试面板查看/清除卡上 modifier。
- 卡面正文级视觉语言（整卡染色等重视觉）——徽章+动画先行。
