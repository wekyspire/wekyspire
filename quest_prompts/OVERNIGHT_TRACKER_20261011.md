# 过夜超级大任务追踪（2026-10-11 晚）

> 防上下文压缩：需求原文拆解 + 完成状态。每完成一项就回来打勾并记要点。
> 验收纪律（用户定）：尽可能多次迭代、严苛视觉标准、高完成度；美学上保持设计
> 语言与整体风格可自由发挥。

## 批次 0：UI 风格批次 1（已完成，随首个 commit 入库）

- 双字族：标题/数字/短语 = 文道潮黑；成句正文 = 思源黑体 TC Bold（SIL OFL，GB2312 一级零缺字）
- 粗粝噪纹 256²（高频版）、瑞米 12 帧 sprite（加载界面 + 幕间黑屏右下角）
- 加载壳 1:1、合成粗体全线清零、描边发丝级（0.07）、卡面深底拉开对比度
- 权威文档：quest_prompts/UI_LANGUAGE.md（字体章/粗粝/涂鸦/描边纪律）

## 色系任务（卡面配色，用户拍板的优先级）

- [x] **B（最重要）通用灰压暗**：COMMON_THEME #e8e6e0 → **#9a9da6**（appearance.js）
- [x] **A 等阶 = 明度与光泽**：TIER_DIM（D.38/C.24/B.10/A0/S0，边框主题压哑阶梯）+
      TIER_WASH（顶部提亮 .03→.13）；S 流动高光**未做**（静态阶梯已分离等阶，要动效再挂 CardFxLayer）
- [x] **C 边框双色分工**：外框 = 主题色（frameTheme 压哑后）；内描边**全等阶**改等阶色（原仅 B+）；
      四边饰钉 → 等阶色。验收图 tmp/play/cardfont.png（点火 C/B/A + 真拳 S + 纯化 common）
- D 渐变：**不做大范围**，特殊卡除外（用户定）

## 小任务

- [x] **开始界面风格同步**：StartScreen/MenuDialog/MenuPopup/ChangeLog 已同步——按钮标题字族 +
      粗粝纹理叠层（--grit var + ::after screen 混合 .13）+ hover 一律压暗 brightness(.72) +
      标题槽 skewX(-8deg) 招牌斜切 + 去 text-shadow；验收图 tmp/play/startscreen-{1,2,3}.png
- [x] **禁止游戏右键菜单**：App.vue #stage-canvas `@contextmenu.prevent`（canvas 级，
      调试面板输入框的右键粘贴不受影响）
- [ ] **遗物缺失美术 ComfyUI 补齐**：先观察既有遗物美术惯例再生成
  - 12 件全落地（tools/genRelics.mjs + key.py --no-crop + compress_art.py 入库）；
  - **大剑两度返工**：①过窄过装饰被打回 ②prompt 里「cleaver-like」生出单刃大刀再被打回
    （骑士大剑 = 厚重朴素**双刃**直刃长剑）；终案 prompt 锁「straight double-edged /
    two symmetric cutting edges / no engravings」+ per-relic neg 词表，3 候选取 v3
    （最宽最朴素、棱角剑尖贴设计稿）已入库 src/assets/relics/大剑.webp

## 大活：战前准备阶段 UI 超级大更新 —— **全部落地（探针 19/19 绿）**

- [x] 遗物栏**点击快速卸下/装备**（prep 限定）：背囊点击=装备、顶栏点击=可用即用否则卸下
- [x] 准备阶段的「激活遗物栏」**移除** → 纯背包遗物栏（RelicLoadoutObject 重写：
      背囊区+恒生效行+提示行；拖拽双向保留：背包→顶栏窄条=装备、顶栏→背囊区=卸下，
      落点矩形实时换算；超容量点击=摇头+染红，拖拽悬停超容=ghost 染红预告）
- [x] 遗物槽进度条 → 粗粝加载条风味（RelicSlotMeterObject：grit256 平铺填充 +
      分隔刻线轨道 + 变化脉冲），钉顶栏窄条右缘（tick 每帧随从），**仅 prep 可见**
- [x] 层数显示：TowerFloorBadgeObject 钉塔身（深底方牌+白字「N 层」，Boss 层红字），
      跨层与相机爬升同拍滑行（同 duration/power2.inOut）
- [x] 右缘刻度尺 TowerRulerObject：44 白刻度（普通短/逢 5 中/Boss 长红/当前最长），
      竖直细黑导轨衬出白刻度；跨层亮浪扫过（26 层/秒）+ 当前层弹性伸长；hover 提亮+浮层号
- [x] 左侧敌人预览 EnemyPreviewObject：大立牌 17wu（Boss ×1.22 红名）+ 脚下软影 +
      逐张交错上浮入场 + hover 抬升；prep 面板删掉层数/距Boss/敌人文本行

### 大活验收轮（2026-10-12 凌晨）

- 探针 tmp/play/check-prep-overhaul.mjs（存档 prepui：F5/slots4/4装+号角+北山岩）：
  静态就位 7 项 + 交互链 8 项 + 亮浪/滑行 4 项 = **19/19 绿**；截图 prep-overhaul-1~7.png
