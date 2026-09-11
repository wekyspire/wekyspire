# 休息阶段房间的 PCG 方法设计（2026-09-11）

> 状态：**方法定稿 + 第一间房（赌厅 `casino`）已实现**，视觉在 `restGallery.html` 迭代中。
> 主流程接线（runController 切场景 + 面板叠加/锚点对位）**下一阶段**做。
> 相关契约：`SCENE_PROP_WORKFLOW.md`（道具生产管线）、`SCENE_PCG_CATALOG.md`（红线摆放法）、
> `SLOT_MACHINE.md`（老虎机/银行机玩法）、`THREE_UI_MIGRATION.md`（面板 Three 化）。

## 1. 目标

休息阶段（奖励房）目前是**纯 UI 覆盖塔楼/战场背景**。本次把休息房也纳入既有 PCG 配方范式：
同一个 `composeRoom(recipeId, seed)` 产出房间几何，由前端按 room 类型切换场景
（战斗房 → 现有四阶段配方；休息房 → 新配方族），面板仍走 `panelSnapshot` + `dispatchPanelIntent`
（UI 是覆盖层，不塞进 3D）。

第一间房是**老虎机 + 银行机同处的赌厅**（`SLOT_MACHINE.md`：二者成对出现），配方 id `casino`。
古尔帕斯之店（35 层）与售货机层是后续同类房间，走同一套方法。

## 2. 休息房配方与战斗房配方的差异（方法层）

| 维度 | 战斗房（fortress/palace/manor/library/boss） | 休息房（casino/…） |
| --- | --- | --- |
| 构图约束 | **中景留空**：战线走廊（`battleLine`/`slots` keepout）不许摆件，保证单位站位与瞄准可读 | 无战线约束；改为**视觉焦点带**（中景偏上放核心设施）+ **UI 安全区**（画面下方留给面板，密度压到最低） |
| 核心物件 | 无（房型是背景） | **交互设施**（老虎机/银行机/柜台）——固定落位、朝向相机、体量放大（`guaranteed` + `scale`） |
| 交互契约 | 无 | 配方声明 `anchors`（设施位置/朝向 + UI 安全区比例），随 `getRoomScene` 下发 |
| 布光 | 月光/火把主导（有窗有光束） | **无窗室内**：月光几乎为零，亮度交给**设施自发光灯池**（`lamp` 通道，见 §3）与少量烛台 |
| 相机 | 战斗机位 | 暂与战斗**同一机位**（不另设）；后续如需贴脸看机器再加 `cam` 字段 |

**不变量（沿用生产线铁律）**：只住 Stage 层、无纹理/外部模型、颜色只走 `palette` token、
`composeRoom` 仍是「配方声明要什么 + 红线法决定怎么摆」的单一实现。

## 3. 新增机制

### 3.1 `lamp` 通道（自发光体 → 无火焰点光池）

- 既有 `lightSource`/`fire` 标签会生成**点光 + 火焰粒子**（火把/烛台语义）。
  机器不该冒火，故新增 `lamp` 标签：`composeRoom` 收集 `lampAnchors`，
  `lighting.createLighting(key, fireAnchors, lampAnchors)` 为其生成**点光池**（不生成火焰、不投影、无闪烁）。
- 处方字段：`preset.lamp = { color, base, dist, cap, colors? }`（缺省则不生成任何灯池——旧配方零影响）。
- **锚收集范围 = 全部摆位**（撒布/角簇/立面/`guaranteed`）。早期只在 `guaranteed` 里收集，
  等于"只有配方定点件才能出灯池"——墙面彩灯串这类撒布件声明了 `lamp` 也不发光。
- **锚高度口径**：落地件取体量上段（`y + min(h·0.7, 6)`）；**墙挂件取自身包围盒中心 + 向室内推
  `LAMP_WALL_PUSH = 4.5`**。挂件从挂点向下垂（彩灯串/吊灯），用落地口径会把光池放到挂点上方；
  而贴墙的灯池（灯珠离墙 ~1）会在墙上打出爆白的彩色斑——推离墙面才是柔和的氛围光。
- 资产侧可选字段：
  - `lampGain`（乘在 `base` 上）：外围小灯（彩灯串）用它压低光池，别抢机器灯池与中央光。
  - `lampColor`：该件的灯池颜色（不写则走 `preset.lamp.colors` 轮转 / `preset.lamp.color`）。
- **颜色轮转**：`preset.lamp.colors` 按**锚的 gain 降序**轮转（`composeRoom` 先排序），
  前几位必然留给 `gain = 1` 的机器，彩灯串（`gain < 1`）拿后面的彩灯色。
