// 房型配方层 · 命名配方：爬塔四阶段风格流（用户定 2026-09）+ Boss 房 + 隔层特殊房。
//   阶段1（1-10 层，boss1 前）fortress：现状风格加强版——年久失修的杂乱要塞，地面起伏更大，
//     倾斜柱/大块坍塌岩（breaker）多。
//   阶段2（12-21 层）palace：空间缩小 15%（room.scale 0.85），左墙多扇高长窗，
//     墙上精致立柱与横梁（wallStructure 高概率）+ 大量画作旗帜（chapel/cloth 权重），宫殿大厅。
//   阶段3（23-32 层）manor：窗户减少、渐暗，仍宫殿但维护变差（maintenance↑：歪挂墙饰/
//     蛛网/碎屑），道具转向居室/书房（quarters/furniture/library）。
//   阶段4（34-43 层）library：窗户全消，空间再缩 15%（0.7225），大图书馆主题——
//     通顶书柜排架（bookcaseTall）+ 满地书籍碎石，地面再次起伏（维护差），拥挤。
//   隔层 mezzanine（boss4 与研究层之间，不计层数）：左墙一整排中世纪高窄窗透月光释压，
//     地面平整，小花园（fountain/plants/moss）。SDK：getRoomScene('mezzanine', seed)。
// 处方只声明"要什么"（tag 权重/密度/布光），选品与摆位全部在 composeRoom 按红线法执行。
// 视觉调参改这里。

// ---- 阶段 1 · 杂乱要塞（1-10 层）：现行基调 + 大起伏 + 多打断体 ----
const FORTRESS = {
  id: 'fortress',
  theme: 'dungeon',
  lighting: 'torch',
  room: { scale: 1 },
  wall: {
    // 窄高窗（dungeon 处方：短但高——月光大量透入且不破坏纵深感），窗洞几何自动进体积光
    windows: [{ z0: 12, z1: 22, sill: 16, top: 64 }],
    slits: [{ x: -8, y: 54 }],
    brickChance: 0.4,
  },
  // 墙体皮肤 PCG：同色平整墙面 + 少量真特征（剥落/龟裂/透穿洞/坍塌咬口；用户定 2026-09）
  wallSkin: {
    spalls: 3,
    holes: 1, holeChance: 0.8, backHoleChance: 0.25,
    bites: 1, biteChance: 0.6, backBiteChance: 0.2,
  },
  // 要塞年久失修：起伏加大（amp 16），低谷/高台各 2
  floor: { slabCount: 11, mossChance: 0.2, patches: 6, terrain: { amp: 16, basins: 2, platforms: 2, fissures: 1, slopes: 1 } },
  facade: {
    structureProb: 0.5,
    structureOverlapProb: 0.35, // 墙面结构允许同 bay 叠加（装饰=并集层）
    decorProb: { high: 0.12, mid: 0.45, low: 0.4 },
    tags: { barrack: 2.2, generic: 2, quarters: 1, crypt: 0.8 },
  },
  scatter: {
    tags: { generic: 3, barrack: 2, crypt: 1.5, container: 1.2, rubble: 2.4, lightSource: 1, stone: 0.8 },
    scale: 2.2, // 落地件整体放大（用户定：所有物体至少 2~3 倍；相机机位不动）
    bands: {
      back: { cell: 15, density: 0.72 },
      left: { cell: 15, density: 0.66 },
      right: { cell: 16, density: 0.48 },
      mid: { cell: 22, density: 0.2 },
      midRight: { cell: 24, density: 0.16 },
      fgLeft: { cell: 22, density: 0.12 },
      fgRight: { cell: 22, density: 0.12 },
      front: { cell: 22, density: 0.14 },
    },
  },
  decals: { count: 10, tags: { decal: 3, rubble: 1, crypt: 0.8 } },
  ceiling: { chandeliers: 1 },
  bigSilhouettes: ['catapultBroken', 'ballistaRemnant', 'rubblePile', 'columnBasalt'],
  clusters: 3,
  breakers: 9, // 要塞：断柱/坍塌岩/斜板多（用户定：倾斜的柱子、大块坍塌的岩石等比较多）
  maintenance: 0.35, // 维护度：低=歪挂/蛛网少量
  // 火源向场景中央集中（对照 dungeon：视觉中心在中部，不在墙边）
  fires: [
    { id: 'torchStanding', x: -58, z: 20 },
    { id: 'brazierFire', x: 28, z: 28 },
    { id: 'candelabraFloor', x: 18, z: 2 },
  ],
  compositionDecal: null,
  // 雾处方：远墙距相机 ~315，smoothstep  Ramp 压到 ≤0.1 因子；雾色提向环境霾色——
  // 远物融向月夜蓝霭而非纯黑（用户反馈：远视角过暗、拉近才亮，雾吃亮度是主因）
  fog: { color: 0x0e1626, near: 250, far: 640 },
};