- 修出的实坑：
  ① **读档相机滞留 1 层**（潜伏旧 bug：_cameraFloor 构造即锁 1，读档无 arriveFloor 调用——
     塔 art 每层同图所以一直没人发现；层数牌把它照出）→ App.vue 开机 `snapCameraToFloor()`；
  ② 探针两坑：截图要等什么 = `!_riseTween` **且** boot-shell 消失（vite 重变换后首拍慢）；
     denyT 0.4s 窗口跨进程采样会漏 → 页内 30ms 轮询蹲守；
  ③ MapStage._bakeLabel 是海报烘焙（固定 16px 不吃 fontPx/tint）→ 新 UI 件 bakeText 传
     **null** 走 TextBlockObject 缺省 bakeAutoLine（字号/色调才生效）；
  ④ 塔面实机尺度 1wu≈61px（非 uiScene 的 7.2px）——层数牌首版 6.4wu 糊满塔面，收 2.9wu；
  ⑤ 刻度尺首版 0.16wu 细灰线雪地隐身 → 0.26wu + 提亮 + 黑导轨衬托。
- 大剑 v3 入库；候选 v1/v2 留档 art_src/遗物/out_comfy/大剑_v{1,2,3}.png 供用户翻牌。

## 过程记录

（随进展填写：关键决策 / 旋钮位置 / 验收轮次结论）

### 2026-10-11 深夜（批次1后续）

- **main.css 是孤儿文件**（无 import，自 shell 重写后失联）——批次1把双字族栈写进了孤儿文件，
  DOM 层字体实际从未生效（探针 computed = Times New Roman 抓出）。修复：栈与 --font-display
  挪进 App.vue 全局 style 块，main.css 已 checkout 回退。教训：改全局 CSS 前先确认文件被谁加载。
- dev 服务器（5177）进程早于 0.13.x 版本提交启动，开始界面版本行显示旧值（构建期注入）；
  重启 dev 服务器即新——非代码问题。

### 遗物缺图（小任务③）

- 缺图清单（12）：塔的石头/鸟羽/拾荒者的口袋/架势镜/胀满的背包/守夜灯/火中栗/共鸣石/
  囤囤鼠之宝藏/破釜/大剑/戟（registry 58 名 vs assets 48 图 diff 出）。
- 惯例：art_src/遗物/PROMPT_TEMPLATE.md——柔和厚涂低完成度、单物居中 55–70% 高、
  白描边贴剪影、透明底、1024² 带留白；描述留白纪律（高频名词诱发过度刻画）。
- 落地方案：用户点名 ComfyUI → tools/genRelics.mjs（沿用 genEnemies 的 qwen2.1 工作流，
  **洋红底**——白描边会被白底洪水抠图吃掉，沿袭 seedream 遗物管线 chroma 思路）；
  key.py 加 `--no-crop`（原行为裁包围盒，遗物要保 1024² 留白）。
- 试跑塔的石头：风格/抠图一次过（暗底合成验收干净）。批跑 11 件进行中。

### 大活：战前准备 UI 大更新——布局定稿（动工前设计）

- 屏幕分区：左 = 敌人预览（大立牌+名称，EnemyPreviewObject 新件）；
  右 = 塔楼 + 塔身层数牌（TowerFloorBadge，平面白字「第 N 层」钉在塔上随层滑动）；
  屏幕最右缘 = 刻度尺（TowerRulerObject 新件：每楼层一根白色短横线，Boss 层长红、
  每 5 层中档、当前层最长最亮带层号；跨层滑动动效 + hover 交互）；顶 = 资源行 +
  遗物槽位条（RelicSlotMeterObject 新件，粗粝加载条风味，仅 prep 显示）。
- 面板只剩：标题 / 删卡机会 / 背包遗物栏（纯背囊，点击=装备）/ 进入战斗。
- 装卸交互：背包点击=装备（canEquip 快照门禁，超容量不给意图只给压暗/摇头反馈）；
  顶栏点击=卸下（可用遗物点击=使用，沿用）；拖拽双向保留：背包→顶栏遗物行=装备，
  顶栏→背包区=卸下。drop 判定靠 stage 提供的实时矩形换算回调。
- core 侧零改动（equip/unequip/useRelic 意图链既有；equipRelic 超容量是抛错，
  必须在 Stage 门禁拦下）。
- 触碰文件（本批）：src/stage/objects/RelicLoadoutObject.js（重写）、RelicSlotMeterObject.js（新）、
  TowerRulerObject.js（新）、EnemyPreviewObject.js（新）、TowerFloorBadgeObject.js（新）、
  src/stage/objects/TopResourceBarObject.js（+stripWorldRect/stripRightX）、
  src/stage/stages/MapStage.js（接线+snapCameraToFloor）、src/stage/panels/prep.js（瘦身）、
  src/shell/App.vue（开机 snap 一行）。

### 2026-10-09 试玩回归批（低血渐晕 + 开始切幕）

- **低血渐晕返工**（src/stage/objects/screenImpactFX.js）：阈值 20%→40% 起渐入、8% 拉满，
  level 曲线改 smoothstep（入档平缓、越深越陡）；层次感 = 浅层（level<0.30 ≈ hp>28%）只有
  慢呼吸压暗、深层才挂「lub-dub」双搏心跳（高斯主搏+次搏，心率 0.95→1.80Hz ≈ 57→108 BPM、
  搏深 +50% 随档淡入）。心率随档变化 → 心跳相位积分推进（乘式会跳相）。
  探针 tmp/play/check-lowhp-heartbeat.mjs 7/7 绿（35% 微暗无心跳 spread 0.003；
  12% spread 0.17 主搏 5 次/2s；浓度单调递增）。截图 lowhp-35/12/6.png。