- 资产侧职责：机器自带 `unlit` 族发光面（转轮窗/屏幕/灯牌），并声明 `lamp` 标签。
  ⚠ 但**要被追光照亮的部分不能是 unlit**（unlit 不吃光，恒定亮度）——见 §3.5。

### 3.2 `guaranteed` 支持 `scale`

构图定点件原先固定 `scale=1`，而休息房的核心设施需要放大（相机不动靠体量撑场面）。
`{ id, x, z, ry, scale }` 现在会同时作用到几何与红线占位（`claim` 按缩放后的 footprint）。

### 3.3 交互锚点契约（`anchors`）

```js
// presets.js 的休息房配方
anchors: {
  slot:    { x: -12.5, z: -44, ry: 0.14 },   // 设施：世界坐标 + 朝向
  bank:    { x:  12.5, z: -44, ry: -0.14 },
  counter: { x: 0,     z: -47, ry: 0 },
  uiSafe:  { bottomRatio: 0.42 },            // UI 安全区：屏幕下缘起的比例
}
```

`getRoomScene(recipeId, seed)` 现在把 `anchors` 一并返回（战斗房为 `undefined`，行为不变）。
主流程接线阶段据此做三件事：① 3D 侧把机器高亮/脉冲与面板按钮对应（点击机器 = 触发同一 intent）；
② 面板布局避开 `uiSafe` 带；③ 相机/取景沿用战斗参数（必要时后续加 `cam` 覆盖）。


### 3.4 可动组件与交互层（用户定 2026-09-11）

老虎机/银行机不是静态陈设，而是**场景中有复杂动画的可动组件**（后续同类：售货机、
古佩·诗菲商店、部分剧情房——数量少，逐个单独开发）。

**可动件契约**
- 道具 `build()` 在返回的 Group 上挂 `userData.parts`（`body` / `leverPivot` / `reels[]`
  / `bulbs[]` / `screen`…）与 `userData.interactive = 'slot' | 'bank'`。
- 配方 `guaranteed` 条目加 `live: true` → `composeRoom` **不把它并入静态合批**，
  放进 `liveRoot` 并登记到 `room.interactives`（`Map<name, { object, parts, kind, x, z, ry, scale }>`）。
  静态件仍整体合批（`live: true` 只给需要逐帧驱动的件）。
- 动画驱动在 `stage/scenes/interactive/*Rig.js`：**纯 Stage 层**（不读 Core/Bridge），
  输入只有「拉杆时给定的结果」（调用方从 Core 拿）：

```js
const rig = createSlotMachineRig({ object, parts });
rig.setHover(true);
rig.pull({ tier: 'major', symbols: [0, 2, 4] });   // 后端在拉杆瞬间已定结果
rig.update(dt);                                    // 宿主逐帧驱动
```

**老虎机反馈分层**（用户定，细节见 rig 顶部注释）
| 层 | 表现 |
| --- | --- |
| 常驻 | 机体微微抖动（"活着"）+ 彩灯缓慢呼吸；**追光怼脸时抖动压到 ~1/3**（`setFocus`）<br>——近景里同样的位移看起来剧烈得多（用户报障），且 idleAmp 本身也从 0.018 降到 0.012 |
| hover | 机体轻微上浮放大 + 彩灯提亮 |
| 拉杆 | 拉杆快速拉下 → **缓慢弹起**（弹性回位）；三点亮起同步起转 |
| 转轮 | **四段时序、全程 C1 连续**：① 起转加速 → ② 长匀速（2.7~3.5s，中间轮最久）→ ③ 指数减速<br>（末速收到 ~4% = "将停未停"地缓缓蹭过去，即自然停下会卡在两格之间的悬念）→<br>④ **卡入位**：阻尼弹簧把已冲过槽位 0.2rad 的鼓拉回来（带回滚+微过冲，读作机械卡销咬合）。<br>锁定次序 **左右先、中间最后**，落槽瞬间有"咔"式小弹跳；待机时三根各停在**不同图案面**上（不设初始角<br>会把两带接缝摆在付款线上，半红半金很假）。参数与推导见 rig 文件头的 `planReel/angleAt` |
| 中奖 | 彩灯按档位分级：小奖=跑马灯，大奖=跑马+全亮爆闪；大奖另加**机体激动抖动**（幅度/时长按档位） |

