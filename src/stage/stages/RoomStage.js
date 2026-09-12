// RoomStage：**场景式休息房**（第一间 = 赌厅 casino / 老虎机房，用户定 2026-09-11）。
//
// 与塔楼层（MapStage）/战斗层（BattleStage）并列的第三个舞台：由 runController 在
// `gameStage === 'room'` 且该房间有休息房配方时，经 **cutscene 幕间黑幕** 切进来
// （`restRecipeFor(roomType)` 给配方；无配方的房间继续用塔楼层 + 占位面板）。
//
// 呈现：PCG 房间几何（`getScene('pcg:<recipe>')`）+ 可动机器 rig + 头顶浮标（可点）；
// 点机器 → 该机器的操作面板**停靠**在屏幕下沿（PanelObject 的 dock 形态），房间始终看得见；
// 右下角常驻**「继续前进」大箭头**（用户新增美术）——场景式休息房没有自动离开，玩家点它
// 才离开休息室回塔楼层（宿主据此走 `leaveRoom` 意图 → completeRoom → 幕间黑幕回塔楼）。
//
// 数据边界（THREE_UI_MIGRATION 铁律）：本舞台**不读 run 状态**——面板走 `setPanel(snap)`
// 下行快照、点击走 `setPanelIntentHandler` 上行意图、状态栏走 `setStatus`。机器 rig 的输入
// 只有"后端已定的结果"（拉杆落面/档位），rig 自己完成动画，播完回执 slotAnimDone。
//
// **机器逻辑已按机器下沉到 `stage/machines/`**（老虎机/售货机/银行机/合并房陈设各一个模块）：
// 本舞台只做通用舞台机制（相机聚焦机械/浮标/面板停靠/拾取主干/状态栏/逐帧骨架），
// 不认识任何具体机器——**加新机器只改 machines/**（加一个模块文件 + 在 machines/index.js 登记一行）。

import * as THREE from 'three';
import { getScene } from '../scenes/index.js';
import { FLOOR_Y } from '../scenes/dungeon3D.js';
import { createVolumetricMoonlight } from '../scenes/volumetricMoon.js';
import { PanelObject, PANEL_ABOVE_Z } from '../objects/PanelObject.js';
import { ContinueButtonObject } from '../objects/ContinueButtonObject.js';
import { MachineMarkerObject } from '../objects/MachineMarkerObject.js';
import { PlayerStatusObject, PLAYER_STATUS_POS } from '../objects/PlayerStatusObject.js';
import { TopResourceBarObject } from '../objects/TopResourceBarObject.js';
import { BubbleLayer } from '../objects/BubbleLayer.js';
import { createStagePickerKit } from '../stagePickerKit.js';
import { playCardGrantFlight } from '../cardGrantFlight.js';
import { MACHINE_FACTORIES } from '../machines/index.js';
import { Picker } from '../picker/Picker.js';
import { renderRichTextBlock } from '../richtext/texture.js';
import { makeCardFaceBaker } from '../richtext/cardFaceDefaults.js';
import { sharedCardArtCache } from '../art/cardArtCache.js';
import { bakeBoldText } from '../objects/textBakers.js';
import { sharedUnitArtCache } from '../art/unitArt.js';
import { WORLD_HEIGHT, UI_CAMERA_LOOK_AT_Y } from '../StageManager.js';

const HALF_UI_W = ((WORLD_HEIGHT * 16) / 9) / 2;

// 聚焦机位处方（用户定 2026-09-11：**点物件先推近，推到位再显示它的操纵 UI**）：
// fracH = 物件占可视高比例；bottom = 物件底边离屏底的比例（其余下沿留给停靠面板）；
// pad = 横向装得下时的余量。距离与视轴下移都由这几个比例**反解**（不手调 margin）。
// 默认一套适用所有尺寸（距离自适应），个别物件要贴脸/退远时由**机器模块的 focusOf** 覆盖。
const FOCUS_DEFAULT = { fracH: 0.50, bottom: 0.46, pad: 0.92 };

const ZOOM_MS = 0.62;   // 推近/拉远的补间时长（秒）
// 「继续前进」按钮：右下角（用户定）——避开下沿停靠面板（面板宽 62 wu、居中），故放最右侧
const CONTINUE_POS = { x: HALF_UI_W - 16, y: UI_CAMERA_LOOK_AT_Y - 30 };

