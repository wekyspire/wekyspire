# SCENE_PCG_CATALOG — 房间 PCG 摆放方法（地块红线法）与道具生产清单

> 状态：定稿 v1（2026-08-28）。管线契约见 `SCENE_PROP_WORKFLOW.md`，任务分解见
> `SCENE_TASKS.md`。本文档 = 摆放方法（§1-§3）+ 待生产资产总清单（§4，85 件）。
> flash 按分类批次领任务，喂料规格直接抄 §4 条目。

## 1. 摆放方法：地块红线法（城市规划隐喻）

核心思想抄城市规划：**功能分区（zoning）→ 地块红线（plots）→ 沿街立面（facade）→ 撒印（stamping）**。
摆放 = 逐层收缩的槽位占用问题，不是自由散布——确定性（房间种子）、不重叠、不进战场，
全部由层级结构保证。

### 1.1 L0 功能分区（Zoning）

房间（矩形舞台盒，相机 azimuth -34° 斜视）按下表分区，每区有自己的道具准入与密度权重：

| 分区 | 范围 | 准入 | 密度 |
| --- | --- | --- | --- |
| 战场区 | battleLine 走廊 ± slots 外扩 keepout | 仅 floorDecal（低平不遮脚） | 由配方定 |
| 边缘带 | 沿四面墙根 1 格进深 | prop / smallWall / floorDecal | 高 |
| 中景带 | 战场区与后墙之间（敌人身后的背景层） | smallWall / 大件 prop（稀疏大剪影） | 低 |
| 前景带 | 相机近端（手牌扇两侧以下） | 仅少量大剪影件（如前景拱门惯例） | 极低 |
| 墙面 | 四面墙 + 墙面结构 | wallStructure / wallDecor | 见 §1.3 |

**相机侧权重**：后墙（敌人身后）与左侧墙最可见 → 墙段密度最高；右侧墙中等；
近端墙（相机身后/强透视）基本不摆或只摆门。这是"城市化"的朝向逻辑——好街面留给立面。

### 1.2 L1 地块红线（Plots）

- 地板在准入分区内划分为地块（网格 + 手调锚点集），每地块按**footprint 档位**匹配资产；
  一地块一主物（prop / smallWall），占用即写红线。
- **宿主层级（host hierarchy）**：smallWall（立柱/基座/方墩）占用地块后，其**顶面成为
  新的宿主表面**——通用装饰可摆上柱顶/基座顶（`mount:'smallWallTop'`，如雕像基座上放双耳瓶）。
  宿主高度必须 ≥ 摆放物需求高度（资产声明 `topY`）。
- 顶挂（吊灯类）：天花板锚点（`mount:'ceiling'`），不占地块，按房间中心/构图点取位。

### 1.3 L2 沿街立面（Facade：墙段化）

每面墙切分为**墙段（bay，约 4~6 世界单位/段）**，段内分层占用：

```
墙段（bay）
 ├─ 开口（门/窗，消耗整段，由房型配方先占）
 ├─ 墙面结构 ×1（pilaster/浮雕/壁龛/壁炉——贴墙重合放置）
 └─ 墙面装饰 ×0..2（按高度带各一：高带/中带/低带）
     · 可挂在裸墙上或墙面结构上，同段同带互斥 → 天然不重叠
```

- 墙面结构声明占段宽（1~2 段）；墙面装饰声明**高度带**（高带 ≈ 挂旗/上画，中带 ≈ 火把/
  油画/挂盾，低带 ≈ 修补木板/壁烛）。
- 墙体本身（roomWall 类）由房型配方的墙生成器按 style 拼装——style 资产提供砖石语言，
  破洞/修补类结构在其上叠放。

### 1.4 L3 撒印（Stamping：地板装饰专用）

floorDecal 类**不走红线**：作为贴地层 + 矮堆直接按密度参数撒印（苔斑/裂纹/水洼是"涂料"，
碎石堆/散骨是"贴纸"）。撒印仍受战场 keepout 与相机视线约束，且**避让地块红线的主体根部**
（桌子底下不长碎石堆）。法环/血祭地纹等大贴印按构图点放置（通常战场区中心或 Boss 位）。

