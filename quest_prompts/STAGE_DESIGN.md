# STAGE_DESIGN — 战斗舞台设计（2.5D 立牌战场）

> 状态：草案 v1（2026-08-01）。本文档是舞台设计的单一事实源，后续舞台相关迭代回写本文档。

## 0. 设计目标

所有战斗共用一个舞台模型：**简单 3D 场景 + 2D 立牌单位 + 血条与效果 overlay**，整体 2.5D。
素材风格：粗糙笔触的涂鸦水彩；角色 Q 版。不同战斗可换不同场景（背景 + 站位参数）。

参考：用户手绘布局稿（左下近景友军、右上远景敌军、地面椭圆站台、HP 数字在站台下方、
效果图标带层数浮于身侧、前景拱门/吊灯框景、地牢走廊场景）。

**视角约定**：友军（玩家/瑞米）**背对屏幕**（朝向敌人），敌军正对屏幕。
立牌命名：`unit_xxx.png` = 舞台用图（友军=背视图，敌军=正视图），`unit_xxx_front.png` = 正视图备用。

**角色设定**（用户概念稿，`tools/seedream/ref/`）：
- 主角"灵御"：身着无装饰全身板甲的倒三角肌肉壮汉，圆顶全覆式头盔（Y 形面甲缝，
  看不清面容），系红色围巾，一手长剑一手铁锤。
- 瑞米：白色猫形小精灵，大耳朵，尾巴比身体还大的蓬松尾，豆豆眉。
  画风要"粗糙幼稚"（接近概念稿的铅笔草稿感），忌精致萌系（AI 感）。

## 1. 视觉模型：双相机——世界透视斜视 + UI 独立正交

- **世界相机：PerspectiveCamera fov=24°，azimuth=-34°（右侧斜视）、elevation=20°（俯角），
  lookAt (0,-15,0)，距离 ≈123（z=0 平面可视高=100 反解）**（2026-08-02 用户手调定稿：
  更侧、更平的机位让前后排纵深读起来更强）。
  **眼高必须高于场内一切水平面**（地板 -30、柱帽顶 ≈+20）——眼高若夹在场景中部，
  眼上物露底面（读作仰视）、眼下物露顶面（读作俯视），单投影数学一致但感知上是
  两个视角的拼接，这是"柱子顶端像仰视"的根因。lookAt 压低给底部手牌栏留构图。
- **双 pass 渲染（用户定）**：stage 可带 `uiScene`——先渲染 3D 世界，清深度后再渲染
  UI pass（卡牌/按钮/牌库坟墓图标/**玩家状态栏**/查看器）。牌桌 UI 世界坐标在地板平面之下
  （y<-30），同 pass 会被地板 z-test 裁掉；UI 本质是前景覆盖层，不与 3D 世界做深度交互。
  单位/粒子留在世界 pass（与地板正确深度交互）。Picker 拾取前两个场景都要
  updateMatrixWorld（卡牌在 uiScene，单测不渲染不会自动刷新）。
- **玩家状态栏（左下角，PlayerStatusObject，2026-08-02 用户定）**：头像（unit_xxx_front
  正视图圆形裁切 + 描边环）+ AP/魏启资源点两排（ResourcePipsObject `align:'left'` 左对齐，
  高亮/弹跳/渐变帧驱动逻辑不变）+ `abilities` 留位 Group（精英/大师能力灵脉图标行的
  未来挂载点）。面板 36×10.5 贴 UI 底缘（中心 (-70,-59.3)，z=6 低于手牌 z10+——
  左侧手牌 hover 放大盖住面板右上一角可接受，交互元素在上层）。