**彩灯与正面图案**（用户定 2026-09-11："小灯泡浮空、正面细节不够、多来点彩灯和条纹"）
- 一圈 14 颗彩灯**挂在压边框上**（沿框中心线矩形排布、球心嵌进框体）——早期悬在窗口前 0.42
  处无依托，近景就是一圈浮空的球。
- 逐颗颜色不同：色相登记在 `userData.tint`（资产侧 `RING_TINTS`），rig 的呼吸/中奖灯效按该底色走。
- 正面图案：立柱红金双细线、窗口下方金粗+红细双横线、额头金带 + 红菱形徽记（怼脸时最大留白）。
  ⚠ 网格数已顶到 `interactive` 预算 60（现 59），再加件必须同时删件。

**银行机**（克制型，SLOT_MACHINE.md：老虎机慷慨、银行机吝啬）：常驻指示灯呼吸 + 屏幕微亮浮动；
`act('deposit'|'withdraw'|'overdraft')` → 屏幕闪亮 + 扫描线扫一次 + 指示灯追逐（颜色区分存/取）。

**交互层**（进入房间后）
- 机器上方**跳动的三维浮标**（菱形 + 竖直光柱，远景可读）+ 地面光环（hover 提亮）。
- hover → 命中机器/浮标即高亮（rig.setHover + 光环）。
- 点击 → **相机推到该机器屏幕前**（按整机包围盒 + 相机 fov 反算距离取景）+ 下方出现交互条
  （老虎机「拉杆」、银行机「存钱」「取钱」；`Esc`/「返回房间」复位）。
  - **老虎机**：贴到屏幕前（接近怼脸），但**必须留住侧面拉杆**——按"屏幕尺寸 + 拉杆尖端外扩"
    算所需半宽/半高（`margin 1.32`，1.3 左右是不出框的极限）。
  - **银行机**（无拉杆件）：**整机入画**（`margin 1.12`，读作"走到机器前"）——怼屏幕只剩一块色板，
    而机身上 2/3 段又太近（正面是一大片平壳）。下方 42% 会被交互面板盖住，正好。
- 游戏内这一层会换成正式面板（`PanelObject` + `ButtonObject`）与 `Picker` 拾取；
  本轮先在 `restGallery.html` 用 DOM 做交互原型（`?tier=` / `?symbols=` 可强制结果做视觉验证）。

### 3.5 聚焦布光（zoomin 追光，用户定 2026-09-11）

"zoomin 时压暗背景、把机器屏幕照亮"——布光不是静态预设，得知道**当前在看哪台机器**：

```js
// lighting.js 返回的句柄（composeRoom 随契约下发为 room.lighting）
lighting.setFocus(screenWorldPos /* Vector3|null */, { strength: 1 });
// update(dt, particles, camPos) 在 focusK 上缓动：
//   · 外围光池（环境/月光/补光/反弹/中央光/lamp 灯池/烛火）统一乘 (1 - focusK*dim)
//   · 另开一盏"观众侧补光"落在 target↔相机连线上（相机方向 offset 处）
```

- 处方字段：`preset.focus = { color, base, dist, offset, dim, rise, lift }`——缺省有兜底值，
  别的预设调用 `setFocus` 也能用（`dim` 是压暗上限，`rise` 是收敛速度 1/秒，
  `lift` 是补光相对屏幕中心的抬高比例——**只能很小**，抬多了变顶光、正面屏幕反而照不亮）。
- **光心就落在屏幕中心**（不加抬高）；`casino` 定数：`base 1000 / offset 14 / dist 70`——
  贴太近整面洗白、太远（+dist 大）会把整间大厅重新点亮。
- 相机位置经 `update(..., camPos)` 传入（观战/无相机路径传 null → 补光落在 +z 侧兜底）。
- rig 侧同步 `setFocus(true|false)` 抑制机体抖动（同一件事：怼脸时屏幕上的一切位移都放大）。
- **屏幕/灯珠这类"自己会亮"的面用 `unlit` 没问题（不吃光）；但被追光照亮的主体（如老虎机转轮鼓）
  必须走吃光族**（`M.stone`），否则追光打在屏幕上毫无反应，怼脸看仍是恒定亮度的色块。

## 4. 赌厅 `casino` 配方（第一间房）

- 房间：`room.scale 0.86`（空间收缩、背墙拉近）、地面平整（机器/桌椅要站得稳，地形特征全关）、
  无窗室内（`wall.windows: []`，只留一道高窄缝）。
