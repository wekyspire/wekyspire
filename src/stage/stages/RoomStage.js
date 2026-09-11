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

import * as THREE from 'three';
import { getScene } from '../scenes/index.js';
import { getProp } from '../scenes/props/index.js';
import { createRng } from '../scenes/kit/scatter.js';
import { FLOOR_Y } from '../scenes/dungeon3D.js';
import { createVolumetricMoonlight } from '../scenes/volumetricMoon.js';
import { createSlotMachineRig } from '../scenes/interactive/slotMachineRig.js';
import { createBankMachineRig } from '../scenes/interactive/bankMachineRig.js';
import { createVendingMachineRig } from '../scenes/interactive/vendingMachineRig.js';
import { PanelObject, PANEL_ABOVE_Z } from '../objects/PanelObject.js';
import { ContinueButtonObject } from '../objects/ContinueButtonObject.js';
import { MachineMarkerObject } from '../objects/MachineMarkerObject.js';
import { CardScrollPickerObject } from '../objects/CardScrollPickerObject.js';
import { RelicScrollPickerObject } from '../objects/RelicScrollPickerObject.js';
import { ItemShowcaseObject } from '../objects/ItemShowcaseObject.js';
import { PlayerStatusObject, PLAYER_STATUS_POS } from '../objects/PlayerStatusObject.js';
import { TopResourceBarObject } from '../objects/TopResourceBarObject.js';
import { buildSlotPanel, buildBankPanel, buildCampTrainingPanel, buildShopPanel } from '../panels/index.js';
import { BubbleLayer } from '../objects/BubbleLayer.js';
import { ChoiceBillboardObject } from '../objects/ChoiceBillboardObject.js';
import { Picker } from '../picker/Picker.js';
import { renderRichTextBlock } from '../richtext/texture.js';
import { makeCardFaceBaker } from '../richtext/cardFaceDefaults.js';
import { sharedCardArtCache } from '../art/cardArtCache.js';
import { bakeBoldText } from '../objects/textBakers.js';
import { sharedUnitArtCache } from '../art/unitArt.js';
import { WORLD_HEIGHT, UI_CAMERA_LOOK_AT_Y } from '../StageManager.js';

const HALF_UI_W = ((WORLD_HEIGHT * 16) / 9) / 2;
// 交互物 name → 该物件的操纵面板（**加房间只加一行数据**：配方里给 live 件 `name`，
// 这里登记对应面板 builder；RoomStage 不做任何房间/机器判断）。
const PANEL_OF = {
  slot: (snap) => buildSlotPanel(snap, { sceneChoice: true }),
  bank: (snap) => buildBankPanel(snap, { sceneChoice: true }),
  // 合并房（营地·训练场）：**点篝火或训练桩都开同一份面板**（营地选项 + 训练选项一起给，
  // 用户定 2026-09-12）——两个部分同处一室，不该让玩家来回点两件东西找入口
  camp: buildCampTrainingPanel,
  training: buildCampTrainingPanel,
  shop: buildShopPanel,     // 售货机（主柜）：点机身直接开货架面板（不再是房间表头上的一个按钮）
  shop2: buildShopPanel,    // 溢出柜（货架 > 4 件时才有）：同一份货架面板（数据是全局的）
};

// 聚焦机位处方（用户定 2026-09-11：**点物件先推近，推到位再显示它的操纵 UI**）：
// fracH = 物件占可视高比例；bottom = 物件底边离屏底的比例（其余下沿留给停靠面板）；
// pad = 横向装得下时的余量。距离与视轴下移都由这几个比例**反解**（不手调 margin）。
// 默认一套适用所有尺寸（距离自适应），个别物件要贴脸/退远时按 kind 覆盖。
const FOCUS_DEFAULT = { fracH: 0.50, bottom: 0.46, pad: 0.92 };

/**
 * 老虎机的取景主体（用户 2026-09-12：**点击后要"屏幕怼脸"**）：只框**三根转轮窗口 + 拉杆**
 * （口径同 restGallery 的 focusMachine——这两件是这台机器的"脸"），不含底座/招牌/操作台，
 * 于是机器顶到脸上、上下自然出画。其它交互物仍按整件包围盒取景（默认）。
 */
function slotSubject(entry) {
  const reels = entry.parts?.reels ?? [];
  const mid = reels[Math.floor(reels.length / 2)];
  if (!mid) return null;
  const c = mid.getWorldPosition(new THREE.Vector3());
  const a = reels[0].getWorldPosition(new THREE.Vector3());
  const b = reels[reels.length - 1].getWorldPosition(new THREE.Vector3());
  const cell = Math.abs(a.x - b.x) / Math.max(1, reels.length - 1);
  let halfW = (Math.abs(a.x - b.x) + cell * 1.35) * 0.5;   // 窗口宽 + 单格余量
  let halfH = cell * 1.05 * 0.5;                            // 窗口高
  const lever = entry.parts?.leverPivot ?? null;
  if (lever) {                                              // 拉杆是侧面极限件，必须入画
    const lb = new THREE.Box3().setFromObject(lever);
    halfW = Math.max(halfW, Math.abs(lb.max.x - c.x), Math.abs(c.x - lb.min.x));
    halfH = Math.max(halfH, Math.abs(lb.max.y - c.y), Math.abs(c.y - lb.min.y));
  }
  // 投料口/计数器（吞噬入口 + 进度）在下半身：不框进来就会被底部操纵条盖住 →
  // 向下扩到它们（横向本来就在窗口宽度内，不会把主体拉宽）
  const crusher = entry.parts?.crusher ?? null;
  if (crusher) {
    for (const o of Object.values(crusher)) {
      if (!o?.isObject3D) continue;
      const cb = new THREE.Box3().setFromObject(o);
      halfH = Math.max(halfH, Math.abs(c.y - cb.min.y));
    }
  }
  return new THREE.Box3(
    new THREE.Vector3(c.x - halfW, c.y - halfH, c.z - 2),
    new THREE.Vector3(c.x + halfW, c.y + halfH, c.z + 2),
  );
}
/** 取一件物的**上段**（火盆/火焰这种"脸在上半身"的物件）：从高度份额 `from` 到顶。 */
function upperSubject(entry, from = 0.35, topPad = 0.22) {
  const box = new THREE.Box3().setFromObject(entry.object);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  // ⚠ 顶面留余量：火焰粒子是**场景粒子**（不在道具包围盒里），不留白会把火苗切在画外
  const topY = box.max.y + size.y * topPad;
  return new THREE.Box3(
    new THREE.Vector3(c.x - size.x / 2, box.min.y + size.y * from, c.z - size.z / 2),
    new THREE.Vector3(c.x + size.x / 2, topY, c.z + size.z / 2),
  );
}
function bowlSubject(entry) { return upperSubject(entry, 0.42); }