- **UI 相机（uiCamera）= OrthographicCamera 正视**（2026-08-02，用户定）：透视 UI 相机
  让卡牌/UI 吃透视畸变——z 层不同投影缩放/偏移不同（咏唱槽 z=4 vs 手牌 z=20+ 错位、
  卡牌飞行 z 变化忽大忽小）；正交下布局坐标↔屏幕**线性映射**，z 只定前后层。
  相机 (0,-15,500) 正视 -z，可视范围 y∈[-65,+35]（底部留手牌构图）；
  **视锥在视图空间必须对称 ±50——取景中心偏移只由相机位置承担，top/bottom 再偏移
  等于算两遍**。渲染/拾取/拖拽映射三链路都按 space 分流：
  Picker 的 pickable 带 `space:'ui'`（UI 命中优先，与渲染覆盖次序一致）；
  拖拽出牌反投影（`screenToWorld(px,py,planeZ,cam)`）必须传 uiCamera。
- `screenToWorld(px, py, planeZ, cam?)` = 射线与 z 平面求交（任意相机姿态通用）；
  `worldToScreen(..., cam?)` 为其逆（测试基建用它，**禁止线性近似**；测试 helper 须按
  对象所在 pass 选相机——battleStage.test.js 的 `toScreen`/`toScreenUI` 二分）。
- **单位立牌形（圆柱）billboard**：standee/hpBar/fxAnchor 挂 billboard 子组，
  `faceCamera(camDir)` 逐帧 yaw 转向相机——斜视下立牌不转正会被
  透视压斜；**立面保持垂直地面，不做 pitch**（球面 billboard 的后仰像纸片倒下，已弃，
  用户定）；阴影/目标金环平贴地板不参与。
- **战线轴 battleLine**（3D，站水平地板）——**前-后占位为主（2026-08-02 多轮调参，用户手调定稿）**：
  near (-32, FLOOR_Y, +15) → far (24, FLOOR_Y, -60)，轴沿纵深（z）走、x 只留少量斜漂——
  友军前排近镜头偏左、敌军后排远镜头偏右（旧左右占位轴 (-50,22)→(70,-34) 已废）。
  槽位 t∈[0,1]：position = lerp + **lane 地面 XZ 法向偏移**（(dz,-dx) 向；轴沿 z 后
  lane≈屏幕横向斜升：lane+ = 屏幕左上/后排，lane- = 屏幕右下/前排，**laneGap=30**——
  用户定稿把排内间隔拉宽，瑞米与主角同 t=0 并列 lane+0.75）；
  nearScale/farScale 当前 1/1（透视纵深已够，风格化夸张关闭，机制保留）。
  场景随之拉长（地板 FLOOR_FAR_Z -45→-80、左墙 z0 -115、柱列/幽火各加深远一组、
  吊灯后移、雾 165→310 让远排沉进暗部）。
  **前后排槽位经验**：① lane+ 的队友会正好躲进主角身后被挡死（t 微差 + lane+ 在屏幕上
  几乎纯竖直位移）——同排并列要 lane 拉开足够间隔；② near 排 z 不宜 >15，
  再近下半身就被手牌扇遮（UI 覆盖层在 70% 屏高线）；③ 敌排 lane 带 t 微交错破直线感。

## 2. 场景装配：程序化低多边形 3D（零外部 3D 资产）

**2026-08-01 推翻生成图背景方案**（用户：生图背景效果不好，程序化场景费效比更高——
少 3D 资产，但场景动效/氛围/光照/交互做到高完成度）。**同日二轮：坡面地板→水平地板**——
坡面是正交时代的投影戏法，透视相机下水平面自然透视收缩，坡面反而让地面法线朝镜头倾斜，
成为透视矛盾的另一半根因；场景一律按真 3D 常理构建（FLOOR_Y=-30，单位脚底锚定）。

- **设定与色调（2026-08-01 四轮定方向、五轮定稿，用户定）：高塔楼层大厅，塔外永夜，
  全场统一冷调（蓝白紫）**——石材蓝灰泛紫、环境光/月光冷蓝紫、**火焰也是蓝紫/冷白的
  幽火**（鬼火感；绿在五轮被进一步压掉，暖橙禁用）；唯一的"亮"来自左墙高窗外的冷月。
  几何求丰富与不对称，不做纹理细节。
