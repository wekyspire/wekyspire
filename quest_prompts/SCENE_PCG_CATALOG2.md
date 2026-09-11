# SCENE_PCG_CATALOG2 — 塔身物件增补清单（120 件，西幻主题）

> 状态：v1（2026-08-30）。管线契约见 `SCENE_PROP_WORKFLOW.md`，原版清单见
> `SCENE_PCG_CATALOG.md`（85 件，已完成 64 件 + 批5 的 13 件 style 待 P3 联调）。
> 本清单覆盖**塔身 1-44 层**的物件多样化；**塔顶实验室与塔基是独立风格包，
> 不在本清单范围**（未来另立 palette 主题与清单）。
>
> 契约字段沿用 CATALOG §2（place/mount/footprint/bayWidth/band/topY）与既定裁定：
> - mount 可数组（如 `['floor','smallWallTop']`）；band 可数组（如 `['low','mid']`）
> - 档位是选品参考，footprint 数值是机器事实；长条家具按宽度维判档
> - wallStructure/wallDecor 原点：z=0 贴墙、+z 朝室内；y 原点=挂点投影
>   （灯具/浮雕向上、垂挂布旗向下并存合法）
> - ceiling 件（mount:'ceiling'）原点=天花板锚点、身体垂挂负 y
> - ✦lightSource/fire 件只声明"有火"，禁私设 PointLight；火苗 unlit 冷白锥
> - 本清单启用 **9 个新 palette token**（见 §0），资产禁裸 hex 照旧

## 0. 新增 palette token（kit/palette.js 已同步，两主题同键）

`bread`（面包棕黄）/ `cheese`（奶酪灰黄）/ `flour`（面粉灰白）/ `copper`（紫铜）/
`silver`（冷银）/ `herb`（药草绿）/ `glowCyan`（幽光青：晶簇/微光蘑菇专用）/
`wine`（酒深红）/ `parchment`（羊皮纸灰黄）。

## 0.5 风味分区 tag（塔身楼层的选品权重钩子，P3 配方消费）

tags 中带且仅带一个区带 tag：`prison`（监牢）/ `barrack`（军营）/ `chapel`（圣所）/
`crypt`（墓窟）/ `library`（书库）/ `kitchen`（居室炊事）/ `smith`（锻工）/
`arcane`（奥术）/ `nature`（自然侵蚀）/ `quarters`（起居）/ `vault`（宝库）/
`generic`（通用）。同件多语境可省略区带 tag（视同 generic）。

## 1. 家具 prop / mount floor（21 件）

| # | id | 名称 | 描述 | tags | 档 |
| --- | --- | --- | --- | --- | --- |
| 1 | tableRound | 圆木桌 | 圆面厚板+中柱三脚，桌缘木色差 | wood,furniture,quarters | M |
| 2 | tableWriting | 书写桌 | 斜面稿架+侧抽+墨水瓶 | wood,furniture,library | M |
| 3 | deskScribe | 抄写台 | 高斜面+书堆压角+留烛位 | wood,furniture,library | M |
| 4 | chairSimple | 简椅 | 四腿薄板座背，坐面磨亮 | wood,furniture,quarters | S |
| 5 | stoolSquare | 方凳 | 四腿方座面微裂 | wood,furniture,quarters | S |
| 6 | benchStone | 石凳 | 整条石板+两石墩 | stone,furniture,generic | M |
| 7 | cupboardClosed | 碗柜 | 双门高柜+顶檐线脚 | wood,container,quarters | M |
| 8 | wardrobeTall | 高衣柜 | 双门带锁孔+顶冠 | wood,container,quarters | M |
| 9 | bedFourPoster | 四柱床 | 立柱+华盖布幔半垂 | wood,cloth,quarters | XL |
| 10 | cradleWood | 木摇篮 | 船形摇篮+小被褥 | wood,cloth,quarters | S |
| 11 | throneSmall | 小王座 | 高背石座+扶手兽头雕 | stone,chapel | M |
| 12 | lecternPodium | 讲经台 | 斜面经书+侧链坠 | wood,chapel | S |
| 13 | prieDieu | 祈祷跪凳 | 跪板+斜倚架+垂布 | wood,cloth,chapel | S |
| 14 | sideTableNarrow | 窄边几 | 三条细腿小几 | wood,furniture,quarters | S |
| 15 | coatRackWood | 衣帽架 | 立杆+枝杈挂钩+搭衣 | wood,cloth,quarters | S |
| 16 | screenFolding | 折屏 | 三扇木框布面微折角 | wood,cloth,quarters | L |
| 17 | ladderLean | 倚墙梯 | 斜靠双杆横档+磨损 | wood,generic | M |
| 18 | shelfLadderStep | 阶梯架 | 三级阶格+散置杂物 | wood,container,quarters | L |
| 19 | bedRoll | 铺盖卷 | 被卷半开+小枕 | cloth,quarters | S |
| 20 | pillowPile | 靠垫堆 | 三两只叠压歪斜 | cloth,quarters | S |
| 21 | benchHall | 大厅长凳 | 厚板+雕卷腿，比长凳更重 | wood,furniture,generic | L |