// ---- 阶段 2 · 宫殿大厅（12-21 层）：空间 -15%，高长窗列，立柱横梁 + 画作旗帜 ----
const PALACE = {
  id: 'palace',
  theme: 'dungeon',
  lighting: 'moon',
  room: { scale: 0.85 }, // 阶段 2 起空间缩小 15%（用户定）
  wall: {
    // 左墙多扇高长窗（透入月光 + 多道光路）
    windows: [
      { z0: -46, z1: -34, sill: 14, top: 78 },
      { z0: -6, z1: 6, sill: 14, top: 78 },
      { z0: 34, z1: 46, sill: 14, top: 78 },
    ],
    slits: [{ x: 66, y: 56 }],
    brickChance: 0.3,
  },
  wallSkin: {
    spalls: 1,
    holes: 1, holeChance: 0.5, backHoleChance: 0.15,
    bites: 1, biteChance: 0.3, backBiteChance: 0.1,
  },
  // 宫殿地面平整（amp 7），少坑缝
  floor: { slabCount: 13, mossChance: 0.12, patches: 4, terrain: { amp: 7, basins: 1, platforms: 1, fissures: 0, slopes: 0 } },
  facade: {
    structureProb: 0.78, // 墙上总有精致立柱与横梁装饰（用户定）
    structureOverlapProb: 0.5,
    decorProb: { high: 0.3, mid: 0.6, low: 0.5 }, // 大量画作与旗帜
    tags: { chapel: 2.6, quarters: 2, cloth: 2.4, generic: 1.4, arcane: 0.8 },
  },
  scatter: {
    tags: { quarters: 2.2, furniture: 1.8, chapel: 1.4, container: 0.8, lightSource: 1.4, generic: 1 },
    scale: 2.1,
    bands: {
      back: { cell: 15, density: 0.7 },
      left: { cell: 15, density: 0.62 },
      right: { cell: 16, density: 0.4 },
      mid: { cell: 22, density: 0.22 },
      midRight: { cell: 24, density: 0.16 },
      fgLeft: { cell: 22, density: 0.12 },
      fgRight: { cell: 22, density: 0.12 },
      front: { cell: 22, density: 0.14 },
    },
  },
  decals: { count: 9, tags: { decal: 2, rugWorn: 0, generic: 1 } },
  ceiling: { chandeliers: 2 }, // 宫灯多
  bigSilhouettes: ['fountainDry', 'statuePedestal', 'benchHall', 'screenFolding'],
  clusters: 2,
  breakers: 2, // 宫殿完好：几乎无坍塌打断
  maintenance: 0.1, // 维护极好
  fires: [
    { id: 'torchStanding', x: -58, z: 20 },
    { id: 'brazierFire', x: 28, z: 28 },
    { id: 'candelabraFloor', x: 18, z: 2 },
    { id: 'sconceCandle', x: 24, z: -70 },
  ],
  compositionDecal: null,
  fog: { color: 0x101a2e, near: 235, far: 600 },
};

