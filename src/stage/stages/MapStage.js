import * as THREE from 'three';
import gsap from 'gsap';
import { isBossFloor } from '../../core/run/runFlow.js';
import { PlayerStatusObject, PLAYER_STATUS_POS } from '../objects/PlayerStatusObject.js';
import { TopResourceBarObject } from '../objects/TopResourceBarObject.js';
import { UI_CAMERA_LOOK_AT_Y } from '../StageManager.js';
import { PanelObject, PANEL_ABOVE_Z } from '../objects/PanelObject.js';
import { SlotRollObject } from '../objects/SlotRollObject.js';
import { BubbleLayer } from '../objects/BubbleLayer.js';
import { PANEL_BUILDERS } from '../panels/index.js';
import { createStagePickerKit } from '../stagePickerKit.js';
import { playCardGrantFlight } from '../cardGrantFlight.js';
import { Picker } from '../picker/Picker.js';
import { makeCardFaceBaker } from '../richtext/cardFaceDefaults.js';
import { sharedCardArtCache } from '../art/cardArtCache.js';
import { renderRichTextBlock } from '../richtext/texture.js';
import { sharedUnitArtCache } from '../art/unitArt.js';

// 快照 kind → builder/形态 的共享表在 panels/index.js（战斗层战后奖励面板共用同一份）

// 战前准备/地图舞台（阶段 7 色块占位，RUN_DESIGN §8.8）：
// 夜空背景 + 点星 + 右侧塔楼侧视图（只看当前层附近一截——看不到顶底）+ 高亮当前层。
// uiScene pass 绘左下角玩家状态栏（与战斗内 PlayerStatusObject 同物同位）。
// 水彩素材与正式布局后补（§9）；本舞台只保证三阶段模型中"楼层切换"一极可跑通。
const VISIBLE_WINDOW = 11;      // 可视层数窗口
const FLOOR_GAP = 7;            // 层间纵向间距（世界单位）
const TOWER_X = 58;             // 塔楼横向位置（右侧）
const BOX_SIZE = { w: 14, h: 4.6, d: 10 };

export class MapStage {
  /**
   * @param {object} options
   *   totalFloors: 塔高（缺省 44）
   *   bakeLabel: 文本烘焙（缺省浏览器用 renderRichTextBlock，node 退化为 1x1 占位）
   *   unitArt: 立牌/图标美术缓存（缺省浏览器用 sharedUnitArtCache，node 为 null）
   */
  constructor({ totalFloors = 44, bakeLabel = null, unitArt = null } = {}) {
    this.name = 'map';
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1026); // 夜空
    this.uiScene = new THREE.Scene(); // UI pass：玩家状态栏（StageManager 清深度后二次渲染）
    this._tower = new THREE.Group();
    this._tower.position.set(TOWER_X, -15, -10);
    this.scene.add(this._tower);
    this._buildStars();

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
    this._panelUi = null;  // 面板本地交互态（勾选缓冲等；换面板即清空）
    this._snap = null;     // 当前面板快照（本地重绘用）
    this._slotRoll = null;  // 老虎机转轮演出对象（演出即结果揭示的闸门）
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
    this._sm = null;         // StageManager（attachInput 注入：世界→UI 空间换算用）
    this._bus = null;       // 事件总线（选卡界面发 tooltip 用）
    this._slotRollId = null; // 正在播放的轮次 id（防重绘重播）
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
  /** 意图上行出口（runController 注入：Stage 只上报「谁被点了」，不解释语义）。 */
  setPanelIntentHandler(fn) { this._onIntent = fn; }