- **开始游戏走切幕**（src/shell/App.vue）：App 自持 menuWipe（createSceneWipe）+
  顶层常驻 SceneWipeOverlay（与 ctrl.sceneWipe 那层永不同期激活）；onStart = begin →
  toCover → 全黑中点 newGame → reveal。EndPanel「再来一局」同路径（@restart 改指 onStart）。
  autoStartFromUrl（?debug=1&save=）与调试面板重载仍直切（探针不付 1.7s 切幕税）。
  探针 tmp/play/check-start-wipe.mjs 6/6 绿（cover 期 ctrl 未建、reveal 时已就位、全程 2162ms）。
  截图 start-wipe-0~3.png。
- 踩坑：harness 的 clickPanelBtn 只认 RoomStage 面板（rs._stagePanel ?? rs._panel），
  prep 面板在 MapStage 上要手写 screenOfUi 表达式点（本轮又踩一次）。

### 2026-10-09 卡牌脉冲 shader 化（pulse 全链路返工）

- **动因**：用户指出卡牌各类 pulse 动画相当部分是「简单叠加彩色半透明方块」，太过简陋。
- **落地**（src/stage/objects/CardFxLayer.js）：pulse() 纯色块 → 单 TSL shader 三模式能量面片
  （控制量打包 uVecA=[prog,mode,intensity,seed] / uColor / uVecB=[cardW,cardH,reach,-]——
  r185 实测 Fn 参数 ≤4 才安全，超参整体猝死；牌面宽高/边距走 uniform 不烘字面量）。
  - mode 0 涌动：冲击波亮环外扩（外锋锐/内尾拖）+ 中心注能闪 + 边框共振（环越牌边时
    逐片元充电，相位天然锁定）+ 环带闪点 —— 冷却推进/施术起手。
  - mode 1 汇聚：环自牌缘加速内坍 + 末段中心迸发 —— 衰败反向/手牌挤压。
  - mode 2 流扫：42° 丝质流光带 easeInOut 扫掠 + 尾随淡回波 + 闪点 —— 威力提升/晋升镀金。
  - 包络/环程全在 shader 内由 uProg 驱动，JS 只推进度；旧 scale 参数折算环程系数 uReach；
    HDR 纪律：环锋/闪点可过 1.45 bloom 阈（intensity 推），填充压阈下防洗白。
- **调用点语义接线**：冷却 tick 绿=mode0/intensity0.9；衰败暗红=mode1；威力金=mode2/1.15；
  手牌挤压红=mode1；晋升金×2=mode2/1.25；cardFlare 施术起手=mode0/1.2（环锋吻 bloom）。
- **验收**：check-card-pulse.mjs 10/10 绿（uniform 推值 + PNG 解码像素签名——绿1121/红3818/
  金1167 像素实证「真渲染了」，底帧签名 0）；check-card-flare-live.mjs 真打 punchC 全链路过。
  证据截图 card-pulse-wide-m0-surge/attack、m1-converge、m2-sheen.png。
- 探针坑：_pulseTl.elapsed 单位是**秒**（跳读定格别拿毫秒乘）。

## 批次：塔楼层层链 chrome + 场景压暗（2026-10-12 凌晨，本批未提交）

- **层链 chrome 世界 billboard 化**：`stage/objects/FloorChromeObject.js`（新）取代
  TowerFloorBadgeObject（已删）——塔左缘悬空链条：塔钉（菱形）→短横→**无底板悬空层号**
  （描边+软投影分离空气，Boss 层吃红+塔钉/短横同步红）→引出线（两端渐隐）→敌人预告。
  敌人预告从 uiScene 迁入世界场景（EnemyPreviewObject：picker 去 space:'ui'、加 setFade
  宿主淡出因子、layoutHalfWidth getter、材质 fog:false）；TextBlockObject 材质全局
  fog:false（世界场景内文本不吃指数雾）。chrome 全件 fog:false + depthWrite:false。
- **爬升 fade 编排**：arriveFloor 爬升起 fadeOut、回执路径 fadeIn（fadeIn 挂在
  _riseDone 包装里——_settleRise 提前收口也补 fadeIn，链条不会死在透明态）；
  MapStage tick 逐帧 faceCamera（屏幕平行 billboard，视差摇摆自然跟随）。
- **布局自适应**：链条总宽预算 9.3wu（1280×720 塔缘→左屏缘 567px；px/wu 只随视口
  高度变）；行宽超预算先缩预告比例、引出线在 [0.8,2.2]wu 吃余量。层号位数变化
  经 _rebake→_relayout 自动重排。
- **场景压暗（只动光照，不动反照率）**：towerWilderness hemi 0.09→0.045
  （地面色 0xdadcde→0x9aa0a8）/ rim 0.19→0.09 / central 2→0.8 / **track 50→13**。
  天空穹颜色不动 → 全场只剩天空相对亮，塔身近剪影，败塔氛围 + 悬空白字自然 outstanding。