// ---- 阶段 3 · 衰败庄园居室（23-32 层）：窗减/渐暗，维护变差，转向书房居室 ----
const MANOR = {
  id: 'manor',
  theme: 'dungeon',
  lighting: 'moon',
  room: { scale: 0.85 },
  wall: {
    windows: [{ z0: -6, z1: 6, sill: 16, top: 70 }], // 窗户量开始减少（用户定）
    slits: [{ x: -30, y: 56 }, { x: 66, y: 52 }],
    brickChance: 0.4,
  },
  wallSkin: {
    spalls: 3,
    holes: 1, holeChance: 0.6, backHoleChance: 0.2,
    bites: 1, biteChance: 0.45, backBiteChance: 0.15,
  },
  floor: { slabCount: 13, mossChance: 0.3, patches: 6, terrain: { amp: 10, basins: 1, platforms: 1, fissures: 1, slopes: 1 } },
  facade: {
    structureProb: 0.55,
    structureOverlapProb: 0.42,
    decorProb: { high: 0.2, mid: 0.55, low: 0.42 },
    tags: { quarters: 2.6, furniture: 2.2, library: 1.4, generic: 1.2, chapel: 0.8 },
  },
  scatter: {
    tags: { quarters: 2.6, furniture: 2.2, library: 1.4, container: 1, lightSource: 0.9, generic: 1, rubble: 0.8 },
    scale: 2.1,
    bands: {
      back: { cell: 15, density: 0.76 },
      left: { cell: 15, density: 0.7 },
      right: { cell: 16, density: 0.44 },
      mid: { cell: 22, density: 0.26 },
      midRight: { cell: 24, density: 0.2 },
      fgLeft: { cell: 22, density: 0.14 },
      fgRight: { cell: 22, density: 0.14 },
      front: { cell: 22, density: 0.16 },
    },
  },
  decals: { count: 12, tags: { decal: 3, rubble: 0.8, crypt: 0.4 } },
  ceiling: { chandeliers: 1 },
  bigSilhouettes: ['bedFourPoster', 'wardrobeTall', 'tableWriting', 'screenFolding'],
  clusters: 3,
  breakers: 4,
  maintenance: 0.6, // 维护差：歪挂墙饰 + 蛛网 + 碎屑（用户定）
  fires: [
    { id: 'torchStanding', x: -58, z: 20 },
    { id: 'brazierFire', x: 28, z: 28 },
    { id: 'candelabraFloor', x: 18, z: 2 },
  ],
  compositionDecal: null,
  // 渐暗：雾收近、色沉（用户定"房间逐渐变暗"）
  fog: { color: 0x0d1420, near: 205, far: 540 },
};

// ---- 阶段 4 · 大图书馆（34-43 层）：无窗，再缩 15%，书柜排架 + 书堆碎石，地面崎岖拥挤 ----
const LIBRARY = {
  id: 'library',
  theme: 'dungeon',
  lighting: 'torch', // 无月光，火烛主导（密室的幽闭）
  room: { scale: 0.7225 }, // 0.85 × 0.85：空间再次缩小 15%（用户定）
  wall: {
    windows: [], // 窗户全部消失（用户定）
    slits: [],
    brickChance: 0.5,
  },
  wallSkin: {
    spalls: 4,
    holes: 0, holeChance: 0, backHoleChance: 0, // 无窗密塔，洞全关
    bites: 1, biteChance: 0.6, backBiteChance: 0.2,
  },
  // 维护差：地面再次非常不平整（用户定）
  floor: { slabCount: 12, mossChance: 0.25, patches: 7, terrain: { amp: 15, basins: 2, platforms: 2, fissures: 1, slopes: 1 } },
  facade: {
    structureProb: 0.85, // 墙上一排排书柜（bookcaseTall，library tag 主导结构池）
    structureOverlapProb: 0.55,
    decorProb: { high: 0.15, mid: 0.35, low: 0.3 },
    tags: { library: 4, arcane: 1.2, quarters: 0.6, generic: 0.6 },
  },
  scatter: {
    tags: { library: 3, rubble: 2, arcane: 1.2, container: 1, lightSource: 1.2, stone: 0.8 },
    scale: 2.1,
    bands: {
      back: { cell: 15, density: 0.9 },
      left: { cell: 15, density: 0.85 },
      right: { cell: 16, density: 0.5 },
      mid: { cell: 22, density: 0.4 },
      midRight: { cell: 24, density: 0.3 },
      fgLeft: { cell: 22, density: 0.2 },
      fgRight: { cell: 22, density: 0.2 },
      front: { cell: 22, density: 0.2 },
    },
  },
  decals: { count: 13, tags: { decal: 2, library: 1, rubble: 1.2 } },
  ceiling: { chandeliers: 2 },
  bigSilhouettes: ['bookStack', 'rubblePile', 'columnBasalt', 'stalagmite'],
  clusters: 4, // 拥挤感（用户定）
  breakers: 5,
  maintenance: 0.7, // 维护差
  fires: [
    { id: 'torchStanding', x: -58, z: 20 },
    { id: 'brazierFire', x: 28, z: 28 },
    { id: 'candelabraFloor', x: 18, z: 2 },
    { id: 'candelabraFloor', x: -14, z: 30 },
  ],
  compositionDecal: null,
  fog: { color: 0x120f1a, near: 190, far: 520 }, // 闭塞：雾更近更沉
};