### 1.5 选品与确定性

- 每分区按配方权重（tag 加权）从注册表抽品 → 用 `createRng(roomSeed)` 驱动全程：
  同房间种子恒定同布局（回放/测试可复现）。
- 主题 = palette 组 + 墙 style + 各分区 tag 权重的命名预设（`SCENE_PROP_WORKFLOW.md` §4）。

## 2. 方法推导出的资产属性（契约新增字段）

摆放方法决定每件资产**必须声明**什么——这是清单能开出来的前提：

| 字段 | 取值 | 消费层 |
| --- | --- | --- |
| `place` | `roomWall / smallWall / floor / prop / floorDecal / wallStructure / wallDecor` | 分区准入 + 摆放器分派 |
| `mount` | prop 类：`floor / smallWallTop / ceiling`；wallDecor 类：`wall / wallStructure` | 宿主解析 |
| `footprint` | 档位 S(≤2) / M(≤4) / L(≤8) / XL(>8)，world units 宽度 | 地块匹配 |
| `bayWidth` | wallStructure 类：占墙段数（1~2） | 立面占用 |
| `band` | wallDecor 类：`high / mid / low` | 同段分层互斥 |
| `topY` | smallWall 类：宿主顶面高度 | 柱顶摆放准入 |
| `tags` | 含交互预留：`brittle / cloth / lightSource / fire` + 主题/材质 tags | 选品权重 + P5 行为路由 |

（`SCENE_PROP_WORKFLOW.md` §3 的资产契约代码块同步加上 `place` 字段。）

## 3. 分类摆放规则（用户六类，形式化）

1. **房间墙体 roomWall**：舞台盒四面墙本体。style 资产提供砖石语言与开口件（门/窗框），
   由墙生成器拼装；不与任何类"摆放"冲突（它是被贴的底）。
2. **小墙体 smallWall**：场景内大型独立物（立柱/雕像/屏风/巨石）。占地板地块，可作
   通用装饰的宿主（顶面）。
3. **地板 floor**：每场景唯一。style 资产（含变体参数），铺满地板平面。
4. **通用装饰 prop**：摆地板或小墙体顶面，互不重叠（地块红线保证）。桌/椅/瓶/桶/架。
5. **地板装饰 floorDecal**：地坛/碎石堆等，撒印层，不走地块，密度参数控制。
6. **墙面结构 wallStructure**：与墙体**重合贴放**（浮雕/半柱/壁龛），占墙段。
7. **墙面装饰 wallDecor**：挂墙/挂墙面结构上（画/火把/旗/修补板），段内高度带互斥不重叠。

## 4. 待生产资产总清单（85 件）

> 描述即剪影一句话（flash 喂料规格直接引用）。`档` = footprint 档位；
> tags 只列关键项（材质/主题 tag 产出时按 WORKFLOW §2.1 补全）。
> 标 ✦ 的带燃点/布光职责（`lightSource`/`fire`），✧ 的预留 P5 交互（brittle/cloth）。

### 4.1 房间墙体 roomWall（8 件）

| # | id | 名称 | 描述 | tags | 档 |
| --- | --- | --- | --- | --- | --- |
| 1 | brickWallStd | 标准砖墙段 | 齐整灰砖横缝，偶有错缝与深浅差 | wall,brick | — |
| 2 | brickWallWeathered | 风化砖墙段 | 缺角掉砖、砖色斑驳、缝里积灰 | wall,brick | — |
| 3 | stoneSlabWall | 大石板墙段 | 巨石不规则砌缝，庄重气派（Boss 房基调） | wall,stone | — |
| 4 | mossyWallSeg | 苔痕墙段 | 下半幅爬苔的砖墙，苔缘不规则 | wall,brick,moss | — |
| 5 | crackedWallSeg | 裂墙段 | 一道大裂缝斜穿墙面（可配修补木板） | wall,brick | — |
| 6 | windowGothic | 尖拱窗 | 石材尖拱+竖棂，透月光（开口件） | wall,opening | 1 段 |
| 7 | doorArchFrame | 拱门框 | 双层线脚石拱，战斗背景主视觉（开口件） | wall,opening | 2 段 |
| 8 | doorIronBarred | 铁栅门 | 半开的铁栅木门，栅缝透视深度 | wall,opening,metal | 1 段 |

