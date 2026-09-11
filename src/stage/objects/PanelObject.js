// PanelObject：休息阶段面板容器（UI pass 空间）。三种形态：
//   · anchored —— 无背板、贴左上角、定宽竖排行流（战前准备）。
//   · modal    —— 全屏背板 + 居中内容（奖励/进阶/占位房间）。
//   · dock     —— **底部停靠**：只给内容一块半透明底（无全屏背板），整组贴屏幕下沿居中——
//                 场景式休息房（3D 房间 + 机器）用**它**：房间要一直看得见，面板只是操作条。
//
// 职责边界（quest_prompts/THREE_UI_MIGRATION.md §4.2-2）：只做「把一组 widget 画出来 +
// 把点击路由成 action」，**不判断能不能点**（enabled 由快照下发），也不认识任何 run 状态。
// widget.action 原样交给宿主注入的 onIntent。
//
// 行流布局用**固定行高**而非测量烘焙结果：headless 下烘焙退化为占位尺寸，测量法会让布局
// 依赖 document 是否存在（契约测试就写不了）；固定行高确定、可断言。内容超出各自行框时
// **等比收敛**（文本/卡面），因此"行不重叠"是构造性保证。

import * as THREE from 'three';
import { TextBlockObject } from './TextBlockObject.js';
import { ButtonObject } from './ButtonObject.js';
import { CardObject } from './CardObject.js';
import { CheckBadgeObject } from './CheckBadgeObject.js';
import { CARD_WIDTH, CARD_HEIGHT } from './cardMetrics.js';
import { WORLD_HEIGHT, UI_CAMERA_LOOK_AT_Y } from '../StageManager.js';

const PX_PER_WU = 10;
const HALF_UI_W = ((WORLD_HEIGHT * 16) / 9) / 2;
const UI_TOP = UI_CAMERA_LOOK_AT_Y + WORLD_HEIGHT / 2;

const Z = { PANEL: 60, BACKDROP: 80, CONTENT: 81 };

/**
 * 面板**内容之上**的 z（世界坐标）。
 * 面板组本身在 z=PANEL，背板/内容都是组内偏移，故它们在世界的实际 z 是 PANEL+BACKDROP /
 * PANEL+CONTENT。任何直接挂到 uiScene 的覆盖物（全屏选卡界面、老虎机转轮…）都必须高于
 * 这个值，否则会被面板背板挡住——这是踩过两次的坑，故显式导出而不是各写各的魔数。
 */
export const PANEL_ABOVE_Z = Z.PANEL + Z.CONTENT + 10;

// 两种形态的几何（逻辑像素；沿用原 Vue 面板的观感尺寸）
const FORMS = {
  anchored: {
    width: 250, marginX: 12, marginY: 12, padX: 12, padY: 10,
    rowH: { title: 26, text: 18, sub: 14, button: 26, main: 38, gap: 8, tiles: 60, cards: 380 },
  },
  modal: {
    width: 760, padX: 24, padY: 20,
    rowH: { title: 36, text: 22, sub: 20, button: 34, main: 44, gap: 12, tiles: 104, cards: 300 },
  },
  // 下沿停靠（场景式休息房的机器操纵条，用户 2026-09-12：**贴到接近屏幕下边沿** +
  // 字号整体调大一档 + 文字统一白字黑边）。`font` = 各行烘焙字号（逻辑像素，10px/wu）。
  dock: {
    width: 580, padX: 24, padY: 14,
    rowH: { title: 34, text: 24, sub: 21, button: 36, main: 44, gap: 11, tiles: 96, cards: 260 },
    font: { title: 24, sub: 16, text: 18, button: 17 },
  },
};
// dock 形态：整组内容底边贴这条 y（UI 取景带下沿在 look_at_y - 50，故 -44 = 距下边沿 6）
const DOCK_BOTTOM = UI_CAMERA_LOOK_AT_Y - 44;
const CARD_SCALE = 0.8;      // 面板内卡面缩放（3 张一排：3×20.8 + 间隙 < 取景带 177.8）
const BADGE_PX = 58;         // 「已选取」打勾徽标直径（逻辑像素）
const BADGE_MARGIN = 18;     // 徽标中心距卡面右/下边的距离（逻辑像素）
const TILE = { width: 170, gap: 12 };