// ---- Boss 型：血色基调 + 侧逆光大件剪影 + 道具稀疏而巨大 + 雾重 ----
const BOSS = {
  id: 'boss',
  theme: 'boss',
  lighting: 'boss-rim',
  room: { scale: 1 },
  wall: {
    windows: [{ z0: -16, z1: -6, sill: 26, top: 72 }], // 高窄窗一线（rim 之外的微月）
    slits: [{ x: -30, y: 58 }, { x: 66, y: 52 }],
    brickChance: 0.3,
  },
  // Boss 房：洞少（夜空透穿会泄血色浓度），龟裂/剥落加重（受创的古老砌体）
  wallSkin: {
    spalls: 5,
    holes: 1, holeChance: 0.35, backHoleChance: 0.15,
    bites: 1, biteChance: 0.5, backBiteChance: 0.15,
  },
  floor: { slabCount: 9, mossChance: 0.15, patches: 5, terrain: { amp: 13, basins: 1, platforms: 2, fissures: 1, slopes: 2 } },
  facade: {
    structureProb: 0.45,
    structureOverlapProb: 0.3,
    decorProb: { high: 0.2, mid: 0.4, low: 0.3 },
    tags: { crypt: 2.2, arcane: 1.2, barrack: 0.6 },
  },
  scatter: {
    tags: { crypt: 2.5, arcane: 1, rubble: 1.5, lightSource: 1, stone: 0.8 },
    scale: 2.4,
    bands: {
      back: { cell: 16, density: 0.5 },
      left: { cell: 16, density: 0.48 },
      right: { cell: 16, density: 0.32 },
      mid: { cell: 24, density: 0.42 },
      midRight: { cell: 24, density: 0.24 },
      fgLeft: { cell: 24, density: 0.12 },
      fgRight: { cell: 24, density: 0.12 },
      front: { cell: 24, density: 0.12 },
    },
  },
  decals: { count: 12, tags: { decal: 3, crypt: 1.5 } },
  ceiling: { chandeliers: 1 },
  bigSilhouettes: ['catapultBroken', 'ballistaRemnant', 'stalagmite', 'boulderMossy', 'columnBasalt'],
  clusters: 2,
  breakers: 7,
  maintenance: 0.3,
  fires: [
    { id: 'brazierFire', x: -54, z: 32 },
    { id: 'brazierFire', x: 40, z: 20 },
    { id: 'candelabraFloor', x: 20, z: -2 },
    { id: 'candelabraFloor', x: -14, z: 30 },
  ],
  // 祭坛压敌后排中轴 + 召唤法环贴其前（构图点，不是撒布）
  guaranteed: [{ id: 'altarDark', x: 24, z: -70, ry: Math.PI }],
  compositionDecal: { id: 'ritualCircle', x: 24, z: -62 },
  fog: { color: 0x160a12, near: 185, far: 560 },
};