## 2. 容器与储物 prop / mount floor（14 件）

| # | id | 名称 | 描述 | tags | 档 |
| --- | --- | --- | --- | --- | --- |
| 22 | amphoraTall | 高足罐 | 细高陶罐+双环耳+环带纹 | pottery,container,generic | S |
| 23 | jarSmall | 小陶罐 | 矮胖小罐（柱顶件） | pottery,container,brittle,generic | S |
| 24 | potIron | 铁锅 | 三足黑锅+锅盖斜搭 | metal,container,kitchen | S |
| 25 | urnLidded | 带盖瓮 | 圆胖瓮+覆碗盖+盖钮 | pottery,container,brittle,crypt | S |
| 26 | sackOpen | 敞口袋 | 袋口外翻漏出谷粒 | cloth,container,quarters | S |
| 27 | basketWicker | 柳条筐 | 敞口编织感+横箍两道 | wood,container,kitchen | S |
| 28 | crateLong | 长条箱 | 武器运输木匣+封条 | wood,container,barrack | M |
| 29 | bottleCase | 酒瓶箱 | 格挡内卧瓶+稻草垫 | wood,container,kitchen | S |
| 30 | scrollRolls | 卷轴堆 | 成捆卷轴+皮带头+一根散开 | wood,parchment,library | S |
| 31 | bookStack | 书堆 | 横叠七八册+一本斜倚 | wood,library | S |
| 32 | reliquaryBox | 圣物匣 | 小匣+拱盖+锁片 | wood,metal,chapel | S |
| 33 | vialRack | 试管架 | 双排小管+一瓶歪倒 | wood,glass,arcane | S |
| 34 | ropeCoil | 绳卷 | 盘绳三匝+垂头一段 | rope,generic | S |
| 35 | chestLarge | 大铁皮箱 | XL 包铁重箱+双锁扣 | wood,metal,container,vault | XL |

## 3. 照明与火 prop（10 件，均 ✦lightSource/fire）

