# 故事模式 Cutscene 剧本索引

剧本以引擎契约书写（`{ id, steps }`，步骤词汇：`fade` / `wipe` / `image` / `dialogue` / `call`），
可整段拷入 `src/shell/overlay/scripts.js`。`call` 步骤的 `fn` 为装配层绑定的副作用占位（字符串标记）。
口径与写作纪律见 README.md。CG `src` 均为占位名。

> 各剧本为起草稿精选版：只保留平实可用的台词与拍子；凡 string.md 已有原文处以 string.md 为准。
> 剧本正文按剧情块分文件存放，本文只保留触发总览与装配层接线备注。

## 触发总览（与 string.md 三结局结构对齐）

| 剧本 | 内容 | 所在文件 |
| --- | --- | --- |
| `opening` | 开场（新档，初遇瑞米：激动 → 好奇 → 介绍 → 带骑士开始游玩） | `OPENING.md` |
| `firstDeath` | 死亡 → 重置 → remi抱遗物（首次死亡） | `OPENING.md` |
| `chapter2/3/4` | 章节开场（12 / 23 / 34 层） | `CHAPTERS.md` |
| `campfire` | 休息层炉火闲谈（非主线小剧场，触发一次） | `CHAPTERS.md` |
| `boss11/22/33` | Boss 战前后置（44 层为最终战 A，塔顶剧情单列） | `BOSS_TALKS.md` |
| `finalAMid` | 最终战 A 中段（44 层 Boss 瞬杀 remi 的剧情杀：承受 / 打跑两分支） | `TOP_OF_TOWER.md` |
| `towerTop` | 塔顶共同部（最后的字条 → 观星阁楼 → 冻结的计数器） | `TOP_OF_TOWER.md` |
| `topOfTower` | 塔顶高潮（终止旋钮七周 → 程序四变脸 → 瑞米登顶 → 星星对质 → "让我转最后一下" → 玩家选择；独行变体待写） | `TOP_OF_TOWER.md` |
| `towerTopRefuse` | 拒绝交钥匙（remi 随钥匙转动消散 → 结局 A） | `TOP_OF_TOWER.md` |
| `remiFlee` | 心软交钥匙（remi 叼钥匙逃离 → 塔基隐藏关解锁） | `TOP_OF_TOWER.md` |
| `towerBase` | 塔基（独闯 → 冷却液河边重逢 → 塔底装置 → 最终战 B） | `TOWER_BASE.md` |
| `towerBaseC` | 最终战 B 两形态胜利后（头盔滚落 → 顿悟 → 纵身一跃 → 停机） | `TOWER_BASE.md` |
| `endingA / endingB / endingC` | 三结局 | `ENDINGS.md` |

---

## 接线备注（装配层）

- `opening` 中 `$startFloor1`：结束开场后进入 1 层（roguelike 常规开档路径）。
- `firstDeath` 的 `$grantDeathCarryRelics`：发放上一轮回保管遗物（runController 已有跨局遗物机制的叙事化挂点）。
- `finalAMid` 为最终战 A（44 层 Boss）的战斗内嵌剧本：`$finalAShieldChoice` 弹出战中二选一
  （替remi承受 = 高好感解锁项），未解锁则直接走 `finalAMidOut`。
- `towerTop` 末尾直接接 `topOfTower`；remi 在场与否的对话页差异（念字条、计数器）由装配层按分支裁剪。
- `topOfTower` 中段「瑞米登顶」仅瑞米满级（塔楼表层关键剧情全触发）时演出；独行变体见 `TOP_OF_TOWER.md`（待写）。
- `topOfTower` 末尾 `$finalKeyChoice` 为**玩家选择**：拒绝 → `towerTopRefuse` → `endingA`；
  交出钥匙（心软）→ `remiFlee` → `$unlockTowerBase`。
- `towerBase`：remi 先冲下塔基被擒、钥匙易手、程序对 remi 漠不关心（"优先级：低"）；
  骑士**独自**清过超标怪（此段无 remi 对话），冷却液河边重逢（温情解禁第一场）后进入最终战 B。
- `$finalBossBResult`：战败 → `endingB`；战胜（两形态）→ `towerBaseC` → `$endingCSequence` → `endingC`。
- 三结局的 `$rollCredits` 共用制作组名单；结局标题页（白月 / 离开 / 星星）可用 `image` 步骤加标题 CG 实现。
- `> 幕间｜` / `> 音乐｜` 为侧写占位标注：幕间落为 `image` / `wipe` / `fade` 步骤或舞台动效；
  音乐建议以 `{ type: 'call', fn: '$music:<cueId>' }` 钩子接入，等音效资源到位后由装配层统一绑定。