- **布局（五轮定框架、六轮定稿，用户定）**：**左墙（x=-95）= 月光墙**——分段盒子拼出的
  真实墙体开两扇尖拱窗洞（winA 大而低主光路、winB 小而高；全墙体 castShadow），
  **月光平行光穿窗（shadow map，PCF）在地板投出窗形光池**。
  **墙体尺寸三铁律（六轮漏光调试实录，全部用数学验证过）**：
  ①**高度**：月光是平行光（坡降 0.648），越顶光线会淹掉房间上半空气（地板只亮一条，
  表面阴影正常但体积光全糊）——墙顶必须高于最远可见空气的回溯高 y+(x+93)*0.648，
  现 **+460**（高耸出画，视觉零成本）；②**厚度**：shadow map 纹素 ≈3-5wu/texel，
  亚纹素厚度在 PCF 插值下边缘漏光——现 **12wu**（>2 texel）；
  ③**z 向覆盖**：光向 dz/dx≈0.106，房间远端漂移 ±25——现 z∈[-115,+125] 堵侧漏
  （前后排布局拉长场景后随之后延）。
  **light.position 是阴影相机的深度原点**（对平行光不改光照方向）：必须沿光轴反向后移
  让整面高墙落在阴影相机近平面之前——墙在 y≈49.5 以上沿光轴深度为负被 near 裁掉，
  shadow map 缺上半墙时回溯打中上半墙的采样恒亮（右上角漏光楔形，边界即 y≈49.5 等高线，
  加高墙纹丝不动就是因为这个）。**正面墙（z=-45）= 素墙**——砖块补丁×2（逐砖抖动+缺砖）、
  尖拱 doorway（黑洞+石框）、破幡×2（紫/青蓝，update 轻摆）、窄缝窗（暗槽+铁栅）；
  **左端必须止于左墙内侧面，探过左墙会挡住窗洞里的夜空**（五轮调试实录）。
- **程序化 skydome（六轮，skydome.js）**：大球壳 BackSide + ShaderMaterial——
  地平线暗紫→天顶蓝黑渐变、3D 格 hash 星野（只出地平线以上）、月亮盘+广晕
  （高空方向，物理上与陡角入射月光一致；**用户：月亮不必出现在窗内**）；
  方向采样以相机位置为原点（vWorldPos - camPos），不吃雾不写深度最先画。
  **淘汰"贴在窗外的几何背板"方案**（五轮的背板+钉星是凑坐标，六轮全部拆除）。
- **ray marching 体积月光（六轮，volumetricMoon.js，用户点名要真体积光）**：
  世界场景渲进带深度纹理的 RT（HalfFloat + MSAA×4）→ march pass 全屏 quad 逐像素
  重建视线，向场景深度行进 26 步（**frame jitter seed %30 轮转**），逐步把采样点
  变换进月光 shadow 空间做 **sampler2DShadow 硬件比较**，累计散射光量；
  **temporal history（ping-pong RT）EMA 收敛：ema = mix(history, current, 1/30)**——
  **只 EMA 光项不 EMA 场景色**（全场 EMA 会让火焰/呼吸/卡牌动画拖影），
  首帧/resize 后 emaAlpha=1 直接定植避免从黑收敛；composite pass 场景色+EMA 光量输出。
  光柱被窗洞/柱列真实切碎，jitter 条纹被时间域抹平。
  管线：BattleStage 在 renderer 支持 RT 时创建 composer，StageManager tick 走
  `composeScene` 钩子、resize 走 `composeResize`（假 renderer 自动回退直接渲染）。
  **调试实录（全是坑）**：a) three r185 PCF 阴影深度在 `shadow.map.depthTexture`
  （UnsignedIntType + compareFunction），**color 纹理是未用的垃圾**——别采 .texture；
  b) 合成 shader 绕过 three 的线性→sRGB 输出链路，**RT 线性色必须手动 pow(1/2.2)**，
  否则全场变暗；c) **行进起点截到房间近缘 z=95**——相机在房间外（z=208），相机→房间的
  共有路径没有墙遮挡（回溯 z'≈190>墙缘 125），不截断全场发奶；
  d) **飞出 shadow 覆盖的采样按完全阴影处理**，sp.z 还要卡下界（负 z 做 LessEqual 恒亮）；
  e) maxDist=300：远场空气对演出无贡献还放大漏光面；
  f) 立牌等 alpha 材质必须 **alphaTest 0.5 二值 mask**（transparent+depthWrite 会让
  全透明像素写假深度，体积光被矩形截断）；g) 调试工具：composer `_uniforms` 实时改
  density/lightColor/maxDist/nearZ、红色可视化（lightColor=(1,0,0) 看光束 sculpt）、
  density=0 隔离基线、冻结 tick 后 castShadow 开关差分。