export class PanelObject extends THREE.Group {
  /**
   * @param {object} options
   *   form: 'anchored' | 'modal'
   *   onIntent: (action) => void  点击路由出口（宿主接 runController）
   *   bakeText / bakeButton / bakeFace: 注入烘焙（缺省浏览器实现，node 退化占位）
   */
  constructor({ form = 'anchored', onIntent = null, bakeText = null, bakeButton = null, bakeFace = null, bakeBadge = null } = {}) {
    super();
    this.form = form;
    this._g = FORMS[form] ?? FORMS.anchored;
    this._onIntent = onIntent;
    this._bakeText = bakeText;
    this._bakeButton = bakeButton;
    this._bakeFace = bakeFace;
    this._bakeBadge = bakeBadge; // 打勾徽标烘焙（注入：单测用假实现）
    this._picker = null;
    this._rows = [];          // { widget, object, top, h, contentH }
    this._buttons = new Map(); // pickId -> ButtonObject（含横向组瓦片）
    this._buttonActions = new Map(); // pickId -> { action, enabled }（点击路由的唯一来源）
    this._cardActions = new Map(); // pickId -> action（卡面点击）
    this._cards = [];         // CardObject（重烘用）
    this._hoveredId = null;
    this._backdrop = null;
    this._rowPickIds = new Set(); // 可 hover 文本行的 pickable id（attachPicker/清理都要摘）
    this._rowSeq = 0;   // 可 hover 文本行的 pickable id 序号
    this.kind = null;
    if (form === 'modal') this.position.set(0, UI_CAMERA_LOOK_AT_Y, Z.PANEL);
    else if (form === 'dock') this.position.set(0, DOCK_BOTTOM, Z.PANEL); // 实际 y 在 setWidgets 里按内容高回推
    else this.position.set(-HALF_UI_W + this._g.marginX / PX_PER_WU,
      UI_TOP - this._g.marginY / PX_PER_WU, Z.PANEL);
  }

  get buttons() { return [...this._buttons.values()]; }
  get rowCount() { return this._rows.length; }
  /** 行几何（面板局部坐标系，wu）：供契约测试断言"不重叠且不越界"。 */
  get rows() {
    return this._rows.map(r => ({
      kind: r.widget.kind, top: r.top, bottom: r.top - r.h, h: r.h, contentH: r.contentH,
    }));
  }

