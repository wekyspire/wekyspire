import * as THREE from 'three';
import gsap from 'gsap';
import { isBossFloor } from '../../core/run/runFlow.js';

const _v3 = new THREE.Vector3();   // 装卸区坐标换算的复用向量（免逐帧分配）
import { PlayerStatusObject, PLAYER_STATUS_POS } from '../objects/PlayerStatusObject.js';
import { DeckChipObject, isDeckChipHit } from '../objects/DeckChipObject.js';
import { TopResourceBarObject } from '../objects/TopResourceBarObject.js';
import { RelicSlotMeterObject } from '../objects/RelicSlotMeterObject.js';
import { TowerRulerObject } from '../objects/TowerRulerObject.js';
import { EnemyPreviewObject } from '../objects/EnemyPreviewObject.js';
import { FloorChromeObject } from '../objects/FloorChromeObject.js';
import { createParticlePool } from '../fx/gpu/particlePool.js';
import { ZoneFrameObject } from '../objects/ZoneFrameObject.js';
import { UI_CAMERA_LOOK_AT_Y } from '../StageManager.js';
import { PanelObject, PANEL_ABOVE_Z } from '../objects/PanelObject.js';
import { SlotRollObject } from '../objects/SlotRollObject.js';
import { BubbleLayer } from '../objects/BubbleLayer.js';
import { PANEL_BUILDERS } from '../panels/index.js';
import { createStagePickerKit } from '../stagePickerKit.js';
import { installPanelHost } from '../panelHost.js';
import { Picker } from '../picker/Picker.js';
import { makeCardFaceBaker } from '../richtext/cardFaceDefaults.js';
import { sharedCardArtCache } from '../art/cardArtCache.js';
import { renderRichTextBlock } from '../richtext/texture.js';
import { sharedUnitArtCache } from '../art/unitArt.js';
import { sharedTowerArtCache } from '../art/towerArt.js';
import { buildTowerWilderness, towerFacingY, towerCameraPose, towerStormLevel, TOWER_X, TOWER_Z, TOWER_BASE_Y } from '../scenes/towerWilderness.js';
import { Cast } from '../fx/cast.js';
import { runScript } from '../fx/script.js';
import { EventNames } from '../../bridge/events.js';

// 快照 kind → builder/形态 的共享表在 panels/index.js（战斗层战后奖励面板共用同一份）

// 战前准备/地图舞台：大雪荒原 + 孤立塔楼（观感重做，替占位夜空+色块塔）。
// 塔身 = billboard 纸片塔——每层一张模块贴片（assets/tower/，全部楼层同一模块直
// 到后续章节素材落位）。塔是世界固定的（塔基轻吻雪面，锚 TOWER_BASE_Y）；相机随层沿
// 塔身爬升表达「到层」（arriveFloor 上升动画，替旧「当前层高亮
// 长出」），爬升时雪盒/填充光同步跟随。贴图缺席（headless/加载中）退化为色块层。
// 雪原/天空/雾/雪花在 scenes/towerWilderness.js（环境件），本舞台只持塔身
// （setFloor/arriveFloor 接口不变）。
// uiScene pass 绘左下角玩家状态栏（与战斗内 PlayerStatusObject 同物同位）。
const FLOOR_GAP = 7;            // 层间纵向间距（世界单位）= 模块贴片高
const MODULE_ASPECT = 2048 / 1199;  // 模块素材宽高比（层宽 = FLOOR_GAP × 此值）
// 塔世界位 TOWER_X/Z/BASE_Y 在 scenes/towerWilderness.js（塔环境共享锚点，本舞台 import 取用）
const TOWER_MODULE = '第一章_基础';  // 全楼层共用的模块（后续按章换）
// 鼠标视差：相机随鼠标绝对位置轻微平移——**二阶弹簧阻尼平滑**
// （：保留动量，一阶指数趋近太"黏"）。刚度/阻尼/幅度都是调参位：塔距相机 30、
// 画面高 ~25 世界单位，1 单位平移 ≈ 画面 4%。ζ≈0.92 略欠阻尼，带一点惯性尾。
export const MOUSE_SWAY = { unitsX: 0.8, unitsY: 0.48, stiffness: 5, damping: 4.1, maxDt: 0.1 };
// 视差落相机的复用临时向量（tick 单协程，无重入）
const _swayDir = new THREE.Vector3();
const _swayRight = new THREE.Vector3();
const _swayUp = new THREE.Vector3();
const _swayOff = new THREE.Vector3();
const _swayLook = new THREE.Vector3();
const _swayWorldUp = new THREE.Vector3(0, 1, 0);