- **dungeon3D.js 其余**：水平地板（z **-80**..+95，左端止于左墙；前后排布局拉长）+
  错位石板×13 + 裂板一对；扶壁×3 不对称；吊灯偏心（(-6,20,-32)，铁环+冷白烛焰）；
  **柱列不对称**：左列四根完好高低错落，右列完好微倾 + 深远柱×2、中柱断裂
  （残桩+斜茬顶+倒柱段+柱帽残块+小碎块簇）+ 断楣两段；碎石散点 + 墙脚碎石堆×3；
  **顶部拱肋×3**（大半径薄管弧，弧端落柱列顶、弧顶出画，暗示穹顶——castShadow=false，
  否则平行月光下横拱在地板光池上拖横穿阴影）；**立地火盆×2**（三脚架铁盆中景填空，
  补前后排间空档光池）；**吊链×2 + 废弃吊灯**（斜挂无火，上半空间细节）；
  **doorway 内踏步×3**（向下没入黑暗，门洞纵深）；全体石材 castShadow/receiveShadow。
- **幽火壁灯×10 + 立地火盆×2（共 12 火源）**（柱列内侧 + doorway 两侧 + 中景；
  右中柱已断改挂残桩低处，高度/间距不对称）：
  铁架+火盆碗+**蓝紫外焰锥 + 冷白内焰锥**+点光（0x7474a0）
  +粒子发射锚（火焰粒子淡紫/蓝紫上浮）。
- **光照**：**半球环境光（HemisphereLight 0x3a4666 天光 / 0x232030 地面反弹 ×3.0——
  全局环境光没有位置/衰减，只当保底防暗部死黑，不能当主光）** + **月光平行光
  （0x9db4ec×2.2，唯一投影光，mapSize 2048，自左墙高窗泻入）** + 相机侧弱补光
  （0x66779e×0.5）+ **光池假反弹点光×2（0x8298d4，620/380 candela，贴两窗光池上方
  朝上打——把柱列/墙面当月光二次反弹面打亮；无阴影，成本≈零）** + **战场主补光
  （0x93a5d8×8000、distance 260、decay 1.8，悬战线轴中点 (-4,FLOOR+60,-22)——
  物理衰减让亮度向远墙/近景画外自然跌落：战场亮、周围暗的光照焦点）**；
  幽火/吊灯点光（基准 1150/800 candela，distance 78/95——收敛光池只留灯周一圈）
  双频 sin 闪烁。**StageManager.attach 开启 shadowMap（PCF；PCFSoft 新版 three
  已弃用），假 renderer 无 shadowMap 自动跳过**。
- **雾**：THREE.Fog(0x060a14, **165, 310**) 远景没入永夜蓝黑但保留墙/窗剪影
  （前后排布局后场景纵深拉长，雾距拉近让远排沉进暗部）；
  立牌/HP 条/粒子全部 fog:false 豁免（单位不被雾吞）；夜空/星/月也 fog:false（本应无限远）。
- **立牌光照交互**（假采样，非实光照）：`sampleStandeeTint(pos)` = 冷蓝紫底 + 各幽火/吊灯
  **蓝紫光（b 主导）**按 XY 距离衰减（与点光闪烁同源）+ 纵深压暗；BattleStage tick 逐帧
  染色立牌材质（闪红窗口内不覆盖）。