  /** 装配/更新面板内容（幂等：先清场）。widgets 由各面板 builder 产出。 */
  setWidgets(kind, widgets = []) {
    this.kind = kind;
    this._clearRows();
    const g = this._g;
    const innerW = (g.width - g.padX * 2) / PX_PER_WU;
    // 局部原点：anchored = 面板左上；modal = 取景带中心（背板/居中布局都以此为基准）；
    // dock = 内容顶边（setWidgets 末尾按内容高把整组下推到底沿）
    const flowTop = this.form === 'modal'
      ? WORLD_HEIGHT / 2 - g.padY / PX_PER_WU - 30 / PX_PER_WU
      : (this.form === 'dock' ? 0 : -g.padY / PX_PER_WU);
    const centerX = (this.form === 'modal' || this.form === 'dock')
      ? 0 : g.padX / PX_PER_WU + innerW / 2;
    const left = this.form === 'dock' ? -innerW / 2
      : (this.form === 'modal' ? centerX - innerW / 2 : g.padX / PX_PER_WU);

    if (this.form === 'modal' && !this._backdrop) this._addBackdrop();

    let y = flowTop;
    for (const w of widgets) {
      if (w.kind === 'gap') { y -= this._g.rowH.gap / PX_PER_WU; continue; }
      // ⚠ size 的语义按 kind 分流：**按钮**的 'sub'/'main' 是"小按钮/主按钮"，
      // 而 rowH 里同名的 'sub'/'main' 是**文本行高**——dock 里曾因此把按钮压成 21px 高，
      // 标签字号 = 0.4×高 → 只有 8px，糊成一团（用户报"字体太小看不清"）。
      const isDock = this.form === 'dock';
      const h = (isDock && w.kind === 'button')
        ? this._g.rowH[w.size === 'main' ? 'main' : 'button']
        : (this._g.rowH[w.size] ?? this._g.rowH[w.kind] ?? this._g.rowH.text);
      const hWu = h / PX_PER_WU;
      if (w.kind === 'button') {
        const btn = new ButtonObject({
          id: w.id, width: w.width ?? (g.width - g.padX * 2), height: h,
          bakeButton: this._bakeButton, fontPx: w.fontPx ?? (g.font?.button ?? 15),
          // dock（休息房操纵条）：按钮文字与面板正文同口径——白字 + 黑描边
          labelStyle: isDock ? { color: '#ffffff', stroke: 'rgba(0,0,0,0.9)' } : null,
        });
        btn.setData({ label: w.label, sublabel: w.sublabel, enabled: w.enabled !== false, active: !!w.active });
        btn.placeCenter(centerX, y - hWu / 2);
        btn.position.z = Z.CONTENT; // 必须高于背板：模态背板在 z=BACKDROP，压在内容之上会盖住文字/按钮
        this.add(btn);
        this._buttons.set(w.id, btn);
        this._buttonActions.set(w.id, { action: w.action, enabled: w.enabled !== false });
        // 按钮也可挂 token 热区（如"三选一遗物"的按钮要给遗物效果预览）——Picker 的通用挂钩
        if (w.token) btn.userData.token = w.token;
        this._picker?.addPickable(btn.pickId, btn, { kind: 'button', space: 'ui' });
        // object 留 null：按钮统一由 _buttons 清理（横向组的瓦片也在同一张表里），避免二次释放
        this._rows.push({ widget: w, object: null, top: y, h: hWu, contentH: hWu });
      } else if (w.kind === 'tiles' || w.kind === 'cards') {
        // 网格：cols 缺省 = 单行（一行放下全部）；给定 cols 则换行，组高按实际行数推导
        const items = w.items ?? [];
        const cols = Math.max(1, w.cols ?? (items.length || 1));
        const rows = Math.max(1, Math.ceil(items.length / cols));
        const itemH = this._itemHeightWu(w);
        const gapY = (w.gapY ?? TILE.gap) / PX_PER_WU;
        const groupH = rows * itemH + (rows - 1) * gapY;
        this._rows.push(this._buildGrid(w, { y, groupH, centerX, cols, itemH, gapY }));
        y -= groupH;
        this._contentBottom = y;
        continue; // 组高已在此推进
      } else {
        // dock（场景式操纵条）：文字**统一白色**（读在 3D 场景上，彩色/灰字对比不够）；
        // 黑边由注入的烘焙（bakeBoldText 的 stroke）负责——见 RoomStage 的 dockBakeText
        const dock = this.form === 'dock';
        const f = g.font ?? { title: 20, sub: 13, text: 15 };
        const text = new TextBlockObject({
          bakeText: this._bakeText,
          fontPx: w.kind === 'title' ? f.title : (w.kind === 'sub' ? f.sub : f.text),
          tint: dock ? '#ffffff' : (w.tint ?? (w.kind === 'title' ? '#ffd75e' : '#cdd6f4')),
        });
        text.setText(w.text ?? '', { maxWidth: innerW });
        // 等比收进行框：烘焙高度由字号决定（fontPx×1.4），可能高于行高，不收敛会压到下一行
        const s = Math.min(1, hWu / text.scale.y, innerW / text.scale.x);
        text.scale.set(text.scale.x * s, text.scale.y * s, 1);
        if (this.form !== 'anchored' || w.align === 'center') text.placeCenterTop(centerX, y);
        else text.placeLeftTop(left, y);
        text.position.z = Z.CONTENT; // 同按钮：内容一律在背板之上
        this.add(text);
        // 可 hover 的文本行（如遗物效果预览）：挂 token 热区 → Picker 命中即发 tooltip:*
        if (w.token) {
          const pid = `${kind}:row:${this._rowSeq++}`;
          text.userData.token = w.token;
          text.userData.pickId = pid;
          this._rowPickIds.add(pid);
          this._picker?.addPickable(pid, text, { kind: 'row', space: 'ui' });
        }
        this._rows.push({ widget: w, object: text, top: y, h: hWu, contentH: text.scale.y });
      }
      y -= hWu;
      this._contentBottom = y;
    }
    this._panelHeight = (flowTop - y) + this._g.padY / PX_PER_WU;
    if (this.form === 'dock') this._placeDock(this._panelHeight);
  }