export class RoomStage {
  /**
   * @param {object} options
   *   recipe: 休息房配方 id（'casino' …）
   *   seed:   场景种子（同层同房稳定重建）
   *   stageManager: 舞台管理器（取 renderer 建体积光 composer；可空 = headless）
   *   snap:   房间面板快照（panelSnapshot 的 room 快照；可后补 setPanel）
   *   bakeLabel / unitArt: 文本与立牌美术（缺省浏览器实现）
   *   bus: 事件总线（面板 tooltip 出口；缺省不发）
   *
   * 与 BattleStage 同律：**自己建 Picker**（App.vue 只给 mapStage 注入输入通道，
   * 战斗/房间舞台各自持有自己的拾取器）；attachInput 保留给测试/外部覆盖。
   */
  constructor({ recipe = 'casino', seed = 'room', stageManager = null, snap = null, bakeLabel = null, unitArt = null, bus = null } = {}) {
    this.name = 'room';
    this.recipe = recipe;
    this.scene = new THREE.Scene();
    this.uiScene = new THREE.Scene();
    this._sm = stageManager;
    this._snap = snap;
    this._onIntent = null;
    this._runSequencer = null;  // run 级动画队列（runController 后置注入：得卡演出指令化）
    this._grantBusy = false;    // 「择卡得卡」演出进行中：吞掉点击（见 _activate/_onPanelAction）
    this._picker = null;
    this._bus = bus;
    this._panel = null;          // 下沿停靠的机器操作面板（惰性建）
    this._panelKind = null;      // 当前面板对应的机器（null = 收起）
    this._focused = null;        // 聚焦的机器名
    this._hoverName = null;      // 当前 hover 的交互物名（聚焦时恒 null，见 handlePointerMove）
    this._downHit = null;
    this._pickIds = [];
    this._t = 0;
    this._camTween = null;   // { from, to, t, dur, then }：推近/拉远的机位补间
    this._unsubTick = null;

    // ---- 3D 房间（PCG 配方；与战斗房同一 composeRoom 契约）----
    this._sceneDef = getScene(`pcg:${recipe}`, seed);
    this._room = this._sceneDef?.build3D?.() ?? null;
    if (this._room) {
      this.scene.add(this._room.group);
      const fogDef = this._room.recipe?.fog;
      this.scene.fog = fogDef
        ? new THREE.Fog(fogDef.color, fogDef.near, fogDef.far)
        : new THREE.Fog(0x060a14, 165, 310);
    }
    const renderer = stageManager?._renderer;
    if (this._room?.moonlight && renderer && typeof renderer.setRenderTarget === 'function') {
      this._composer = createVolumetricMoonlight({ light: this._room.moonlight });
      this.composeScene = ({ scene, camera }) => this._composer.render(renderer, scene, camera);
      this.composeResize = (w, h) => this._composer.resize(w, h);
      this.composeResize(stageManager.viewSize.width || 2, stageManager.viewSize.height || 2);
    }

    // ---- 机器 rig + 头顶浮标（可点：浮标比机器大得多，远景也点得中）----
    this._rigs = new Map();      // name -> rig
    this._markers = [];          // { name, entry, marker(箭头浮标), hover }
    // ---- 机器模块（machines/：每台机器的 rig/取景/面板/拾取/演出/义务门都归它的模块）----
    // RoomStage 只做通用舞台机制；加新机器 = machines/index.js 登记一行。
    // ctx 全部箭头晚绑定（与 runController 拆域同律）：模块构造时舞台可能还没就位（无 picker/无相机）。
    const machineCtx = {
      snap: () => this._snap,
      room: () => this._room,
      sceneDef: () => this._sceneDef,
      picker: () => this._picker,
      bubbles: () => this._bubbles,
      camera: () => this._sm?.camera ?? null,
      sm: () => this._sm,
      markers: () => this._markers,
      rigs: () => this._rigs,
      focused: () => this._focused,
      panelKind: () => this._panelKind,
      recipe: this.recipe,
      intent: (a) => this._onIntent?.(a),
      focusMachine: (n) => this._focusMachine(n),
      focusPoseFor: (n) => this._focusPoseFor(n),
      openPanel: (n) => this._openPanel(n),
      startCamTween: (to, dur, then) => this._startCamTween(to, dur, then),
      entryOf: (name) => this._markers.find(m => m.name === name)?.entry ?? null,
      addPickable: (id, obj, opts) => { if (this._picker) { this._picker.addPickable(id, obj, opts); this._pickIds.push(id); } },
      removePickable: (id) => { this._picker?.removePickable(id); const i = this._pickIds.indexOf(id); if (i >= 0) this._pickIds.splice(i, 1); },
      uiAnchorOf: (e, l) => this._uiAnchorOf(e, l),
      midAnchorOf: (e, l) => this._midAnchorOf(e, l),
      addInteractive: (name, entry) => this._addInteractive(name, entry),
    };
    this._machines = MACHINE_FACTORIES.map(f => f(machineCtx));
    this._moduleOfKind = {};     // entry.kind -> 机器模块（rig 创建/取景/面板归口）
    for (const m of this._machines) for (const k of m.kinds ?? []) this._moduleOfKind[k] = m;
    this._buildInteractives();

    // ---- UI：状态栏 + 顶端资源行 + 继续前进按钮 ----
    this._unitArt = unitArt ?? ((typeof document !== 'undefined') ? sharedUnitArtCache : null);
    this._bakeLabel = bakeLabel || defaultBakeLabel();
    // 卡面烘焙（与战场/塔楼层同源）：**全屏选卡界面也必须拿到它**——漏传的症状是
    // "候选卡一张都看不到、但 hover 预览正常"（预览走 tooltip 的 DOM 卡面，不经过这里；
    // 用户 2026-09-12 报"篝火处升级选卡界面卡牌隐身"的真凶）。面板与选卡界面共用这一份。
    this._bakeFace = (typeof document !== 'undefined')
      ? makeCardFaceBaker({ cardArt: sharedCardArtCache, unitArt: this._unitArt })
      : null;
    // 全屏选卡/选遗物界面 + 获得物特写：三舞台共用套件（stagePickerKit.js）——
    // 与塔楼层/战斗层是**同一份实现**（此前这里抄了一份，文案与来源还在漂移）。
    // ⚠ 必须在 `_bakeFace` 就位之后建（卡面烘焙是按值传进去的，早建会让候选卡面隐身）；
    // bus 传 getter：房间舞台的总线可能在 attachInput 里才注入，而界面是惰性创建的。
    this._pickerKit = createStagePickerKit({
      uiScene: this.uiScene,
      getPicker: () => this._picker,
      bakeFace: this._bakeFace,
      bus: () => this._bus,
      onIntent: (a) => this._onIntent?.(a),
      getSequencer: () => this._runSequencer,
      getAnchor: () => this._deckAnchor(),
    });
    const mkBake = this._bakeLabel;
    this._statusBar = new PlayerStatusObject({ bakeLabel: mkBake, unitArt: this._unitArt });
    this._statusBar.position.set(PLAYER_STATUS_POS.x, PLAYER_STATUS_POS.y, PLAYER_STATUS_POS.z);
    this.uiScene.add(this._statusBar);
    // 立绘晚到补挂（与塔楼层/战场同源同款）：漏这一步的症状是「休息房里玩家与瑞米的
    // 头像都是空圆」（用户 2026-09-13 报赌博层头像失踪）。素材通常已预载就绪，先挂一次；
    // 未就绪则由 addOnLoad 回调补挂（水晶/金币的晚到补挂走 PlayerStatusObject 自己的订阅）。
    this._unsubArt = this._unitArt?.addOnLoad(() => this._applyAvatar());
    this._applyAvatar();
    this._topBar = new TopResourceBarObject({ bakeLabel: mkBake });
    this.uiScene.add(this._topBar);
    this._bubbles = new BubbleLayer();   // 角色/物件的说话·思索泡泡（提示用，如"还没挑卡"）
    this.uiScene.add(this._bubbles);
    this._continue = new ContinueButtonObject();
    this._continue.position.set(CONTINUE_POS.x, CONTINUE_POS.y, PANEL_ABOVE_Z + 2);
    this._continue.setEnabled(true);   // 拾取登记在 attachInput（此时可能还没 Picker）
    this.uiScene.add(this._continue);

    if (stageManager) this._picker = new Picker({ stageManager, bus });
    if (snap) this.setPanel(snap);
    this._registerPickables();   // 机器/浮标/继续按钮先登记（面板的按钮随面板建时登记）
  }