  /** run 级动画队列注入（「择卡得卡」演出指令化的挂点，与切幕/清层串行）。 */
  setRunSequencer(seq) { this._runSequencer = seq ?? null; }

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
  }

  /**
   * 面板动作分流：`local: true` 的是**面板本地交互态**（如种子包勾选）——舞台自己消化
   * 并就地重绘，不惊动 core；其余原样上报给 runController。
   * 判据见 THREE_UI_MIGRATION §6.3：被确认前的勾选是纯 UI 态，确认时才作为载荷上行。
   */
  _onPanelAction(action, info) {
    if (!action || this._grantBusy) return;
    if (action.local) {
      if (action.action === 'openUpgradePicker') { this.openUpgradePicker(action.source); return; }
      if (action.action === 'openShop') { this._panelUi.shopOpen = true; this._renderPanel(); return; }
      if (action.action === 'closeShop') { this._panelUi.shopOpen = false; this._renderPanel(); return; }
      if (action.action === 'toggleSeed') {
        const sel = this._panelUi.selected;
        const id = action.defId;
        if (sel.has(id)) sel.delete(id);
        else if (sel.size < (this._snap?.offering?.picks ?? 0)) sel.add(id);
        this._renderPanel(); // 就地重绘（勾选高亮 + 确认键可用性）
      }
      return;
    }
    // 得卡标记（古尔帕斯卡包三选一）：摘下被点的卡 → 解除 overlay → 播「择卡得卡」
    // 演出（脉冲→飞向玩家状态栏，sequencer 指令化）→ 落袋才上行意图。
    // overlay 是整体 _removePanel 而不是藏起：隐形面板会被随后的 setPanel 重绘但仍隐形
    // （重建只在 kind 变化时），直接拆掉让下一份快照整份重建。
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
    // 老虎机演出完成回执：不是玩家意图，而是**舞台的演出回执**——旧实现由 DOM 的
    // @animationend 发出，迁到 Three 后只能由本舞台自己给（结果揭示的闸门）。
    this._onIntent?.(action);
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
    this._syncSlotRoll();
  }

  // ---- 获得物特写（通用组件，用户定 2026-09-11）----
  // 拿到遗物/药水/奖励时播一次：中央淡入放大（带弹跳）+ 背后上帝光 + 下方三行文本，
  // 点击任意处退出。**实现已抽到 stagePickerKit**（与房间层/战斗层共用一份），
  // 本舞台只保留同名转发（宿主编排器按"当前舞台"调用，签名不变）。
  showcaseItem(item) { return this._pickerKit.showcaseItem(item); }

  /** 卡牌升级演出（通用入口，stagePickerKit 包装的原卡变身→飞入牌库）。 */
  playCardUpgrade(payload) { return this._pickerKit.playCardUpgrade(payload); }

  /** 特写是否在播（宿主据此吞掉面板输入）。 */
  get showcasing() { return this._pickerKit.showcasing; }

  // ---- 角色对话/思索泡泡（通用接口，用户定 2026-09-11）----
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

  // ---- 全屏选卡界面 + 粉碎入口（实现已抽 stagePickerKit，与房间层/战斗层共用一份）----
  // 本舞台只保留对外同名转发：来源表/意图/文案都在 kit 里（stagePickerKit.js 的 UPGRADE_SOURCES），
  // 候选一律取自当前快照（`this._snap`），选卡开关是舞台本地交互态，确认才上行意图。
  // 覆盖来源：camp / training / bankUpgrade / bankBurn / slot / gurpasRemove / bossRemove。

  /**
   * 公开入口（宿主编排器用：银行升级/焚毁、中奖后的免费指定升级由 Shell 主动唤起）。
   * 面板本地动作走同一条路（`_onPanelAction` 的 openUpgradePicker 分支）。
   */
  openUpgradePicker(source) { return this._pickerKit.openUpgradePicker(source, this._snap); }

  /** 卡包三选一（买到即开）：全屏 overlay，**可放弃**（返回 = 放弃卡包）。 */
  openShopPackPicker() { return this._pickerKit.openShopPackPicker(this._snap); }

  /** 遗物包三选一（售货机稀有度遗物包）：全屏 overlay，**可放弃**（返回 = 放弃遗物包）。 */
  openShopRelicPackPicker() { return this._pickerKit.openShopRelicPackPicker(this._snap); }

  /**
   * 打开「粉碎物品」选择界面（老虎机吞噬入口；kind: 'card' | 'relic'）。
   * 候选数据由编排器给（Stage 不读 run）。
   * @returns 是否真的打开了（无候选时 false，编排器据此跳过）
   */
  openDevourPicker(opts) { return this._pickerKit.openDevourPicker(opts); }

  get cardPicker() { return this._pickerKit.cardPicker; }
  get relicPicker() { return this._pickerKit.relicPicker; }

  /** 滚轮：选卡界面优先消费（全屏界面，滚轮只作用于它）。 */
  handleWheel(deltaY) {
    return this._pickerKit.handleWheel(deltaY);
  }

  // ---- 老虎机转轮（演出即闸门）----
  // 快照里出现新的 spinning 就播一次；播完上报 slotAnimDone（runController 据此
  // 揭示结果并推进 sequencer 队列）。演出态本身不进快照（用户裁决：播放进度留 Stage）。
  _syncSlotRoll() {
    const spinning = this._snap?.slot?.spinning ?? null;
    if (!spinning) { this._slotRoll?.reset(); this._slotRollId = null; return; }
    if (spinning.id === this._slotRollId) return; // 同一轮已在播（重绘不重播）
    this._slotRollId = spinning.id;
    if (!this._slotRoll) {
      this._slotRoll = new SlotRollObject({ bakeText: this._bakeLabel });
      // 必须挂在 PANEL_ABOVE_Z 之上：老虎机是模态面板，转轮低于面板背板就会被挡住
      this._slotRoll.position.set(0, UI_CAMERA_LOOK_AT_Y - 18, PANEL_ABOVE_Z);
      this.uiScene.add(this._slotRoll);
    }
    this._slotRoll.play(() => {
      this._slotRollId = null;
      this._onIntent?.({ action: 'slotAnimDone', id: spinning.id });
    });
  }

  // 卡图异步到图后重烘面板内卡面（与战场 addOnLoad 重烘同语言）；无面板/无卡时不订阅
  _syncCardArtSub() {
    const need = !!this._panel?.ownsCardArtWait;
    if (need && !this._unsubCardArt) {
      this._unsubCardArt = sharedCardArtCache.addOnLoad(() => this._panel?.rebakeCards?.());
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
    this._syncCardArtSub();
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
    this._pickerKit.attachPicker(this._picker); // 选卡/选遗物/特写一并重连
  }

  detachInput() {
    this._panel?.attachPicker?.(null);
    this._pickerKit.attachPicker(null);
    this._picker = null;
    this._downHit = null;
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
    if (!this._picker) return;
    this.uiScene.updateMatrixWorld(true);
    const hit = this._picker.hover(x, y);
    if (this._pickerKit.routeHover(hit, x, y)) return;   // 特写吞掉 hover / 全屏界面接管
    this._panel?.onHover?.(hit);
  }

  /** 按压：只记录命中，交互一律在抬起时判定（与 BattleStage 的查看器同律）。 */
  handlePointerDown(x, y) {
    if (!this._picker) return;
    this.uiScene.updateMatrixWorld(true);
    this._downHit = this._picker.pick(x, y);
  }

  /** 抬起：按压与抬起命中一致才算一次点击（防拖出/误触）。 */
  handlePointerUp(x, y) {
    if (!this._picker) return;
    this.uiScene.updateMatrixWorld(true);
    const hit = this._picker.pick(x, y);
    const down = this._downHit;
    this._downHit = null;
    if (!down || !hit || down.kind !== hit.kind || down.id !== hit.id) return;
    if (this._pickerKit.routeClick(hit)) return;   // 特写点任意处退出 / 全屏界面接管
    this._panel?.onClick?.(hit);
  }

  /**
   * 同步状态栏数值（run 层每次阶段迁移后由编排器调用）。
   * 战斗外 AP 恒满（战斗内才消耗）；魏启 = run 持久值；金币/遗物路由到顶端资源行；
   * hp/maxHp 为角色血条（run 快照，战斗外无变化不重烘）；remi 为瑞米区视图
   * （{ present, hp }，编排器压平后透传）。
   */
  setStatus({ ap, apMax, mana, manaMax, money = null, hp = null, maxHp = null, relics = null, remi = null }) {
    this._statusBar.apCoin.setValue(ap, apMax);
    this._statusBar.manaCrystal.setValue(mana, manaMax);
    if (money !== null) this._topBar.setMoney(money);
    if (hp != null && maxHp != null) this._statusBar.setPlayerHp(hp, maxHp);
    if (relics) this._topBar.setRelics(relics);
    if (remi) this._statusBar.setRemi(remi);
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
    this._unsubTick = manager.onTick((dt) => {
      this._statusBar.update(dt);
      this._slotRoll?.update(dt * 1000); // dt 秒 → 转轮用毫秒
      this._pickerKit.update(dt);        // 获得物特写（自带 in/hold/out 时序）
      this._followBubbles();             // 泡泡跟随世界锚点（相机移动也要跟）
      this._bubbles.update(dt);
    });
  }

  onExit() {
    this._unsubTick?.();
    this._unsubTick = null;
  }

  dispose() {
    this.onExit();
    this._unsubArt?.(); // 共享缓存订阅摘除（防幽灵舞台补挂头像）
    this._unsubCardArt?.();
    this._unsubCardArt = null;
    this._removePanel();
    this._bubbles.dispose();
    this._bubbleAnchors.clear();
    this._pickerKit.dispose();   // 选卡/选遗物/特写（未创建的实例无事发生）
    if (this._slotRoll) {
      this.uiScene.remove(this._slotRoll);
      this._slotRoll.dispose();
      this._slotRoll = null;
    }
    this.detachInput();
    for (const child of [...this._tower.children]) { // 塔身层块（与 setFloor 重建同律）
      child.geometry.dispose();
      child.material.dispose();
      this._tower.remove(child);
    }
    this._stars?.geometry.dispose();
    this._stars?.material.dispose();
    this.scene.remove(this._stars);
    this._statusBar.dispose();
    this._topBar.dispose();
  }

  _buildStars() {
    const count = 260;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 360;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 220;
      positions[i * 3 + 2] = -40 - Math.random() * 80;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const stars = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xaabbee, size: 0.7, sizeAttenuation: true, transparent: true, opacity: 0.85,
    }));
    this._stars = stars; // dispose 时释放（geometry + material）
    this.scene.add(stars);
  }

  // 重建塔身窗口：以当前层为中心的一截；当前层高亮，Boss 层红色调
  setFloor(floor, totalFloors) {
    for (const child of [...this._tower.children]) {
      child.geometry.dispose();
      child.material.dispose();
      this._tower.remove(child);
    }
    const half = Math.floor(VISIBLE_WINDOW / 2);
    for (let f = floor - half; f <= floor + half; f++) {
      if (f < 1 || f > totalFloors) continue; // 看不到顶底 → 窗口外的层不画
      const isCurrent = f === floor;
      const color = isCurrent ? 0xffd75e : (isBossFloor(f) ? 0x8a3548 : 0x39456b);
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(BOX_SIZE.w, BOX_SIZE.h, BOX_SIZE.d),
        new THREE.MeshBasicMaterial({ color }),
      );
      box.position.set(0, (floor - f) * FLOOR_GAP, 0);
      this._tower.add(box);
    }
  }

  // 塔楼抵达动画（S5 pilot）：黑幕 reveal 后当前层高亮块自下而上"长出"。
  // 由 run sequencer 指令驱动（onDone = 回执句柄）；duration 可缩（测试）
  arriveFloor(floor, totalFloors, { onDone = null, duration = 0.6 } = {}) {
    this.setFloor(floor, totalFloors); // 幂等落位（doSwap 已 setFloor 时等同重放）
    const current = this._tower.children.find(c => c.position.y === 0);
    if (!current) { onDone?.(); return; }
    current.scale.set(1, 0.01, 1);
    gsap.to(current.scale, {
      y: 1, duration, ease: 'back.out(2.2)',
      onComplete: onDone,
    });
  }
}

// 缺省文本烘焙：浏览器走 RichTextEngine（与 BattleStage 小字号同参数）；
// node 无 document 退化为 1x1 占位（与其他状态件一致）
function defaultBakeLabel() {
  if (typeof document === 'undefined') return null;
  return (text) => renderRichTextBlock(text, {
    maxWidth: 220, scale: 3, style: { fontSize: 16, lineHeight: 20 },
  });
}
