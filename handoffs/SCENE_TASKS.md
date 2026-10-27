# SCENE_TASKS — 场景生成/改进顶层任务分解

> 状态：v1（2026-08-28）。管线契约见 `SCENE_PROP_WORKFLOW.md`（先读它，本文的任务卡
> 默认遵守其全部禁令）。执行者标注：**[主会话]** = 契约/架构改动，flash 不做；
> **[flash]** = 按任务卡 + WORKFLOW §6.1 喂料模板批量产出；**[联合]** = 主会话搭壳，flash 填肉。

## 总目标

保持 lowpoly 风格，尖塔各章节出现风格迥异的房型，Boss 房有专属布光与布景；
道具生产管线化（契约测试 + 陈列页双门），并为纯前端交互模板（WORKFLOW §5）预留槽位。

## 分期总览

| 期 | 内容 | 执行者 | 出口标准 |
| --- | --- | --- | --- |
| P1 | propKit 落地 + 契约测试 + 陈列页 | 主会话 | kit API 冻结，3 件范例资产过全部门 |
| P2 | 种子道具 15~20 件铺满五大类 | flash | 全部过双门并登记 |
| P3 | 房型配方层 + 章节 palette + 布光预设 | 联合 | 2 个普通房型 + 1 个 Boss 型差异肉眼可辨 |
| P4 | run 层接线（chapter/boss → 场景）+ 转场验收 | 主会话 | 爬塔实际走到不同章节见到不同房间 |
| P5 | 交互行为模板（PropAgent + behaviors 目录） | 主会话搭壳 / flash 填参数 | 旗帜/碎瓶/熄灯三类样板可用 |

---

## P1 — propKit 落地 [主会话]

> kit 是契约本体，API 冻结前不交 flash。以下任务卡是主会话的实现规格。

### T1.1 调色板与材质族
- 产出：`kit/palette.js`（token 按 dungeon/boss/chapterN 分组，含 `shade(c,k)`）、
  `kit/materials.js`（stone/wood/metal/glass/cloth 五族共享材质，flatShading + 顶点色）。
- 收敛：dungeon3D 现有散装材质（matFloor/matSlab/matWall…）迁入族内，老场景表现不回退
  （对比截图验收）。

### T1.2 图元与修饰器
- 产出：`kit/primitives.js`：`box/cyl/cone/prism/lathe/sphereLo/plate`
  （`{ color(P.*), size, seg }` → 烘好顶点色的 Mesh）+ `tilt/jitter/chip/mirror`。
- 验收：单件范例资产（见 T1.4）≤ 30 行。

### T1.3 撒布与合并
- 产出：`kit/scatter.js`（`createRng` 确定性 + battleLine/slots keepout）、
  `kit/merge.js`（BufferGeometryUtils 封装，静态合并、带行为者排除）。

### T1.4 契约测试 + 陈列页 + 3 件范例资产
- 产出：`test/sceneProps.test.js`（WORKFLOW §7 全项；**fs 扫描 props/ 目录自动发现，
  过门与登记解耦**——多代理并行生产时互不相扰）、`propGallery.html`
  （`src/debug/propGallery.js`，网格陈列 + id 标签 + palette 主题切换）、
  范例资产 `bottleRack` / `rubblePile` / `wallTorch`（各代表家具/瓦砾/墙饰一类，
  作为 flash 的模仿母本）。
- 验收：`npm test` 全绿；陈列页浏览器过目；范例成为 WORKFLOW §6.1 的固定喂料。

## P2 — 种子道具批量生产 [flash]

> 待生产资产总清单（85 件、按摆放类分类、含剪影描述与批次划分）见 `SCENE_PCG_CATALOG.md`。
> 每任务卡 = 一次喂料会话。全部走：产出 → `npm test` → 陈列页验收 → 登记。

### T2.0 骨架批（每类 2~3 件验证类契约）
- 清单 §5 批 1：#9 立柱 / #14 基座 / #33 陶瓮 / #37 烛台立架 / #48 小瓦砾堆 /
  #61 半壁柱 / #71 壁装火把——打通"柱→柱顶瓶→火把"宿主链全链路。