| # | id | 名称 | mount | 描述 | tags | 档 |
| --- | --- | --- | --- | --- | --- | --- |
| 36 | torchStanding | 立式火把 | floor | 落地铁杆+油盘+单焰 | metal,lightSource,fire,generic | S |
| 37 | lanternFloor | 落座提灯 | floor | 铁提灯罩内亮片+提环 | metal,lightSource,fire,generic | S |
| 38 | oilLampStand | 油灯立架 | floor | 细杆悬油碗+芯焰 | metal,lightSource,fire,quarters | S |
| 39 | candleAltarCircle | 祭坛烛阵 | floor | 一圈矮烛+中央高烛 | wax,lightSource,fire,chapel | M |
| 40 | hearthStone | 小火塘 | floor | 石砌矮圈+炭堆余温 | stone,lightSource,fire,kitchen | M |
| 41 | bonfireRemnant | 篝火余烬 | floor | 交叉柴+炭堆+一点残焰 | wood,lightSource,fire,generic | M |
| 42 | brazierDish | 矮盆油灯 | floor | 石盆+芯焰+沿口焦色 | stone,lightSource,fire,chapel | S |
| 43 | candelabraTable | 桌面五枝烛台 | ['floor','smallWallTop'] | 矮座展枝五烛 | metal,lightSource,fire,quarters | S |
| 44 | crystalLamp | 晶石灯 | ['floor','smallWallTop'] | 座上晶簇幽光（glowCyan） | stone,lightSource,arcane | S |
| 45 | candleBurntOut | 烛泪残台 | ['floor','smallWallTop'] | 燃尽烛泪塔+黑芯 | wax,lightSource,fire,generic | S |

## 4. 军事与锻工 prop（12 件）

| # | id | 名称 | 描述 | tags | 档 |
| --- | --- | --- | --- | --- | --- |
| 46 | anvilIron | 铁砧 | 双角砧+砧座+砧面锤痕 | metal,smith | M |
| 47 | toolRackSmith | 铁匠工具架 | 立架挂锤钳锉 | wood,metal,smith | M |
| 48 | weaponCart | 武器车 | 两轮车斗+斜倚矛束 | wood,metal,barrack | L |
| 49 | shieldStack | 盾堆 | 三面盾靠墙互叠 | metal,barrack | M |
| 50 | spearBundle | 矛束 | 五六杆斜靠+绳捆 | wood,metal,barrack | M |
| 51 | bowRack | 弓架 | 立弓两张+插箭筒 | wood,barrack | M |
| 52 | arrowTarget | 箭靶 | 草环靶+三支插箭 | wood,barrack | M |
| 53 | trainingDummy | 训练木人 | 桩身横臂+旧盔歪戴 | wood,metal,barrack | M |
| 54 | barricadeWood | 木拒马 | 交叉尖木+横档+铁丝感 | wood,barrack | L |
| 55 | spikesGround | 地刺排 | 斜埋尖桩一排 | wood,prison | M |
| 56 | ballistaRemnant | 弩炮残架 | 残木架+断臂+散矢 | wood,metal,barrack | L |
| 57 | catapultBroken | 破投石机 | 残臂+垂吊兜+断辐 | wood,barrack | XL |

## 5. 神秘与宗教（10 件）

| # | id | 名称 | place/mount | 描述 | tags |
| --- | --- | --- | --- | --- | --- |
| 58 | altarStone | 石祭坛 | prop/floor | 台面垂布+四角烛位 | stone,cloth,chapel |
| 59 | altarDark | 暗黑祭坛 | prop/floor | 斜面血槽+骷髅位 | stone,crypt |
| 60 | fontStone | 洗礼盆 | prop/floor | 立柱盆+静水片 | stone,chapel |
| 61 | censerChain | 吊香炉 | prop/ceiling | 链摆炉+缕烟感件 | metal,lightSource,chapel |
| 62 | staffRack | 法杖倚架 | prop/floor | 三杖斜倚+环架 | wood,arcane |
| 63 | orbStand | 水晶球座 | prop/['floor','smallWallTop'] | 托座+幽光球 | stone,lightSource,arcane |
| 64 | tomeChained | 锁链巨典 | prop/floor | 斜面台+链拴厚书 | wood,metal,arcane |
| 65 | symbolFaith | 圣徽立像 | prop/floor | 竖立圆徽+翼饰浮雕 | stone,chapel |
| 66 | idolSmall | 异神小像 | prop/smallWallTop | 歪头石像+底座 | stone,crypt |
| 67 | garlandDried | 干花花环 | wallDecor/high | 环圈垂+干穗残花 | herb,chapel |

## 6. 生活与餐饮 prop（14 件）