- **验收**：shot-prep-chrome.mjs 13/13 绿（几何投影/世界空间 hover 拾取/fade 行为/
  Boss 染色/真爬升路径自动 fadeIn）。证据截图 prep-chrome-after/boss/fadeout/climb-mid/
  climb-done.png。
- 坑：gsap tween 过的普通对象会被挂上 _gsap 循环引用——探针 JSON.stringify 前先摘字段；
  调试面板 setFloor 跳层不走 arriveFloor（相机不爬）——截图验证要 snapCameraToFloor 补锚。

## 批次：雪花落地衰减 + 遗物装卸交互返修（工作区未提交）
- **雪花**：towerWilderness.js 雪片着色加 vWorldY varying，fragment 按世界高度
  smoothstep(GROUND_BASE_Y+0.8 → +7.0) 乘进 color（×mix(0.3,1)）与 alpha——近地面变暗变透明。
- **ZoneFrameObject 新建**：拖放区域高亮框（uiScene）= 四角 L 角码 + 细边线；
  show=角码从角外 back-out 滑入 + 边线淡入 / setActive=呼吸 / flashThenHide=落定闪+延时自收。
- **遗物交互链**：顶栏 hover 抬升 1.08 / 按下回缩 0.92 / 可用点击弹跳 1→1.24→1；
  点击卸下=icon 弧线飞背囊+落点框闪；背囊点击装备=icon 飞顶栏下一槽+窄条框闪；
  双向拖拽=src/dst 区域框 + 悬停 over 呼吸 + 无效染红；拖拽开始即 TOOLTIP_HIDE（tooltip 让位）。
- **坑①（uiScene 单位错觉）**：uiScene ≈7.3px/wu——角码臂长 0.62wu、边线 0.045wu 全部
  亚像素不可见（初审当「整圈细矩形」）。重定标：边线 0.14wu≈1px，臂长按框尺寸自适应
  clamp(min(w,h)×0.28, 1.2, 2.4)。**uiScene 新建件先算 px/wu 再写尺寸常量**。
- **坑②（快速连拖竞态）**：`_setDropFrameFx` 只在框 invisible 时 setRect——上一链落定闪的
  延时 hide 在途时开新拖，框带着旧矩形上岗（截图实证落点框画在背囊）。修法两面：
  setRect 无条件化（8 片重摆零成本）+ flashThenHide 把 flash+延时 hide 收进对象内、
  show/hide 杀在途 autoHide（delayedCall 不被 killTweensOf 管，必须自持句柄）。
- **验收**：check-relic-dnd.mjs 18/18 绿（hover/按压/双点击飞行/双拖放/落定清场/
  快速连拖矩形断言）。证据截图 relic-drag-frames/hover-bag/to-topbar、unequip/equip-done、
  snow-ground-fade.png。初审走的 glm-flash + 自查放大裁剪（python PIL crop+NEAREST 4x）。
- 已知轻残留：装备落定后指针未动时 tooltip 保留被消耗背囊件的悬停内容，动指针即清（常态 hover 语义）。

## 交互问题四连批（2026-10-12 凌晨，全部未提交）

1. **肉鸽续玩失效**（StartScreen.vue）：`canContinue` 的 `!isStory` 漏 `.value`（ref 恒真→恒 false），
   d8a3ae5 引入。一行修复；check-save-resume.mjs 全链绿（首页按钮 → 点续玩 → 落 prep）。
2. **老虎机拉杆可交互**（slotMachineRig.js + machines/slotMachine.js）：隐形杠杆代理盒进拾取表，
   hover 预示下压 + 火光提亮（rig `setLeverHover`）；点击 = 可拉时 `spin` 意图，不可拉时聚焦机器。
   模块 handleClick 优先于通用路由消费。check-slot-lever.mjs 5/5。
   坑：canSpin 在 panelSnapshot 派生层不在 run.slot；奖品特写会吞 hover（探针先 hover 后点击）。
3. **训练房继续键防误触**（RoomStage.js）：`_campContinueGated()`（campTraining/training）——
   训练未开始整枚隐藏（visible=false → Picker visibleUp 防线，压暗仍会被点中不如不存在）；
   聚焦机器时点继续 = 只退焦不收房。check-camp-continue.mjs 8/8。
   坑：存档字段是 `run.roomData.trained`（快照映射 `training.started`）。
3b. **敌人预览竖排**（FloorChromeObject.js）：横排链（引出线横穿敌人行=重叠病根）改竖向堆叠——
   塔钉→短横→层号横排不动，预告行悬在层号正上方居中（GAP_V 0.3wu）；引出线/线端点删除。
   MapStage 只摆位转发零改动。shot-prep-chrome.mjs 断言改竖向口径 14/14。