- **氛围粒子**：火焰粒子自幽火锚点上浮（重力>0，淡紫/蓝紫，走 ParticleSystem spawn）；
  **浮尘 = 常驻月光浮尘云（moonDust.js，非 spawn/死亡型）**：1500 粒常驻尘埃场，
  顶点做值噪声三轴漂移 + 逐粒速度差缓慢下落（盒内回绕），片元采样月光 shadow map
  硬件比较决定亮暗（**光柱内亮冷蓝、阴影区/飞出 shadow 范围极暗近不可见**）——
  亮暗由 shadow 真值驱动，与体积光/地面光池天然对齐（取代旧"沿光路参数化 spawn"
  的位置近似）；35~40% 粒子偏向两条光柱体积 spawn 保证光柱内密度，其余均匀填房间
  兼作环境尘（暗部空气感）；纯 GPU，CPU 每帧只推 uTime + 同步 shadow uniform，
  shadow map 未就绪时整朵云隐藏不渲染。
- **粒子空间分流**（2026-08-01，用户定）：粒子按用途分两套空间，不是一刀切——
  **点粒子（火花/碎屑/火焰/浮尘）= 真 3D**（世界 pass，吃雾/深度/透视，spawn 必须传
  场景内实际 z——缺省 z=70 是旧 2D 特效层约定，斜相机下投影错位到屏幕下方）；
  **读数文本粒子（伤害/治疗数字）= UI pass**（uiScene 前景层，恒定屏幕尺寸、不被场景
  遮挡——伤害数字是读数 UI 不是世界物体，杀戮尖塔同理；相机固定故无"贴玻璃"违和）。
  桥接：BattleStage `_unitToUI(unit, dx, dy)` = 世界相机投影到屏幕像素 → UI 相机反投影
  到 z=70 平面（spawnText 缺省 z=70 恰落该平面）；ParticleSystem sprite 池按
  `space: 'world'|'ui'` 分两套（sprites / spritesUI 两组互不占额），材质 fog:false。
  另：**逐粒子尺寸**走 aSize 顶点属性（PointsMaterial.size 是材质级全局值，onBeforeCompile
  把 gl_PointSize 改为 size × aSize），spawn 的 size 选项才生效。
- **单位贴地件**：阴影/目标金环平贴地板（rotation.x=-π/2，微抬防 z-fight）；
  HP 条叠脚踝前方（hpBar y=+3.4、z=+0.6，标签钳底不沉进地板）——脚底=地板，
  旧稿"站台下方"会被地面裁掉。手牌扇 y=-40（压低给战场让位，防近景卡牌遮敌血条；
  但世界俯角加大后前排单位下半身仍会被手牌扇遮——友军槽位一律后排，见 §1）。

**SceneDefinition 注册表**（`src/stage/scenes/`）：

```js
{
  id: 'dungeon',
  build3D: buildDungeon3D,   // → { group, torches, update(dt, particles), sampleStandeeTint(pos, out) }
  battleLine: { near: {x,y,z}, far: {x,y,z}, nearScale, farScale, laneGap },
  slots: { player: t, allies: [t...], enemies: [t...] },
}
```

战斗 → 场景映射先固定 `dungeon`；将来按战斗配置（敌人组合/剧情节点）选场。

## 3. UnitObject 立牌化

结构（Group）：

```
UnitObject
├─ shadow      引擎画椭圆，贴地，不动（仿射动效不打在它身上）
├─ standee     PlaneGeometry，底部锚定 shadow 中心；纹理=抠图 PNG，无图回退色块
├─ hpBar       立牌下方：底槽 + 填充条 + 数字文本（"20/60"，对齐手绘稿）
│   ├─ shieldGroup 护盾层（shield>0 可见）：蓝色保护框（微蓝背板+四细条）包裹血条
│   │  + 左侧盾徽数值 chip（canvas 程序化盾形图标 + 数值文本）
│   └─ fxRows  血条上方左对齐效果行（icon + 特征色名称 + 层数，详见效果行契约）
└─ fxAnchor    头侧效果图标锚点（留位；当前效果呈现走 fxRows）
```