  // ================= 对外 API（与 MapStage 同名同义，宿主代码可共用）=================

  setPanelIntentHandler(fn) { this._onIntent = fn; }

  /** run 级动画队列注入（「择卡得卡」演出指令化的挂点，与切幕/清层串行）。 */
  setRunSequencer(seq) { this._runSequencer = seq ?? null; }

  /** 得卡演出的收编锚点：玩家状态栏（房间里没有牌库图标，卡收向"玩家"即入组）。 */
  _deckAnchor() { return { x: PLAYER_STATUS_POS.x + 10, y: PLAYER_STATUS_POS.y, z: PLAYER_STATUS_POS.z }; }

  /** 房间面板快照下行（notify 每次都推）：存下 + 按需重绘已打开的机器面板。 */
  setPanel(snap) {
    // ⚠ 只认**房间快照**：离房时编排器会先推一份新阶段的快照（prep/…），若照单全收，
    // 已打开的机器面板会用错快照重绘一次（用户报"点继续后营地 UI 突变了一下"——那一帧
    // 正是营地面板拿 prep 快照重绘的结果，随后才被幕间黑幕盖住）。非房间快照一律忽略。
    if (!snap || snap.kind !== 'room') return;
    this._snap = snap;
    if (this._panelKind) this._renderPanel();
    for (const m of this._machines) m.sync?.(snap);   // 各机器按快照同步（spin/货架/屏幕/恶魔起止）
  }

  /** 状态栏（与塔楼层同物同位，编排器每次阶段迁移后推）。 */
  setStatus({ ap, apMax, mana, manaMax, money = null, hp = null, maxHp = null, relics = null, remi = null }) {
    this._statusBar.apCoin.setValue(ap, apMax);
    this._statusBar.manaCrystal.setValue(mana, manaMax);
    if (money !== null) this._topBar.setMoney(money);
    if (hp != null && maxHp != null) this._statusBar.setPlayerHp(hp, maxHp);
    if (relics) this._topBar.setRelics(relics);
    if (remi) this._statusBar.setRemi(remi);
  }

  /** 挂骑士/瑞米头像立绘（与 MapStage._applyAvatar 同源同款）。 */
  _applyAvatar() {
    const img = this._unitArt?.getFile('knight_avatar.png');
    if (img) this._statusBar.setAvatar(img, { crop: 'full', mirror: true });
    const remiImg = this._unitArt?.getFile('remi_avatar.png');
    if (remiImg) this._statusBar.setRemiAvatar(remiImg);
  }

  // ---- 全屏选择界面 / 获得物特写（实现已抽 stagePickerKit，与塔楼层/战斗层共用一份）----
  // 本舞台只保留对外同名转发（宿主按"当前舞台"调用，签名不变）：来源表/意图/文案都在 kit 里，
  // 候选取自当前房间快照（`this._snap`）。来源：camp / training / slot / bankUpgrade / bankBurn。

  /**
   * 打开「选卡」界面；source 决定候选与确认后上行的意图。
   * ⚠ 候选按 source 取对应快照段（kit 的 UPGRADE_SOURCES）——曾经一律读 `snap.slot.upgradeCards`，
   * 于是营地/训练桩面板里的「升级一张卡」在场景里是死按钮（点开空的 = 没反应）。
   */
  openUpgradePicker(source) { return this._pickerKit.openUpgradePicker(source, this._snap); }