### 4.2 小墙体 smallWall（10 件）

| # | id | 名称 | 描述 | tags | 档 | topY |
| --- | --- | --- | --- | --- | --- | --- |
| 9 | columnRound | 石立柱 | 圆柱身+柱头柱础，三段式 | stone,column | M | 高 |
| 10 | columnBroken | 断柱 | 半高断口斜茬，茬口粗粝 | stone,column | M | 中（可摆物） |
| 11 | columnCluster | 三柱组 | 高低错落三根，一根略倾 | stone,column | L | — |
| 12 | pillarSquare | 方墩塔 | 方柱厚墩，顶面平（柱顶摆物宿主） | stone,column | M | 中 |
| 13 | archRemnant | 拱门遗迹 | 两断柱顶残拱相连，藤蔓垂挂 | stone,ruin | L | — |
| 14 | statuePedestal | 雕像基座 | 高石基座带线脚（顶放雕像/瓶） | stone,pedestal | M | 高 |
| 15 | statueKnight | 骑士雕像 | 石甲骑士拄剑垂首，衣褶硬直 | stone,statue | M | — |
| 16 | stoneScreen | 石屏风 | 雕花立屏，三扇微折 | stone,screen | L | — |
| 17 | bookshelfTall | 高书架 | 顶天立地木书架，书脊横斜 | wood,furniture | L | — |
| 18 | boulderHuge | 巨石块 | 房间大的崩落岩块，一面平可贴墙 | stone,ruin | XL | 低（可摆物） |

### 4.3 地板 floor（5 件）

| # | id | 名称 | 描述 | tags |
| --- | --- | --- | --- | --- |
| 19 | floorStoneStd | 标准石板地 | 均质大方砖拼缝，缝深一致 | floor,stone |
| 20 | floorStoneBroken | 破裂石板地 | 起翘/缺失/裂纹变体参数 | floor,stone,ruin |
| 21 | floorMosaic | 马赛克地砖 | 拼纹彩砖，几何回纹（祭司/法师房） | floor,tile |
| 22 | floorRitualBlood | 血祭地纹 | 暗红沟槽法环刻线（Boss 房） | floor,ritual |
| 23 | floorWoodPlank | 木地板 | 拼板木地，板缝木色差（营地/休息） | floor,wood |

### 4.4 通用装饰 prop（24 件）