4. **刻度尺重做**（TowerRulerObject.js 重写 + MapStage 一行指针源）：
   - 死黑导轨删除；白刻度自带软阴影纹理（共享烘焙，bar+shadowBlur 一体，颜色走材质 tint）。
   - 近层窗口：|Δ层|≤2 全显，向外 6 层渐隐到地板值（普通 0.045 / Boss 0.16=章节路标）。
   - 指针临近：MapStage 每 move 转 UI 平面坐标喂 `setPointer`（拖拽/模态吞掉时喂 null）；
     列横向邻域内按纵向距离 smoothstep 推 `zoom` → 长度 ×(1+0.55z) + 明度 max(win, zoom)。
   - hover：隐形脂肪拾取带（可见线仅 2px 高抠手）；冒泡框 = 单纹理烘焙（深底+淡蓝细描边+
     右尾巴+两行「N 层 / 房型」），几何右缘中心为原点，back.out pop 从刻度尖长出，帧跟随线尖。
   - 房型确定性来源：`isBossFloor/isPreBossFloor/isTrainingFloor`（runFlow）+ `isShopFloor`
     （rooms/shop）+ `GURPAS_FLOOR`（rooms/gurpas）；自由层现场随机 → 「事件 或 老虎机」。
   - check-ruler.mjs 13/13；截图 ruler-idle/prox/bubble/bubble-boss 自审过。
   坑：uiScene 烘焙换算 7.2px/wu（720p）；op 是帧推的，断言前先 waitIdleFrames 收敛。

## 遗物拖拽两修复（2026-10-12 凌晨，未提交）

- **顶栏→背包拖下 GPUValidationError**（TopResourceBarObject.js）：`disposeSubtree` 对遗物槽
  贴图（120×120 = SLOT 4.0×10×3x）直销毁，卸下重建时在飞 submit 仍引用 → WebGPU 报错。
  换图/清场四处全走 `deferDisposeTexture`（disposeSubtree / 窄条与金币换图 / dispose 尾销）。
- **背包→顶栏拖放「额外粒子诞生跳走」**（RelicLoadoutObject + MapStage）：落定即弃拖拽 ghost
  又原地新建飞行件（scale 0.85 pop = 「诞生」观感）。修为 ghost 原对象移交：`_onEquipFx` 增
  `ghost` 参，MapStage 换父到 uiScene 接力 `_flyRelicGhost`（ghost= 分支本就为此备）。
  宿主编排缺位时回落弃置（防泄漏）。
- 回归：check-relic-dnd.mjs 扩 5 断言（consoleErrors 监听、ghost 同一性 same/n=1、无 pop
  scale=1.00）23/23 绿。

## 楼层 chrome 常驻化 + 刻度尺章节化（2026-10-12 凌晨，未提交）

- **大标尺常驻 marker 化**（FloorChromeObject v2 重写）：每层一枚常驻 billboard 组（塔钉+引出线+
  「N层」数字牌），显隐/缩放不排期——逐帧按 `|取景高 lookAt.y − 层锚| / 层距` 邻近度驱动
  （NEAR full 0.18 / gone 0.9 / zoom 0.1），日后一次跳多层不用写动画。**未登陆层 maxOpacity
  mask**：`setFloor` 只动指针，`markLanded` 才推水位线（arriveFloor 落定回执 / snapCameraToFloor
  / 同层 setFloor 三处调）——爬升途中下一层牌不提前亮（elig lerp dt*5 → op 乘 elig）。
- **敌人预览独立轨道**：挂当前层 marker（居中于数字牌上方 GAP_V 间距），prep 显隐走 `_fade.prep`
  包络；拾取注册不变（EnemyPreviewObject 内部世界空间 pickable，换父照转）。
- **刻度尺 v2**（TowerRulerObject 重写）：只画本章 11 层（FLOORS_PER_CHAPTER），竖窗 WIN_H=11wu +
  上下 EDGE_FADE 渐隐；滚轮步进（`_scroll` lerp `_scrollT`，换层同章自动归中）；临近 zoom /
  hover 冒泡 / 同章爬升亮浪全保留。锚点 = MapStage 每帧把「塔左缘 @ 取景高」worldToUI 喂
  `setAnchor`（lookAt 点恒投同一屏位，锚天然稳定）。
- **坑①（真 bug）**：panelHost 混入在类定义**之后**往 prototype 装 `handleWheel`，把 MapStage
  类体同名方法静默盖掉——滚轮全进 pickerKit。修为 mixin 先问舞台钩子 `_handleStageWheel`
  （返真即拦截），MapStage 类体方法改名钩子。**教训：往三舞台加方法先查 panelHost 装没装同名。**
- **坑②（探针）**：启动壳 `position:fixed` → offsetParent 恒 null，旧等待条件秒过；
  正确判据 = 节点摘除或 `.bye` 类（pointer-events:none）。
- 回归：shot-prep-chrome 15/15（含未登陆层压 0 / 爬升中水位线不动 / 目标层不提前亮）、
  check-ruler 18/18（本章 11 根 / 贴塔左缘 Δx / 窗口渐隐 / 滚轮门控双向 / 冒泡 / 亮浪 / 变章重建）、
  check-relic-dnd 23/23。截图 ruler-idle/ruler-bubble/prep-chrome-climb-mid/boss 自审过。

## 收刃/藏锋刀光落玩家修复（2026-10-12 凌晨，未提交）

- **根因 = 1c0d45f（0.13.0 英文 id 规范化）codemod 误改 FX 词表**：FX 命名空间的
  kind/mode 字符串被当卡 id 一并改名——`kind: 'slash'→'slashC'`、`kind: 'punch'→'punchC'`、
  bladeCast `mode === 'slash'→'slashC'`；而消费方（runDamageBeat 的 case、bladeCast
  自动路由的 'slash' 产出）没跟上。后果双断：① 单体刀法卡（斩链/收刃藏锋链/一切无显式
  mode 的对敌刀法）施术拍 auto 路由 'slash' 无分支 → 落穿到 self = **绕身刀光打在玩家身上**
  （用户实报）；② 刀/拳/格挡全系**伤害拍命中特效静默全灭**（kind 无匹配 case）。