export class MapStage {
  /**
   * @param {object} options
   *   totalFloors: 塔高（缺省 44）
   *   bakeLabel: 文本烘焙（缺省浏览器用 renderRichTextBlock，node 退化为 1x1 占位）
   *   unitArt: 立牌/图标美术缓存（缺省浏览器用 sharedUnitArtCache，node 为 null）
   */
  constructor({ totalFloors = 44, bakeLabel = null, unitArt = null, towerArt = null } = {}) {
    this.name = 'map';
    this.scene = new THREE.Scene();
    this.uiScene = new THREE.Scene(); // UI pass：玩家状态栏（StageManager 清深度后二次渲染）
    // ---- 荒原环境：渐变天空穹 + 指数大气 + 两半球环境光 + 起伏雪原 + GPU 雪花 ----
    this._wilderness = buildTowerWilderness({ towerX: TOWER_X, towerZ: TOWER_Z });
    this.scene.add(this._wilderness.group);
    this.scene.fog = this._wilderness.fog;
    // billboard 纸片塔：一次性朝向世界相机（塔楼层相机沿塔身爬升，朝向角只算一次）
    this._tower = new THREE.Group();
    this._tower.position.set(TOWER_X, TOWER_BASE_Y, TOWER_Z); // 塔是世界固定的（锚塔基）
    this._tower.rotation.y = towerFacingY({ x: TOWER_X, z: TOWER_Z });
    this.scene.add(this._tower);
    // 相机所在层（爬升动画的起点锚）：setFloor 首次落位初始化，之后只由 arriveFloor
    // 推进——战后换台 setFloor 摆新层模块但不动它，相机爬升才有可见起点
    this._cameraFloor = null;
    this._riseTween = null;
    this._riseDone = null;
    // 塔楼层世界 pass 由雪云管线接管（StageManager composeScene 钩子，BattleStage
    // 体积光同范式）：mesh pass → 云 march（读场景深度）→ transmittance 合成。
    // UI pass（uiScene）仍由 StageManager 在其后兜底渲染，不受影响。
    this.composeScene = ({ renderer, scene, camera }) => {
      this._wilderness?.clouds?.composeFrame({ renderer, scene, camera });
    };
    // 逻辑机位（视差的基座）：锚点摆位与爬升 tween 只写它，tick 统一把「机位 +
    // 鼠标视差偏移」落到共享相机（onEnter 设/onExit 还协议不变）
    this._basePose = null;
    this._mouseTarget = { x: 0, y: 0 };  // 鼠标归一化目标 [-1,1]（x 右、y 上）
    this._mouseSway = { x: 0, y: 0 };    // 二阶平滑：视差位置（弹簧位移）
    this._mouseSwayVel = { x: 0, y: 0 }; // 二阶平滑：视差速度（保留的动量）
    // 塔楼模块贴图缓存（node/headless 为 null → 层块退化色块；浏览器共享单例，
    // 预载门 warm 过则首拍同步命中）
    this._towerArt = towerArt ?? ((typeof document !== 'undefined') ? sharedTowerArtCache : null);
    this._towerTexture = this._loadTowerTexture();
    // 模块贴图晚到（首拍未命中）→ 重取并重建塔身挂图（重取即同步命中）
    this._unsubTowerArt = this._towerArt?.addOnLoad(() => {
      if (this._towerTexture) return;
      this._towerTexture = this._loadTowerTexture();
      if (this._towerTexture && this._floorState) {
        this.setFloor(this._floorState.floor, this._floorState.totalFloors);
      }
    });

    // ---- 玩家状态栏（与战斗内共享 PlayerStatusObject，同位同尺寸）----
    // 头像素材走应用级共享立牌缓存（与 BattleStage 同一份，互为预热）；
    // 必须先取缓存再构造状态栏——构造时即按缓存现状挂水晶/金币美术并订阅 onLoad
    this._unitArt = unitArt ?? ((typeof document !== 'undefined') ? sharedUnitArtCache : null);
    this._bakeLabel = bakeLabel || defaultBakeLabel();
    // 面板内卡面走与战场同一份烘焙（卡图/系列装饰/魏启水晶素材同源，所见即所得）
    this._bakeFace = (typeof document !== 'undefined')
      ? makeCardFaceBaker({ cardArt: sharedCardArtCache, unitArt: this._unitArt })
      : null;
    this._statusBar = new PlayerStatusObject({ bakeLabel: this._bakeLabel, unitArt: this._unitArt });
    this._statusBar.position.set(PLAYER_STATUS_POS.x, PLAYER_STATUS_POS.y, PLAYER_STATUS_POS.z);
    this.uiScene.add(this._statusBar);
    // 顶端居中资源行（金币数值 + 遗物槽；与战斗内同物同位）
    this._topBar = new TopResourceBarObject({ bakeLabel: this._bakeLabel });
    this.uiScene.add(this._topBar);
    this._unsubArt = this._unitArt?.addOnLoad(() => {
      this._applyAvatar();
      // 水晶/金币的晚到补挂由 PlayerStatusObject 自身的 onLoad 订阅负责（unitArt 已注入）
    });
    this._applyAvatar();

    this._unsubTick = null;
    this._unsubCardArt = null; // 卡图到图 → 面板卡面重烘
    this._picker = null;   // 输入通道（attachInput 注入：stageManager + 总线）
    this._panel = null;    // 当前休息阶段面板对象（setPanel 装配；null = 无面板）
    this._loadout = null;  // 面板里的遗物装卸区（prep custom widget；每次重绘后重接）
    this._panelUi = null;  // 面板本地交互态（勾选缓冲等；换面板即清空）
    this._snap = null;     // 当前面板快照（本地重绘用）
    this._slotRoll = null;  // 老虎机转轮演出对象（playSlotSpin 惰性创建）
    // 全屏选卡/选遗物界面 + 获得物特写：三舞台共用套件（stagePickerKit.js）。
    // bus 传 getter：总线在 attachInput 里才注入，而界面是惰性创建的——传快照值会让
    // 之后创建的界面永远拿不到 tooltip 出口。
    this._pickerKit = createStagePickerKit({
      uiScene: this.uiScene,
      getPicker: () => this._picker,
      bakeFace: this._bakeFace,
      bus: () => this._bus,
      onIntent: (a) => this._onIntent?.(a),
      getSequencer: () => this._runSequencer,
      getAnchor: () => this._deckAnchor(),
    });
    this._bubbles = new BubbleLayer();   // 角色对话/思索泡泡（世界锚点，每帧重投影）
    this.uiScene.add(this._bubbles);
    this._bubbleAnchors = new Map();     // key -> { x, y, z }（世界坐标；相机移动时重投影）
    // 「卡组」chip（build 画廊入口）：顶栏右端槽位（摆位由 TopResourceBarObject 下发）。
    // z 压过一切模态层（面板/全屏选卡/画廊）→ prep 面板与选卡界面开着时也能按；点击走
    // 意图上行（deckViewToggle）。计数经 setStatus（编排器 syncMapStatus 下发）。
    this._deckChip = new DeckChipObject();
    this._topBar.attachDeckChip(this._deckChip);
    this.uiScene.add(this._deckChip);
    // ---- 战前准备阶段 chrome（仅 prep 可见；详见 _syncPrepChrome）----
    // 槽位条：顶部资源行右随从头（粗粝加载条风味）；刻度尺：塔左缘本章楼层条（逐帧锚定）。
    this._slotMeter = new RelicSlotMeterObject({ bakeText: null });
    this._slotMeter.visible = false;
    this.uiScene.add(this._slotMeter);
    this._ruler = new TowerRulerObject();
    this.uiScene.add(this._ruler);
    // 常驻逐层楼层牌（世界 billboard，塔左缘悬空）：塔钉→短横→悬空层号；敌人预告挂当前层牌。
    // 显隐/缩放由「取景高度离各层锚点几个层距」帧驱动（靠近淡入微放大、远去淡出微缩小），
    // 未登陆层压 0——爬升/跨层跳转不需要任何排期动画。
    this._floorChrome = new FloorChromeObject({ unitArt: this._unitArt });
    this.scene.add(this._floorChrome);
    this._floorChrome.configure({
      gap: FLOOR_GAP,
      baseY: TOWER_BASE_Y,
      anchorFor: (f) => {
        const halfW = (FLOOR_GAP * MODULE_ASPECT) / 2;
        this._tower.updateWorldMatrix(true, false);
        // 左探 1.8wu：让开本章刻度尺竖带（右缘 0.7wu + 最长刻度 ~9.2wu，UI 口径 ≈ 71px
        // ≈ 世界 1.16wu）+ 钉半宽与余隙——两件都锚塔左缘，不挪就重叠
        _v3.set(-halfW - 1.8, (f - 0.5) * FLOOR_GAP, 0.9);
        this._tower.localToWorld(_v3);
        return { x: _v3.x, y: _v3.y, z: _v3.z };
      },
    });
    this._enemyPreview = this._floorChrome.preview;   // 拾取/hover 的引用口（归 chrome 所有）
    // 顶栏遗物交互态（prep 限定）：按下候选 → 点击=用/卸 / 超阈值拖拽=拖回背包卸下
    this._topBarPress = null;
    this._topBarDrag = null;
    this._topBarHoverIdx = -1;   // 顶栏遗物 hover 抬升（-1 = 无）
    // 拖放/装卸的区域高亮框（src=出处淡蓝灰 / dst=落点亮白，落定 flash）与在途飞行 icon
    this._frameSrc = new ZoneFrameObject();
    this._frameDst = new ZoneFrameObject();
    this.uiScene.add(this._frameSrc, this._frameDst);
    this._relicFlights = new Set();
    this._sm = null;         // StageManager（attachInput 注入：世界→UI 空间换算用）
    // fx 门面地基（Phase 4）：塔楼目前无可寻址道具，cast 留空表——
    // cutscene 'fx' step 在塔楼层只应做运镜/等待类演出（camera 可用）
    this._cast = new Cast();
    this._fxScripts = new Set(); // 在途剧本协程（dispose 统一 kill）
    this._fxDisposeHooks = new Set(); // 舞台寿命钩子（剧本常驻效果收尾，dispose 统一回调）
    // 世界 GPU 粒子池（楼层通过演出的灰；与 BattleStage 同例懒建于 onEnter——
    // 构造时还没拿到 stageManager._renderer）。非 WebGPU 后端恒 null，演出静默降级
    this._fxPool = null;
    this._bus = null;       // 事件总线（选卡界面发 tooltip 用）
    this._onIntent = null; // 面板点击上行出口（setPanelIntentHandler 注入）
    this._runSequencer = null;  // run 级动画队列（runController 后置注入：得卡演出指令化）
    this._grantBusy = false;    // 「择卡得卡」演出进行中：吞掉面板动作（见 _onPanelAction）
    this._downHit = null;  // 按压命中（抬起时配对，防"按下 A 抬起 B"误触发）
    this.setFloor(1, totalFloors);
  }

  get statusBar() { return this._statusBar; }
  get topBar() { return this._topBar; }
  get panel() { return this._panel; }

  // ---- 休息阶段面板 ----
  /** 得卡演出的收编锚点：玩家状态栏（塔楼层没有牌库图标，卡收向"玩家"即入组）。 */
  _deckAnchor() { return { x: PLAYER_STATUS_POS.x + 10, y: PLAYER_STATUS_POS.y, z: PLAYER_STATUS_POS.z }; }