  /**
   * 打开「卡包三选一」全屏 overlay（买到的卡包：买到即开，用户定 2026-09-12）。
   * **可放弃**：确认 = 选中的卡入组；返回 = 放弃这个卡包（钱已花，选择权在玩家）。
   */
  openShopPackPicker() { return this._pickerKit.openShopPackPicker(this._snap); }

  /** 打开「粉碎物品」选择界面（卡或遗物；kind 决定列表）。 */
  openDevourPicker(opts) { return this._pickerKit.openDevourPicker(opts); }

  /** 获得物特写（通用组件：有素材用素材，没有就拿色块代替）。 */
  showcaseItem(item) { return this._pickerKit.showcaseItem(item); }

  get showcasing() { return this._pickerKit.showcasing; }
  get cardPicker() { return this._pickerKit.cardPicker; }
  get relicPicker() { return this._pickerKit.relicPicker; }

  /** 当前聚焦的机器名（调试/测试）。 */
  get focusedMachine() { return this._focused; }
  /** 当前打开的面板种类（'slot' | 'bank' | 'shop' | null）。 */
  get openPanel() { return this._panelKind; }
  get rigs() { return this._rigs; }

  // ================= 输入 =================

  attachInput({ stageManager, bus } = {}) {
    this._picker = stageManager ? new Picker({ stageManager, bus }) : this._picker;
    this._sm = stageManager ?? this._sm;
    this._bus = bus ?? null;
    this._registerPickables();
    // 选卡/选遗物/特写也要重连到（可能刚换过的）拾取器：它们惰性创建，重连不补会把
    // 界面登记到旧 Picker 上（点击/hover 全落空）。
    this._pickerKit.attachPicker(this._picker);
  }

  detachInput() {
    for (const id of this._pickIds ?? []) this._picker?.removePickable(id);
    this._pickIds = [];
    this._pickerKit.attachPicker(null);
    this._picker = null;
    this._downHit = null;
    for (const m of this._machines) m.pickerChanged?.();   // 各机器复位自己的拾取簿记
  }

  handlePointerMove(x, y) {
    if (!this._picker) return;
    this.uiScene.updateMatrixWorld(true);
    const hit = this._picker.hover(x, y);
    // 各机器的吞掉型 hover（安慰奖演出中只认两件货）
    for (const m of this._machines) if (m.handleHover?.(hit)) return;
    // 恶魔 roll 选择阶段：转轮自己的 tooltip token 由 Picker 发（此处不吞 hover）
    if (this._pickerKit.routeHover(hit, x, y)) return;   // 特写吞掉 hover / 全屏界面接管
    const name = this._focused ? null : this._machineOf(hit);
    // zoom-in（已聚焦某台）期间不响应 hover：hover 放大/提亮是**全景下的可交互暗示**
    // （"这东西能点"），推近之后玩家已经在跟它交互了，再跟着鼠标缩放只会让人以为画面在抖
    // （用户定 2026-09-12）。故聚焦时统一喂 null，机器 rig 与浮标都不进入 hover 态。
    this._hoverName = name;
    for (const [n, rig] of this._rigs) rig.setHover?.(n === name);
    for (const m of this._markers) m.hover = (m.name === name);   // 箭头浮标 hover 提亮
    // 各机器的通知型 hover（售货机商品卡：悬停抬起 + 盘子提亮；下标全局唯一，各 rig 只认自己的）
    for (const m of this._machines) m.hover?.(hit);
    this._continue.setHovered(hit?.id === this._continue.pickId);
    this._panel?.onHover?.(hit);   // 面板按钮/卡面 hover（缺席 = 无面板）
  }

  handlePointerDown(x, y) {
    if (!this._picker) return;
    this.uiScene.updateMatrixWorld(true);
    this._downHit = this._picker.pick(x, y);
    if (this._downHit?.id === this._continue.pickId) this._continue.setPressed(true);
  }

  handlePointerUp(x, y) {
    if (!this._picker) return;
    this.uiScene.updateMatrixWorld(true);
    this._continue.setPressed(false);
    const hit = this._picker.pick(x, y);
    const down = this._downHit;
    this._downHit = null;
    // 各机器的 pointerUp 点选（先于 pickerKit 路由）：安慰奖演出中选一件货
    for (const m of this._machines) if (m.handlePointerUp?.(hit)) return;
    if (this._pickerKit.routeClick(hit)) return;   // 特写点任意处退出 / 全屏界面接管
    if (down && hit && down.kind === hit.kind && down.id === hit.id) {
      this._activate(hit);
      return;
    }
    // 抬起与按下不一致（拖出/误触）：只做"点空白处收起面板"
    if (!hit || hit.kind === 'background') this._focusMachine(null);
  }

  handleWheel(deltaY) {
    return this._pickerKit.handleWheel(deltaY);
  }

  onEnter(manager) {
    this._sm = manager;
    manager.restoreBaseCamera?.();   // 接手时先回基准机位（上一舞台可能留下变形取景）
    this._unsubTick = manager.onTick((dt) => this._tick(dt));
  }

  onExit() {
    this._unsubTick?.();
    this._unsubTick = null;
    for (const m of this._machines) m.onExit?.();   // 各机器停掉自己的定时器/演出
    this._camTween = null;
    clearTimeout(this._camFuse);
    this._camFuse = null;
    this._sm?.restoreBaseCamera?.();   // 借过机位必须还：否则塔楼层带着推近的取景
    this._focused = null;
    this._panelKind = null;
    this._removePanel();
  }

