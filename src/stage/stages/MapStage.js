import * as THREE from 'three';
import gsap from 'gsap';
import { isBossFloor } from '../../core/run/runFlow.js';
import { PlayerStatusObject, PLAYER_STATUS_POS } from '../objects/PlayerStatusObject.js';
import { TopResourceBarObject } from '../objects/TopResourceBarObject.js';
import { UI_CAMERA_LOOK_AT_Y } from '../StageManager.js';
import { PanelObject, PANEL_ABOVE_Z } from '../objects/PanelObject.js';
import { SlotRollObject } from '../objects/SlotRollObject.js';
import { CardScrollPickerObject } from '../objects/CardScrollPickerObject.js';
import { buildPrepPanel, buildRewardPanel, buildAscensionPanel, buildRoomPanel, buildShopPanel } from '../panels/index.js';
import { Picker } from '../picker/Picker.js';
import { makeCardFaceBaker } from '../richtext/cardFaceDefaults.js';
import { sharedCardArtCache } from '../art/cardArtCache.js';
import { renderRichTextBlock } from '../richtext/texture.js';
import { sharedUnitArtCache } from '../art/unitArt.js';

// 快照 kind → widget builder（一个面板一个；未登记 = 该阶段还没有 Three 面板，
// 对应 Vue 面板仍在渲染——迁移是逐面板推进的）。form = PanelObject 形态。
const PANEL_BUILDERS = {
  prep: { build: buildPrepPanel, form: 'anchored' },
  reward: { build: buildRewardPanel, form: 'modal' },
  ascension: { build: buildAscensionPanel, form: 'modal' },
  room: { build: buildRoomPanel, form: 'modal' },
  shop: { build: buildShopPanel, form: 'modal' },
};

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
    this._cardPicker = null; // 全屏选卡界面（营地/训练场升级用；惰性创建）
    this._bus = null;       // 事件总线（选卡界面发 tooltip 用）
    this._slotRollId = null; // 正在播放的轮次 id（防重绘重播）
    this._onIntent = null; // 面板点击上行出口（setPanelIntentHandler 注入）
    this._downHit = null;  // 按压命中（抬起时配对，防"按下 A 抬起 B"误触发）
    this.setFloor(1, totalFloors);
  }

  get statusBar() { return this._statusBar; }
  get topBar() { return this._topBar; }
  get panel() { return this._panel; }

  // ---- 休息阶段面板 ----
  /** 意图上行出口（runController 注入：Stage 只上报「谁被点了」，不解释语义）。 */
  setPanelIntentHandler(fn) { this._onIntent = fn; }

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
        onIntent: (a) => this._onPanelAction(a),
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
  _onPanelAction(action) {
    if (!action) return;
    if (action.local) {
      if (action.action === 'openUpgradePicker') { this._openUpgradePicker(action.source); return; }
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

  // ---- 全屏选卡界面（营地/训练场「升级一张卡」）----
  // 按下升级按钮进入：界面渲染**牌组全部卡**（不可升级的置灰），hover 预览升级后的卡面，
  // 可返回/确认。选卡与开关都是舞台本地交互态（不惊动 core），确认时才上报意图。
  _openUpgradePicker(source) {
    // 只展示**可升级**的卡：原来把整副牌组都渲染出来（不可升级的置灰可见），
    // 玩家要在一堆灰卡里找目标（用户 2026-09-11 报）。快照里 enabled 即"有晋升目标"。
    const isBankUpgrade = source === 'bankUpgrade';
    const isBankBurn = source === 'bankBurn';
    const isGurpasRemove = source === 'gurpasRemove';
    const isBossRemove = source === 'bossRemove';
    const cards = (source === 'camp'
      ? (this._snap?.camp?.upgradeCards ?? [])
      : source === 'training'
        ? (this._snap?.training?.upgradeCards ?? [])
        : isBankUpgrade
          ? (this._snap?.bank?.upgradeCards ?? [])
          : isGurpasRemove
            ? (this._snap?.gurpas?.removeCards ?? [])   // 删卡服务：整副牌组（不限等阶）
            : isBossRemove
              ? (this._snap?.cardRemoval?.removeCards ?? [])  // Boss 奖励删卡机会
              : (this._snap?.bank?.burnCards ?? []))    // bankBurn：焚毁候选（含 S 级豁免过滤）
      .filter(c => c.enabled !== false);
    if (!cards.length) return;
    if (!this._cardPicker) {
      this._cardPicker = new CardScrollPickerObject({
        bakeFace: this._bakeFace,
        bakeText: this._bakeLabel,
        bus: this._bus,
        onCancel: () => this._pickerFocus = null,
        onConfirm: (ids) => {
          const uniqueID = ids[0];
          this._pickerFocus = null;
          // 升级意图：营地与训练场各有各的入口（语义在 runController 落地）
          this._onIntent?.(source === 'camp'
            ? { action: 'campChoose', option: 'upgrade', uniqueID }
            : source === 'training'
              ? { action: 'trainingUpgrade', uniqueID }
              : isBankUpgrade
                ? { action: 'bankUpgradeOffer', uniqueID }
                : isGurpasRemove
                  ? { action: 'gurpasRemove', uniqueID }
                  : isBossRemove
                    ? { action: 'bossRemoveCard', uniqueID }
                    : { action: 'bankBurnOffer', uniqueID });
        },
      });
      this.uiScene.add(this._cardPicker);
    }
    this._cardPicker.attachPicker(this._picker);
    this._cardPicker.open({
      title: (isGurpasRemove || isBossRemove) ? '选择要删除的卡' : (isBankBurn ? '选择要焚毁的卡' : '选择要升级的卡'),
      hint: (isGurpasRemove || isBossRemove)
        ? '这张牌将从牌库中彻底消失 ｜ 滚轮翻页'
        : isBankBurn
          ? '恶魔词条·忘却：焚毁一张（S 级豁免）｜ 滚轮翻页'
          : '悬停查看升级后的卡面 ｜ 滚轮翻页（只列出当前可升级的卡）',
      cards: cards.map(c => ({
        uniqueID: c.uniqueID, defId: c.defId, view: c.view,
        enabled: c.enabled, tipDefId: c.tipDefId,
      })),
      confirmLabel: (isGurpasRemove || isBossRemove) ? '确认删除' : (isBankBurn ? '确认焚毁' : '确认升级'),
    });
    this._pickerFocus = 'upgrade';
  }

  get cardPicker() { return this._cardPicker; }

  /** 滚轮：选卡界面优先消费（全屏界面，滚轮只作用于它）。 */
  handleWheel(deltaY) {
    if (this._cardPicker?.opened) return this._cardPicker.scrollBy(deltaY / 100);
    return false;
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
    this._cardPicker?.close(); // 面板换了/卸了，选卡界面不该留在屏幕上
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
    this._bus = bus ?? null; // 选卡界面的 tooltip 出口（card 整卡预览走同一条浮层）
    this._panel?.attachPicker?.(this._picker); // 重连时把已有面板重新登记
    this._cardPicker?.attachPicker(this._picker);
  }

  detachInput() {
    this._panel?.attachPicker?.(null);
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
      ?? this._cardPicker?._buttonActions?.get(pickId)
      ?? { action: null, enabled: false };
  }

  /** 指针移动：hover 拾取（Picker 内部发 tooltip:*）+ 面板悬浮态。 */
  handlePointerMove(x, y) {
    if (!this._picker) return;
    this.uiScene.updateMatrixWorld(true);
    const hit = this._picker.hover(x, y);
    if (this._cardPicker?.opened) { this._cardPicker.onHover(hit, x, y); return; }
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
    if (this._cardPicker?.opened) { this._cardPicker.onClick(hit); return; }
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
    if (this._cardPicker) {
      this.uiScene.remove(this._cardPicker);
      this._cardPicker.dispose();
      this._cardPicker = null;
    }
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
