# SCENE_PROP_WORKFLOW — 场景素材生产管线与交互模板扩展设计

> 状态：定稿 v1（2026-08-28）。本文档是场景素材（lowpoly 道具/房型）生产管线的单一事实源，
> 配套任务分解见 `SCENE_TASKS.md`。目标执行者：AI 代理（GLM flash 批量产出道具，
> 主会话/人工维护 kit 与契约）。

## 0. 目标与边界

在保持 lowpoly（顶点色 + flatShading、无纹理）风格的前提下，大幅提升场景表现与多样化：
尖塔不同阶段有不同风格的房间（章节主题），Boss 房有特殊布光与布景。为此建立：

- **propKit**：场景搭建工具库（材质/调色板/图元/撒布/合并）——一切资产的依赖项；
- **props 资产库**：小件 lowpoly 道具（瓶罐/瓦砾/碎石/家具/墙饰…），代码即资源；
- **rooms 配方层**：房型 = 墙型 + 撒布 + 布光 + 雾/后期参数，章节/Boss 换配方；
- **PropAgent（预留）**：纯前端交互层——道具对战斗演出事件的环境反应（见 §5）。

**边界（铁律）**：
- 一切只住 Stage 层（`src/stage/scenes/`），禁止 import Core/Bridge 内部逻辑；
  交互层只读 frontendBus 的 anim 事件流（表现事实通道，见 §5.1）。
- 不引入纹理、UV、外部模型文件（GLTF 仅作为未来导出/互换的后备路径，不是输入路径）。
- 不影响后端结算。任何"想让道具知道游戏语义"的需求走 §5.2 的两条白名单路径。

## 1. 分层总览

```
src/stage/scenes/
├── kit/                    # propKit：契约本体（主会话/人工维护，flash 禁改）
│   ├── palette.js          # 调色板 token（唯一合法颜色来源）
│   ├── materials.js        # 共享材质（flatShading + 顶点色，按 roughness/metalness 分族）
│   ├── primitives.js       # 图元快捷件（box/cyl/prism/lathe/…，顶点色烘焙）
│   ├── scatter.js          # 种子化撒布（createRng，确定性变体）
│   ├── merge.js            # 静态几何合并（BufferGeometryUtils 封装）
│   └── behaviors.js        # 交互行为模板目录（§5，Phase 5 前只有骨架）
├── props/                  # 道具资产（flash 产出区）：一文件一资产
│   ├── index.js            # 显式 import 登记（沿用 content/index.js 约定，禁 import.meta.glob）
│   └── bottleRack.js …
├── rooms/                  # 房型配方（composeRoom + 预设）
└── index.js                # getScene 扩展：chapter/boss → room recipe
```

## 2. propKit API 契约（草案，Phase 1 落地时回填实签）

### 2.1 调色板（palette.js）

- 颜色一律经 token 引用：`P.stone / P.woodDark / P.potionGreen / P.bossBlood …`，
  token 按**主题分组**（`P.dungeon.*` / `P.boss.*` / `P.chapter3.*`）——换主题 = 换 palette 组，
  这是章节换肤与 Boss 房变色的实现机制。
- **资产内禁止裸 hex**（`0xff0000`/`'#fff'` 均不允许），只许 `P.*` 或对已有色的
  `shade(c, k)`（明暗微调，k∈[-1,1]）。契约测试静态扫描此禁令。

### 2.2 材质（materials.js）

- 现状锚点：dungeon3D 每部件一个 MeshStandardMaterial（flatShading）。kit 收敛为
  **按表面属性分族的共享材质**（stone/wood/metal/glass/cloth，roughness 与 metalness 分档），
  颜色画进**顶点色**（`vertexColors: true`）——同族道具合并后一个 draw call。
- 顶点色写入是图元层的职责（primitives 统一烘焙），资产代码不直接摸 material。

### 2.3 图元（primitives.js）

高层快捷件（返回已烘焙顶点色的 Mesh/Group）：
`box / cyl / cone / prism / lathe / sphereLo(segments) / plate`，
统一参数 `{ color, size, seg }`；修饰器 `tilt / jitter / chip(缺角) / mirror / scaleXYZ`。
目标：**单件资产 = 10~30 行图元组合**，接近声明式。

### 2.4 撒布（scatter.js）

`scatter(rng, { count, area, avoid: [keepout], onGround, tiltAmp })`——确定性：
同一房间种子恒定产出同一变体布局。keepout 必含 `battleLine` 与全部 `slots`
（道具永远不许进战场/站位）。

### 2.5 合并（merge.js）

静态道具按房间 merge（世界变换烘焙进顶点）；**挂了 behaviors 的道具不参与合并**
（数量少，独立成 draw call 换可动性）。

### 2.x 可动组件（interactive）的预算例外（2026-09-11）

带 `interactive` 标签的件（老虎机/银行机这类**场景可动组件**，由配方 `live: true` 排除出静态
合批、注册进 `room.interactives` 供 rig 逐帧驱动）网格预算放宽到 **60**（静态件仍为 40）：
- 理由：40 的口径来自"合批后静态几何的成本"，而 live 件根本不进合批，且数量极少（当前 2 件）；
- 代价：live 件是独立 draw call，数量增长时要重新评估；
- 自建材质仍**禁止**（逐帧改色的需求由 rig 侧把材质独立化，资产只出 kit 图元 + `animRole`）。