// ---- 隔层 · 月光花园（boss4 与研究层之间，不计层数）：整排高窄窗 + 平整地面 + 小花园 ----
const MEZZANINE = {
  id: 'mezzanine',
  theme: 'dungeon',
  lighting: 'moon',
  room: { scale: 1 },
  // 特殊色调（用户定）：隔层略偏亮、灰白——grading 随场景契约下发，渲染层消费
  grading: { exposure: 1.12, tint: [1.06, 1.05, 1.03] },
  wall: {
    thickness: 6, // 薄墙（用户定）：godlight 透过更足；内侧面/战斗几何不动
    // 左墙一整排中世纪高**长**窗（用户定：窗本身要高——sill 8 / top 84，h=76 近通顶）
    windows: [
      { z0: -68, z1: -62, sill: 8, top: 84 },
      { z0: -42, z1: -36, sill: 8, top: 84 },
      { z0: -16, z1: -10, sill: 8, top: 84 },
      { z0: 10, z1: 16, sill: 8, top: 84 },
      { z0: 36, z1: 42, sill: 8, top: 84 },
      { z0: 62, z1: 68, sill: 8, top: 84 },
    ],
    slits: [],
    brickChance: 0.2,
  },
  wallSkin: {
    spalls: 1,
    holes: 0, holeChance: 0, backHoleChance: 0, // 窗已够多，不再破洞
    bites: 0, biteChance: 0, backBiteChance: 0,
  },
  // 地面平整（用户定）：amp 0 + 全地形特征关；地面装饰减到最少（用户定）
  floor: { slabCount: 5, mossChance: 0.55, patches: 2, terrain: { amp: 0, basins: 0, platforms: 0, fissures: 0, slopes: 0 } },
  facade: {
    structureProb: 0.4,
    structureOverlapProb: 0.3,
    decorProb: { high: 0.2, mid: 0.4, low: 0.35 },
    tags: { quarters: 1.4, chapel: 0.8, generic: 1 },
  },
  scatter: {
    // 小花园：草木石水（nature/herb/moss 权重）
    tags: { nature: 3.2, herb: 2, pottery: 1.4, stone: 1, furniture: 0.6, lightSource: 0.8, generic: 0.6 },
    scale: 2.1,
    bands: {
      back: { cell: 15, density: 0.5 },
      left: { cell: 15, density: 0.55 },
      right: { cell: 16, density: 0.35 },
      mid: { cell: 22, density: 0.24 },
      midRight: { cell: 24, density: 0.14 },
      fgLeft: { cell: 22, density: 0.16 },
      fgRight: { cell: 22, density: 0.16 },
      front: { cell: 22, density: 0.14 },
    },
  },
  decals: { count: 5, tags: { decal: 1, moss: 2.4, nature: 1 } }, // 地面撒印减到最少（用户定）
  ceiling: { chandeliers: 1 },
  bigSilhouettes: ['fountainDry', 'wellIndoor', 'stumpTree', 'boulderMossy'],
  clusters: 1,
  breakers: 1,
  maintenance: 0.05, // 精心照料的花园
  fires: [
    { id: 'brazierFire', x: 28, z: 28 },
    { id: 'candelabraFloor', x: 18, z: 2 },
  ],
  // 干泉/石盆压中景（花园构图锚）
  guaranteed: [{ id: 'fountainDry', x: -10, z: -30, ry: 0 }],
  compositionDecal: null,
  fog: { color: 0x14202e, near: 250, far: 620 }, // 月透大窗，雾亮一档
};