  dispose() {
    this.onExit();
    this._unsubArt?.();
    this._unsubArt = null;
    this._composer?.dispose();
    this._composer = null;
    this.composeScene = null;
    this.composeResize = null;
    this._bubbles.dispose();
    for (const m of this._machines) m.dispose?.();   // 各机器收尾（onExit 已调过，模块自身幂等）
    this._continue.dispose();
    this._pickerKit.dispose();   // 选卡/选遗物/特写（未创建的实例无事发生）
    this._removePanel();
    for (const m of this._markers) m.marker?.dispose?.();
    this._statusBar.dispose();
    this._topBar.dispose();
    this._markers = [];
    this._rigs.clear();
  }

  // ================= 内部：场景与机器 =================

  _buildInteractives() {
    const interactives = this._room?.interactives;
    if (!interactives) return;
    for (const [name, entry] of interactives) this._addInteractive(name, entry);
  }

  /** 登记一件交互物：机器类（由机器模块的 createRig 决定）才建 rig；普通陈设只要浮标 + 拾取 + 推近。 */
  _addInteractive(name, entry) {
    {
      // rig 的创建归口到机器模块（没有 createRig 的陈设 = 无 rig，只有浮标 + 聚焦）
      const rig = this._moduleOfKind[entry.kind]?.createRig?.(entry) ?? null;
      if (rig) this._rigs.set(name, rig);
      // 无 rig 件的 hover 放大基准（配方的 scale 已烘进 object.scale，这里存一份当基准）
      entry.baseScale = entry.object.scale.x || 1;
      entry._hoverK = 0;
      // 头顶浮标 = **一枚跳动的发光箭头**（用户定 2026-09-12：去掉地面光圈与光柱，只留箭头）。
      // ⚠ y 必须落在房间地平（FLOOR_Y）上：道具都摆在 FLOOR_Y 平面，浮标写 y=0 会飘到半空
      // （30 世界单位的悬空，与机器读作两件东西）；箭尖指着机器顶上方一点点，
      // 高度从**包围盒顶**算，各种尺度的机器都不用逐个调参。
      const topY = new THREE.Box3().setFromObject(entry.object).max.y;
      const marker = new MachineMarkerObject({ size: Math.max(1, entry.scale * 0.52) });
      marker.position.set(entry.x, FLOOR_Y + Math.max(4, topY - FLOOR_Y + 1.3), entry.z);
      this._room.group.add(marker);
      this._markers.push({ name, entry, marker, hover: false });
    }
  }

  /** 拾取登记：浮标 + 机器本体（world 空间）+ 商品卡 + UI（继续按钮 / 面板按钮）。 */
  _registerPickables() {
    if (!this._picker) return;
    this._pickIds = [];
    for (const m of this._markers) {
      const id = `room:machine:${m.name}`;
      this._picker.addPickable(id, m.marker, { kind: 'machine' });
      this._pickIds.push(id);
      // 机器本体也给一个 id（点机器本身同样聚焦）。售货机用 `parts.pickBody`（机身合批件，
      // **不含玻璃门**）：整机登记的话，玻璃门会先被射线命中，柜内的商品卡永远点不到
      this._picker.addPickable(`room:body:${m.name}`, m.entry.parts?.pickBody ?? m.entry.object, { kind: 'machine' });
      this._pickIds.push(`room:body:${m.name}`);
    }
    this._picker.addPickable(this._continue.pickId, this._continue, { kind: 'button', space: 'ui' });
    this._pickIds.push(this._continue.pickId);
    this._panel?.attachPicker(this._picker);
    // 各机器登记专属拾取（老虎机的投料口热区 / 售货机的商品卡……）
    for (const m of this._machines) m.registerPickables?.();
  }

  /** hit → 机器名（浮标或本体任一命中）。 */
  _machineOf(hit) {
    if (hit?.kind !== 'machine') return null;
    return hit.id.startsWith('room:machine:') ? hit.id.slice('room:machine:'.length)
      : hit.id.startsWith('room:body:') ? hit.id.slice('room:body:'.length) : null;
  }

  _activate(hit) {
    if (this._grantBusy) return;   // 得卡演出中：吞掉一切点击（机器/继续键/面板都先让路）
    // 各机器的吞掉型点击（恶魔词条 / 投料口 / 商品卡）：命中即消化
    for (const m of this._machines) if (m.handleClick?.(hit)) return;
    if (!hit || hit.kind === 'background') {
      this._panel?.onClick?.(hit);
      this._focusMachine(null);   // 点房间空白处 = 收起机器面板
      return;
    }
    if (hit.id === this._continue.pickId) {
      // 「继续前进」的**义务门**（**由各机器模块自报**：恶魔 roll / 卡包待选 / 强绑抓牌是硬拦，
      // 营地的休整是软提示——第一次点继续只给一句提示泡泡，**再点一次即离房**）。
      // 先问各机器是否接管这次点击（拉回镜头提示 / 播离房安慰奖），都没接管才真的离房。
      for (const m of this._machines) if (m.onContinue?.()) return;
      this._onIntent?.({ action: 'leaveRoom' });   // 主动离开休息室（宿主走幕间黑幕回塔楼）
      return;
    }
    const name = this._machineOf(hit);
    if (name) { this._focusMachine(name); return; }
    this._panel?.onClick?.(hit);   // 面板按钮（拉杆/存款/…）：路由到 _onPanelAction → 上行意图
  }