// 单件取景覆盖：老虎机怼脸（fracH>0.5 = 主体占屏更大）；其余交互物走默认整件取景
const FOCUS_OF = {
  // 怼脸处方：主体（转轮窗 + 拉杆 + 下半身的投料口/计数器）占屏 0.88，底边抬到 0.26
  // ——窗口顶到上缘、操作区露在操纵条之上（操纵条占屏幕下沿 ~25%）
  slot: { fracH: 0.88, bottom: 0.26, pad: 0.92, subject: slotSubject },
  // 售货机同样怼脸（用户定 2026-09-12：点售货机要看清货架上的商品与价格）：
  // 主体 = **货架区开口**（不含底座/操作列/顶牌），底边抬到操纵条之上（两排货 + 价格全露出来）
  vending: { fracH: 0.62, bottom: 0.36, pad: 0.95, subject: vendingSubject },
  // 篝火（营地·训练场的交互物）：主体 = **火盆 + 火焰**（不含三足）——整件取景时腿占了半屏，
  // 火苗顶到画外；换成"看火"，机器一般怼近一点（用户定 2026-09-12 的交互节奏）
  camp: { fracH: 0.6, bottom: 0.38, pad: 0.9, subject: bowlSubject },
};

/**
 * 售货机的取景主体：**货架区开口**（cards 立在托盘上，卡片顶沿再留一点余量）。
 * 取景只框"玻璃柜里的货"——整机取景会让货架缩得太小、价格读不出来（怼脸的意义就在这）。
 * 机器带 ry/缩放，故用机身的局部→世界换算，不手算朝向。
 */
function vendingSubject(entry) {
  const bay = entry.parts?.bay;
  if (!bay) return null;
  const s = entry.scale ?? 1;
  const c = entry.object.localToWorld(new THREE.Vector3(bay.x, bay.y, bay.z));
  const halfW = (bay.w / 2) * s + 0.5;
  const halfH = (bay.h / 2) * s + 0.3;
  return new THREE.Box3(
    new THREE.Vector3(c.x - halfW, c.y - halfH, c.z - 3),
    new THREE.Vector3(c.x + halfW, c.y + halfH, c.z + 3),
  );
}
// 恶魔 roll（银行机超额取款的代价）：灯池染暗红 + 词条卡片按等级分色（占位美术）
const DEMON_LAMP = 0x9a2432;
const DEMON_TIER_TINT = { yellow: 0xb08a3a, red: 0x9a3a3a, black: 0x3a2440 };
const DEMON_TIER_NAME = { yellow: '黄色级', red: '红色级', black: '黑色级' };
const ZOOM_MS = 0.62;   // 推近/拉远的补间时长（秒）
// 「继续前进」按钮：右下角（用户定）——避开下沿停靠面板（面板宽 62 wu、居中），故放最右侧
const CONTINUE_POS = { x: HALF_UI_W - 16, y: UI_CAMERA_LOOK_AT_Y - 30 };