  /**
   * 装配/更新/清除当前阶段面板。
   * 数据是**纯快照**（core/run/panelSnapshot.js 产出）：本舞台不读任何 run 状态。
   * 未登记的 kind → 不装配（该面板还在 Vue 侧）。
   */
  setPanel(snap) {
    const entry = snap && PANEL_BUILDERS[snap.kind];
    if (!entry) { this._removePanel(); this._syncCardArtSub(); return; }
    // 面板对象只在"面板种类"变化时重建；shop 是同一份快照下的本地视图，不重建（保本地态）
    if (!this._panel || this._panel.kind !== (this._panelUi?.shopOpen && snap.shop ? 'shop' : snap.kind)) {
      this._removePanel();
      this._panelUi = { selected: new Set() }; // 换面板 = 清空面板本地交互态
      this._panel = new PanelObject({
        form: entry.form,
        onIntent: (a, info) => this._onPanelAction(a, info),
        bakeFace: this._bakeFace,
      });
      this.uiScene.add(this._panel);
    }
    this._snap = snap;
    this._renderPanel();
    this._syncCardArtSub();
    this._syncPrepChrome();
  }

  /** 用当前快照 + 面板本地态重绘（setPanel 与本地交互共用同一入口）。 */
  _renderPanel() {
    const snap = this._snap;
    if (!snap || !this._panel) return;
    // 面板本地态可以把"当前视图"切到另一个 builder 上（如房间 → 自动售货机）；
    // 快照仍是同一份（售货机数据在 snap.shop 里），故不需要为它单开一条下行通道。
    const kind = this._panelUi?.shopOpen && snap.shop ? 'shop' : snap.kind;
    const entry = PANEL_BUILDERS[kind];
    if (!entry) return;
    this._panel.attachPicker(this._picker);
    this._panel.setWidgets(kind, entry.build(snap, { selected: this._panelUi?.selected }));
    this._bindLoadout();
  }