**效果行契约**（2026-08-02，用户定）：

- 位置：血条**上方**左对齐纵列，每行 = 暗背板 + richtext 烘焙文本
  （`icon + /特征色{名称} + /绿或红{ N}`）——名称用效果定义的特征色（color 字段即
  richtext 颜色名），层数按极性着色（buff 绿 / debuff 红）；行自下而上堆叠，
  第一个效果最贴近血条。HP 主标签不再夹带效果文本。
- 数据：投影 `unit.effects` 已压平定义元数据（name/type/color/icon，
  `projectUnit` 经效果注册表反查），Stage 不 import Core 注册表。
- 重建策略：效果列表签名（含层数）变化才整列重建；HP 变化不触发效果行重烘。
- **tooltip 与卡面热区同协议**：行网格带 `userData.effectRow`
  （`{ type:'effect', payload:{ name } }`，与 hitRegion 同构），Picker 对
  kind:'unit' 命中做二级查询返回 token 命中，hover 走既有
  `tooltip:show/move/hide` 协议，Shell（debug 页 DOM / 未来 Vue 薄壳）按 name
  反查定义渲染 popup（icon + 名称 + 描述）。拖牌/瞄准路径
  （`kinds:['unit']` 过滤）不触发该二级查询——效果行区域仍是合法出牌落点。
- 渲染层级：与 hpBar 全家同规则 statusify（depthTest/Write 关闭 + renderOrder 65/66，
  浮于场景之上、粒子之下）。
- **文本抗锯齿**（2026-08-02）：状态层文本（HP 数字/盾徽数值/效果行）一律
  `transparent: true` 真 alpha 混合，**不用 alphaTest 二值 mask**——canvas 烘焙自带
  AA alpha 渐变，二值化丢弃它就是阶梯锯齿的根因；状态层本就 depthTest/Write 关闭 +
  显式 renderOrder（painter 序确定），混合无排序风险。standee 立牌在世界内吃深度，
  仍用 alphaTest。烘焙侧：小字号文本 scale 3 + `anisotropy = min(8, max)`（效果行随
  billboard 与俯视相机成斜角）。MSAA/RT samples 只管几何边，管不了纹理内容；
  TAA/FXAA 为纹理内锯齿不是对症下药（TAA 需 jitter+velocity，与快速粒子/伤害文本
  和体积光 EMA 历史相冲；FXAA 会软化小字），不做。

**护盾层契约**（2026-08-02，用户定）：

- 护盾与血条一体渲染：有盾时血条被蓝色保护框包裹，左侧出盾徽+数值 chip；
  HP 主标签不再附"盾N"文本。
- **数值变更**（增/减但未归零）：chip 放缩跳动（`_shieldPopT` 线性衰减 1.45→1，0.28s，
  牌库脉冲同语言）；值不变不重烘。
- **破碎 vs 自然消失的区分在因果不在状态**：`>0→0` 的状态检测无法区分"被打破"与
  "回合开始清零"，因此**破碎碎粒只由伤害节拍驱动**（`_damageHit` 里
  `shieldAbsorbed>0` 且 `显示盾量(上一 sync 快照) - absorbed ≤ 0` 时播放蓝白碎粒）；
  自然消失只是保护框随 sync 静默隐去。UnitObject 不做 >0→0 回调。
- **伤害节拍按落点分流**：生命值受伤（dealt>0）才闪红+红色火花+击退（节拍阻塞）；
  全吸收只有蓝色火花+灰色吸收数字，**不翻红不击退**（用户定），短停一拍即收节拍。