/** 拉杆结果的落面：中奖让三根一致（读得出"中了"），未中奖随机——后端只给档位，没有符号概念。 */
function symbolsForTier(tier) {
  if (tier === 'major') return [1, 1, 1];   // 三个 7
  if (tier === 'minor') return [0, 0, 0];   // 三个樱桃
  return null;                              // 未中奖：随机面
}

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
    this._picker = null;
    this._bus = bus;
    this._panel = null;          // 下沿停靠的机器操作面板（惰性建）
    this._panelKind = null;      // 当前面板对应的机器（null = 收起）
    this._focused = null;        // 聚焦的机器名
    this._downHit = null;
    this._cardPicker = null;    // 全屏选卡（升级/焚毁；惰性建）
    this._relicPicker = null;   // 全屏选遗物（粉尘/粉碎；惰性建）
    this._showcase = null;      // 获得物特写（金币大奖等；惰性建）
    this._pickerConfirm = null; // 当前选择界面的确认回调（按入口切换）
    this._pickIds = [];
    this._goodsPickIds = new Set();  // 商品卡拾取 id（随货架增删对账）
    this._t = 0;
    this._slotSpinId = null;
    this._slotPoll = null;
    this._camTween = null;   // { from, to, t, dur, then }：推近/拉远的机位补间     // 正在播的拉杆轮次 id（防重绘重播）
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
    this._buildInteractives();

    // ---- UI：状态栏 + 顶端资源行 + 继续前进按钮 ----
    this._unitArt = unitArt ?? ((typeof document !== 'undefined') ? sharedUnitArtCache : null);
    this._bakeLabel = bakeLabel || defaultBakeLabel();
    const mkBake = this._bakeLabel;
    this._statusBar = new PlayerStatusObject({ bakeLabel: mkBake, unitArt: this._unitArt });
    this._statusBar.position.set(PLAYER_STATUS_POS.x, PLAYER_STATUS_POS.y, PLAYER_STATUS_POS.z);
    this.uiScene.add(this._statusBar);
    this._topBar = new TopResourceBarObject({ bakeLabel: mkBake });
    this.uiScene.add(this._topBar);
    this._bubbles = new BubbleLayer();   // 角色/物件的说话·思索泡泡（提示用，如"还没挑卡"）
    this.uiScene.add(this._bubbles);
    this._gift = null;                   // 安慰奖二选一演出件（惰性；见 _playGift）
    this._demon = null;                  // 恶魔 roll 状态机（见 _stepDemonRoll）
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

  /** 房间面板快照下行（notify 每次都推）：存下 + 按需重绘已打开的机器面板。 */
  setPanel(snap) {
    this._snap = snap ?? null;
    if (this._panelKind) this._renderPanel();
    this._syncSlotFromSnapshot();
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

  // ---- 全屏选择界面 / 获得物特写（与 MapStage 同名同义：宿主按"当前舞台"调用）----
  // ⚠ 与 MapStage 的这两段是同构的（选卡/选遗物/特写三件套）。后续可抽 `StagePickerKit`
  // 让两个舞台共用一份；眼下房间层只用到 slot/bank 三个来源，故先就地实现，不动已验证的塔楼路径。
  /** 选择界面文本烘焙：honors fontPx/tint/maxWidth（不能用状态栏那套固定 style 的烘焙）。 */
  _pickerBakeText() {
    if (this._pickerBake !== undefined) return this._pickerBake;
    this._pickerBake = (typeof document === 'undefined')
      ? null
      : (text, { fontPx = 16, tint = '#cdd6f4', maxWidth } = {}) => renderRichTextBlock(text, {
        maxWidth: maxWidth ?? 4000,
        scale: 3,
        style: { fontSize: fontPx, lineHeight: Math.round(fontPx * 1.3), color: tint },
      });
    return this._pickerBake;
  }

  /**
   * 打开「选卡」界面；source 决定候选与确认后上行的意图。
   * 房间层来源：营地上级 / 训练升级 / 老虎机免费升级 / 银行升级 / 银行焚毁。
   * ⚠ 候选必须按 source 取对应快照段——曾经一律读 `snap.slot.upgradeCards`，
   * 于是营地/训练桩面板里的「升级一张卡」在场景里是死按钮（点开空的 = 没反应）。
   */
  openUpgradePicker(source) {
    const snap = this._snap;
    const CARDS_OF = {
      camp: () => snap?.camp?.upgradeCards,
      training: () => snap?.training?.upgradeCards,
      bankUpgrade: () => snap?.bank?.upgradeCards,
      bankBurn: () => snap?.bank?.burnCards,
      slot: () => snap?.slot?.upgradeCards,
    };
    const cards = (CARDS_OF[source]?.() ?? []).filter(c => c.enabled !== false);
    if (!cards.length) return false;
    if (!this._cardPicker) {
      this._cardPicker = new CardScrollPickerObject({
        bakeText: this._pickerBakeText(),
        bus: this._bus,
        onCancel: () => { /* 收起即可，面板还在 */ },
        onConfirm: (ids) => this._pickerConfirm?.(ids),
      });
      this.uiScene.add(this._cardPicker);
    }
    const INTENT_OF = {
      camp: (uniqueID) => ({ action: 'campChoose', option: 'upgrade', uniqueID }),
      training: (uniqueID) => ({ action: 'trainingUpgrade', uniqueID }),
      bankUpgrade: (uniqueID) => ({ action: 'bankUpgradeOffer', uniqueID }),
      bankBurn: (uniqueID) => ({ action: 'bankBurnOffer', uniqueID }),
      slot: (uniqueID) => ({ action: 'slotPickUpgrade', uniqueID }),
    };
    this._pickerConfirm = (ids) => {
      const intent = INTENT_OF[source]?.(ids[0]);
      if (intent) this._onIntent?.(intent);
    };
    this._cardPicker.attachPicker(this._picker);
    this._cardPicker.open({
      title: source === 'bankBurn' ? '选择要焚毁的卡' : '选择要升级的卡',
      hint: source === 'bankBurn'
        ? '恶魔词条·忘却：焚毁一张（S 级豁免）｜ 滚轮翻页'
        : '悬停查看升级后的卡面 ｜ 滚轮翻页',
      cards: cards.map(c => ({
        uniqueID: c.uniqueID, defId: c.defId, view: c.view, enabled: c.enabled, tipDefId: c.tipDefId,
      })),
      confirmLabel: source === 'bankBurn' ? '确认焚毁' : '确认升级',
    });
    return true;
  }

  /** 打开「粉碎物品」选择界面（卡或遗物；kind 决定列表）。 */
  openDevourPicker({ kind, cards = [], relics = [], onPick = null } = {}) {
    if (kind === 'relic') {
      if (!relics.length) return false;
      if (!this._relicPicker) {
        this._relicPicker = new RelicScrollPickerObject({
          bakeText: this._pickerBakeText(),
          bus: this._bus,
          onConfirm: (ids) => this._pickerConfirm?.(ids),
        });
        this.uiScene.add(this._relicPicker);
      }
      this._pickerConfirm = (ids) => onPick?.(ids[0]);
      this._relicPicker.attachPicker(this._picker);
      this._relicPicker.open({
        title: '粉碎哪件遗物？',
        hint: '喂给老虎机换金币 ｜ 悬停查看效果 ｜ 滚轮翻页（S 级嚼不动）',
        relics,
        confirmLabel: '确认粉碎',
      });
      return true;
    }
    if (!cards.length) return false;
    if (!this._cardPicker) {
      this._cardPicker = new CardScrollPickerObject({
        bakeText: this._pickerBakeText(),
        bus: this._bus,
        onConfirm: (ids) => this._pickerConfirm?.(ids),
      });
      this.uiScene.add(this._cardPicker);
    }
    this._pickerConfirm = (ids) => onPick?.(ids[0]);
    this._cardPicker.attachPicker(this._picker);
    this._cardPicker.open({
      title: '粉碎哪张卡？',
      hint: '喂给老虎机换金币 ｜ 悬停查看卡面 ｜ 滚轮翻页（诅咒卡另有奖赏）',
      cards,
      confirmLabel: '确认粉碎',
    });
    return true;
  }

  /** 获得物特写（通用组件：有素材用素材，没有就拿色块代替）。 */
  showcaseItem(item) {
    if (!item) return false;
    if (!this._showcase) {
      this._showcase = new ItemShowcaseObject();
      this.uiScene.add(this._showcase);
      this._showcase.attachPicker(this._picker);
    }
    return this._showcase.show(item);
  }

  get showcasing() { return !!this._showcase?.busy; }
  get cardPicker() { return this._cardPicker; }
  get relicPicker() { return this._relicPicker; }

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
  }

  detachInput() {
    for (const id of this._pickIds ?? []) this._picker?.removePickable(id);
    this._pickIds = [];
    this._picker = null;
    this._downHit = null;
  }

  handlePointerMove(x, y) {
    if (!this._picker) return;
    this.uiScene.updateMatrixWorld(true);
    const hit = this._picker.hover(x, y);
    if (this._gift?.active) { this._gift.onHover(hit); return; }   // 安慰奖演出中：只认两件货
    if (this._demon?.cards?.active) { this._demon.cards.onHover(hit); return; }   // 恶魔词条三选一
    if (this._showcase?.busy) return;                       // 特写期间吞掉 hover
    if (this._cardPicker?.opened) { this._cardPicker.onHover(hit, x, y); return; }
    if (this._relicPicker?.opened) { this._relicPicker.onHover(hit, x, y); return; }
    const name = this._machineOf(hit);
    for (const [n, rig] of this._rigs) rig.setHover?.(n === name);
    for (const m of this._markers) m.hover = (m.name === name);   // 箭头浮标 hover 提亮
    // 售货机商品卡：悬停抬起 + 盘子提亮（点下去就是买；下标全局唯一，各 rig 只认自己的）
    const gi = this._goodsIndexOf(hit);
    for (const rig of this._rigs.values()) rig.setGoodsHover?.(gi);
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
    if (this._gift?.active) { const id = this._gift.pickIndexOf(hit); if (id) this._gift.choose(id); return; }
    if (this._demon?.cards?.active) { const id = this._demon.cards.pickIndexOf(hit); if (id) this._demon.cards.choose(id); return; }
    if (this._showcase?.busy) { this._showcase.onClick(hit); return; }        // 点任意处退出特写
    if (this._cardPicker?.opened) { this._cardPicker.onClick(hit); return; }
    if (this._relicPicker?.opened) { this._relicPicker.onClick(hit); return; }
    if (down && hit && down.kind === hit.kind && down.id === hit.id) {
      this._activate(hit);
      return;
    }
    // 抬起与按下不一致（拖出/误触）：只做"点空白处收起面板"
    if (!hit || hit.kind === 'background') this._focusMachine(null);
  }

  handleWheel(deltaY) {
    if (this._cardPicker?.opened) return this._cardPicker.scrollBy(deltaY / 100);
    if (this._relicPicker?.opened) return this._relicPicker.scrollBy(deltaY / 100);
    return false;
  }

  onEnter(manager) {
    this._sm = manager;
    manager.restoreBaseCamera?.();   // 接手时先回基准机位（上一舞台可能留下变形取景）
    this._unsubTick = manager.onTick((dt) => this._tick(dt));
  }

  onExit() {
    this._unsubTick?.();
    this._unsubTick = null;
    clearInterval(this._slotPoll);
    this._slotPoll = null;
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
    this._composer?.dispose();
    this._composer = null;
    this.composeScene = null;
    this.composeResize = null;
    this._bubbles.dispose();
    this._removeGift();
    this._removeDemonCards();
    this._continue.dispose();
    this._cardPicker?.dispose();
    this._cardPicker = null;
    this._relicPicker?.dispose();
    this._relicPicker = null;
    this._showcase?.dispose();
    this._showcase = null;
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

  /** 登记一件交互物：机器类（有 parts/kind）才建 rig；普通陈设只要浮标 + 拾取 + 推近。 */
  _addInteractive(name, entry) {
    {
      const rig = entry.kind === 'slot' ? createSlotMachineRig({ object: entry.object, parts: entry.parts })
        : entry.kind === 'bank' ? createBankMachineRig({ object: entry.object, parts: entry.parts })
          : entry.kind === 'vending' ? createVendingMachineRig({
            object: entry.object, parts: entry.parts,
            // 出货演出播完 → 回执宿主（宿主再播"物品到手"的获得特写；演出顺序不能被特写盖掉）
            onDispensed: (index) => this._onIntent?.({ action: 'shopAnimDone', index }),
          })
            : null;
      if (rig) this._rigs.set(name, rig);
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
    this._goodsPickIds = new Set();
    for (const m of this._markers) {
      const id = `room:machine:${m.name}`;
      this._picker.addPickable(id, m.marker, { kind: 'machine' });
      this._pickIds.push(id);
      // 机器本体也给一个 id（点机器本身同样聚焦）。售货机用 `parts.pickBody`（机身合批件，
      // **不含玻璃门**）：整机登记的话，玻璃门会先被射线命中，柜内的商品卡永远点不到
      this._picker.addPickable(`room:body:${m.name}`, m.entry.parts?.pickBody ?? m.entry.object, { kind: 'machine' });
      this._pickIds.push(`room:body:${m.name}`);
    }
    // 老虎机正面的**投料口/计数器**热区（rig 给的可点件）：点它就是"粉碎物品"入口
    const slotRig = this._rigs.get('slot');
    (slotRig?.crusherTargets?.() ?? []).forEach((obj, i) => {
      const id = `room:crusher:${i}`;
      this._picker.addPickable(id, obj, { kind: 'machine' });
      this._pickIds.push(id);
    });
    this._syncGoodsPickables();
    this._picker.addPickable(this._continue.pickId, this._continue, { kind: 'button', space: 'ui' });
    this._pickIds.push(this._continue.pickId);
    this._panel?.attachPicker(this._picker);
  }

  /**
   * 商品卡拾取登记（**增量对账**）：货架随快照增删（买到货、换层），登记表也要跟着变——
   * 卖掉的卡片必须立刻从 Picker 摘掉，否则空货位还能点到（"点了没反应"）。
   */
  _syncGoodsPickables() {
    if (!this._picker) return;
    const want = new Map();
    for (const rig of this._rigs.values()) {
      for (const t of rig?.goodsTargets?.() ?? []) want.set(`room:goods:${t.index}`, t.object);
    }
    for (const id of [...this._goodsPickIds]) {
      if (want.has(id)) continue;
      this._picker.removePickable(id);
      this._goodsPickIds.delete(id);
      const i = this._pickIds.indexOf(id);
      if (i >= 0) this._pickIds.splice(i, 1);
    }
    for (const [id, object] of want) {
      if (this._goodsPickIds.has(id)) continue;
      this._picker.addPickable(id, object, { kind: 'goods' });
      this._goodsPickIds.add(id);
      this._pickIds.push(id);
    }
  }

  /** hit → 商品卡下标（kind 'goods' 或遗物 token 热区都算）。 */
  _goodsIndexOf(hit) {
    const id = hit?.id;
    if (typeof id !== 'string' || !id.startsWith('room:goods:')) return null;
    const n = Number(id.slice('room:goods:'.length));
    return Number.isFinite(n) ? n : null;
  }

  /** 这件货属于哪台机器（溢出柜时的货架切片靠它区分；点哪台推近哪台）。 */
  _goodsOwner(index) {
    for (const [name, rig] of this._rigs) {
      if ((rig.goodsTargets?.() ?? []).some(t => t.index === index)) return name;
    }
    return null;
  }

  /** hit → 机器名（浮标或本体任一命中）。 */
  _machineOf(hit) {
    if (hit?.kind !== 'machine') return null;
    return hit.id.startsWith('room:machine:') ? hit.id.slice('room:machine:'.length)
      : hit.id.startsWith('room:body:') ? hit.id.slice('room:body:'.length) : null;
  }

  _activate(hit) {
    if (!hit || hit.kind === 'background') {
      this._panel?.onClick?.(hit);
      this._focusMachine(null);   // 点房间空白处 = 收起机器面板
      return;
    }
    if (hit.id === this._continue.pickId) {
      // 合并房（营地·训练场）：**两部分的奖励都处理完才能走**（用户定 2026-09-12）——
      // 没在火边歇过 / 没把训练做完就点继续，这里把人拉回火堆并给一句提示，
      // 免得玩家一路点过去把这一层的收益漏掉（两部分都恒有可做的动作，不会卡死）
      const duty = this._pendingRoomDuty();
      if (duty === 'camp' || duty === 'training') { this._nudgeCampTraining(duty); return; }
      if (duty === 'demon') { this._nudgeDemonRoll(); return; }
      if (duty === 'shop') { this._nudgeShopPending(); return; }
      if (duty === 'forced') { this._nudgeForcedPick(); return; }
      // 还欠着离房安慰奖（拉了 ≥2 次杆没中奖）→ 先吐出可乐/鸡腿让你选，选完再离房
      if (this._playGift()) return;
      this._onIntent?.({ action: 'leaveRoom' });   // 主动离开休息室（宿主走幕间黑幕回塔楼）
      return;
    }
    // 售货机商品卡：点 = 买。**但没怼脸时先推近**——远景里机器中央就是货架，第一次点它
    // 若直接成交，玩家连商品名与价格都没看清（用户定的节奏：先 zoom in 看货，再点选购买）
    const gi = this._goodsIndexOf(hit);
    if (gi != null) {
      const owner = this._goodsOwner(gi);
      if (owner && this._focused !== owner) { this._focusMachine(owner); return; }
      this._buyGoods(gi);
      return;
    }
    // 投料口：进度满 = 直接进"粉碎物品"链（对话 → 选卡/遗物）；没满就先聚焦机器（看得出还差几次）
    if (hit.id?.startsWith('room:crusher:')) {
      const rig = this._rigs.get('slot');
      if (rig?.devourReady?.()) { this._onIntent?.({ action: 'requestDevour' }); return; }
      this._focusMachine('slot');
      return;
    }
    const name = this._machineOf(hit);
    if (name) { this._focusMachine(name); return; }
    this._panel?.onClick?.(hit);   // 面板按钮（拉杆/存款/…）：路由到 _onPanelAction → 上行意图
  }

  /**
  /**
   * **离房安慰奖演出**（用户定 2026-09-12）：点「继续前进」且快照里欠着安慰奖时，
   * ① 相机推到**出料口**；② 机器"吐出"两件 billboard（可乐/鸡腿，暂无美术 = 纯色块 + 白字）；
   * ③ 点选其一 → 选中件朝镜头飞出、另一件缩没；④ 播完上行 `slotTakeGift`（宿主结算 +
   * 播获得物特写）。演完由快照（gift 变 null）自然收尾，玩家再点「继续前进」即离房。
   * @returns 是否已接手这次点击（true = 别离房）
   */
  _playGift() {
    const items = this._snap?.slot?.gift;
    if (!Array.isArray(items) || !items.length) return false;
    if (this._gift) return true;                       // 已在演：吞掉重复点击
    const machine = this._markers.find(m => m.name === 'slot')?.entry;
    if (!machine) return false;
    // 取景以**两件货**为主体：摆位 = 机器腰高、身前 6.5（贴出料口摆会被底部操纵条盖住，
    // 且镜头对着出料口时两件货在画面外），机器留在背景里当上下文
    const { spot, dist, fwd } = this._billboardStage(machine, items.length * 3.0 + 4.35);
    const position = spot.clone().addScaledVector(fwd, dist);
    const m = new THREE.Matrix4().lookAt(position, spot, new THREE.Vector3(0, 1, 0));
    this._startCamTween(
      { position, quaternion: new THREE.Quaternion().setFromRotationMatrix(m) },
      0.5,
      () => this._spawnGift(items, spot),
    );
    // 演出期间抑制机器常驻抖动（怼脸看细节）
    for (const rig of this._rigs.values()) rig.setFocus?.(false);
    return true;
  }

  /**
   * 机器前"摆一排 billboard"的取景处方（安慰奖两件 / 恶魔词条三张共用）：
   * @returns { spot, dist, fwd } spot = 卡片组的中心落点（机器腰高、身前 6.5），
   *   dist = 相机距离（**按卡片组总宽反解**：三张一排比两张宽，不按宽度退远会切边），
   *   fwd = 机器朝向（相机沿它后退）。
   */
  _billboardStage(machine, totalW) {
    const fwd = new THREE.Vector3(Math.sin(machine.ry ?? 0), 0, Math.cos(machine.ry ?? 0));
    const mbox = new THREE.Box3().setFromObject(machine.object);
    const mid = mbox.getCenter(new THREE.Vector3());
    const spot = new THREE.Vector3(machine.x, mid.y + 0.5, machine.z).addScaledVector(fwd, 6.5);
    const vFov = THREE.MathUtils.degToRad(this._sm?.camera?.fov ?? 24);
    const aspect = this._sm?.camera?.aspect || (16 / 9);
    const distW = (totalW * 1.18) / (2 * Math.tan(vFov / 2) * aspect);
    const dist = Math.max(18, distW, mbox.getSize(new THREE.Vector3()).y * 1.15);
    return { spot, dist, fwd };
  }

  /** 生成两件占位货（机器腰高、身前；每一件面向相机漂浮），并登记拾取。 */
  _spawnGift(items, spot) {
    if (this._gift) return;
    this._gift = new ChoiceBillboardObject({
      items: items.map(it => ({ id: it.id, name: it.name, sub: it.effect, tint: it.tint })),
      size: 3.0,
      onPick: (id) => {
        this._onIntent?.({ action: 'slotTakeGift', choice: id });
        this._removeGift(0.5);
      },
    });
    this._gift.position.copy(spot);
    this._room?.group.add(this._gift);
    this._gift.attachPicker(this._picker);
  }

  _removeGift() {
    if (!this._gift) return;
    this._room?.group.remove(this._gift);
    this._gift.dispose();
    this._gift = null;
  }

  /**
   * 房里**还欠着的事**（null = 可以离房）：'camp' | 'training' | 'demon' | 'shop' | 'forced'。
   * 判定刻意保守（只认"确实有可做/必须做的"）：营地恒有"休整"、训练恒有终止动作，
   * 恶魔 roll 与卡包三选一都是**钱已到手**的选择题——不选完不许走，但都有明确的出口。
   */
  _pendingRoomDuty() {
    const snap = this._snap;
    if (!snap) return null;
    if (snap.bank?.pendingRoll) return 'demon';                  // 超额取款的钱已经进袋了
    if (snap.shop?.pending) return 'shop';                       // 卡包买到即开，还没挑牌
    if (snap.training?.forced) return 'forced';                  // 升级后的强绑抓牌
    if (snap.room !== 'campTraining') return null;
    const t = snap.training ?? {};
    if (t.choices?.length || !t.done) return 'training';
    const c = snap.camp ?? {};
    if (!c.used && (c.options?.length ?? 0) > 0) return 'camp';
    return null;
  }

  /** 合并房旧名（保留给内部语义：返回 'camp' | 'training' | null）。 */
  _pendingCampTraining() {
    const d = this._pendingRoomDuty();
    return (d === 'camp' || d === 'training') ? d : null;
  }

  /** 恶魔 roll 未选就想走：钱已经到手，先把词条领了——镜头拉回老虎机 + 泡泡。 */
  _nudgeDemonRoll() {
    if (this._focused !== 'slot') this._focusMachine('slot');
    const entry = this._markers.find(m => m.name === 'slot')?.entry;
    if (!entry) return;
    this._bubbles.say('room:demon', {
      ...this._midAnchorOf(entry, 1.5),
      text: '恶魔 roll 还没选词条呢。',
      kind: 'thought',
      duration: 2.6,
      tint: 0xff9a9a,
    });
  }

  /** 没做完就想走：把镜头拉回**篝火**（两部分的入口都在它那份面板里）并给一句泡泡。 */
  _nudgeCampTraining(part) {
    const name = this._markers.some(m => m.name === 'camp') ? 'camp' : 'training';
    const entry = this._markers.find(m => m.name === name)?.entry;
    if (entry && this._focused !== name) this._focusMachine(name);
    else if (entry) this._openPanel(name);
    if (!entry) return;
    const t = this._snap?.training ?? {};
    const c = this._snap?.camp ?? {};
    const campLeft = !c.used && (c.options?.length ?? 0) > 0;
    const trainLeft = !t.done || !!t.forced;
    this._bubbles.say('room:campHint', {
      ...this._midAnchorOf(entry, 1.5),
      text: (campLeft && trainLeft) ? '火边还有事没做完呢。'
        : part === 'camp' ? '还没在火边歇过呢。' : '训练还没做完呢。',
      kind: 'thought',
      duration: 2.6,
      tint: 0xffe0b0,
    });
  }

  /** 强绑抓牌未领时点「继续前进」：把镜头拉到训练桩并冒一句泡泡（"先挑卡"）——比"按钮没反应"清楚。 */
  _nudgeForcedPick() {
    const target = this._markers.find(m => m.name === 'training') ? 'training' : this._focused;
    if (target) this._focusMachine(target);
    const entry = this._markers.find(m => m.name === 'training')?.entry;
    const anchor = entry ?? this._markers[0]?.entry;
    if (anchor) {
      this._bubbles.say('room:hint', {
        ...this._midAnchorOf(anchor, 1.5),
        text: '还没把挑好的卡放进牌组呢。',
        kind: 'thought',
        duration: 2.6,
        tint: 0xe8ecfa,
      });
    }
  }

  /** 卡包三选一未选就想走：镜头拉回售货机 + 打开货架面板（金币已扣，选择不能丢）。 */
  _nudgeShopPending() {
    const name = this._markers.some(m => m.name === 'shop') ? 'shop' : 'shop2';
    const entry = this._markers.find(m => m.name === name)?.entry;
    if (!entry) return;
    if (this._focused === name) this._openPanel(name);
    else this._focusMachine(name);
    // 提示挂在**货架下沿**（怼脸取景里机器顶在画外；挂机器顶上的话玩家看不到）
    this._bubbles.say('room:pack', {
      ...this._vendingHintAnchor(entry),
      text: '卡包里还有一张没挑呢。',
      kind: 'thought',
      duration: 2.4,
      tint: 0xffe6ad,
    });
  }

  /** 售货机提示泡泡的 UI 锚点：货架区**下沿**（怼脸时机器顶在画外，挂顶上等于没挂）。 */
  _vendingHintAnchor(entry) {
    const bay = entry?.parts?.bay;
    const sm = this._sm;
    if (!bay || !entry || !sm?.worldToUI) return this._uiAnchorOf(entry ?? {}, 4);
    const p = entry.object.localToWorld(new THREE.Vector3(bay.x, bay.y - bay.h / 2 + 0.4, bay.z));
    return sm.worldToUI(p.x, p.y, p.z);
  }

  /** 点商品卡：买得起 → 上行购买意图；买不起 → 盘子摇头 + 一句泡泡（不是"点了没反应"）。 */
  _buyGoods(index) {
    const it = this._snap?.shop?.items?.[index];
    if (!it || it.sold) return false;
    if (!it.affordable) {
      for (const rig of this._rigs.values()) rig.deny?.();
      // 泡泡挂在**被点的那件货**上方（不是机器顶）：怼脸取景里机器顶在画外，
      // 挂在机器顶上的提示玩家根本看不到（"点了没反应"的老毛病）
      const obj = this._goodsObject(index);
      const sm = this._sm;
      const at = (obj && sm?.worldToUI)
        ? (() => { const w = obj.getWorldPosition(new THREE.Vector3()); return sm.worldToUI(w.x, w.y + 1.9, w.z); })()
        : this._uiAnchorOf(this._markers.find(m => m.name === 'shop')?.entry ?? {}, 4);
      this._bubbles.say('room:money', {
        x: at.x, y: at.y,
        text: `还差 ${Math.max(0, it.price - (this._snap.money ?? 0))} 金……`,
        kind: 'thought',
        duration: 2.2,
        tint: 0xff9a9a,
      });
      return false;
    }
    this._onIntent?.({ action: 'buyShopItem', index });
    return true;
  }

  /** 某件货的卡片根对象（泡泡挂点/调试用）。 */
  _goodsObject(index) {
    for (const rig of this._rigs.values()) {
      const t = (rig.goodsTargets?.() ?? []).find(x => x.index === index);
      if (t) return t.object;
    }
    return null;
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
    // 售货机：**只压暗外围、不打正面补光**——柜内商品是 unlit 自发光（补光照不到），
    // 而打进敞开玻璃柜的补光会把柜内背板照爆（怼脸时柜子中间一团白光，把两排货糊掉）
    this._room?.lighting?.setFocus?.(p, entry.kind === 'vending' ? { fill: false } : { strength: 1 });
    this._startCamTween(this._focusPose(entry, p), ZOOM_MS, () => {
      if (this._focused === name) this._openPanel(name);   // 推到位才开面板
    });
  }

  /** 机器取景中心（世界坐标）：机身包围盒中段（不含悬浮浮标）。 */
  _machineMidY(entry) {
    const box = new THREE.Box3().setFromObject(entry.object);
    return box.min.y + (box.max.y - box.min.y) * 0.5;
  }

  /** 焦点补光的高度：售货机压到**下半身**（出货口一带）——光心落在货架之下，柜内背板不被照爆。 */
  _focusLightY(entry) {
    const box = new THREE.Box3().setFromObject(entry.object);
    const h = box.max.y - box.min.y;
    return box.min.y + h * (entry.kind === 'vending' ? 0.22 : 0.5);
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
    const cfg = { ...FOCUS_DEFAULT, ...(FOCUS_OF[entry.kind] ?? {}) };
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

  _openPanel(name) {
    if (!name || !PANEL_OF[name]) { this._panelKind = null; this._removePanel(); return; }
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
   * 播一次**粉碎演出**（编排器在吞噬结算后调用）：把镜头拉回老虎机（粉碎口在下半身，
   * 玩家可能正看着别的机器/面板）→ rig 咬合 + 迸币。纯表现，不影响结算。
   */
  playCrush() {
    const rig = this._rigs.get('slot');
    if (!rig?.crush) return false;
    if (this._focused !== 'slot') this._focusMachine('slot');
    this._startCamTween(this._focusPoseFor('slot'), 0.45, () => rig.crush());
    return true;
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
        onIntent: (a) => this._onPanelAction(a),
        // 卡面烘焙与战场/塔楼层同源（pending 的卡阵、选卡界面都要真卡面，不能没有）
        bakeFace: (typeof document !== 'undefined')
          ? makeCardFaceBaker({ cardArt: sharedCardArtCache, unitArt: this._unitArt })
          : null,
        // 操纵条文字**统一白字 + 黑边**（用户 2026-09-12）：烘焙层直接定色，
        // widget 各自的 tint 在 dock 形态下被忽略（见 PanelObject 的 dock 分支）
        bakeText: this._dockBakeText(),
      });
      this.uiScene.add(this._panel);
    }
    // 停靠面板第一行恒为「返回房间」（拉远回全景）：推近后的操作 UI 自带退出口
    const back = [{
      kind: 'button', id: 'room:back', width: 220, size: 'sub',
      label: '← 返回房间', action: { action: 'backToRoom', local: true },
    }];
    const build = this._panelKind === 'shop' ? buildShopPanel : PANEL_OF[this._panelKind];
    if (!build) { this._panelKind = null; this._removePanel(); return; }
    this._panel.setWidgets(this._panelKind, [...back, ...build(snap)]);
    this._panel.attachPicker(this._picker);
  }

  _removePanel() {
    if (!this._panel) return;
    this.uiScene.remove(this._panel);
    this._panel.dispose();
    this._panel = null;
  }

  /** 面板动作分流：本地动作（开售货机 / 开选卡界面…）自己消化，其余原样上行。 */
  _onPanelAction(action) {
    if (!action) return;
    if (action.local) {
      if (action.action === 'backToRoom') { this._focusMachine(null); return; }
      if (action.action === 'openShop') { this.openShop(); return; }
      if (action.action === 'closeShop') { this._openPanel(this._focused); return; }
      if (action.action === 'openUpgradePicker') { this.openUpgradePicker(action.source); return; }
      return;
    }
    this._onIntent?.(action);
  }

  // ================= 内部：拉杆演出（演出即结果揭示的闸门）=================

  /** 快照出现新的 spinning → 让机器自己转；播完回执 slotAnimDone（后端才揭示结果）。 */
  _syncSlotFromSnapshot() {
    this._syncVending();
    this._syncBank();
    this._syncDemonRoll();
    // 奖励没领完就压暗「继续前进」（合并房两部分 / 恶魔 roll / 卡包待选；点了给泡泡并拉镜头）
    this._continue.setDim(this._pendingRoomDuty() ? 0.4 : 1);
    const s = this._snap?.slot;
    const rig = this._rigs.get('slot');
    if (!s || !rig) return;
    // 计数器（翻牌）与进度满的"嘴张开"直接由快照驱动
    if (s.devour) rig.setDevour?.(s.devour);
    const spinning = s.spinning ?? null;
    if (!spinning) { this._slotSpinId = null; return; }
    if (spinning.id === this._slotSpinId) return;   // 同一轮已开播（重绘不重播）
    this._slotSpinId = spinning.id;
    const tier = spinning.tier ?? 'none';   // 'major' | 'minor' | 'none'（不是奖项种类）
    rig.pull({ tier, symbols: symbolsForTier(tier) });
    clearInterval(this._slotPoll);
    this._slotPoll = setInterval(() => {
      if (rig.isBusy()) return;
      clearInterval(this._slotPoll);
      this._slotPoll = null;
      this._slotSpinId = null;
      this._onIntent?.({ action: 'slotAnimDone', id: spinning.id });
    }, 120);
  }

  /** 银行机屏幕文本：显示**存款额**（道具侧写死的「余额 0」会与顶端金币数打架）。 */
  _syncBank() {
    const bk = this._snap?.bank;
    const rig = this._rigs.get('bank');
    if (!bk || !rig?.setScreen) return;
    rig.setScreen(bk.deposit > 0 ? `存款 ${bk.deposit}` : `余额 ${this._snap.money ?? 0}`);
  }

  // ================= 内部：恶魔 roll（银行机超额取款的代价）=================
  // 用户定 2026-09-12：超额取款 → **视角立刻切到老虎机** → 机器切恶魔形态（关闸 → 换暗红盘
  // → 开闸，灯池同时染暗红）→ 自动开转 → 停稳后弹出三张词条卡片 → 点选其一 → 退场
  // （换回普通盘、灯效复原）→ 回银行机并回执宿主播"奖励到手"特写（那笔超额取款的金币）。
  // 状态机由 _tick 推进（dt 驱动，与所有演出同一时基；不用定时器，免得被 rAF 节流坑）。
  _syncDemonRoll() {
    const pr = this._snap?.bank?.pendingRoll ?? null;
    const rig = this._rigs.get('slot');
    if (!rig) return;
    if (pr && !this._demon) this._startDemonRoll(pr);
    else if (!pr && this._demon) {
      // 词条已选（快照里 pendingRoll 没了）→ 退场。若卡片还挂着（占位面板按钮选的）先收掉
      if (this._demon.phase !== 'exit') { this._demon.phase = 'exit'; this._demon.started = false; }
    }
  }

  _startDemonRoll(pr) {
    this._demon = {
      phase: 'enter', started: false,
      gold: pr.gold, tier: pr.tier,
      options: (pr.options ?? []).map(o => ({ id: o.id, name: o.name, desc: o.desc, tier: o.tier })),
      cards: null,
    };
    // ① 视角立刻切到老虎机（玩家此刻站在银行机面板前）——推到位的回调里机器才开始关闸换盘
    if (this._focused !== 'slot') this._focusMachine('slot');
    // ② 灯池染暗红 + 机器进恶魔风格（换盘本身由 demonEnter 的"关闸 → 换盘 → 开闸"时序做）
    this._room?.lighting?.setLampTint?.(DEMON_LAMP, 1);
    this._rigs.get('slot')?.setDemonStyle?.(1);
  }

  /** 帧驱动相位推进：enter（关闸换盘）→ spin（自动开转）→ choose（卡片等点选）→ exit（换回普通盘）。 */
  _stepDemonRoll(dt) {
    const d = this._demon;
    if (!d) return;
    const rig = this._rigs.get('slot');
    if (!rig) { this._demon = null; return; }
    if (d.phase === 'enter') {
      if (!d.started) { if (rig.isBusy() || !rig.demonEnter?.()) return; d.started = true; return; }
      if (rig.isBusy()) return;
      d.phase = 'spin'; d.started = false;
    } else if (d.phase === 'spin') {
      if (!d.started) {
        // 恶魔 roll 不是中奖：tier 'none'（不亮中奖灯），三根盘各落一面
        if (!rig.pull({ tier: 'none', symbols: null })) return;
        d.started = true;
        return;
      }
      if (rig.isBusy()) return;
      d.phase = 'choose';
      this._spawnDemonChoice(d);
    } else if (d.phase === 'exit') {
      if (!d.started) {
        this._removeDemonCards();
        if (rig.isBusy() || !rig.demonExit?.()) return;
        d.started = true;
        return;
      }
      if (rig.isBusy()) return;
      rig.setDemonStyle?.(0);
      this._room?.lighting?.setLampTint?.(null, 0);
      this._demon = null;
      if (this._markers.some(m => m.name === 'bank')) this._focusMachine('bank');   // 回到取钱的那台
      this._onIntent?.({ action: 'demonAnimDone' });                                // 宿主播奖励特写
    }
  }

  /** 三张词条卡片：机器身前一排（名字 + 词条等级副标题，色块按等级分色），点选即承受。 */
  _spawnDemonChoice(d) {
    const machine = this._markers.find(m => m.name === 'slot')?.entry;
    if (!machine || !d.options.length) return;
    d.cards = new ChoiceBillboardObject({
      items: d.options.map(o => ({
        id: o.id, name: o.name,
        sub: DEMON_TIER_NAME[o.tier] ?? '',
        tint: DEMON_TIER_TINT[o.tier] ?? DEMON_TIER_TINT.black,
      })),
      size: 3.2,
      gap: 3.6,     // 三张一排：间距收一点，取景才不会贴边（总宽 = 2×gap + 卡宽）
      onPick: (id) => { this._onIntent?.({ action: 'bankPick', id }); },
    });
    const { spot, dist, fwd } = this._billboardStage(machine, d.cards.totalWidth);
    d.cards.position.copy(spot);
    this._room?.group.add(d.cards);
    d.cards.attachPicker(this._picker);
    const position = spot.clone().addScaledVector(fwd, dist);
    const m = new THREE.Matrix4().lookAt(position, spot, new THREE.Vector3(0, 1, 0));
    this._startCamTween({ position, quaternion: new THREE.Quaternion().setFromRotationMatrix(m) }, 0.5, null);
  }

  _removeDemonCards() {
    const d = this._demon;
    if (!d?.cards) return;
    this._room?.group.remove(d.cards);
    d.cards.dispose();
    d.cards = null;
  }

  /**
   * 售货机同步（**商店房 'shop' = 一整间货房**，用户定 2026-09-12）：
   *   · 主柜来自配方（`guaranteed` + `live`，name='shop'）——定点、被 claim，撒布件不会压到它；
   *   · 货架超过一台的容量（4 件，故事模式瑞米等级高时 5 件）→ 在 `anchors.shop2` 生成**溢出柜**
   *     （只此一路是动态生成：锚点位没有 claim，故生成前先避让已占红线，见 `_freeSpot`）；
   *   · 库存按机器**切片**下发（index 用全局货架下标——购买/拾取都用它）；
   *   · 卡包买到即开：三选一挂起时把面板顶到前面来（金币已扣，选择不能丢）。
   */
  _syncVending() {
    const shop = this._snap?.shop ?? null;
    if (!shop) return false;                       // 非商店房：不生成、不显示
    const items = shop.items ?? [];
    const cap = Math.max(1, this._rigs.get('shop')?.state?.capacity ?? 4);
    const machines = Math.max(1, Math.ceil(items.length / cap));
    for (let i = 0; i < machines; i++) {
      const name = i === 0 ? 'shop' : `shop${i + 1}`;
      if (!this._markers.some(m => m.name === name) && !this._spawnShopMachine(name, i)) break;
      const rig = this._rigs.get(name);
      rig?.setStock(items.slice(i * cap, (i + 1) * cap));
      rig?.setDisplay(`余额 ${this._snap.money ?? 0}`);
    }
    this._syncGoodsPickables();
    if (shop.pending && this._panelKind !== 'shop') this._openPanel('shop');
    return true;
  }

  /**
   * 按配方的锚点生成一台售货机（`index` 0 = 主柜位 shop、1 = 溢出柜位 shop2）。
   * 只用于**溢出柜**：主柜在配方 guaranteed 里（被 claim）。溢出柜位没有 claim，故先算一个
   * 不与已摆件重叠的落点（`_freeSpot`）；锚点缺失 → 放弃生成（宁可少一台，不重叠）。
   */
  _spawnShopMachine(name, index = 1) {
    const anchors = this._sceneDef?.anchors ?? {};
    const a = index === 0 ? anchors.shop : (anchors[`shop${index + 1}`] ?? anchors.shop2);
    if (!a || !this._room) return false;
    const def = getProp('vendingMachine');
    const scale = a.scale ?? 1;
    const fp = def.footprint ?? { x: 3.2, z: 2.4 };
    const spot = this._freeSpot(a.x, a.z, fp.x * scale, fp.z * scale);
    const obj = def.build({ rng: createRng(`${this.recipe}:shop:${name}`) });
    obj.position.set(spot.x, FLOOR_Y, spot.z);     // 与配方摆件同一地平面（FLOOR_Y）
    obj.rotation.y = a.ry ?? 0;
    obj.scale.setScalar(scale);
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this._room.group.add(obj);
    this._addInteractive(name, {
      object: obj, kind: obj.userData.interactive ?? 'vending',
      x: spot.x, z: spot.z, ry: a.ry ?? 0, scale,
      parts: obj.userData.parts ?? null,
    });
    return true;
  }

  /** 在 (x,z) 附近找一个不与房间已摆件重叠的落点（原始位优先，其次沿 ±x/±z 退让）。 */
  _freeSpot(x, z, w, d) {
    const list = this._room?.placements ?? [];
    const hit = (cx, cz) => list.some((p) => !p.floating && !p.onWall && !p.hosted
      && cx - w / 2 < p.x + (p.fx ?? 1) && cx + w / 2 > p.x - (p.fx ?? 1)
      && cz - d / 2 < p.z + (p.fz ?? 1) && cz + d / 2 > p.z - (p.fz ?? 1));
    if (!hit(x, z)) return { x, z };
    for (const step of [5, 10, 16, 22]) {
      for (const [dx, dz] of [[-step, 0], [step, 0], [0, -step], [0, step], [-step, -step], [step, step]]) {
        if (!hit(x + dx, z + dz)) return { x: x + dx, z: z + dz };
      }
    }
    return { x, z };
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
    }
    this._stepDemonRoll(dt);
    this._continue.update(dt);
    this._showcase?.update(dt);
    this._gift?.update(dt, this._sm?.camera ?? null);   // 安慰奖 billboard 面向相机 + 浮动
    this._demon?.cards?.update(dt, this._sm?.camera ?? null);   // 恶魔词条卡片同理
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