// ============================================================================
// 休息房配方（用户定 2026-09-11）：**PCG 不只用于战斗，也用于休息阶段房间**
// 与战斗房配方的差异（方法层，详见 quest_prompts/SCENE_REST_ROOM.md）：
//   · 无战斗走廊约束——不追求「中景留空给单位站位」，改为**视觉焦点带**（中景偏上）+
//     「UI 安全区」（画面下方留给休息面板，密度压到最低、只放压边大件）；
//   · 需要**交互锚点**（anchors）：休息房的核心设施（老虎机/银行机/柜台）落位固定，
//     供前端把面板按钮与场景物件对应起来（本次只声明，主流程接线在下一阶段）；
//   · 布光走 `casino` 预设：无窗室内 + 机器灯池（`lamp` 通道：自发光不冒火）。
// ============================================================================
const CASINO = {
  id: 'casino',
  theme: 'dungeon',
  lighting: 'casino',
  room: { scale: 0.86 },   // 赌厅比要塞大厅亲密（空间收缩把背墙拉近、机器占比更大）
  grading: { exposure: 1.1, tint: [1.07, 1.0, 0.93] },   // 暖调（华丽感）：曝光微抬 + 红抬蓝压
  // 无窗室内（无窗 → 无体积月光光束；墙面靠皮肤与挂饰撑），只留一道高窄缝透一点夜光
  wall: {
    windows: [],
    slits: [{ x: -10, y: 58 }],
    brickChance: 0.3,
  },
  wallSkin: {
    spalls: 2,
    holes: 0, holeChance: 0, backHoleChance: 0,   // 室内：不破洞（漏月光会破坏"密闭赌厅"）
    bites: 1, biteChance: 0.35, backBiteChance: 0.1,
  },
  // 地面平整（机器/桌椅要站得稳）：地形特征全关，只留石板错位与少量苔斑
  floor: { slabCount: 9, mossChance: 0.06, patches: 3, terrain: { amp: 0, basins: 0, platforms: 0, fissures: 0, slopes: 0 } },
  facade: {
    structureProb: 0.34,
    structureOverlapProb: 0.3,
    decorProb: { high: 0.2, mid: 0.5, low: 0.3 },
    // 居室/室内陈设压过军事与宗教（镜/挂画/帘幕读作赌厅装潢）；
    // **festoon 高权重**（用户定 2026-09-11：简陋小彩灯是赌厅的"华丽 vs 残破"戏剧对比主笔）
    tags: { quarters: 2.4, generic: 1.2, chapel: 0.5, crypt: 0.3, festoon: 3.2 },
  },
  scatter: {
    tags: {
      furniture: 2.8, quarters: 1.8, container: 1.2, generic: 1,
      lightSource: 1.5, rubble: 0.3, decal: 0.5, stone: 0.4,
    },
    scale: 2.2,
    bands: {
      back: { cell: 15, density: 0.52 },
      left: { cell: 16, density: 0.44 },
      right: { cell: 16, density: 0.44 },
      // 中景是焦点带：桌椅密度最高（两台机器之间要有可读的空隙，故不拉满）
      mid: { cell: 20, density: 0.34 },
      midRight: { cell: 22, density: 0.28 },
      // 前景带 = UI 安全区：只放压边大件，密度压到最低（面板会盖住这里）
      fgLeft: { cell: 30, density: 0.04 },
      fgRight: { cell: 30, density: 0.04 },
      front: { cell: 30, density: 0.05 },
    },
  },
  // 撒印：金币/筹码散落为主（coinScatter = decal+metal）——赌厅地面要有"钱流过"的痕迹
  decals: { count: 22, tags: { decal: 3, metal: 2.4, quarters: 1 } },
  ceiling: { chandeliers: 2 },
  bigSilhouettes: ['wardrobeTall', 'columnRound', 'crateStack', 'barrelStack'],
  clusters: 2,
  breakers: 2,
  maintenance: 0.5,
  // 烛台（带火：赌厅的暖点；**外围光减量**——只留背墙两盏，亮度交给中央暖金光池
  // 与机器灯池，火不再是撑场的光源）
  fires: [
    { id: 'candelabraFloor', x: -25, z: -40 },
    { id: 'candelabraFloor', x: 25, z: -40 },
  ],
  // 构图定点：**核心设施**（老虎机/银行机 + 柜台）。整组压到背墙前（z≈-44）——
  // 休息房的构图读法是"背墙 + 柜台 + 两机"，悬在大厅中央会读成空旷走廊。
  // 机器 1.35 倍放大：它们是交互焦点，体量要压得住场（guaranteed 支持 scale 覆盖）。
  guaranteed: [
    // live: true = **可动组件**（不进静态合批，登记进 room.interactives 由 rig 驱动动画）
    // 体量（用户定 2026-09-11）：老虎机再放大 1.5×（1.35×1.5≈2.0）、银行机放大一倍（≈2.7）
    { id: 'slotMachine', x: -12.5, z: -44, ry: 0.14, scale: 2.0, live: true, name: 'slot' },
    { id: 'bankMachine', x: 12.5, z: -44, ry: -0.14, scale: 2.7, live: true, name: 'bank' },
    { id: 'tableLong', x: 0, z: -47, ry: 0, scale: 1.3 },      // 柜台（两机之间的中轴）
    { id: 'stoolSquare', x: -12.5, z: -37, ry: 0.2, scale: 1.2 }, // 机器前的凳子（暗示可交互）
    { id: 'stoolSquare', x: 12.5, z: -37, ry: -0.2, scale: 1.2 },
    // 「钱」的两个读点：两机旁的钱箱（庄家的进账）
    { id: 'chestTreasure', x: -17.5, z: -44, ry: 0.35, scale: 1.25 },
    { id: 'chestTreasure', x: 17.5, z: -44, ry: -0.35, scale: 1.25 },
    // 赌桌区：中景左右各一张圆桌 + 两凳（"等人下注"的氛围）
    { id: 'tableRound', x: -27, z: -50, ry: 0.4, scale: 1.3 },
    { id: 'stoolSquare', x: -31.4, z: -49, ry: 0.9, scale: 1.1 },
    { id: 'stoolSquare', x: -23.2, z: -51.4, ry: -0.6, scale: 1.1 },
    { id: 'tableRound', x: 27, z: -50, ry: -0.35, scale: 1.3 },
    { id: 'stoolSquare', x: 31.4, z: -49, ry: -0.9, scale: 1.1 },
    { id: 'stoolSquare', x: 23.2, z: -51.4, ry: 0.6, scale: 1.1 },
    // 地毯：机器前的"赌位"（rugWorn = cloth/quarters，作构图件压地面）
    { id: 'rugWorn', x: -12.5, z: -40, ry: 0.1, scale: 1.6 },
    { id: 'rugWorn', x: 12.5, z: -40, ry: -0.1, scale: 1.6 },
  ],
  // 交互锚点契约（主流程接线用）：设施在房间内的位置与朝向 + UI 安全区比例
  anchors: {
    slot: { x: -12.5, z: -44, ry: 0.14 },
    bank: { x: 12.5, z: -44, ry: -0.14 },
    counter: { x: 0, z: -47, ry: 0 },
    // UI 安全区：屏幕下缘起的比例（休息面板将覆盖这一带，构图不在此放精细件）
    uiSafe: { bottomRatio: 0.42 },
  },
  compositionDecal: null,
  fog: { color: 0x1b1219, near: 165, far: 345 },   // 暖暗雾（冷蓝会把"华丽赌厅"拉回地牢）
};