- **状态绘制浮于场景之上**（2026-08-02，用户定）：场景遮蔽立牌是合理的，但不可遮蔽
  状态——hpBar 全家 + 护盾层一律 `depthTest:false + depthWrite:false +
  renderOrder 60+`（`statusify(mesh, order)`，场景 0 < 状态 60~64 < 粒子 70/71；
  depthTest 关闭后同层顺序靠显式 renderOrder painter 序；depthWrite 关闭防污染
  体积光 RT 深度）。卡牌等 UI 是独立 uiScene pass（清深度后渲染），天然仍在状态之上。
  立牌本体/阴影/金环仍是场景物，正常吃深度。

**极简状态机**（idle / attack / hurt / dead）+ 整牌仿射动效：

| 状态 | 表现 | 阻塞 |
|---|---|---|
| idle | 呼吸：scaleY = 1 + 0.02·sin(t)，相位随机 | 否 |
| attack | 向目标 lunge：位移 + 前倾，去程快回程慢（animator 补间） | 是（节拍） |
| hurt | 短促抖动 + 后仰 + 红闪（沿用现有 flash） | 是（节拍） |
| dead | 倒地 rotate≈-80° + 下沉淡出 → 移除 | 是（节拍） |

所有仿射变换只作用在 `standee` 子节点；`shadow` 始终贴地。

## 3.5 出牌交互：按 targetMode 双模式（2026-08-01，用户定）

- **判定来源**：技能定义声明式字段 `targetMode: 'enemy' | 'none'`（缺省 'none'），
  经 `projectCardFull` 投影给前端——后端结算仍走"白名单目标 + 默认选靶"，
  targetMode 只是前端交互声明，不影响结算语义。
- **`'enemy'`（需选目标，如冲拳/点火）= 杀戮尖塔式瞄准**：按下后卡**留手牌原位**
  （不遮目标），高亮 + 两侧手牌撑开（复用 hover 撑开布局）；`TargetingArrowObject`
  圆点曲线（二次贝塞尔，向上凸，尾小头大 + 末端箭头）从卡牌延伸到指针；
  掠过存活敌人 → 单位高亮 + 箭头变色（暖金→青绿）；**松手在存活敌人身上才打出，
  否则取消**（过出牌线也不打出）。瞄准中资源点"即将消耗"高亮保持。
- **`'none'`（免目标，如格挡/凝神诀）= 旧式拖拽**：卡随指针走（z=30 平面反投影），
  拖过 PLAY_LINE_Y(-20) 松手 = 打出，拖回手牌区 = 取消回锚点。
- 瞄准箭头是 UI pass 覆盖层（z=45，depthTest:false，renderOrder:5）：指针追随物，
  不进动画队列/animator 注册表。

## 4. 素材管线（seedream 5.0 pro）

- `tools/seedream/gen.py`：manifest 驱动批量生成。`ARK_API_KEY` 走环境变量（**key 永不入文件**）。
  支持 `refImages`（本地参考图 → base64，i2i 保持角色身份，如瑞米/史莱姆沿用旧资产形象）。
- `tools/seedream/key.py`：边缘洪水抠图（白底→透明 PNG，水彩软边可调 tolerance）。
- 产出 `tools/seedream/out/`；人工挑选后拷入 `src/assets/stage/` 并在 SceneDefinition/内容注册表引用。
- **成本控制**：全部 1K 试水，能凑合用就凑合用；风格关键词锁定，保证成套。

**风格关键词（锁定）**：`粗糙笔触的涂鸦水彩，儿童绘本感，Q版二头身，粗犷勾线，水彩晕染填色`。
立牌统一追加：`全身立绘，纯白色背景，无阴影，无底座，无文字`（视角按需：友军背视/敌军正视）。

**沿用旧资产做 i2i 参考**：瑞米 = `master:src/assets/remi.png`（白色大耳猫形小精灵），
史莱姆 = `master:src/assets/enemies/slime.png`（黑团白眼）。已拷入 `tools/seedream/ref/`。

### 首批清单（1K 试水）