- **修 = 回改 FX 词表**（AGENTS.md 白纸黑字 kind 词汇 = slash/flameslash/punch/…）：
  bladeCast 分支回 'slash'；damageFx kind 回 'slash'/'punch' ×2；index.js
  pointShot/piercingShot 显式 mode 回 'slash'。共 5 处。
- **防再犯**：同名撞车 namespaces 已有五处（美术键/效果/能力/敌招式/房型），FX kind/mode
  是**第六个**——卡 id 改名 codemod 不得扫 `src/stage/fx/`。
- 验证：check-sheath-fx.mjs（prepui 档进战斗 + dbgCall 加卡 + playCard 真链路）——
  词表对账 slash/slash/punch ✓、收刃施术 playerAnchor 起飞 + playerUnit 零调用
  （self 绕身特征消失）✓、拳卡伤害落账 ✓、无 GPUValidationError ✓；静态对账
  damageFx 产出/消费 kind 集全等。探针坑两枚：deps 的 unitAnchor/targets 在
  _runSpellFx 字面量段会**盖掉** _spellDeps 包装（拦点只能选 _spellDeps 段字段）；
  uniqueID 是字符串，eval 插值要 JSON.stringify。

## 大标尺左移让位刻度尺（2026-10-12 凌晨，未提交）

- 用户截图实报：两件都锚塔左缘 → 大标尺的钉+引出线与本章刻度尺竖带重叠。
- 修 = MapStage chrome `anchorFor` 左探 0.22 → **1.8wu**（带最宽静态刻度 45px+右缘 5px+
  钉半宽 20px+余隙，世界 61px/wu 口径换算）。marker 整体（数字牌/钉/敌人预览）随锚平移，
  内部相对布局不变。
- 验证：shot-prep-chrome 15/15（相对布局不变量全绿）；check-ruler 锚定断言换「钉右缘 <
  条带静态带左端」真不变量（旧断言只卡死两点距离）18/18；boss 层截图自审无重叠。

## 刻度尺精英橙/HDR 当前层/爬升同拍 + 敌人预览换父修复（2026-10-12 下午，未提交）

用户四连：① 小标尺精英层橙色；② 爬升时小标尺游标要顺滑（匹配相机缓升节奏）；
③ 当前层发光标出（略 HDR 喂 bloom）；④ 大标尺敌人预览爬升时挂错楼层（已 clear
层亮出下一层敌人 → 半途闪烁消失 → 落定才正确）。

- ① `TowerRulerObject`：import core 的 `isEliteFloor`（章内 6/9 层，与 5 层中档/Boss
  层无交集），COL 增 elite 0xeda24e；`_colOf` 精英支 + `_descOf` 冒泡第二行
  「精英战斗」橙。
- ③ 当前层材质色每帧直写 HDR `setRGB(1.62,1.78,2.24)`（略过 bloom 阈值 1.45；
  亮浪途经再 ×(1+0.9·bright)；fxPost 关闭档退化为纯白可接受）。
- ② 新增 `setScrollFloat(v)`（_scroll/_scrollT 同写，帧内 lerp 空转）；
  `MapStage.arriveFloor` 的相机补间 onUpdate 里按同一 proxy.k 喂
  `fromFloor + (floor-fromFloor)*k`——同 duration 同 power2.inOut，根治原
  dt·8 指数收敛与 5s 缓升节奏脱节。
- ④ **根因如用户所判 = 预览全局单例换父太晚**：`FloorChromeObject.setFloor` 原只在
  prepWanted 时 `_placePreview`，且目标层牌不存在（懒建只盖 ≤_landed）→ 换父静默失败，
  预览滞留旧层牌 + setEncounter 先换了内容 = 旧层牌顶新敌人。修 = setFloor 无条件
  `ensureMarker(floor) + _placePreview()`：新层牌未登陆被资格标量压着不亮相，预览随牌
  在落定那刻携正确内容淡入，旧层牌空手退场。三个症状一剂全除。
- 验证：check-ruler 扩到 26 断言全绿（精英橙材质/文案、当前层 HDR 读数、爬升中段
  游标 ∈(5,7) 且预览 parent=floorMark:7 且未亮相、落定 scroll=7 且携预告淡入）；
  shot-prep-chrome 15/15 回归；截图 ruler-idle/ruler-climb-landed 自审通过。

## 「楼层通过」演出：本层敌人残影开裂→灰暗→崩解成灰（2026-10-12 下午，未提交）

用户需求：战后回塔楼那一拍原本空演，现播「本层怪物预览逐个开裂、灰暗、变为粒子
随风消散」（GPU 粒子 + 手写 shader）；此后爬升途中本层不再显示怪物。

- 捕获：`runController.endBattle` 胜利分支在 finishBattle 之前把 `run.encounter`
  快照成 `pendingClearFx`（{floor, boss, enemies:[{defId,name}]}）；`afterRewardToFloor`
  的 ② 拍切幕后经 `awaitFloorArrive(..., {clearFx})` 下放（消费即清，防串层）。