## 3. 道具资产契约

一文件一资产，ESM 默认导出：

```js
// src/stage/scenes/props/bottleRack.js
import { P, K, B } from '../kit/index.js';

export default {
  id: 'bottleRack',                       // 与文件名一致（camelCase）
  place: 'prop',                          // 摆放类：roomWall/smallWall/floor/prop/
                                          // floorDecal/wallStructure/wallDecor
  tags: ['furniture', 'container', 'brittle'],   // 撒布筛选 + 未来行为路由（§5）
  footprint: { x: 4, z: 2 },              // 世界单位占地（keepout 用，宁大勿小）
  // place 派生字段见 SCENE_PCG_CATALOG.md §2：mount/bayWidth/band/topY
  build(opts = {}) {                      // → THREE.Group；opts 含 rng/变体参数
    const g = new THREE.Group();
    // …图元组合，只用 P.* 颜色…
    return g;
  },
  behaviors: [],                          // §5 预留槽位（Phase 5 前保持空数组）
};
```

**登记**：`props/index.js` 显式 import + 注册表登记（同 content/index.js 约定）。
`mount` 可为单值或数组（目录双宿主条目如 `mount: ['floor', 'smallWallTop']`，
契约测试两者皆收；`band` 同理支持数组，见 CATALOG §2）。

**预算**（契约测试常量，初期值）：单件 ≤ 40 个 Mesh（合并前）、顶点数 ≤ 3000、
材质族 ≤ 3。超预算 = 拆资产或简化，不是调大常量。

**footprint 档位口径**（批2 裁定）：S/M/L/XL 是**选品参考**，`footprint` 数值才是
机器事实（契约测试只校验数值与实测范围）；长条家具（长案/长凳/床）按**宽度维**判档，
长度维可超档。纯 ceiling 顶挂件也声明 footprint（宁大勿小，防吊灯投影进人堆）。

**wallDecor 的 y 原点口径**（批4 裁定）：原点=墙面 z=0 的**挂点投影**。灯具/浮雕/挂画类
主体向上（原点近底缘），垂挂布旗类主体向下（原点=悬挂锚点，bbox 可为负 y）——两者并存
合法；P3 摆放器按 band 高度带 + 件内 bbox 计算落位，不依赖统一锚高。

**布光职责标签**（资产禁私设 `PointLight`，只声明语义，光参数集中在 `lighting.js`）：
`lightSource`/`fire` → 点光 **+ 火焰粒子**（火把/烛台）；`lamp` → **只出点光池**（机器/招牌/彩灯串，
不冒火、不投影、无闪烁）。`lamp` 件可选 `lampGain`（乘在处方 base 上，外围小灯压低用：彩灯串 0.2）
与 `lampColor`（该件灯池颜色；不写走预设 `colors` 轮转）。**要被聚焦追光照亮的主体不要用 `unlit` 族**
（unlit 不吃光，恒定亮度）——详见 `quest_prompts/SCENE_REST_ROOM.md` §3.1/§3.5。

**变体策略**：同类变体优先 `build(opts)` 参数化（高度/饱满度/倾斜），而非新资产文件。
"一次性"资产是库膨胀的头号来源，review 时警惕。

## 4. 房型配方层（rooms）

`composeRoom(recipe)`：recipe = 墙型（门/窗开洞参数）+ 地面样式 + 撒布规则列表
（tag 权重 + 密度 + 种子）+ 布光预设 + 雾/后期参数。章节主题 = palette 组 + 墙型 +
撒布权重的命名预设；Boss 房 = 专属 recipe（侧逆光/血色 palette/更稀疏但更大的道具）。
`getScene(id)` 扩展为 chapter/boss → recipe 映射；run 层接线只改一处。

**摆放算法 = 地块红线法**（功能分区 → 地块红线 → 沿街立面 → 撒印，含资产 `place`/
`mount`/`bayWidth`/`band`/`topY` 契约字段的推导），权威定义见 `SCENE_PCG_CATALOG.md` §1-§3。

## 5. 交互模板扩展（设计预留，Phase 5 落地）

> 需求原话：旗帜在附近单位受重击时被冲击撩起、爆炸类卡片震碎附近脆性容器、
> 火把光源受某些影响熄灭。**纯前端，不影响后端结算。**

### 5.1 触发源：现有表现事件流，零新通道

frontendBus 的 `anim:*` 事件已是"表现事实"通道，载荷可空间化：
`anim:damage`（目标 + dealt 量 → 重击撩旗）、`anim:effect` / `anim:unit-death` /
`anim:unit-spawn`、BattleStage 本地信号（`shake.impulse(severity)` 等）。
**PropAgent**（场景级管理器）订阅这些事件 → 载荷中的单位换算世界坐标 →
空间查询（半径/区域）→ 分发给登记了匹配行为的道具。分发带**冷却 + 随机抖动**
（一阵爆发不该同时撩起全场旗帜）与**强度阈值**。