| # | id | 名称 | mount | 描述 | tags | 档 |
| --- | --- | --- | --- | --- | --- | --- |
| 24 | tableWood | 木桌 | floor | 厚板四腿，桌角磨圆 | wood,furniture | M |
| 25 | tableLong | 长案 | floor | 细长供桌，桌面留烛台位 | wood,furniture | L |
| 26 | stoolThree | 三脚凳 | floor | 三腿圆凳，凳面龟裂 | wood,furniture | S |
| 27 | benchWood | 长凳 | floor | 板面长凳，两端凳腿斜撑 | wood,furniture | L |
| 28 | chairHighback | 高背椅 | floor | 雕花木椅，椅背高耸 | wood,furniture | M |
| 29 | barrelWood | 木酒桶 | floor | 竖放铁箍桶，桶板微凸 | wood,container | S |
| 30 | barrelStack | 桶堆 | floor | 两竖一横叠，横桶略滚错位 | wood,container | M |
| 31 | crateWood | 木箱 | floor | 简板钉箱，箱角包铁 | wood,container | S |
| 32 | crateStack | 箱堆 | floor | 大小两箱叠放，上箱歪斜 | wood,container | M |
| 33 | vaseClay | 陶瓮 | floor/柱顶 | 圆胖大口陶瓮，肩宽带纹 | pottery,container,✧brittle | S |
| 34 | vaseTwinEar | 双耳瓶 | floor/柱顶 | 细颈双耳，釉色斑驳 | pottery,container,✧brittle | S |
| 35 | potionShelf | 药剂架 | floor | 三层格架，瓶色各异地摆 | wood,container | M |
| 36 | bottleRack | 瓶架 | floor | 斜靠酒瓶的木架，一只瓶倒 | wood,container,✧brittle | M |
| 37 | candleStand | 烛台立架 | floor/柱顶 | 多枝立式烛台，烛泪堆叠 | metal,✦lightSource,fire | S |
| 38 | candelabraFloor | 落地烛台 | floor | 高杆三枝，枝头蜡烛 | metal,✦lightSource,fire | S |
| 39 | chandelierChain | 吊灯 | ceiling | 链挂多枝环烛台，微斜 | metal,✦lightSource,fire | — |
| 40 | brazierFire | 火盆 | floor | 三足立式火盆，炭堆余焰 | metal,✦lightSource,fire | M |
| 41 | weaponRack | 武器架 | floor | 倚靠剑斧的木架，兵器交错 | wood,metal | M |
| 42 | armorStand | 甲胄架 | floor | 半身甲+立剑的木架 | metal | M |
| 43 | chestTreasure | 宝箱 | floor | 铁箍木箱半开，金币溢缘 | wood,container | S |
| 44 | chestLocked | 上锁箱 | floor | 平盖锁扣箱，锁头厚重 | wood,metal,container | S |
| 45 | sacksGrain | 麻袋堆 | floor | 三五软袋相叠，袋口扎绳 | cloth,container | M |
| 46 | anvilStone | 石砧 | floor | 矮平石砧，砧面凹磨 | stone | M |
| 47 | cotBed | 简陋床铺 | floor | 木框草垫，毯子半搭 | wood,cloth | L |

### 4.5 地板装饰 floorDecal（13 件）

| # | id | 名称 | 描述 | tags |
| --- | --- | --- | --- | --- |
| 48 | rubblePileSmall | 小瓦砾堆 | 碎砖小丘，混断木片 | rubble |
| 49 | rubbleScatter | 碎石带 | 长条散石，头密尾疏 | rubble |
| 50 | gravelPatch | 砾石斑 | 细碎石片滩，边缘融地 | rubble |
| 51 | tilesUplift | 起翘地砖 | 几块翘起碎砖，缺角错台 | rubble |
| 52 | mossPatchFloor | 苔藓斑 | 不规则苔块，深浅两层 | moss |
| 53 | cracksFloor | 地裂 | 分叉裂纹贴地，主缝宽 | decal |
| 54 | bloodStain | 血渍 | 暗红泼溅渍，边缘沉色 | decal,gore |
| 55 | boneScatter | 散骨 | 碎骨小堆，肋骨斜插 | bone |
| 56 | skullPile | 骷髅头堆 | 三五个叠放，眼窝深洞 | bone |
| 57 | coinScatter | 散落金币 | 十几枚金币洒地，微反光 | decal,metal |
| 58 | ritualCircle | 法环贴地 | 浅刻法阵圆环，符文点缀 | ritual,decal |
| 59 | puddleWater | 水洼 | 浅洼微反光，边缘湿深 | decal,water |
| 60 | strawBedding | 草垫铺 | 干草铺地，压痕散乱 | decal |

### 4.6 墙面结构 wallStructure（10 件）