  /**
   * 房里**还欠着的事**（null = 可以离房）：由各**机器模块自报**（`pendingDuty`）。
   * 语义分两档（硬拦 / 软提示）由模块自己定义与提示，本舞台只做聚合：
   *   · **硬拦**（如 'demon' / 'shop' / 'forced'）——钱已到手或升级已发生，不处理完不许走；
   *   · **软提示**（如 'camp'）——休整是可选收益（训练同理，用户定 2026-09-12），
   *     第一次点「继续前进」只弹一句泡泡，再点一次就放行（各模块自己记"提示过没有"）。
   */
  _pendingRoomDuty() {
    return this._machines.some(m => m.pendingDuty?.(this._snap));
  }

  /** 世界锚点 → UI 空间（泡泡/文字挂在物件上方）。 */
  _uiAnchorOf(entry, lift = 10) {
    const sm = this._sm;
    if (!sm?.worldToUI) return { x: 0, y: 0 };
    const box = new THREE.Box3().setFromObject(entry.object);
    const c = box.getCenter(new THREE.Vector3());
    return sm.worldToUI(c.x, Math.max(c.y, box.max.y) + lift * (entry.scale ?? 1), c.z);
  }

  /**
   * 物件**中部**的 UI 锚点（怼脸取景时物件顶/底都在画外，提示泡泡要挂在看得见的地方）。
   * lift 是世界单位（不乘 scale——怼脸处方里 scale 已经很大，乘完就飞出去了）。
   */
  _midAnchorOf(entry, lift = 1.5) {
    const sm = this._sm;
    if (!sm?.worldToUI) return { x: 0, y: 0 };
    const box = new THREE.Box3().setFromObject(entry.object);
    const c = box.getCenter(new THREE.Vector3());
    return sm.worldToUI(c.x, c.y + lift, c.z);
  }

  /** 聚焦某个交互物（null = 退回房间全景）。用户定的节奏：**先把相机推到物件前，推到位之后再
   * 弹出该机器的操作 UI**；退回时反过来——先收 UI/追光，再把机位拉回全景。
   */
  _focusMachine(name) {
    if (this._focused === name) return;
    this._focused = name;
    for (const [n, rig] of this._rigs) rig.setFocus?.(n === name);
    const entry = this._markers.find(m => m.name === name)?.entry ?? null;
    if (!entry) {
      this._panelKind = null;
      this._removePanel();
      this._room?.lighting?.setFocus?.(null);
      this._startCamTween(this._basePose(), ZOOM_MS, null);
      return;
    }
    const p = new THREE.Vector3(entry.x, this._focusLightY(entry), entry.z);
    // 各机器的焦点补光覆盖（售货机：**只压暗外围、不打正面补光**——柜内商品是 unlit 自发光）
    const light = this._moduleOfKind[entry.kind]?.focusLightOf?.(entry);
    this._room?.lighting?.setFocus?.(p, light?.fill === false ? { fill: false } : { strength: 1 });
    this._startCamTween(this._focusPose(entry, p), ZOOM_MS, () => {
      if (this._focused === name) this._openPanel(name);   // 推到位才开面板
    });
  }

  /** 焦点补光的高度（由机器模块覆盖；售货机压到**下半身**——光心落在货架之下，柜内背板不被照爆）。 */
  _focusLightY(entry) {
    const box = new THREE.Box3().setFromObject(entry.object);
    const h = box.max.y - box.min.y;
    return box.min.y + h * (this._moduleOfKind[entry.kind]?.focusLightOf?.(entry)?.y ?? 0.5);
  }

  /** 全景基准机位（StageManager 构造时那套）。 */
  _basePose() {
    const base = this._sm?.cameraBase;
    const cam = this._sm?.camera;
    if (!cam) return null;   // headless（无舞台管理器）：不做机位动画，面板直接开
    return base
      ? { position: base.position.clone(), quaternion: base.quaternion.clone() }
      : { position: cam.position.clone(), quaternion: cam.quaternion.clone() };
  }

  /**
   * 聚焦机位：**按整机包围盒**取景（含拉杆/招牌/投放口），沿机身朝向 ry 的正前方落到
   * `中心 + fwd·dist`，视轴再下移 aimLift×可见高 —— 机器整体偏上，下沿留给停靠面板。
   *
   * ⚠ 与 restGallery 的 `focusMachine` 有意不同：那里是"怼脸"（老虎机只框三根转轮 + 拉杆，
   * 为了看转轮细节），而房间层的交互目标遍布整机（投料口/计数器在下半身、招牌在上），
   * 只框窗口会把可点区域切出画外。故统一用整机包围盒 + 按 fov 反解距离。
   */
  _focusPose(entry, center) {
    const cam = this._sm?.camera;
    const cfg = { ...FOCUS_DEFAULT, ...(this._moduleOfKind[entry.kind]?.focusOf?.(entry) ?? {}) };
    const bb = cfg.subject?.(entry) ?? new THREE.Box3().setFromObject(entry.object);
    const size = bb.getSize(new THREE.Vector3());
    const c = bb.getCenter(new THREE.Vector3());
    const vFov = THREE.MathUtils.degToRad(cam?.fov ?? 24);
    const aspect = cam?.aspect || (16 / 9);
    const tan = Math.tan(vFov / 2);
    // ① 竖向：让机器占 fracH 的可视高 → 反解"可见高"，再换算成相机距离
    let visibleH = size.y / cfg.fracH;
    // ② 横向兜底：整机宽度（含余量）也要装得下，装不下就再退远
    visibleH = Math.max(visibleH, size.x / (cfg.pad * aspect));
    const dist = Math.max(visibleH / (2 * tan), 10);
    // ③ 机器中心在屏幕高度上的比例 → 视轴下移量（0 = 居中；正值 = 机器上移）
    const centerFrac = cfg.bottom + (size.y / visibleH) / 2;
    const fwd = new THREE.Vector3(Math.sin(entry.ry ?? 0), 0, Math.cos(entry.ry ?? 0));
    const position = c.clone().addScaledVector(fwd, dist);
    const look = new THREE.Vector3(c.x, c.y - visibleH * (centerFrac - 0.5), c.z);
    const m = new THREE.Matrix4().lookAt(position, look, new THREE.Vector3(0, 1, 0));
    return { position, quaternion: new THREE.Quaternion().setFromRotationMatrix(m) };
  }