| 名称 | 用途 | 参考图 | 备注 |
|---|---|---|---|
| `unit_player` | 玩家立牌（背视） | player_concept.png | 板甲壮汉+红围巾+长剑铁锤 |
| `unit_player_front` | 玩家正视图（备用） | 同上 | Y 形面甲缝 |
| `unit_remi` | 瑞米立牌（背视） | remi_concept.png | 铅笔草稿风，大尾巴背影 |
| `unit_remi_front` | 瑞米正视图（备用） | 同上 | 坐姿 |
| `unit_slime` | 敌人史莱姆立牌 | slime.png（旧资产） | 黑色粘液团+白圆眼 |
| `unit_warlock` | 敌人燃焰术士立牌 | 无 | 暗红长袍+火焰法杖 |
| ~~`bg_dungeon`~~ | ~~生图背景~~ | 已废弃 | 场景改程序化 3D（§2），生图背景方案弃用 |

## 5. 落地顺序（后续批次）

1. ~~素材试水与定稿~~ ✅（背视/正视两版，concept i2i 流程定型）。
2. ~~UnitObject 立牌化 + HP 条 + 状态机动效~~ ✅ 2026-08-01（shadow/standee/hpBar/fxAnchor；
   idle 呼吸已上线；attack lunge / dead 倒地待 bridge 攻击者锚点事件后补）。
3. ~~SceneDefinition + 战线轴槽位~~ ✅ 2026-08-01（`src/stage/scenes/`，slotTransform）。
4. ~~程序化 3D 场景 + 透视相机~~ ✅ 2026-08-01（fov=24° 透视、坡面地板、火把/吊灯闪烁点光、
   雾、氛围粒子、立牌灯光染色）。**同日二轮修正** ✅：抬眼高斜视 (0,30,235)→lookAt(0,-15,0)
   根治"柱顶仰视/地板俯视"感知矛盾；坡面地板→水平地板（FLOOR_Y=-30）；lane 偏移改地面
   XZ 法向（laneGap 16）；阴影/金环平贴地面；HP 条上移脚踝前；火把×8（前排柱+门侧壁灯）；
   手牌扇压低 y=-40。**同日三轮修正** ✅：斜方向俯视（azimuth=-14° 右侧、elevation=24°）+
   UI 专用正直相机（双相机，卡牌/按钮永远正对）；单位立牌形 billboard（faceCamera 只 yaw，
   立面垂直地面——球面 pitch 后仰效果不佳被用户弃用）；Picker space 路由（UI 命中优先）；
   瑞米改后排（前排下半身被手牌扇遮）。
5. ~~效果 overlay~~ ✅ 2026-08-02（改为血条上方 fxRows 效果行：icon+特征色名称+极性层数，
   hover 弹 tooltip 与卡面热区同协议；fxAnchor 留位）。图标化精简版（仅图标+角标）后续可迭代。
6. ~~场景丰富一轮~~ ✅ 2026-08-02（前后排纵深布局 + 场景拉长 + 拱肋/立地火盆/断楣/吊链/
   废弃吊灯/doorway 踏步/碎石堆/月光束浮尘；相机 azimuth -34°/elevation 20° 用户手调定稿）。
   下一步场景进阶：地板纹理/接缝、更多场景（森林/熔岩等，同 build3D 契约换皮）、前景视差层。
7. ~~浮尘云重做 + 假 GI 提亮~~ ✅ 2026-08-02（月光束浮尘→常驻噪音浮尘云 moonDust.js：
   值噪声漂移 + shadow map 真值定亮暗；环境光 AmbientLight→HemisphereLight 半球假 GI +
   光池假反弹点光×2，暗部不死黑；点光总数 13→15）。
8. ~~光照焦点（战场主补光）~~ ✅ 2026-08-02（HemisphereLight 是全局光无位置/衰减，
   压回 ×3.0 只当保底；新增战场主补光点光悬战线轴中点上空（8000cd/260/1.8），
   物理衰减让战场亮、四周暗；点光 15→16）。