export const RECIPES = Object.freeze({
  fortress: FORTRESS, palace: PALACE, manor: MANOR, library: LIBRARY,
  boss: BOSS, mezzanine: MEZZANINE,
  casino: CASINO,   // 休息房（老虎机 / 银行机）
});

/**
 * 休息房 → 配方映射（用户定 2026-09-11：休息阶段也用 PCG 房间，不再纯 UI）。
 * 本阶段只声明映射与锚点；主流程接线（runController 切场景 + 面板叠加）在下一阶段。
 */
export const REST_RECIPES = Object.freeze({
  slot: 'casino',   // 老虎机 + 银行机同处一室（SLOT_MACHINE.md：二者成对出现）
});

/** 取休息房配方 id；未登记的房间类型返回 null（调用方回退纯 UI）。 */
export const restRecipeFor = (roomType) => REST_RECIPES[roomType] ?? null;
// 隔层：特殊房（不计层数），SDK 直接 getRoomScene('mezzanine', seed)
export const MEZZANINE_ID = 'mezzanine';

/** 取配方；未知 id 抛错（拼写错误宁可炸）。 */
export function getRecipe(id) {
  const r = RECIPES[id];
  if (!r) throw new Error(`rooms: 未知配方 "${id}"（可选：${Object.keys(RECIPES).join('/')}）`);
  return r;
}