  /**
   * 启动机位补间（ease-out cubic）；then 在**到位后**执行一次。
   * 保险丝：补间靠渲染循环推进，而渲染循环在后台标签页/失焦窗口里会被浏览器节流到停摆
   * （rAF 0 帧）——那样"面板等推近到位才开"就会变成永远不开。故同时挂一个定时器兜底：
   * 补间没跑完也把 then 兑现（画面可能停在旧帧，但 UI 不会假死）。
   */
  _startCamTween(to, dur = ZOOM_MS, then = null) {
    const cam = this._sm?.camera;
    if (!cam || !to) { then?.(); return; }   // 无相机（headless/单测）：跳过动画，直接兑现后续
    clearTimeout(this._camFuse);
    this._camTween = {
      from: { position: cam.position.clone(), quaternion: cam.quaternion.clone() },
      to, t: 0, dur: Math.max(0.01, dur), then,
    };
    if (then) {
      this._camFuse = setTimeout(() => {
        this._camFuse = null;
        if (this._camTween) { this._camTween = null; then(); }
      }, dur * 1000 + 400);
    }
  }

  // ================= 内部：面板 =================

  /** 打开某台机器的停靠面板（name = 交互物名；没有对应机器面板则收起）。 */
  _openPanel(name) {
    // 面板 builder 归口到机器模块（entry.kind → 模块）：名字不是交互物 / 该机器没有面板 = 收起
    const entry = this._markers.find(m => m.name === name)?.entry;
    const mod = entry ? this._moduleOfKind[entry.kind] : null;
    if (!name || !mod?.panel) { this._panelKind = null; this._removePanel(); return; }
    this._panelKind = name;
    this._renderPanel();
  }

  /** 操纵条文本烘焙：白字 + 黑描边（bakeBoldText 的 stroke 口径），字号由调用方给。 */
  _dockBakeText() {
    if (this._dockBake !== undefined) return this._dockBake;
    this._dockBake = (typeof document === 'undefined')
      ? null
      : (text, { fontPx = 16 } = {}) => bakeBoldText(text, {
        fontPx, tint: '#ffffff', stroke: 'rgba(0,0,0,0.95)',
      });
    return this._dockBake;
  }

  /**
   * 播一次**粉碎演出**（编排器在吞噬结算后调用）：转发给实现了 playCrush 的机器模块
   * （老虎机：把镜头拉回粉碎口 + rig 咬合迸币）。纯表现，不影响结算。
   */
  playCrush() {
    for (const m of this._machines) { if (m.playCrush?.()) return true; }
    return false;
  }

  /** 取某台交互物的聚焦机位（无则 null）。 */
  _focusPoseFor(name) {
    const entry = this._markers.find(m => m.name === name)?.entry;
    if (!entry) return null;
    const box = new THREE.Box3().setFromObject(entry.object);
    const c = box.getCenter(new THREE.Vector3());
    return this._focusPose(entry, c);
  }

  /** 打开售货机面板（场景式房间点售货机机身；占位房间走房间表头的本地动作）。 */
  openShop() { this._openPanel('shop'); }

  _renderPanel() {
    const snap = this._snap;
    if (!snap || !this._panelKind) return;
    if (!this._panel) {
      this._panel = new PanelObject({
        form: 'dock',
        onIntent: (a, info) => this._onPanelAction(a, info),
        // 卡面烘焙与战场/塔楼层同源（pending 的卡阵、选卡界面都要真卡面，不能没有）
        bakeFace: this._bakeFace,
        // 操纵条文字**统一白字 + 黑边**（用户 2026-09-12）：烘焙层直接定色，
        // widget 各自的 tint 在 dock 形态下被忽略（见 PanelObject 的 dock 分支）
        bakeText: this._dockBakeText(),
      });
      this.uiScene.add(this._panel);
    }
    // 停靠面板只放"这台机器能做的事"：**不再给「返回房间」按钮**——点面板外的房间空白处
    // 即拉远回全景（用户定 2026-09-12：推近后的退出口应当是"点别处"，UI 里多一个返回键既
    // 占地方又和底部操纵条的语义打架）。widgets 由该机器模块的 panel builder 产出。
    const entry = this._markers.find(m => m.name === this._panelKind)?.entry;
    const mod = entry ? this._moduleOfKind[entry.kind] : null;
    const widgets = mod?.panel?.(this._panelKind, snap) ?? null;
    if (!widgets) { this._panelKind = null; this._removePanel(); return; }
    this._panel.setWidgets(this._panelKind, widgets);
    this._panel.attachPicker(this._picker);
  }

  _removePanel() {
    if (!this._panel) return;
    this.uiScene.remove(this._panel);
    this._panel.dispose();
    this._panel = null;
  }