- 节拍：`awaitFloorArrive` 双闸——指令只在 爬升回执 AND `clearHandle.visualDone`
  齐到才放行。**房间层（原地 resolve 无爬升）靠 visualDone 把房间切幕压到崩解演完
  之后**（否则 onExit→cancelClear 会把演出掐死在半空——探针首轮实踩）。
- 面片：`fx/floorClearFx.js` playFloorClearRow——逐敌残影 = MeshBasicNodeMaterial
  立绘采样 → clearShade（双层山脊噪声裂纹自中心扩开 + 前沿一闪 → 去饱和压暗成
  冷灰 → ashErodeField 阈值侵蚀成孔 + 孔缘灰白亮线）；逐敌 stagger 0.70s。
- 粒子：`fx/gpu/floorAsh.js` FLOOR_ASH custom 类型（cap 640）——rejection 采样
  立绘剪影 × 侵蚀前锋带（ashErodeField 与面片 shader 同一份场函数，粒子出生点
  必然贴着缺口前沿），微浮力上飘 + 强风响应（随风消散是语义主体）。
- **单源发射纪律**：stagger(0.70) ≥ 侵蚀窗(0.63)，同一时刻至多一敌在侵蚀段 →
  floorAsh 只开一套发射 uniform（uTex/uModel/uQuad/uFront/uSeed），驱动侧逐帧
  挑出正在侵蚀的那只换挂（burnEmission 逐槽换挂先例）；发射闸 = rateScale。
- **残影挂 chrome 根不挂层牌组**：爬升时层牌远去会压 visible(op<0.003) 把崩解
  尾巴吃掉；挂根组 + 每帧照层牌世界位/billboard 四元数换算位姿即可。落地时与
  prep 预告同位交叉淡入淡出（同一批敌人同一锚点，读感 = 预告就地崩解）。
- MapStage：懒建世界池 mapWorldFx（onEnter 首个 tick 前）+ playFloorClear 门面 +
  onExit cancelClear + dispose 清池。
- 探针纪律（两处采样过早误诊，非产品 bug）：灰粒子 alive 读回在侵蚀窗开启后
  有约 0.3s 前峰爬升（fbm 带宽度随 front 张开 + 8 次 rejection 低接受率段），
  断言要在侵蚀后段采；层牌落定 op/elig 是双斜坡（dt·9 / dt·5），落地即读只有
  ~0.1，要等收敛。另：池 typeApi/useType 只认**数值 typeId**（defineParticleType
  返回值），名字符串必抛「未登记」——探针传参注意。
- 验证：check-floor-clear 真链路（战斗胜利→领奖→回塔楼）全绿（残影 3 只/挂根/
  逐个崩解/灰活着/收编/无 GPUValidationError）；check-floor-clear-climb A/B 段
  隔离核验（静止与爬升同拍 alive 峰值 221/213 相当）；shot-prep-chrome 15/15 +
  check-ruler 26/26 回归全绿。

## 房间表开局定死 + 标尺房型线头符号（2026-10-12 下午，未提交）

用户需求：固定种子的塔楼在开局就确定每层是老虎机房还是事件房；小标尺用花纹/形态
标出房型，给玩家战略规划空间。

- core：`runFlow.buildRoomTable(seed, totalFloors)`——派生流 `createRng(deriveBattleSeed
  (seed, SALT))` 逐层跑 `roomOfFloor`，**不消耗 run.rng 主账本**（奖励序列不受影响）；
  `createRun` 建表挂 `run.roomTable`；消费口 `roomOf(run, floor)`（表优先，无表 fixture
  回退旧现场随机）；completeRewards 改读表。
- 存档：`snapshotRun` 带表；`restoreRunFromSave` 无表旧档按种子重导（表只裁决未来层，
  无副作用）；调试档房内现场 > 表（表本层向 currentRoom 对齐）。
- 标尺视觉**第一版密铺花纹被用户否决**（频率太高、不可读不美观）→ 改**线头符号**：
  房层刻度左尖端挂小几何符号（◆老虎机 / ?事件 / ▲营地&训练场 / ■商店 / ★古尔帕斯），
  共享烘焙纹理 + 逐帧随线尖位置/明度/色同步（HDR 当前层与亮浪照常染符号——正交通道）。
  hover 冒泡报真实房型（slot 金 tint——金钱相关内容允许金；精英/Boss 层战斗语义优先）。
  符号尺寸教训：0.7wu（5px）下五形糊成点，1.05–1.3wu（8–9px）才可读。
- 推送链：App.vue newGame 一次 `mapStage.setRoomTable(run.roomTable)`（表静态整局，
  MapStage 与 ctrl 同寿命）；标尺 `setRoomTable` 存表 + 重建本章刻度 + 冒泡重烘。
- 验证：`tmp/smoke-room-table.mjs` 11 断言全绿（同种同表/异种分叉/固定层规则/主账本
  零消耗/RunDriver 两章零失配/存档往返/旧档重导/房内对齐/fixture 回退）；
  `check-ruler-glyphs.mjs` 全绿（表一致/符号有无与房型一一对应/贴线尖/冒泡文案）+
  4× 放大截图自审（五形可辨、精英橙三角正交合成）；check-ruler 26 + shot-prep-chrome
  15 回归全绿。注：冒烟限 1-2 章——章 3 敌人内容未铺（floor 27 无模板），与本次无关。