| # | id | 名称 | 描述 | tags | 段宽 |
| --- | --- | --- | --- | --- | --- |
| 61 | pilasterHalf | 半壁柱 | 附墙半柱带柱头，线脚三段 | stone | 1 |
| 62 | reliefBattle | 征战浮雕板 | 骑士征战场面高浮雕，人物层叠 | stone | 2 |
| 63 | reliefSigil | 门徽浮雕 | 家族纹章圆雕，缎带环绕 | stone | 1 |
| 64 | alcoveNiche | 壁龛 | 拱顶凹龛，内置烛位（可摆小物） | stone | 1 |
| 65 | fireplaceBig | 壁炉 | 石框火塘，柴堆余焰 | stone,✦lightSource,fire | 2 |
| 66 | buttressWall | 扶壁 | 斜撑墙垛，压顶石 | stone | 1 |
| 67 | wallColumnStrip | 竖棱墙带 | 连续竖线脚浅浮雕 | stone | 2 |
| 68 | blindArcade | 盲拱连排 | 纯装饰拱洞三连，龛内阴影 | stone | 2 |
| 69 | wallGapRuin | 墙体破洞 | 塌落开口露黑，缘口挂渣 | ruin | 1 |
| 70 | bannerNiche | 挂旗龛 | 内凹旗位，上沿挂钩 | stone | 1 |

### 4.7 墙面装饰 wallDecor（15 件）

| # | id | 名称 | band | 描述 | tags |
| --- | --- | --- | --- | --- |
| 71 | torchWall | 壁装火把 | mid | 铁架火把，火苗锥形 | metal,✦lightSource,fire |
| 72 | torchSerpent | 蛇形火把座 | mid | 扭曲铁艺单托，托焰 | metal,✦lightSource,fire |
| 73 | sconceCandle | 壁烛台 | low/mid | 单/双烛铁托，烛泪垂凝 | metal,✦lightSource,fire |
| 74 | bannerLong | 长挂旗 | high | 垂地布旗，底缘撕裂 | cloth,✧ |
| 75 | bannerHerald | 纹章旗 | mid | 家徽方旗，双穗垂坠 | cloth,✧ |
| 76 | tatteredCloth | 破布条 | high | 残布三条飘挂，长短差 | cloth,✧ |
| 77 | paintingGrand | 大油画 | mid | 昏暗人物画，厚框深影 | wood |
| 78 | paintingTilted | 歪挂小画 | mid | 两三幅小画歪挂成组 | wood |
| 79 | shieldWall | 挂盾 | mid | 凹痕圆盾，皮条残断 | metal |
| 80 | crossedSwords | 交叉剑挂饰 | mid | 双剑交叉钉墙，剑柄一高一低 | metal |
| 81 | mountedHead | 猎头挂饰 | high | 兽首/魔物颅骨，眼窝嵌石 | bone |
| 82 | plankRepair | 修补木板 | low | 斜钉加固板两根，钉头冒头 | wood |
| 83 | hooksRope | 墙钩挂绳 | low | 铁钩两枚垂绳索，绳结粗大 | metal,cloth |
| 84 | lanternWall | 壁灯笼 | mid | 铁框提灯，罩内暖光 | metal,✦lightSource,fire |
| 85 | runesScratch | 刻痕涂鸦 | low/mid | 石刻文字与符文涂划，笔画生涩 | decal |

## 5. 生产批次建议（对接 SCENE_TASKS P2）

1. **批 1（P2 骨架批）**：每类先产 2~3 件验证类契约 → #9/#14/#33/#37/#48/#61/#71（宿主链
   全链路：柱→柱顶瓶→火把）。
2. **批 2**：prop 类容器家具（#24-#47）——量最大，flash 主战场。
3. **批 3**：floorDecal 全量（#48-#60）——低风险高密度填充。
4. **批 4**：wallStructure + wallDecor（#61-#85）——立面表现力。
5. **批 5**：roomWall style 变体 + floor style（#1-#8、#19-#23）——随 P3 房型配方联调。
6. 变体参数化回填贯穿始终（同族变体走 `build(opts)`，不新增文件）。

## 6. 横切提醒

- 带布光职责（✦）的资产：光源参数（颜色/强度/距离）走 rooms/lighting.js 预设，
  资产内只声明"这里有火"，不私设 PointLight（防 draw call 与风格失控）。
  吊灯/火盆的 flicker 统一由 P5 的 `B.torchFlicker` 收养。
- ✧ 交互预留 = tags 打好即可，behaviors 保持 `[]`（P5 前不挂）。
- 描述列就是喂料 prompt 的"剪影一句话"，flash 不得自行改写物品身份（可加细节，不可换物）。