  /**
   * 遗物装卸区接线（prep 面板的 custom widget）：拾取器 + 屏幕→局部坐标
   * 换算。面板每次重绘都会重建该对象，故每次 _renderPanel 后都要重接。
   */
  _bindLoadout() {
    this._loadout = this._panel?.getObjectByName?.('relicLoadout') ?? null;
    if (!this._loadout) return;
    const sm = this._sm;
    this._loadout.bindStage({
      picker: this._picker,
      screenToLocal: (sx, sy, zLocal) => {
        const lo = this._loadout;
        if (!lo || !sm?.screenToWorld) return { x: 0, y: 0 };
        const gz = lo.getWorldPosition(_v3).z + zLocal;
        const w = sm.screenToWorld(sx, sy, gz, sm.uiCamera);   // 返回普通 {x,y}
        return lo.worldToLocal(new THREE.Vector3(w.x, w.y, gz));
      },
      // 装备落点 = 顶栏窄条背板矩形（实时换算进装卸区局部坐标；窄条随内容变宽，每拍重取）
      getDropRectLocal: () => {
        const lo = this._loadout;
        if (!lo) return null;
        const r = this._topBar.stripWorldRect();
        lo.updateWorldMatrix(true, false);
        const a = lo.worldToLocal(new THREE.Vector3(r.x0, r.y0, 0));
        const b = lo.worldToLocal(new THREE.Vector3(r.x1, r.y1, 0));
        return {
          x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x),
          y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y),
        };
      },
      // 装备演出钩子：背囊 icon 飞向顶栏槽位 + 顶栏落点框落定闪（意图照旧先行）
      onEquipFx: (info) => this._onRelicEquipFx(info),
      // 拖向顶栏期间：落点框挂窄条（over 呼吸 / 放不下染红；null = 收起）
      setDropFrame: (st) => this._setDropFrameFx(st),
    });
  }

  /** 战前准备 chrome 同步：槽位条/敌人预告（含引出线）只在 prep 阶段可见并吃快照；其余阶段隐藏。 */
  _syncPrepChrome() {
    const snap = this._snap;
    const prep = snap?.kind === 'prep';
    this._slotMeter.visible = !!prep;
    this._floorChrome.setPrepVisible(!!prep);
    if (prep) {
      this._slotMeter.setSlots(snap.relicSlots?.used ?? 0, snap.relicSlots?.total ?? 1);
      this._floorChrome.setEncounter(snap.encounter ?? [], { boss: !!snap.atBossFloor, floor: snap.floor });
    }
  }

  // ---- 遗物装卸演出（prep 限定）----
  // ghost 飞行：顶栏槽位 ↔ 背囊区双向（点击/拖放共用）。意图上行不等飞行落定——
  // 快照重建与飞行 ghost 互不依赖（ghost 共享槽位纹理，只弃材质不碰纹理）。

  /** 遗物 icon 飞行（弧线 + 缩小 + 微倾）。ghost 复用传入件（拖拽落点）或新建（点击路径）。 */
  _flyRelicGhost({ ghost = null, map = null, color = 0x1c1c1c, size = 4.0, from = null, to = null, dur = 0.3, arc = 0.8, onDone = null }) {
    let g = ghost;
    if (!g) {
      if (!from) return null;
      g = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({ transparent: true, fog: false, depthTest: false }),
      );
      if (map) g.material.map = map; else g.material.color.set(color);
      g.position.set(from.x, from.y, 60);
      g.scale.setScalar(0.85);
      this.uiScene.add(g);
      gsap.to(g.scale, { x: 1, y: 1, duration: 0.14, ease: 'back.out(2.5)' });
    }
    this._relicFlights.add(g);
    if (!to) {   // 无落点（面板未开等）：原地淡出
      g.userData.tw = gsap.to(g.material, {
        opacity: 0, duration: 0.2,
        onComplete: () => this._disposeRelicGhost(g, onDone),
      });
      return g;
    }
    const sx = g.position.x, sy = g.position.y;
    const t = { k: 0 };
    g.userData.tw = gsap.to(t, {
      k: 1, duration: dur, ease: 'power1.inOut',
      onUpdate: () => {
        g.position.x = sx + (to.x - sx) * t.k;
        g.position.y = sy + (to.y - sy) * t.k + Math.sin(t.k * Math.PI) * arc;
        g.scale.setScalar(1 - t.k * 0.4);
        g.rotation.z = (t.k - 0.5) * 0.3;
      },
      onComplete: () => this._disposeRelicGhost(g, onDone),
    });
    return g;
  }

  _disposeRelicGhost(g, onDone) {
    this._relicFlights.delete(g);
    this.uiScene.remove(g);
    g.geometry.dispose();
    g.material.dispose();   // map 归槽位/图标缓存共享，只弃材质
    onDone?.();
  }

  /** 顶栏遗物行的下一个槽位中心（装备飞行落点 = 新槽将出现的位置）。 */
  _topBarNextSlotPos() {
    const row = this._topBar.relicRow.children;
    if (row.length) {
      const p = row[row.length - 1].getWorldPosition(new THREE.Vector3());
      return { x: p.x + 4.9, y: p.y };   // SLOT 4.0 + GAP 0.9（顶栏布局常量）
    }
    const r = this._topBar.stripWorldRect();
    return { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 };
  }

  /** 背囊点击/拖拽装备：icon 从面板飞顶栏 + 窄条落点框落定闪。
   *  拖拽落定的 ghost 由调用方移交（ghost 参数）：换父到 uiScene 后接力飞行，
   *  不原地弃置+新建（原地重生会多一次「诞生弹跳」，读感像多出一个粒子）。 */
  _onRelicEquipFx({ relic, fromLocal, size, map, ghost = null }) {
    const lo = this._loadout;
    if (!lo) return;
    const from = lo.localToWorld(new THREE.Vector3(fromLocal.x, fromLocal.y, fromLocal.z ?? 1));
    if (ghost) {
      ghost.removeFromParent();
      ghost.position.set(from.x, from.y, 60);
      this.uiScene.add(ghost);
    }
    this._flyRelicGhost({ ghost, map, size: size ?? 4.0, from, to: this._topBarNextSlotPos(), dur: 0.34, arc: 0.9 });
    const strip = this._topBar.stripWorldRect();
    this._frameDst.setRect(strip);
    this._frameDst.show({});
    this._frameDst.flashThenHide(0.42);
  }

  /** 背囊拖向顶栏期间的落点框状态（null 收起；over 呼吸；放不下染红）。 */
  _setDropFrameFx(st) {
    if (!st) { this._frameDst.setActive(false); this._frameDst.hide(); return; }
    this._bus?.emit(EventNames.TOOLTIP_HIDE, {});   // 拖拽中悬停 tooltip 让位（幂等）
    // 无条件重摆：框可能还带着上一条链的落点矩形（快速连拖时旧框未隐完）
    this._frameDst.setRect(this._topBar.stripWorldRect());
    if (!this._frameDst.visible) {
      this._frameDst.show({ color: st.valid ? 0xcfe0f4 : 0xe85a5a });
    } else {
      this._frameDst.setColor(st.valid ? 0xcfe0f4 : 0xe85a5a);
    }
    this._frameDst.setActive(st.over);
  }

  /** 顶栏遗物 hover 抬升（按压件让位按下回缩）。 */
  _setTopBarHover(idx) {
    if (idx === this._topBarHoverIdx) return;
    const prev = this._topBarHoverIdx;
    this._topBarHoverIdx = idx;
    const setScale = (i, v) => {
      if (i < 0 || i === this._topBarPress?.index) return;
      const slot = this._topBar.relicRow.children[i];
      if (slot) gsap.to(slot.scale, { x: v, y: v, duration: 0.16, ease: 'power2.out', overwrite: 'auto' });
    };
    setScale(prev, 1);
    setScale(idx, 1.08);
  }

  // ---- 顶栏遗物拖拽卸下（prep 限定；卸下方向的另一半在 RelicLoadoutObject）----
  // 按下候选超 6px 阈值 → 起拖（ghost 直挂 uiScene）；拖动中悬停背囊区 → 背囊区亮边；
  // 松手在背囊区上 → 上行 unequip，否则 ghost 丢弃（顶栏槽位签名驱动重建，无需弹回）。

  _topBarPointerMove(x, y) {
    const press = this._topBarPress;
    if (!this._topBarDrag) {
      if (!press || Math.hypot(x - press.x, y - press.y) < 6) return;
      const slot = this._topBar.relicRow.children[press.index];
      const srcMat = slot?.userData?.tileMap;
      if (!srcMat) { this._topBarPress = null; return; }
      const ghost = new THREE.Mesh(
        new THREE.PlaneGeometry(4.6, 4.6),
        new THREE.MeshBasicMaterial({ map: srcMat.map ?? null, transparent: true, opacity: 0.92 }),
      );
      if (!srcMat.map) ghost.material.color.set(0x1c1c1c);
      ghost.position.z = 60;   // 压过面板/窄条的一切
      this.uiScene.add(ghost);
      const sp = slot.getWorldPosition(new THREE.Vector3());
      this._topBarDrag = { relicId: press.relicId, index: press.index, ghost, from: { x: sp.x, y: sp.y } };
      this._bus?.emit(EventNames.TOOLTIP_HIDE, {});   // 拖拽中悬停 tooltip 让位（盖住 ghost/框）
      srcMat.opacity = 0.35;   // 原位退亮（弹回语义由签名重建承担，这里只表达"离位"）
      this._topBarDrag.slotMat = srcMat;
      // 槽位回缩归位（按下回缩让位给拖拽 ghost）
      gsap.to(slot.scale, { x: 1, y: 1, duration: 0.14, ease: 'power2.out', overwrite: 'auto' });
      // ghost 弹出
      ghost.scale.setScalar(0.6);
      gsap.to(ghost.scale, { x: 1, y: 1, duration: 0.2, ease: 'back.out(2)' });
      // 区域框：src=槽位（淡蓝灰出处标记）/ dst=背囊区（落点）
      this._frameSrc.setRect({ x0: sp.x - 2, x1: sp.x + 2, y0: sp.y - 2, y1: sp.y + 2 });
      this._frameSrc.show({ color: 0x9db4d8 });
      const bag = this._loadout?.bagZoneRectWorld?.() ?? null;
      if (bag) { this._frameDst.setRect(bag); this._frameDst.show({}); }
    }
    const drag = this._topBarDrag;
    const w = this._sm?.screenToWorld(x, y, drag.ghost.position.z, this._sm.uiCamera);
    if (!w) return;
    drag.ghost.position.x = w.x;
    drag.ghost.position.y = w.y;
    const r = this._loadout?.bagZoneRectWorld?.() ?? null;
    const over = !!r && w.x >= r.x0 && w.x <= r.x1 && w.y >= r.y0 && w.y <= r.y1;
    this._loadout?.setBagGlow(over);
    if (this._frameDst.visible) this._frameDst.setActive(over);   // 拖悬呼吸
  }

  /** 拖拽收尾：pos={x,y} 松手落点；null = 中断（detachInput 等），不上行。 */
  _endTopBarDrag(pos) {
    const drag = this._topBarDrag;
    this._topBarDrag = null;
    this._loadout?.setBagGlow(false);
    this._frameDst.setActive(false);
    this._frameSrc.hide();
    if (!drag) { this._frameDst.hide(); return; }
    const w = pos ? this._sm?.screenToWorld(pos.x, pos.y, drag.ghost.position.z, this._sm.uiCamera) : null;
    const r = this._loadout?.bagZoneRectWorld?.() ?? null;
    const over = !!r && !!w && w.x >= r.x0 && w.x <= r.x1 && w.y >= r.y0 && w.y <= r.y1;
    if (over) {
      // 落定：ghost 飞入背囊区中心 + 落点框确认闪；意图立即上行（飞行纯演出）
      this._frameDst.flashThenHide(0.3);
      this._flyRelicGhost({ ghost: drag.ghost, to: { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 }, dur: 0.22, arc: 0.3 });
      this._onIntent?.({ action: 'unequip', relicId: drag.relicId });
      return;
    }
    // 落空：ghost 飞回原槽位，落定后原位复亮
    this._frameDst.hide();
    this._flyRelicGhost({ ghost: drag.ghost, to: drag.from, dur: 0.24, arc: 0.25, onDone: () => { drag.slotMat.opacity = 1; } });
  }

  // ---- 角色对话/思索泡泡（通用接口）----
  // 场景里的角色（商店老板、瑞米、事件 NPC…）异步说话/思索时用：
  //   sayAtWorld('shopkeeper', { x, y, z }, { text, kind, duration })
  // 锚点是**世界坐标**，每帧经 StageManager 重投影到 UI 空间——相机转动/推进镜头时
  // 泡泡跟着角色走。同一 key 重复调用 = 改台词并重新计时（不会叠出两个）。
  /**
   * @param key     锚点标识（角色名/单位 id）
   * @param anchor  { x, y, z }（世界坐标；y 给"头顶高度"）
   * @param data    { text, kind:'speech'|'thought', duration, tint, width }
   */
  sayAtWorld(key, anchor = {}, data = {}) {
    const a = { x: anchor.x ?? 0, y: anchor.y ?? 0, z: anchor.z ?? 0 };
    this._bubbleAnchors.set(key, a);
    const p = this._sm ? this._sm.worldToUI(a.x, a.y, a.z) : { x: a.x, y: a.y };
    return this._bubbles.say(key, { ...data, x: p.x, y: p.y });
  }

  /** 撤掉某个（或全部）角色的泡泡，并停止跟随。 */
  hideBubble(key = null) {
    this._bubbles.hide(key);
    if (key == null) this._bubbleAnchors.clear();
    else this._bubbleAnchors.delete(key);
  }

  get bubbleKeys() { return this._bubbles.keys; }

  _followBubbles() {
    if (!this._sm) return;
    for (const key of this._bubbles.keys) {
      const a = this._bubbleAnchors.get(key);
      if (!a) continue;
      const p = this._sm.worldToUI(a.x, a.y, a.z);
      this._bubbles.moveTo(key, p.x, p.y);
    }
  }

  /** 槽位条摆位：钉在顶栏窄条右缘外、纵对齐窄条中心（条体半宽 6.5 = BAR.w/2）。 */
  _anchorSlotMeter() {
    const r = this._topBar.stripWorldRect();
    this._slotMeter.position.set(r.x1 + 1.6 + 6.5, (r.y0 + r.y1) / 2, 8);
  }

  // ---- 老虎机转轮（降级宿主实现）----
  // 编排器直调（runMachines 转轮指令 → panelStage().playSlotSpin），播完回执 sequencer；
  // 不再从快照 diff spinning（快照只带「转动中」布尔做置灰，播放进度留 Stage）。
  playSlotSpin(spin, onDone) {
    if (!this._slotRoll) {
      this._slotRoll = new SlotRollObject({ bakeText: this._bakeLabel });
      // 必须挂在 PANEL_ABOVE_Z 之上：老虎机是模态面板，转轮低于面板背板就会被挡住
      this._slotRoll.position.set(0, UI_CAMERA_LOOK_AT_Y - 18, PANEL_ABOVE_Z);
      this.uiScene.add(this._slotRoll);
    }
    this._slotRoll.play(() => {
      this._slotRoll.reset();   // 结果揭示后收起（下一次 spin 会重新 play）
      onDone();
    });
    return true;
  }

  // 卡图异步到图后重烘面板内卡面（与战场 addOnLoad 重烘同语言）；无面板/无卡时不订阅。
  // 重烘范围含全屏选卡界面（候选卡无战斗预热，首拍常为占位——空白卡事故同源）
  _syncCardArtSub() {
    const need = !!this._panel?.ownsCardArtWait || !!this._pickerKit?.cardPicker?.opened;
    if (need && !this._unsubCardArt) {
      let dirty = false;
      this._unsubCardArt = sharedCardArtCache.addOnLoad(() => {
        if (dirty) return;
        dirty = true;
        setTimeout(() => {
          dirty = false;
          this._panel?.rebakeCards?.();
          this._pickerKit?.rebakeCards?.();
        }, 50);
      });
    } else if (!need && this._unsubCardArt) {
      this._unsubCardArt();
      this._unsubCardArt = null;
    }
  }

  _removePanel() {
    // 面板本地交互态随之清空：同一面板种类稍后重入时不得带出上次的勾选
    this._panelUi = null;
    this._snap = null;
    this._pickerKit.cardPicker?.close(); // 面板换了/卸了，选卡/选遗物界面不该留在屏幕上
    this._pickerKit.relicPicker?.close();
    if (!this._panel) { this._syncCardArtSub(); return; }
    this.uiScene.remove(this._panel);
    this._panel.dispose();
    this._panel = null;
    this._loadout = null;
    this._syncCardArtSub();
    this._syncPrepChrome();   // 面板卸下 = 离开 prep → 槽位条/敌人预告隐藏
  }

  // ---- 输入通道 ----
  // 与 BattleStage 同构：Picker 用 uiCamera 射线拾取 uiScene 内的 UI 对象。
  // 装配点是 Shell（App.vue，它同时持有 stageManager 与 runController 的 animBus）；
  // 舞台自身不关心总线来源。
  attachInput({ stageManager, bus } = {}) {
    this._picker = stageManager ? new Picker({ stageManager, bus }) : null;
    this._sm = stageManager ?? null;
    this._bus = bus ?? null; // 选卡界面的 tooltip 出口（card 整卡预览走同一条浮层）
    this._panel?.attachPicker?.(this._picker); // 重连时把已有面板重新登记
    this._bindLoadout?.();                     // 装卸区拾取同批重接
    this._pickerKit.attachPicker(this._picker); // 选卡/选遗物/特写一并重连
    this._picker?.addPickable('deckChip', this._deckChip, { kind: 'deckChip', space: 'ui' });
    this._topBar.attachPicker(this._picker);   // 顶栏遗物槽（hover tooltip + prep 点击/拖拽卸下）
    this._ruler.attachPicker(this._picker);    // 刻度尺 hover 浮层号
    this._enemyPreview.attachPicker(this._picker);
  }

  detachInput() {
    this._panel?.attachPicker?.(null);
    this._pickerKit.attachPicker(null);
    this._picker?.removePickable?.('deckChip');
    this._topBar.attachPicker(null);
    this._ruler.attachPicker(null);
    this._enemyPreview.attachPicker(null);
    this._picker = null;
    this._downHit = null;
    this._topBarPress = null;
    this._topBarHoverIdx = -1;
    this._frameSrc.hide();
    this._frameDst.hide();
    this._endTopBarDrag(null);   // 拖拽中途断输入：ghost 飞回原位，不上行卸下
  }

  get picker() { return this._picker; }

  /**
   * 某个按钮的动作记录（{ action, enabled }）。先查休息面板、再查选卡界面
   * （两者各有自己的按钮表）；都没有则返回空记录。供契约测试断言。
   */
  _buttonActionsOf(pickId) {
    return this._panel?._buttonActions?.get(pickId)
      ?? this._pickerKit.buttonActionsOf(pickId)
      ?? { action: null, enabled: false };
  }

  /** 指针移动：hover 拾取（Picker 内部发 tooltip:*）+ 面板悬浮态。 */
  handlePointerMove(x, y) {
    this._lastPointer = { x, y };   // 滚轮门控要知道指针悬在哪（App 只转 deltaY）
    // 鼠标视差目标：画布相对像素 → 归一化 [-1,1]（x 右、y 上）。绝对位置驱动，
    // 鼠标静止时偏移保持，无需持续移动
    const el = this._sm?._renderer?.domElement;
    if (el && el.clientWidth > 0 && el.clientHeight > 0) {
      this._mouseTarget.x = (x / el.clientWidth) * 2 - 1;
      this._mouseTarget.y = 1 - (y / el.clientHeight) * 2;
    }
    // 刻度尺指针临近源：屏幕 px → UI 平面坐标（正交相机下 z 平面取 0 即等值）
    const rulerPt = this._sm?.screenToWorld?.(x, y, 0, this._sm.uiCamera) ?? null;
    // 顶栏遗物拖拽/按下候选（prep 卸下方向）：吞掉常规 hover
    if (this._topBarDrag || this._topBarPress) { this._ruler.setPointer(null); this._topBarPointerMove(x, y); return; }
    // 遗物装卸区拖拽中/按下候选：吞掉常规 hover（tooltip 不抢、面板 hover 停更）
    if (this._loadout?.wantsPointer()) { this._ruler.setPointer(null); this._loadout.onMove(x, y); return; }
    if (!this._picker) return;
    this.uiScene.updateMatrixWorld(true);
    this.scene.updateMatrixWorld(true);   // 敌人预告已迁入世界场景（billboard 拾取要世界矩阵）
    const hit = this._picker.hover(x, y);
    this._deckChip.setHovered(isDeckChipHit(hit)); // chip 在模态层之上：路由前先同步
    this._ruler.setHover(TowerRulerObject.floorOfPickId(hit?.id));
    this._ruler.setPointer(rulerPt);
    this._enemyPreview.setHover(EnemyPreviewObject.indexOfPickId(hit?.id));
    const tm = /^topbar:relic:(\d+):/.exec(hit?.id ?? '');   // 顶栏遗物 hover 抬升
    this._setTopBarHover(tm ? Number(tm[1]) : -1);
    if (this._pickerKit.routeHover(hit, x, y)) { this._ruler.setPointer(null); return; }   // 特写吞掉 hover / 全屏界面接管
    this._panel?.onHover?.(hit);
    this._loadout?.onHoverHit?.(hit);                    // 装卸区图标抬升反馈
  }

  /** 滚轮本地消费钩子（panelHost 转发）：指针悬在刻度尺竖带内 → 本章楼层浏览。 */
  _handleStageWheel(deltaY) {
    const p = this._lastPointer;
    if (!p || !this._sm) return false;
    const ui = this._sm.screenToWorld(p.x, p.y, 0, this._sm.uiCamera);
    if (ui && this._ruler.containsPoint(ui)) { this._ruler.addWheel(deltaY); return true; }
    return false;
  }

  /** 按压：只记录命中，交互一律在抬起时判定（与 BattleStage 的查看器同律）。 */
  handlePointerDown(x, y) {
    if (!this._picker) return;
    this.uiScene.updateMatrixWorld(true);
    this.scene.updateMatrixWorld(true);
    this._downHit = this._picker.pick(x, y);
    if (this._loadout?.onDown?.(this._downHit, x, y)) return;  // 遗物图标按下（候选拖拽/点击）
    this._pickerKit.routePointerDown?.(this._downHit, x, y);   // 滚动条拖拽从按下开始
    // 顶栏遗物（prep 限定）：按下候选——点击=用/卸（抬起判定），超阈值移动=拖回背包卸下
    this._topBarPress = null;
    if (this._snap?.kind === 'prep') {
      const m = /^topbar:relic:(\d+):(.+)$/.exec(this._downHit?.id ?? '');
      if (m) {
        this._topBarPress = { index: Number(m[1]), relicId: m[2], x, y };
        // 按下回缩（点击确认感的前半拍；抬起弹回）
        const slot = this._topBar.relicRow.children[Number(m[1])];
        if (slot) gsap.to(slot.scale, { x: 0.92, y: 0.92, duration: 0.1, ease: 'power2.in', overwrite: 'auto' });
      }
    }
  }

  /** 抬起：按压与抬起命中一致才算一次点击（防拖出/误触）。 */
  handlePointerUp(x, y) {
    // 顶栏遗物拖拽收尾（prep 卸下）：落在背囊区上才上行卸下
    if (this._topBarDrag) {
      this._endTopBarDrag({ x, y });
      this._topBarPress = null;
      this._downHit = null;
      return;
    }
    // 顶栏遗物点击（prep 限定）：可用即用，否则卸下——无需拖拽的快速路径
    if (this._topBarPress) {
      const press = this._topBarPress;
      this._topBarPress = null;
      this._downHit = null;
      this.uiScene.updateMatrixWorld(true);
      this.scene.updateMatrixWorld(true);
      const hit = this._picker?.pick(x, y);
      const slot = this._topBar.relicRow.children[press.index];
      // 按下回缩弹回（仍在悬停位则回到抬升态）
      if (slot) gsap.to(slot.scale, {
        x: this._topBarHoverIdx === press.index ? 1.08 : 1,
        y: this._topBarHoverIdx === press.index ? 1.08 : 1,
        duration: 0.18, ease: 'back.out(2.5)', overwrite: 'auto',
      });
      if (hit?.id === `topbar:relic:${press.index}:${press.relicId}`) {
        const r = (this._snap?.relics ?? []).find(v => v.id === press.relicId);
        if (r && r.canUse) {
          // 使用：槽位弹跳确认（效果本身由 core/演出链交代）
          if (slot) {
            gsap.timeline()
              .to(slot.scale, { x: 1.24, y: 1.24, duration: 0.09, ease: 'power2.out' })
              .to(slot.scale, { x: 1, y: 1, duration: 0.22, ease: 'back.out(2.2)' });
          }
          this._onIntent?.({ action: 'useRelic', relicId: r.id });
        } else if (r && slot) {
          // 卸下：icon 从槽位飞入背囊区中心 + 背囊区落定闪
          const srcMat = slot.userData?.tileMap;
          const from = slot.getWorldPosition(new THREE.Vector3());
          const bag = this._loadout?.bagZoneRectWorld?.() ?? null;
          this._flyRelicGhost({
            map: srcMat?.map ?? null, color: 0x1c1c1c, size: 4.0, from,
            to: bag ? { x: (bag.x0 + bag.x1) / 2, y: (bag.y0 + bag.y1) / 2 } : null,
            dur: 0.3, arc: 0.7,
          });
          if (bag) {
            this._frameDst.setRect(bag);
            this._frameDst.show({});
            this._frameDst.flashThenHide(0.38);
          }
          this._onIntent?.({ action: 'unequip', relicId: r.id });
        }
      }
      return;
    }
    // 装卸区在拖拽/按下候选状态：自己收尾（拖放/点击使用/弹回），不走按钮的 down/up 同位判定
    if (this._loadout?.wantsPointer()) {
      this._loadout.onUp(x, y);
      this._downHit = null;
      return;
    }
    if (!this._picker) return;
    this.uiScene.updateMatrixWorld(true);
    this.scene.updateMatrixWorld(true);
    const hit = this._picker.pick(x, y);
    const down = this._downHit;
    this._downHit = null;
    if (!down || !hit || down.kind !== hit.kind || down.id !== hit.id) return;
    // 「卡组」chip：最高层常驻入口——先于模态路由（面板/选卡/画廊开着也能按）
    if (isDeckChipHit(hit)) { this._onIntent?.({ action: 'deckViewToggle' }); return; }
    if (this._pickerKit.routeClick(hit)) return;   // 特写点任意处退出 / 全屏界面接管
    this._panel?.onClick?.(hit);
  }

  /**
   * 同步状态栏数值（run 层每次阶段迁移后由编排器调用）。
   * 战斗外 AP 恒满（战斗内才消耗）；魏启 = run 持久值；金币/遗物路由到顶端资源行；
   * hp/maxHp 为角色血条（run 快照，战斗外无变化不重烘）；remi 为瑞米区视图
   * （{ present, hp }，编排器压平后透传）。
   */
  setStatus({ ap, apMax, mana, manaMax, money = null, hp = null, maxHp = null, relics = null, remi = null, deckCount = null }) {
    this._statusBar.apCoin.setValue(ap, apMax);
    this._statusBar.manaCrystal.setValue(mana, manaMax);
    if (money !== null) this._topBar.setMoney(money);
    if (hp != null && maxHp != null) this._statusBar.setPlayerHp(hp, maxHp);
    if (relics) this._topBar.setRelics(relics);
    if (remi) this._statusBar.setRemi(remi);
    if (deckCount != null) this._deckChip.setCount(deckCount);
  }

  _applyAvatar() {
    // 骑士徽章头像与战斗内同源（knight_avatar.png，近方肖像整图入圆）；
    // 瑞米专用圆像同源补挂（remi_avatar.png，素材已预翻转）
    const img = this._unitArt?.getFile('knight_avatar.png');
    if (img) this._statusBar.setAvatar(img, { crop: 'full', mirror: true });
    const remiImg = this._unitArt?.getFile('remi_avatar.png');
    if (remiImg) this._statusBar.setRemiAvatar(remiImg);
  }

  // 帧驱动：状态栏整体过渡（资源点颜色渐变/弹跳 + 双血环弧长/低量脉动）
  onEnter(manager) {
    this._unsubTick?.();
    // 世界 GPU 池懒建（幂等；renderer 在 manager 上）
    if (!this._fxPool && manager?._renderer) {
      this._fxPool = createParticlePool(manager._renderer, { space: 'world', name: 'mapWorldFx' });
      if (this._fxPool) this.scene.add(this._fxPool.points);
    }
    this._unsubTick = manager.onTick((dt) => {
      this._fxPool?.update(dt);            // 世界 GPU 粒子（楼层通过的灰）
      this._statusBar.update(dt);
      this._deckChip.update(dt);         // 卡组 chip 的 hover scale 包络
      this._loadout?.update(dt);         // 遗物装卸区（容量条缓动/图标抬升/弹回）
      this._slotRoll?.update(dt * 1000); // dt 秒 → 转轮用毫秒
      this._pickerKit.update(dt);        // 获得物特写（自带 in/hold/out 时序）
      this._panel?.update(dt);            // 休息面板卡阵的 fx（hover 高亮收敛）
      this._slotMeter.update(dt);         // 槽位条填充缓动/脉冲（隐藏时同样无害推进）
      // 取景高度 = 楼层牌显隐的唯一驱动（爬升 tween 写 _basePose，视差不参与——
      // 否则鼠标一晃楼层牌就呼吸）；刻度尺锚 = 塔左缘在取景高度的 UI 投影（lookAt 点
      // 恒投同一屏位，锚定天然稳定；当前层刻度自动居中在楼层牌同高）
      const focusY = this._basePose?.lookAt.y ?? this._floorAnchorY(this._floorState?.floor ?? 1);
      this._floorChrome.setFocusY(focusY);
      this._floorChrome.update(dt, this._mgr?.camera);
      {
        const halfW = (FLOOR_GAP * MODULE_ASPECT) / 2;
        this._tower.updateWorldMatrix(true, false);
        _v3.set(-halfW, focusY - TOWER_BASE_Y, 0.9);
        this._tower.localToWorld(_v3);
        const ui = this._sm?.worldToUI(_v3.x, _v3.y, _v3.z);
        if (ui) this._ruler.setAnchor(ui.x - 0.7, ui.y);
      }
      this._ruler.update(dt);             // 刻度尺亮浪/滚动/长度弹性
      if (this._slotMeter.visible) this._anchorSlotMeter();   // 随从顶栏窄条右缘（内容变宽即跟随）
      this._wilderness?.update(dt);      // 荒原环境（雪花 GPU 推进）
      this._followBubbles();             // 泡泡跟随世界锚点（相机移动也要跟）
      this._bubbles.update(dt);
      this._applyMouseParallax(dt);      // 鼠标视差：机位+偏移 → 共享相机（每帧唯一落点）
    });
    // 塔楼层专属机位（：塔楼投影至少占屏 1/3）——世界相机三舞台共享，
    // 走借还协议：onEnter 设、onExit restoreBaseCamera（假 manager 无相机则跳过）。
    // 锚在 _cameraFloor（相机所在的层）：战后换台时 setFloor 已摆新层模块，但相机
    // 停在旧层——arriveFloor 的爬升动画由此出发，上升全程可见
    this._mgr = manager ?? null;
    this._applyAnchorPose(this._cameraFloor ?? this._floorState?.floor ?? 1);
  }

  onExit() {
    this._unsubTick?.();
    this._unsubTick = null;
    this._floorChrome.cancelClear(); // 在途楼层通过演出：离场即收（灰粒子随池续存无妨）
    this._settleRise(); // 爬升中退场（如玩家爬升期间点进战斗）：停表 + 补回执，再还相机
    // 还原世界相机基准机位（塔楼层专属机位不外泄到战斗/房间层）
    this._mgr?.restoreBaseCamera?.();
    this._mgr = null;
  }

  /**
   * 楼层通过演出（战后回塔楼那一拍）：clearFx = { floor, enemies:[{defId,name}], boss }。
   * 残影崩解与相机爬升同拍起跑（调用方与 arriveFloor 同指令）。池缺位时只演面片崩解。
   */
  playFloorClear(clearFx) {
    if (!clearFx?.enemies?.length || !this._floorChrome) return null;
    return this._floorChrome.playClear(clearFx.floor, clearFx.enemies, {
      boss: !!clearFx.boss, pool: this._fxPool,
    });
  }

  // fx 服务门面（cutscene 'fx' step 的统一入口）：塔楼无可寻址道具（cast 为空表），
  // 剧本可做运镜/等待；runScript 无 animator（注册对象补间不可用，tweenRaw 正常）
  fxServices() {
    return {
      cast: this._cast,
      particles: null,
      shake: null,
      vignette: null,
      camera: this._sm?.cameraDirector ?? null,
      notify: () => {},
      onStageDispose: (fn) => { this._fxDisposeHooks.add(fn); return () => this._fxDisposeHooks.delete(fn); },
      runScript: (body) => {
        const h = runScript(body, { animator: null });
        this._fxScripts.add(h);
        h.promise.then(() => this._fxScripts.delete(h));
        return h;
      },
    };
  }

  dispose() {
    this.onExit();
    this._unsubArt?.(); // 共享缓存订阅摘除（防幽灵舞台补挂头像）
    this._unsubCardArt?.();
    this._unsubCardArt = null;
    this._unsubTowerArt?.(); // 塔楼模块晚到订阅摘除
    this._unsubTowerArt = null;
    for (const h of this._fxScripts) h.kill(); // 在途剧本协程统一取消
    this._fxScripts.clear();
    for (const fn of this._fxDisposeHooks) { try { fn(); } catch (_) {} } // 剧本常驻效果收尾
    this._fxDisposeHooks.clear();
    this._cast.clear();
    this._removePanel();
    this._bubbles.dispose();
    this._bubbleAnchors.clear();
    this._deckChip.dispose();    // 卡组 chip（纹理随父级销毁）
    this._pickerKit.dispose();   // 选卡/选遗物/特写（未创建的实例无事发生）
    if (this._slotRoll) {
      this.uiScene.remove(this._slotRoll);
      this._slotRoll.dispose();
      this._slotRoll = null;
    }
    this.detachInput();
    this._frameSrc.dispose();
    this._frameDst.dispose();
    for (const g of this._relicFlights) {   // 在途飞行 ghost 统一收尾
      g.userData.tw?.kill();
      gsap.killTweensOf(g.scale);
      this.uiScene.remove(g);
      g.geometry.dispose();
      g.material.dispose();
    }
    this._relicFlights.clear();
    this._slotMeter.dispose();      // 槽位条（grit 纹理/轨道烘焙）
    this._ruler.dispose();          // 刻度尺（刻度材质/层号文本）
    this._floorChrome.dispose();    // 层链 chrome（层号烘焙/引出线/敌人预告一并释放）
    for (const child of [...this._tower.children]) { // 塔身层块（与 setFloor 重建同律）
      child.geometry?.dispose?.();
      child.material?.dispose?.();
      this._tower.remove(child);
    }
    this._wilderness?.dispose(); // 荒原环境（天空穹/雪原/雪花/灯光，几何材质统一释放）
    this._wilderness = null;
    this._fxPool?.dispose();   // 世界 GPU 池（灰烬段/present 件）
    this._fxPool = null;
    this.scene.fog = null;
    this._statusBar.dispose();
    this._topBar.dispose();
  }

  /** 模块贴图同步取：命中 → THREE 纹理（propArt 同款 sRGB/各向异性）；未命中 null。 */
  _loadTowerTexture() {
    const img = this._towerArt?.getModule(TOWER_MODULE) ?? null;
    if (!img) return null;
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  }

  // 重建塔身：全楼层 billboard 贴片（视锥外的自动剔除）。塔是世界固定的——塔组锚
  // TOWER_BASE_Y（塔基轻吻雪面 0.5），层 f 模块中心 = (f-0.5)×层高（层 1 坐在塔基
  // 线上，只埋 0.5——旧 (f-1) 摆法把层 1 压低半层、79% 入土）；Boss 层红 tint、
  // 其余白（贴图原色）。当前层金 tint 已移除（「到层」改由相机
  // 爬升表达，等美术资源到位后再做更多动画）。贴图缺席（headless/首拍加载中）为
  // 纯色块层。受光材质（Lambert）吃荒原灯组，与雪原同一套光照。
  /** 房间表推入（run.roomTable 静态整局）——标尺花纹与 hover 房型的数据源；建局时推一次。 */
  setRoomTable(table) {
    this._ruler.setRoomTable(table);
  }

  setFloor(floor, totalFloors) {
    this._floorState = { floor, totalFloors };
    if (this._cameraFloor == null) this._cameraFloor = floor; // 首次落位初始化，之后只由 arriveFloor 推进
    for (const child of [...this._tower.children]) {
      child.geometry?.dispose?.();
      child.material?.dispose?.();
      this._tower.remove(child);
    }
    const w = FLOOR_GAP * MODULE_ASPECT;
    for (let f = 1; f <= totalFloors; f++) {
      const color = 0xffffff;
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(w, FLOOR_GAP),
        new THREE.MeshLambertMaterial({
          color, map: this._towerTexture ?? null,
          transparent: true, alphaTest: 0.35, depthWrite: true,
        }),
      );
      plane.position.set(0, (f - 0.5) * FLOOR_GAP, 0); // 层 f 中心 = 塔基 + (f-0.5)×层高（层 1 坐在塔基线上）
      this._tower.add(plane);
    }
    // 相机还在旧层 = 爬升待播（战后换台先摆新层模块，arriveFloor 随后才爬）：
    // 标尺呈现按兵不动（defer）——亮浪/当前层/回中全留给抵达的 animate 拍，
    // 否则静默预推进会吃掉亮浪，预收敛的 scroll 撞上爬升 tween 的绝对驱动 = 条带瞬移跳变
    this._ruler.setFloor(floor, totalFloors, { defer: this._cameraFloor !== floor });
    this._floorChrome.setFloor(floor, totalFloors); // 当前层指针（预告挂点）
    // 登陆水位线：仅「相机已在本层」时推进——arriveFloor 的爬升起点会调到这里，
    // 那时相机还在旧层，不核销（途经层不提前亮相）；核销在爬升回执/开机落位里
    if (this._cameraFloor === floor) this._floorChrome.markLanded(floor);
  }

  /** 层锚点世界 y：层 f 模块中心（塔基 + (f-1)×层高 + 半层）。 */
  _floorAnchorY(floor) {
    return TOWER_BASE_Y + (floor - 0.5) * FLOOR_GAP;
  }

  /** 相机落位到指定层的专属机位，环境件（雪盒/填充光/雪相配方）同步到锚点高度。 */
  _applyAnchorPose(floor) {
    const { position, lookAt } = towerCameraPose({
      towerX: TOWER_X, towerY: this._floorAnchorY(floor), towerZ: TOWER_Z,
    });
    if (!this._basePose) this._basePose = { position, lookAt };
    else { this._basePose.position.copy(position); this._basePose.lookAt.copy(lookAt); }
    this._wilderness?.setAnchorY(lookAt.y);
    this._wilderness?.setStormLevel(towerStormLevel(floor), floor); // 雪相/云观感/雾随章
    this._applyMouseParallax(0); // 立即落位（dt=0 不推进平滑，只按当前视差摆相机）
  }

  /** 相机当前锚定的层（战后/房间退出据此判断是否需要爬升）。 */
  get cameraFloor() { return this._cameraFloor; }

  /** 开机落位：读档起跑把相机直接锚到存档层（读档没有"从 1 层爬上来"的事实，
   *  不播爬升；新开局面层 1 时与构造缺省一致，幂等）。 */
  snapCameraToFloor() {
    const f = this._floorState?.floor ?? 1;
    this._cameraFloor = f;
    this._ruler.setFloor(f, this._floorState?.totalFloors); // 直落路径：标尺一并核销（跳层/读档不经爬升拍）
    this._floorChrome.markLanded(f);   // 直落路径的登陆核销（读档/调试跳层不经爬升回执）
    if (this._mgr) this._applyAnchorPose(f);
  }

  /** 爬升收口：停表 + 补回执。gsap kill 不触发 onComplete——待回执的 sequencer
   *  指令（awaitFloorArrive 的 ANIMATION_INSTRUCTION_FINISHED）若不手动补，会卡到
   *  保险丝强杀才出队，堵住排在后面的战斗/剧本节拍（5s 慢爬 + 爬升中可备战进战斗
   *  的窗口真实存在）。 */
  _settleRise() {
    const tween = this._riseTween;
    this._riseTween = null;
    const done = this._riseDone;
    this._riseDone = null;
    tween?.kill();
    done?.();
  }

  // 塔楼抵达动画：相机从上一层锚点沿塔身上升到当前层。楼层牌/刻度尺无需排期——
  // 楼层牌靠取景高度的邻近显隐自然淡入淡出（登陆水位线挡住未登陆层），刻度尺同拍亮浪。
  // 由 run sequencer 指令驱动（onDone = 回执句柄）；duration 可缩（测试）。默认 5s 慢爬
  // （爬升期间玩家已可备战操作，慢速更有攀爬感）；FLOOR_ARRIVE_MS=6000 的队列兜底宽于默认时长 1s。
  arriveFloor(floor, totalFloors, { onDone = null, duration = 5 } = {}) {
    const climbing = this._cameraFloor !== floor && !!this._mgr;
    this._ruler.setFloor(floor, totalFloors, { animate: climbing });
    this.setFloor(floor, totalFloors); // 幂等落位（doSwap 已 setFloor 时等同重放）
    // 同层直落（本层有房间的战后路径 floor 不变）或无相机可动：立即回执，
    // 不空转 5 秒白占队列节拍
    if (this._cameraFloor === floor || !this._mgr) { onDone?.(); return; }
    const from = towerCameraPose({
      towerX: TOWER_X, towerY: this._floorAnchorY(this._cameraFloor), towerZ: TOWER_Z,
    });
    const to = towerCameraPose({
      towerX: TOWER_X, towerY: this._floorAnchorY(floor), towerZ: TOWER_Z,
    });
    const fromFloor = this._cameraFloor; // 雪相插值起点（跨 11→12 爬升时雪渐变成风暴配方）
    this._cameraFloor = floor;
    const proxy = { k: 0 };
    const finish = () => { this._floorChrome.markLanded(floor); onDone?.(); };
    this._riseDone = finish;
    this._riseTween = gsap.to(proxy, {
      k: 1, duration, ease: 'power2.inOut',
      onUpdate: () => {
        if (!this._mgr?.camera) return;
        // 两锚点仅 y 不同 → 插值即纯竖直升降，取景朝向全程不变。
        // 只写逻辑机位：相机由 tick 的「机位+视差」统一落位，视差与爬升自然叠加。
        this._basePose.position.lerpVectors(from.position, to.position, proxy.k);
        this._basePose.lookAt.lerpVectors(from.lookAt, to.lookAt, proxy.k);
        this._wilderness?.setAnchorY(this._basePose.lookAt.y); // 雪盒/跟随光跟相机爬
        // 雪相/云观感/雾跨章渐变（爬过 11→16 边界时渐入风暴，雾在 33→38 渐小）
        this._wilderness?.setStormLevel(
          towerStormLevel(fromFloor) * (1 - proxy.k) + towerStormLevel(floor) * proxy.k,
          fromFloor + (floor - fromFloor) * proxy.k);
        // 刻度尺游标与爬升同一补间（同 duration/ease 逐帧直写）——原 dt·8 指数收敛与
        // power2.inOut 的 5s 节奏脱节（起步拖尾、收尾追不上）
        this._ruler.setScrollFloat(fromFloor + (floor - fromFloor) * proxy.k);
      },
      onComplete: () => { this._riseTween = null; this._riseDone = null; finish(); },
    });
  }

  /** 鼠标视差：把逻辑机位加一个随鼠标的小幅平移后落到共享相机。
   *  平滑 = **二阶弹簧阻尼**（保留动量：速度是显式状态，缓起缓收带惯性尾；dt 截断防
   *  切页后大步长炸稳）。平移沿相机右/上轴（取景方向变了偏移方向也不跑偏），position
   *  与 lookAt 加同一偏移 = 整体平移，画面同摆不旋转。与锚点摆位/爬升 tween（只写
   *  _basePose）自然叠加。 */
  _applyMouseParallax(dt) {
    const cam = this._mgr?.camera;
    const base = this._basePose;
    if (!cam || !base) return;
    const h = Math.min(dt ?? 0, MOUSE_SWAY.maxDt);
    // 半隐式欧拉：先加速度更新速度，再用新速度推进位置（弹簧 k、阻尼 c）
    for (const axis of ['x', 'y']) {
      const target = this._mouseTarget[axis];
      const pos = this._mouseSway[axis];
      const vel = this._mouseSwayVel[axis];
      const acc = MOUSE_SWAY.stiffness * (target - pos) - MOUSE_SWAY.damping * vel;
      this._mouseSwayVel[axis] = vel + acc * h;
      this._mouseSway[axis] = pos + this._mouseSwayVel[axis] * h;
    }
    _swayDir.subVectors(base.lookAt, base.position).normalize();
    _swayRight.crossVectors(_swayDir, _swayWorldUp).normalize();
    _swayUp.crossVectors(_swayRight, _swayDir);
    _swayOff.copy(_swayRight).multiplyScalar(this._mouseSway.x * MOUSE_SWAY.unitsX)
      .addScaledVector(_swayUp, this._mouseSway.y * MOUSE_SWAY.unitsY);
    cam.position.copy(base.position).add(_swayOff);
    cam.lookAt(_swayLook.copy(base.lookAt).add(_swayOff));
  }
}

// 共享面板宿主（pickerKit 转发族 + 面板动作分流骨架）见 panelHost.js；本舞台只留
// setPanel/_renderPanel/_removePanel —— shopOpen 视图重映射 / 装卸区接线 / 转轮是本地分叉。
// 开放卡阵的全屏界面后续上卡图晚到订阅（候选卡面重烘）。
installPanelHost(MapStage, {
  localActions: {
    openUpgradePicker(a) { this.openUpgradePicker(a.source); },
    openShop() { this._panelUi.shopOpen = true; this._renderPanel(); },
    openShopPack() { this.openShopPackPicker(); },
    openShopRelicPack() { this.openShopRelicPackPicker(); },
    openSlotPrize() { this.openSlotPrizePicker(); },
  },
  onCardPickerOpened(stage) { stage._syncCardArtSub(); },
});

// 缺省文本烘焙：浏览器走 RichTextEngine（与 BattleStage 小字号同参数）；
// node 无 document 退化为 1x1 占位（与其他状态件一致）
function defaultBakeLabel() {
  if (typeof document === 'undefined') return null;
  return (text) => renderRichTextBlock(text, {
    maxWidth: 220, scale: 3, style: { fontSize: 16, lineHeight: 20 },
  });
}