### T2.1 容器与家具（清单 #24-#47，24 件）
- 通用装饰类：桌凳柜桶瓶架箱囊床砧——量最大，flash 主战场。
- tags/footprint 档位/宿主（floor/柱顶/顶挂）按清单条目执行。

### T2.2 地板装饰全量（清单 #48-#60，13 件）
- 撒印类：瓦砾/苔斑/裂纹/血渍/散骨/法环——低风险高密度填充。

### T2.3 墙面结构 + 墙面装饰（清单 #61-#85，25 件）
- 立面表现力：半柱/浮雕/壁龛/壁炉 + 火把/挂旗/油画/挂盾。
- 布光职责（✦）资产只声明"有火"，光源参数走 lighting 预设（清单 §6）。

### T2.4 墙体与地板 style（清单 #1-#8、#19-#23，13 件）
- 随 P3 房型配方联调（style 决定整房砖石语言，放批 5）。

### T2.5 变体参数化回填（贯穿）
- 对已验收资产补 `build(opts)` 变体参数（高度/倾角/缺口），同族不再新增文件。

## P3 — 房型配方层 [联合]

### T3.1 composeRoom 骨架 [主会话]
- 产出：`rooms/composeRoom.js`（墙型开洞/地面样式/撒布规则/布光/雾参数的组装器）
  + `rooms/presets.js`（命名预设）。

### T3.2 章节主题预设 ×2 + Boss 预设 ×1 [flash 按预设格式填参数]
- 普通型 A（第 1-2 章基调：灰蓝石 + 稀疏瓦砾 + 火把暖光）；
  普通型 B（第 3-4 章基调：更深色岩 + 家具密度升高 + 冷月光）；
  Boss 型（血色侧逆光 + 大件断柱 + 道具稀疏而巨大 + 雾加重）。
- 验收：三型并列截图，氛围差异肉眼可辨；战场 keepout 无一违例。

### T3.3 布光预设库 [主会话]
- 产出：`rooms/lighting.js`：torch/moon/boss-rim 三预设（现 dungeon3D 的点光/
  吊灯光参数迁入），flicker update 挂到统一 update 循环。

## P4 — run 层接线 [主会话]

- `scenes/index.js`：`getScene` 支持 `chapterOf(floor)/isBossFloor` → recipe；
- runFlow/enterBattle 传场景选择参数；BattleStage 构造按 recipe 建 3D 场景；
- 验收：同一存档连续爬塔可见房间变化；Boss 层布光生效；`npm test` 全绿。

## P5 — 交互行为模板 [远期]

### T5.1 PropAgent 骨架 [主会话]
- 场景级管理器：订阅 frontendBus anim 事件 + 本地 shake 信号 → 空间分发
  （半径/冷却/抖动/强度阈值）→ 道具 behaviors；tick 与 dispose 收养（kill tweens）。
- 契约测试：模拟事件 → 断言行为触发/冷却/半径过滤。

### T5.2 行为模板三件套 [主会话]
- `B.flutterOnImpact`（挂旗）、`B.shatterOnBlast`（脆性容器，切 broken 变体 + 碎屑）、
  `B.lightExtinguish`（火把熄灭 + 烟）。dungeon3D 现有火把闪烁逻辑迁入
  `B.torchFlicker` 作为第四件。

### T5.3 道具侧参数化挂载 [flash]
- 对已登记资产按 tag 补 behaviors 声明（纯参数，如
  `B.shatterOnBlast({ debris:'pottery', radius:1.5 })`）；语义分类表
  （defId → 'blast' 等，WORKFLOW §5.2 路径 1）由主会话维护。

---

## 横切约定（所有任务卡通用）

- 每张任务卡完成后：`npm test` 全绿 + 陈列页/场景页截图给用户过目，两者缺一不算完成。
- 登记一律显式 import（props/index.js、rooms/presets.js），禁 import.meta.glob。
- 提交粒度：一资产一提交（`feat(scene): 道具 xxx`），配方层一类一提交。
- 视觉调参（光照强度/粒子量/摆幅）不写测试断言，浏览器验收为准。