  /** 面板动作分流：本地动作（开选卡界面…）自己消化，其余原样上行。 */
  _onPanelAction(action, info) {
    if (!action || this._grantBusy) return;
    if (action.local) {
      if (action.action === 'openShop') { this.openShop(); return; }
      if (action.action === 'closeShop') { this._openPanel(this._focused); return; }
      if (action.action === 'openUpgradePicker') { this.openUpgradePicker(action.source); return; }
      if (action.action === 'openShopPack') { this.openShopPackPicker(); return; }
      return;
    }
    // 得卡标记（老虎机卡多选一 / 训练抓牌）：摘下被点的卡 → 收起操纵条 → 播「择卡得卡」
    // 演出（脉冲→飞向玩家状态栏，sequencer 指令化）→ 落袋才上行意图。
    // 操纵条整体 _removePanel 而不是藏起：dock 非模态不吞指针（点击由 _grantBusy 守），
    // 且 setPanel → _renderPanel 只在新快照到达时整份重建，不存在"隐形面板被重绘"的坑。
    if (action.grantCard && info?.pickId && this._panel) {
      const entry = this._panel.takeCard(info.pickId);
      if (entry) {
        this._grantBusy = true;
        this.uiScene.add(entry.object);      // 面板组在原点：局部坐标即世界坐标
        this._removePanel();
        playCardGrantFlight({
          card: entry.object, target: this._deckAnchor(), sequencer: this._runSequencer,
          onDone: () => { this._grantBusy = false; this._onIntent?.(action); },
        });
        return;
      }
    }
    this._onIntent?.(action);
  }

  // ================= 内部：逐帧 =================

  _tick(dt) {
    this._t += dt;
    this._stepCamTween(dt);
    const camPos = this._sm?.camera?.position ?? null;
    this._room?.update?.(dt, null, camPos);
    for (const rig of this._rigs.values()) rig.update(dt);
    // 浮标：跳动的发光箭头（聚焦/hover 的那台更亮更大，远景也读得出"当前在看哪台"）
    for (const m of this._markers) {
      m.marker.setHighlight(m.name === this._focused || !!m.hover);
      m.marker.update(dt);
      // 无 rig 的陈设交互物（篝火/训练桩）的 hover 反馈：整体轻微放大——老虎机/银行机/售货机
      // 由各自 rig 做同类反馈，这里给"没有 rig 的可交互物"补上同一套可交互暗示（用户定 2026-09-12）。
      // zoom-in 时 _hoverName 恒 null，故自然不会缩放（该反馈只属于全景）。
      if (!this._rigs.has(m.name)) {
        const want = this._hoverName === m.name ? 1 : 0;
        const k = (m.entry._hoverK ?? 0) + (want - (m.entry._hoverK ?? 0)) * Math.min(1, dt * 9);
        m.entry._hoverK = k;
        const base = m.entry.baseScale ?? 1;
        m.entry.object.scale.setScalar(base * (1 + 0.035 * k));
      }
    }
    // 各机器的帧驱动（恶魔相位机 / 安慰奖 billboard 面向相机 + 浮动）
    for (const m of this._machines) m.tick?.(dt);
    // 「继续前进」的明度：获得演出/全屏选择界面是**模态覆盖层**，期间这枚常驻按钮必须明显不可用。
    // 只靠 3D 遮罩压不住它——它在 UI 层比遮罩更靠前，会画在半透明遮罩之上、看起来还能点
    // （用户 2026-09-13 报）。故这里逐帧给一个很低的暗度；其余时间按房间欠账（恶魔 roll /
    // 卡包待选 / 强绑抓牌）压到 0.4，正常为 1。放帧驱动是因为演出起止不走快照。
    this._continue.setDim(
      this._pickerKit.uiBusy ? 0.18
        : (this._pendingRoomDuty() ? 0.4 : 1),
    );
    this._continue.update(dt);
    this._pickerKit.update(dt);
    for (const key of this._bubbles.keys) {   // 泡泡跟随物件（相机在动，每帧重投影）
      const entry = this._markers.find(m => m.name === key)?.entry;
      if (entry) this._bubbles.moveTo(key, ...Object.values(this._uiAnchorOf(entry, 14)));
    }
    this._bubbles.update(dt);
  }

  /** 机位补间推进（ease-out cubic）：位置线性插值 + 四元数球面插值。 */
  _stepCamTween(dt) {
    const q = this._camTween;
    if (!q) return;
    const cam = this._sm?.camera;
    if (!cam) { this._camTween = null; return; }
    q.t = Math.min(1, q.t + dt / q.dur);
    const k = 1 - Math.pow(1 - q.t, 3);
    cam.position.lerpVectors(q.from.position, q.to.position, k);
    cam.quaternion.copy(q.from.quaternion).slerp(q.to.quaternion, k);
    if (q.t >= 1) {
      const then = q.then;
      this._camTween = null;
      clearTimeout(this._camFuse);
      this._camFuse = null;
      then?.();
    }
  }
}

// 与 MapStage 逐字同款：node 无 document 退化为 null（各调用方自行兜底）。
// 塔楼与房间的状态栏/顶端资源行共用同一观感口径，故这里也保持一致。
function defaultBakeLabel() {
  if (typeof document === 'undefined') return null;
  return (text) => renderRichTextBlock(text, {
    maxWidth: 220, scale: 3, style: { fontSize: 16, lineHeight: 20 },
  });
}