| # | id | 名称 | 描述 | tags | 档 |
| --- | --- | --- | --- | --- | --- |
| 68 | cauldronWitch | 大釜 | 黑铁大锅+搭搅拌桨 | metal,arcane,kitchen | M |
| 69 | kettleTripod | 吊锅三脚架 | 三脚架+悬锅+底柴堆 | metal,wood,lightSource,kitchen | M |
| 70 | pantryShelf | 食架 | 分层摆面包奶酪罐 | wood,kitchen | M |
| 71 | breadBasket | 面包篮 | 藤篮+两三个圆面包 | wood,kitchen | S |
| 72 | cheeseWheels | 奶酪轮 | 两轮叠+楔形切块 | kitchen | S |
| 73 | gobletPair | 高脚杯对 | 一对细脚杯+翻倒一只 | metal,quarters | S |
| 74 | platesStack | 叠盘 | 一摞陶盘+顶碗 | pottery,quarters | S |
| 75 | potHerb | 药草盆 | 陶盆+瘦苗几茎 | pottery,herb,quarters | S |
| 76 | flourSack | 面粉袋 | 矮胖袋+袋口扑粉 | cloth,kitchen | S |
| 77 | meatRackHang | 挂肉架 | 落地架+横杆垂肉两挂 | wood,kitchen | M |
| 78 | barrelRainwater | 集水桶 | 半满桶+搭木瓢 | wood,kitchen | S |
| 79 | churnButter | 搅乳桶 | 高桶+直木杆+盖孔 | wood,kitchen | S |
| 80 | wellIndoor | 室内小井 | 石沿圈+辘轳架垂绳 | stone,quarters | L |
| 81 | fountainDry | 干涸喷泉 | 小水池+断柱芯+苔 | stone,nature | XL |

## 7. 自然与荒废（11 件）

| # | id | 名称 | place/mount | 描述 | tags | 档/topY |
| --- | --- | --- | --- | --- | --- | --- |
| 82 | stumpTree | 树桩 | smallWall | 矮桩+年轮顶面+斧痕 | wood,nature | S/topY 低 |
| 83 | boulderMossy | 苔巨石 | smallWall | 大卵石半面爬苔 | stone,nature | M/无 |
| 84 | crystalCluster | 晶簇 | smallWall | 幽光晶柱群（glowCyan） | stone,lightSource,arcane | M/无 |
| 85 | pillarWooden | 木柱 | smallWall | 粗木柱带疤+箍铁 | wood,generic | M/高 |
| 86 | columnBasalt | 玄武岩柱 | smallWall | 黑石棱柱+断茬 | stone,crypt | M/中 |
| 87 | stalagmite | 石笋 | smallWall | 锥状积岩+底裙 | stone,nature | S/无 |
| 88 | logPile | 柴堆 | prop/floor | 码放圆木垛+树皮茬 | wood,kitchen | M |
| 89 | plantHanging | 吊盆栽 | prop/ceiling | 垂盆+垂藤蔓几缕 | pottery,herb,nature | — |
| 90 | plantPotDead | 枯苗盆 | prop/smallWallTop | 陶盆+枯枝杈 | pottery,nature | S |
| 91 | nestRafters | 梁上鸟巢 | prop/ceiling | 小巢+探出枯枝 | wood,nature | — |
| 92 | bonesBound | 捆绑骨堆 | prop/floor | 交叉骨+绳捆+断链 | bone,crypt | S |

## 8. 地板装饰 floorDecal（10 件）