## 标尺爬升修复 + 总览模式 + 粉碎口 hover 门控（2026-10-12 晚，未提交）

- **粉碎口 hover 门控**：machines/slotMachine.js `hover()` 的粉碎口提亮加
  `rig.devourReady()` 条件——吞噬进度没满时悬停不再给 glow（与拉杆「拉不了不闪」同纪律）。
  验证 check-crusher-hover 6 断言全绿（未就绪不亮/就绪亮/移开灭/用掉后不亮/真实指针链路）。
- **爬升标尺「纯闪烁」病根**：战后 `swapBattleToMap` 的静默 `setFloor(N+1)` 在爬升前
  ~1.2s 就把标尺 `_floor/_scrollT` 预推进——① animate 拍因 `floor===_floor` 早退，
  亮浪永不建；② scroll 在窗口期 dt·8 收敛到 N+1，爬升 tween 首帧 `setScrollFloat(N)`
  绝对驱动 = 全条带瞬移回跳。修法 = 呈现层 defer：`MapStage.setFloor` 按
  `_cameraFloor !== floor`（相机还在旧层 = 爬升待播）传 defer，标尺按兵不动；
  `snapCameraToFloor` 补标尺直落核销（读档/调试跳层传送语义，runDebug setFloor 已加调）。
  变章重建不受 defer 约束但 scroll/当前层同样留给 animate 拍（跨章爬升同款跳变一并消）。
- **亮浪改骑 scroll 游标**：旧 head 按 26 层/秒自跑（单层爬升 38ms 闪完，与相机脱节）；
  现 head = clamp(scroll)（爬升 tween 逐帧直写），途经层随相机点亮、落定帧目标层触发
  抵达闪光。坑：arrived 的 0.02 epsilon 比「head 爬到 to」早两帧，落定帧要把目标层
  视同已过（headEff），否则目标层永不吃脉冲（探针 A5 抓到）。
- **总览模式**：指针进标尺竖带（横向沿用 PROX 带、纵向放宽到 ±35wu 覆盖全章伸展）
  → `_overview` 包络 dt·5 平滑，本章全部刻度弱显示（明度下限 ov×0.5 ≈ op 0.36），
  房型符号独立下限 0.62（符号是总览信息主体）；hover 单根照旧 0.95 强化 + 冒泡；
  出带全收。竖带即触发区，无自激振荡面（刻度命中带常开，不依赖可见性）。
- 验证：check-ruler-climb-overview 16 断言全绿（defer 保持/无回跳/亮浪建立/闪光在
  落定段/收口；总览起落/符号/hover 强化/真实鼠标进出带；跳层直落）+ 三态截图自审
  （idle 窗口内 6 根 ↔ 总览全章 11 根 ↔ hover 7 层强化带冒泡）。

## 敌人预告每层独立实例（2026-10-12 深夜，未提交）

- **病灶（diag6 事件房路径实报级复现）**：事件房不建 3D 房间，幕间在活动地图舞台上播；
  退出链 `exitSceneAfterCutscene(() => { completeRoomAndNotify(); arriveMapFloor(); })`——
  黑幕中点 notify 应用 prep-N+1 快照（`setPrepVisible(true)` + `setEncounter(N+1)`），
  单例预览被锚回**过期** chrome._floor=N 的层牌，gsap fade 全局推进 → 揭幕后预览在旧层牌上
  淡入 = 闪现；随后爬升指令 `chrome.setFloor(N+1)` 换父 → 瞬间消失 → 落定再淡入。
  采样实锤帧：`stage=map gs=prep floor=4 chromeFloor=3 parent=3 chainVis=true fade=0.29`。
- **修法（用户拍板）**：每层独立 `EnemyPreviewObject` 实例（`_previews: Map<floor, pv>`）。
  `setEncounter(list, {floor})` 按快照楼层字段寻址——目标层实例建内容并挂到该层层牌下，
  其余层实例清空；层牌未登陆被资格标量压着 → 新层预告落定前结构性不亮相。
  没有换父就没有时序窗。`chrome.preview` 改为稳定门面（attachPicker/setHover 广播全部实例），
  MapStage 拾取/hover 链路不动。旧 `_placePreview` 单例机制已删。
- **探针语义适配**：check-floor-clear-climb 的「预告落定就位」断言原先吃单例被换父拖着走的
  旧行为——合成 arriveFloor 没有 notify 先行，新层永远没内容。补真实链路那拍
  （`setEncounter(enc, {floor:6})`）后断言成立。
- 验证：check-preview-climb（事件房 3→4 真链路，1461 帧采样）6 断言全绿——
  全程零错层闪现帧 / 新层预告落定前零早亮 / 落定后正常亮相（content+parent+chainVis+op=1）/
  旧层实例清空 / 新层拾取 3 枚在册 / 无 GPU 错；check-floor-clear-climb 回归全绿。
  看点清单（用户视觉验收）：① 事件房出来爬升时旧层牌上不再有下一层敌人闪现；
  ② 爬升途中新层预告不提前亮相（层牌没登陆前整层压着）；③ 落定后预告随层牌一起淡入。