- 布光（用户定 2026-09-11：**外围光再压、亮度靠中央光撑**，暖调华丽 vs 残破四周）：
  - 主亮源 = **中央暖金光池** `centerFill = [0xffc87a, 5600, 180]`（吊灯位）；
  - 第二层 = 机器灯池 `lamp = { base 4200, dist 140, cap 8, colors 轮转 }`（机器暖金、彩灯串各色彩灯色）；
  - 其余全退成暗底：`hemi 0.38 / moon 0.06 / fill 0.04 / bounce ↓ / battleGlow 2200 暖金 / fire.cap 4`；
  - 调色：`grading { exposure 1.1, tint [1.07, 1.0, 0.93] }`（暖）、`fog 0x1b1219`（暖暗雾）。
- 构图：`guaranteed` = 老虎机(-12.5,-44,×2.0) + 银行机(12.5,-44,×2.7) + 柜台(0,-47) + 两凳 + 两钱箱 +
  两张赌桌（±27,-50，各两凳）+ 两张地毯（机器前的"赌位"）。
- 撒布：家具/居室权重高（桌椅镜帘），中景 `density 0.34`，**前景带压到 0.04–0.05（UI 安全区）**；
  撒印以金币为主（`coinScatter`，`count 22`）。
- **彩灯串 `festoonLights`**（用户定"简陋的小彩灯"）：`wallDecor` 道具，立面 `festoon: 3.2` 高权重；
  松垮电线 + 9 颗彩灯泡（间距不均、两颗坏的不亮），`unlit` 提亮 30% 表达"亮着"，
  `lampGain 0.2`（光池只机器的一小截）。它与墙面的剥落/咬口、乱堆的破箱子构成戏剧对比。
- **老虎机开窗**（2026-09-11 修）：柜体不再是"一整块箱子 + 画在正面的假窗口"——
  改成上/下横梁 + 左右立柱围出**真开口**，鼓退到开口后方（真凹腔），暗背板才是屏底；
  开口高度取 `bodyH * 0.19`（**明显小于鼓直径 `0.9`**）→ 只看见正前那一格图案 + 极窄的邻格边，
  读作单线机（开口 ≥ 鼓径会让整根鼓露出来，读作三行机；开口过高则每根鼓只剩一条竖条）。

## 5. 迭代流程（视觉门）

```bash
npm run dev
# 休息房陈列页（含 UI 安全区带 + 锚点标记）
open http://localhost:5177/restGallery.html?recipe=casino&seed=demo
```

- 旋钮：`?seed=` 换布局 ｜ `?ui=0|0.55` 安全区比例 ｜ `?anchors=0` 关锚点标记 ｜
  `?orbit=1` 鼠标自由旋转/缩放 ｜ `?nocomposer=1` 关体积光 ｜
  布光同 roomGallery：`?hemi=&moon=&fill=&ba=&bb=&glow=&glowd=&cf=&cfd=&fire=&fired=&lamp=&lampd=`
  ｜焦点追光：`?fbase=&fdim=&foff=`（配合 ?orbit=1 点机器进入 zoomin 看效果）
  ——**调参先在页面 A/B，定数再焙进 `presets.js`/`lighting.js`**。
- 控制台句柄（迭代视觉免去拖 canvas）：`__focus('slot'|'bank')` / `__unfocus()` /
  `__pull({tier,symbols})` / `__rigs` / `__orbitTo(x,y,z,dist,az,el)`（直接落机位看局部）。
- 契约门（headless）：`test/roomPcg.test.js`（确定性/keepout/不重叠/契约）+ `test/sceneProps.test.js`
  （道具契约按 fs 自动发现）；新增配方与道具都会被自动纳管。

## 6. 已知待办（下一阶段）

1. **主流程接线**：`runController` 在 `gameStage === 'room'` 且 room 类型有休息房配方时切到该 PCG 场景
   （复用 `getScene('pcg:casino', seed)`），并让 `MapStage` 的面板叠加在同一 canvas 上；
   `restRecipeFor(roomType)` 已备好映射（`slot → casino`）。
2. **机器可点**：按 `anchors` 注册 Pickable，点老虎机 = 打开/聚焦转轮面板，点银行机 = 聚焦存取款区。
3. **更多休息房**：售货机层（`vending` 房）、古尔帕斯之店（`gurpas` 房，35 层固定）——同方法换配方。
4. **视觉继续**（2026-09-11 已完成一轮：暖调重配比 + 彩灯串 + 追光 + 老虎机真开窗/吃光滚轴）：
   剩余 = 中奖灯效档位再调、转轮面换成真纹理（`drumGeometry` 走 UV 就能接美术）、浮标造型、
   赌桌区细节（筹码/酒杯/账本）、`uiSafe` 比例与面板实际高度对齐后再定稿。