  /** dock：内容自上而下排完后，把整组下推到底沿（内容底 = DOCK_BOTTOM），并补一块背板。 */
  _placeDock(heightWu) {
    this.position.set(0, DOCK_BOTTOM + heightWu, Z.PANEL);
    const w = this._g.width / PX_PER_WU;
    // ⚠ 背板用**单元平面 + 缩放**（不是按内容高建几何）：dock 面板每次快照都会重排，
    // 若在"已有背板"分支上再缩放一次，尺寸会越刷越小（症状：内容只有一小块黑底）。
    if (!this._backdrop) {
      this._backdrop = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ color: 0x0a0b10, transparent: true, opacity: 0.86 }),
      );
      this.add(this._backdrop);
    }
    this._backdrop.scale.set(w, heightWu, 1);
    this._backdrop.position.set(0, -heightWu / 2, Z.BACKDROP);
  }

  get heightWu() { return this._panelHeight ?? 0; }

  /** 换/脱拾取器（舞台重连时由 MapStage.attachInput 调用）。 */
  attachPicker(picker) {
    for (const id of this._pickIds()) this._picker?.removePickable(id);
    this._picker = picker ?? null;
    if (!picker) return;
    for (const btn of this._buttons.values()) picker.addPickable(btn.pickId, btn, { kind: 'button', space: 'ui' });
    for (const { object, id } of this._cards) picker.addPickable(id, object, { kind: 'card', cardObject: object, space: 'ui' });
    for (const { object } of this._rows) {
      if (object?.userData?.pickId) picker.addPickable(object.userData.pickId, object, { kind: 'row', space: 'ui' });
    }
  }

  /** hover：按钮抬亮 / 卡面高亮（命中变化时先清旧的）。 */
  onHover(hit) {
    const id = (hit?.kind === 'button' && this._buttons.has(hit.id)) ? hit.id
      : (hit?.kind === 'card' || hit?.kind === 'token') && this._cardActions.has(hit.id) ? hit.id
        : null;
    if (id === this._hoveredId) return;
    this._hoveredId = id;
    for (const [bid, btn] of this._buttons) btn.setHovered(bid === id);
    // 高亮 = hover **或** 已勾选：早先这里把非 hover 的卡一律设回 normal，
    // 于是指针一移开，勾选高亮就被抹掉（勾选状态还在、视觉提示没了）。
    for (const entry of this._cards) {
      entry.object.setVisualState(entry.id === id || entry.selected ? 'highlighted' : 'normal');
    }
  }

  /** 点击路由：按钮（enabled）与整卡命中各自把 widget.action 交给宿主。 */
  onClick(hit) {
    if (hit?.kind === 'button') {
      const entry = this._buttonActions.get(hit.id);
      if (!entry || !entry.enabled) return false;
      this._onIntent?.(entry.action ?? null);
      return true;
    }
    if (hit?.kind === 'card' && this._cardActions.has(hit.id)) {
      this._onIntent?.(this._cardActions.get(hit.id));
      return true;
    }
    return false;
  }

  /** 命中是否落在本面板内（模态形态的"点背景关闭"判定用）。 */
  ownsHit(hit) {
    if (hit?.kind === 'button') return this._buttons.has(hit.id);
    if (hit?.kind === 'card' || hit?.kind === 'token') return this._cardActions.has(hit.id);
    return false;
  }

  get isModal() { return this.form === 'modal'; }
  /** 模态背板所在 z（内容必须高于它；供契约测试断言层序）。 */
  get backdropZ() { return Z.BACKDROP; }
  /** 面板内是否有卡面（宿主据此决定要不要订阅"卡图到图重烘"）。 */
  get ownsCardArtWait() { return this._cards.length > 0; }

  /** 卡图异步到图后重烘（与战场 _rebakeCardFaces 同触发）。 */
  rebakeCards() {
    for (const { object, data } of this._cards) {
      if (data) object.setCard(data);
    }
  }

  dispose() {
    this.attachPicker(null);
    this._clearRows();
    if (this._backdrop) {
      this.remove(this._backdrop);
      this._backdrop.geometry.dispose();
      this._backdrop.material.dispose();
      this._backdrop = null;
    }
  }

  _pickIds() {
    return [...this._buttons.keys(), ...this._cardActions.keys(), ...this._rowPickIds];
  }

  _addBackdrop() {
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF_UI_W * 2, WORLD_HEIGHT),
      new THREE.MeshBasicMaterial({ color: 0x0a0b10, transparent: true, opacity: 0.86 }),
    );
    bg.position.set(0, 0, Z.BACKDROP); // 局部原点即取景带中心
    this.add(bg);
    this._backdrop = bg;
  }

  /** 横向组的单项高度（wu）：卡面按缩放，瓦片按给定高。 */
  /** 网格单项高度（wu）。dock 的卡阵另收一档：操纵条只占屏幕下沿，卡面不能撑半屏。 */
  _itemHeightWu(w) {
    return w.kind === 'cards'
      ? CARD_HEIGHT * this._gridCardScale(w)
      : (w.tileHeight ?? 96) / PX_PER_WU;
  }

  /** 卡阵缩放：dock 形态封顶（0.46 ≈ 单卡 16wu 高，三列一行 ≈ 屏幕高度 16%）。 */
  _gridCardScale(w) {
    const s = w.scale ?? CARD_SCALE;
    return this.form === 'dock' ? Math.min(s, 0.46) : s;
  }

  /** 网格（瓦片/卡面）：整组在 centerX 居中；末行按自身数量居中；返回行记录。 */
  _buildGrid(w, { y, groupH, centerX, cols, itemH, gapY }) {
    const items = w.items ?? [];
    const isCards = w.kind === 'cards';
    const cardScale = this._gridCardScale(w);
    const itemW = isCards ? CARD_WIDTH * cardScale : TILE.width / PX_PER_WU;
    const gap = TILE.gap / PX_PER_WU;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const row = Math.floor(i / cols);
      const inRow = Math.min(cols, items.length - row * cols); // 末行短行 → 按自身居中
      const col = i % cols;
      const rowW = inRow * itemW + Math.max(0, inRow - 1) * gap;
      const x = centerX - rowW / 2 + itemW / 2 + col * (itemW + gap);
      const cy = y - row * (itemH + gapY) - itemH / 2;
      if (isCards) {
        const pickId = `${w.idPrefix}:${item.defId}`;
        const data = item.view ? { ...item.view, uniqueID: pickId, defId: item.defId } : item.defId;
        const obj = new CardObject({
          uniqueID: pickId, cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT, bakeFace: this._bakeFace,
        });
        obj.setCard(data);
        obj.position.set(x, cy, Z.CONTENT);
        obj.scale.set(cardScale, cardScale, 1);
        this.add(obj);
        const selected = !!item.active;
        if (selected) {
          obj.setVisualState('highlighted');
          // 「已选取」打勾徽标：挂成卡面子对象（自动继承位置/缩放）。
          // 只靠材质变亮不够——hover 也是变亮，语义会被抢走；勾选需要独立记号。
          const badge = new CheckBadgeObject({ size: BADGE_PX, bake: this._bakeBadge });
          const m = BADGE_MARGIN / PX_PER_WU;
          badge.position.set(CARD_WIDTH / 2 - m, -CARD_HEIGHT / 2 + m, 0.01); // 卡牌局部：右下角外沿向内
          obj.add(badge);
          obj.userData.selectionBadge = badge;
        }
        this._cardActions.set(pickId, item.action ?? { action: 'claimReward', defId: item.defId });
        this._picker?.addPickable(pickId, obj, { kind: 'card', cardObject: obj, space: 'ui' });
        this._cards.push({ id: pickId, object: obj, data, selected, badge: obj.userData.selectionBadge ?? null });
      } else {
        const pickId = `${w.idPrefix}:${item.id}`;
        const btn = new ButtonObject({
          id: pickId, width: TILE.width, height: w.tileHeight ?? 96,
          bakeButton: this._bakeButton, fontPx: 15,
        });
        btn.setData({
          label: item.name, sublabel: item.desc,
          enabled: item.enabled !== false, active: !!item.active,
        });
        btn.placeCenter(x, cy);
        btn.position.z = Z.CONTENT;
        this.add(btn);
        this._buttons.set(pickId, btn);
        this._buttonActions.set(pickId, { action: item.action, enabled: item.enabled !== false });
        this._picker?.addPickable(pickId, btn, { kind: 'button', space: 'ui' });
      }
    }
    return { widget: w, object: null, top: y, h: groupH, contentH: groupH };
  }

  _clearRows() {
    // 文本行：object 即面片，逐行释放
    for (const { object } of this._rows) {
      if (!object) continue;
      if (object.userData?.pickId) this._picker?.removePickable(object.userData.pickId);
      this.remove(object);
      object.dispose();
    }
    // 按钮（含横向组的瓦片）与卡面：统一按各自的表释放（行记录里不持 object，防二次释放）
    for (const [, btn] of this._buttons) {
      this._picker?.removePickable(btn.pickId);
      this.remove(btn);
      btn.dispose();
    }
    for (const { object, id, badge } of this._cards) {
      this._picker?.removePickable(id);
      // 徽标是卡面子对象，CardObject.dispose 不会释放它 —— 必须显式摘除并释放
      if (badge) { object.remove(badge); badge.dispose(); }
      this.remove(object);
      object.dispose();
    }
    this._rows = [];
    this._rowPickIds.clear();
    this._buttons.clear();
    this._buttonActions.clear();
    this._cards = [];
    this._cardActions.clear();
    this._hoveredId = null;
  }
}