| # | id | 名称 | 描述 | tags |
| --- | --- | --- | --- | --- |
| 93 | rootsCreep | 树根蔓延 | 贴地根须分叉+顶起石片 | nature |
| 94 | mushroomsGlow | 微光蘑菇簇 | 冷绿幽光小伞三五成群 | herb,lightSource,nature |
| 95 | rugWorn | 磨损小地毯 | 织纹矩形+流苏+磨白 | cloth,quarters |
| 96 | hayScatter | 散落干草 | 乱草撒地+草屑 | quarters |
| 97 | feathersScatter | 散羽 | 几根羽毛+绒点 | nature |
| 98 | ashesPile | 灰烬堆 | 灰白小堆+焦木残段 | generic |
| 99 | circleSummon | 召唤法阵 | 暗刻双环+符点+角标 | arcane |
| 100 | graveShallow | 浅坟 | 土包+歪木牌+一撮花 | crypt |
| 101 | waxDrips | 地面烛泪 | 蜡痕点串+烛头 | chapel |
| 102 | waterBasin | 积水潭 | 大水洼+同心波纹圈 | decal,water |

## 9. 墙面装饰 wallDecor（8 件）

| # | id | 名称 | band | 描述 | tags |
| --- | --- | --- | --- | --- | --- |
| 103 | tapestryGrand | 大挂毯 | high | 织画人物+垂穗+厚框杆 | cloth,chapel |
| 104 | curtainDraped | 门口垂帘 | high | 分幅布帘+束带 | cloth,quarters |
| 105 | cloakHook | 挂斗篷 | mid | 钩+斗篷垂褶+搭巾 | cloth,quarters |
| 106 | bannerTorn | 半残旗 | mid | 纹章残片+裂口飘 | cloth,barrack |
| 107 | wineRackWall | 壁挂酒架 | low | 格内卧瓶+漏滴 | wood,kitchen |
| 108 | toolWallBoard | 壁挂工具板 | low | 钉挂钳锤+线锯 | wood,metal,smith |
| 109 | hornMounted | 挂兽角 | mid | 盾板+弯角一对+额饰 | bone,nature |
| 110 | mirrorAntique | 古镜 | mid | 椭圆框+雾面反光片 | metal,quarters |

## 10. 墙面结构 wallStructure（4 件）

| # | id | 名称 | bayWidth | 描述 | tags |
| --- | --- | --- | --- | --- | --- |
| 111 | corbelSupport | 牛腿托 | 1 | 墙挑托石+卷叶雕 | stone,generic |
| 112 | archLiningPiece | 拱门套 | 1 | 内凹门套双层线脚 | stone,generic |
| 113 | plaqueEngraved | 铭碑石 | 1 | 刻字石板+边框线 | stone,crypt |
| 114 | spoutFountainWall | 壁泉口 | 1 | 兽首吐水口+石盆（干涸） | stone,nature |

## 11. 奥术小件 prop（6 件）

| # | id | 名称 | mount | 描述 | tags | 档 |
| --- | --- | --- | --- | --- | --- | --- |
| 115 | alembicSet | 蒸馏器组 | ['floor','smallWallTop'] | 曲颈瓶+受瓶+炉芯微光 | glass,metal,lightSource,arcane | S |
| 116 | specimenJar | 标本罐 | ['floor','smallWallTop'] | 玻璃罐泡着不明物 | glass,arcane | S |
| 117 | hourglassStand | 大沙漏 | floor | 立架双球+沙线 | wood,glass,arcane | S |
| 118 | orreryMini | 黄铜星仪 | ['floor','smallWallTop'] | 环架+错落小球 | metal,arcane | S |
| 119 | mapTable | 地图桌 | floor | 摊图+压石+旗标 | wood,parchment,quarters | M |

## 12. 补足件（1 件，凑整 120）

| # | id | place/band | 描述 | tags |
| --- | --- | --- | --- | --- |
| 120 | bannerHalfTorn | wallDecor/mid | 对开残旗两幅并排，一幅缺角 | cloth,barrack |

## 13. 生产批次建议

- 共 120 件 ÷ 每组 6 件 = 20 组，每波 5 组并行 × 4 波。
- 组内按同类相聚（家具组/容器组/军事组…），风味一致性更好。
- 交接惯例照旧：subagent 只新建 `props/<id>.js`，scoped vitest 自愈；orchestrator
  串行登记（regen 脚本）+ 全量测试 + propGallery vision 验收 + 一资产一提交。