### 5.2 游戏语义缺口的两条白名单路径（按此顺序）

1. **前端分类表**（默认）：Stage 侧 `defId → 交互类别`（'blast'/'fire'/'holy'…）查表。
   纯表现关切，零后端接触。
2. **bridge 载荷加字段**（仅当查表不够）：presenter 翻译层 additive 传字段
   （如 damage 事件带 tags）。这是 Bridge 协议扩展，不动 Core 结算。

### 5.3 行为模板（behaviors.js）：逻辑在 kit，参数在道具

契约三段 = **触发规则（事件选择器：事件名 + 载荷谓词 + 半径 + 冷却 + 强度阈值）
→ 响应方式（行为模板实例）→ 动画（prop 内 gsap/animateCustom 代码）**。

模板目录规划（kit 拥有实现 + 契约测试；道具只声明式实例化）：

| 模板 | 语义 | 典型挂载 tag |
| --- | --- | --- |
| `B.idleSway` | 环境待机摆动（布/链/吊挂） | cloth/hang |
| `B.flutterOnImpact` | 附近重击冲击撩起（幅度随强度） | cloth/flag |
| `B.shatterOnBlast` | 爆炸类事件震碎（切预建 broken 子节点 + 碎屑粒子） | brittle |
| `B.lightExtinguish` | 光源受条件熄灭（点光衰减 + 烟） | lightSource |

道具侧（flash 的活动范围）：`behaviors: [B.shatterOnBlast({ debris:'glass', radius:1.2 })]`
——**只写参数，永不写行为逻辑**。自定义行为闭包是主会话/人工领域。

### 5.4 状态与性能

- 状态性反应（熄灭保持、碎裂保持）由道具局部 runtime state 承载；场景重建即重置
  ——与"战斗间房间可变"天然对齐。
- 碎裂 = **预建 broken 变体子节点**切可见性，禁止运行时构网格；挂行为的道具不进
  静态合并；dispose 必须 kill 全部 tween（PropAgent 统一收养）。

### 5.5 从今天就免费的预留

资产契约带 `tags` 与 `behaviors: []` 槽位（§3 已含）；撒布按 tag 筛选。
日后启用交互 = 往 kit 加模板 + 道具填参数，**资产格式与生产管线零改动**。

## 6. 生产流程（flash 工作流）

```
[喂料] prompt 模板（§6.1）→ flash 产出单资产 ESM
  → [门 1] 契约测试（§7）headless 构建
  → [门 2] 陈列页浏览器视觉验收（用户）
  → [登记] props/index.js + 陈列页清单
  → [迭代] 不满意 = 改代码（资产是代码，微调即改几行）
```

### 6.1 喂料 prompt 模板（固定四件套）

1. **API 速查**：kit 的 palette token 表 + 图元/修饰器签名（一页）；
2. **范例**：2~3 个已验收资产全文（模仿远胜描述）；
3. **规格**：资产名 / tags / footprint / 剪影一句话（"三层的歪斜木架，每层两三只
   圆胖陶罐，一只缺口"）/ 用哪些 palette token / 变体参数建议；
4. **输出约束**：单 ESM 模块、只用 kit、禁裸 hex、禁 behaviors 填充、预算内。

### 6.2 批量策略

一次要"10 个瓶罐变体"（同族批量）远比"一间完整房"可靠。房间艺术方向是配方层
（人工/主会话定），flash 只填叶子道具。

## 7. 验收关卡与测试方针

- **契约测试**（`test/sceneProps.test.js`，headless，three 可在 node 建）：
  **以 fs 扫描 `src/stage/scenes/props/` 目录自动发现资产文件（未登记的也过门）**——
  过门与登记解耦，支持多代理并行生产互不相扰；断言：返回 Group、无 NaN、包围盒与声明
  footprint 匹配（容差）、网格/顶点/材质族预算内、静态扫描无裸 hex、
  （Phase 5 后）behaviors 全为 kit 模板实例。
- **交互契约测试**（Phase 5）：模拟 anim 事件 → 断言道具状态翻转/回调触发；
  视觉参数（撩起幅度、碎屑数量）一律不断言。
- **陈列页**（`propGallery.html` + `src/debug/propGallery.js`）：全部注册道具
  网格陈列 + id 标签 + 可选主题 palette 切换，浏览器过目即视觉验收。

## 8. 禁止事项清单（flash 必读）

1. 禁改 `kit/` 目录任何文件（契约本体）。
2. 禁裸 hex / 禁自建材质 / 禁 import three 之外的库。
3. 禁把道具放进 battleLine 与 slots 的 keepout 区域（撒布必须走 kit.scatter）。
4. 禁超预算（拆件或简化，不是调常量）。
5. 禁写行为逻辑（behaviors 只允许 kit 模板实例化，Phase 5 前保持 `[]`）。
6. 禁 import.meta.glob（登记走显式 import）。
7. 禁碰 Core / Bridge / Shell；禁新增网络请求与外部依赖。
