// CardScrollPickerObject：全屏选卡界面（竖向滚动 + 滚动条 + 返回/确认）。
//
// 用途：营地/训练场「免费升级一张卡」的选卡入口（后续的删卡/牌库级选卡界面也可复用）。
// 用户定的形态：
//   · 按下升级按钮 → 进入**全屏**界面，把**所有卡**渲染出来（不可升级的置灰、不可选）
//   · 选卡时 hover 展示该卡的**升级版本**（tooltip 走 card 整卡预览：发 tooltip 事件给总线，
//     与卡面热区同一套浮层；这里发的是**升级后**的 defId，所以预览的就是升阶后的卡面）
//   · 可返回、可确认；确认后才真正升级
//   · 需要滚动（牌组 20+ 张时一屏放不下）
//
// 为什么不用裁剪遮罩：界面是**全屏**的，边界就是屏幕边界——滚出可视带的卡直接置
// invisible（Three 视野外自然不显示，且 Picker 的 visibleUp 守卫使其**不可命中**），
// 因此不需要 scissor/stencil。这正是用户指出「实现会相对简单」的原因。

import * as THREE from 'three';
import { CardObject } from './CardObject.js';
import { ButtonObject } from './ButtonObject.js';
import { TextBlockObject } from './TextBlockObject.js';
import { CARD_WIDTH, CARD_HEIGHT } from './cardMetrics.js';
import { PANEL_ABOVE_Z } from './PanelObject.js';
import { EventNames } from '../../bridge/events.js';
import { WORLD_HEIGHT, UI_CAMERA_LOOK_AT_Y } from '../StageManager.js';

const HALF_UI_W = ((WORLD_HEIGHT * 16) / 9) / 2;
const UI_TOP = UI_CAMERA_LOOK_AT_Y + WORLD_HEIGHT / 2;

// 必须高于休息面板（其内容在世界 z = PANEL+CONTENT；见 PanelObject.PANEL_ABOVE_Z）——
// 训练场/营地的升级入口是从模态面板里打开的，低于它就会被面板背板盖住。
const Z = { BACKDROP: PANEL_ABOVE_Z, CONTENT: PANEL_ABOVE_Z + 2 };

// 布局（世界单位）：标题带 / 滚动区带 / 底部按钮带
const LAYOUT = {
  titleY: UI_TOP - 3.4,
  hintY: UI_TOP - 7.2,
  bandTop: UI_TOP - 10.5,
  bandBottom: UI_CAMERA_LOOK_AT_Y - 31,
  footerY: UI_CAMERA_LOOK_AT_Y - 42,
  cols: 6,
  cardScale: 0.62,
  gapX: 2,
  gapY: 2.4,
  barX: HALF_UI_W - 2.0,   // 滚动条靠右
  barW: 0.42,              // 更细（用户 2026-09-11）；thumb 略宽于轨道便于抓握
};
const CARD_ID = (uniqueID) => `picker:card:${uniqueID}`;
const BACK_ID = 'picker:back';
const CONFIRM_ID = 'picker:confirm';

export class CardScrollPickerObject extends THREE.Group {
  /**
   * @param {object} options
   *   bakeFace: 卡面烘焙（与战场同源）
   *   bakeText / bakeButton: 文本与按钮烘焙
   *   bus: 事件总线（tooltip 出口；缺省不发 tooltip）
   *   onConfirm(selectedIds) / onCancel(): 宿主回调（确认/返回）
   */
  constructor({ bakeFace = null, bakeText = null, bakeButton = null, bus = null, onConfirm = null, onCancel = null } = {}) {
    super();
    this._bakeFace = bakeFace;
    this._bakeText = bakeText;
    this._bakeButton = bakeButton;
    this._bus = bus;
    this._onConfirm = onConfirm;
    this._onCancel = onCancel;
    this._picker = null;
    this._opened = false;
    this._scrollY = 0;
    this._maxScroll = 0;
    this._entries = [];   // { id, uniqueID, defId, enabled, tipDefId, obj, x, y }
    this._selected = new Set();
    this._hovered = null;
    this._multi = false;
    this._picks = 1;
    this._nodes = [];     // 需释放的非卡/非按钮面片（背板、标题、轨道…）
    this._buttons = new Map();
    this._buttonActions = new Map();
    this.visible = false;
  }

  get opened() { return this._opened; }
  get selectedIds() { return [...this._selected]; }
  get cardCount() { return this._entries.length; }
  get scrollY() { return this._scrollY; }
  get maxScroll() { return this._maxScroll; }

  /**
   * 打开选卡界面（幂等：先清场）。
   * @param {object} data
   *   title / hint: 文案
   *   cards: [{ uniqueID, defId, view, enabled, tipDefId }]（顺序即展示顺序，行优先）
   *   multi/picks: 多选与目标张数（缺省单选 1 张）
   *   confirmLabel: 确认键文案
   */
  open({ title = '选择卡牌', hint = '', cards = [], multi = false, picks = 1, confirmLabel = '确认' } = {}) {
    this.close();
    this._opened = true;
    this._multi = multi;
    this._picks = Math.max(1, picks);
    this.visible = true;

    this._addNode(new THREE.Mesh(
      new THREE.PlaneGeometry(HALF_UI_W * 2, WORLD_HEIGHT),
      new THREE.MeshBasicMaterial({ color: 0x0a0b10, transparent: true, opacity: 0.9 }),
    ), { y: UI_CAMERA_LOOK_AT_Y, z: Z.BACKDROP });

    this._addText(title, { y: LAYOUT.titleY, fontPx: 22, tint: '#ffd75e', center: true });
    if (hint) this._addText(hint, { y: LAYOUT.hintY, fontPx: 13, tint: '#9aa3b8', center: true });

    // ---- 卡面网格（先排位，再按滚动位置摆） ----
    const stepX = CARD_WIDTH * LAYOUT.cardScale + LAYOUT.gapX;
    const stepY = CARD_HEIGHT * LAYOUT.cardScale + LAYOUT.gapY;
    const rows = Math.max(1, Math.ceil(cards.length / LAYOUT.cols));
    const contentH = rows * CARD_HEIGHT * LAYOUT.cardScale + (rows - 1) * LAYOUT.gapY;
    const bandH = LAYOUT.bandTop - LAYOUT.bandBottom;
    this._maxScroll = Math.max(0, contentH + 4 - bandH);
    this._scrollY = 0;

    cards.forEach((c, i) => {
      const row = Math.floor(i / LAYOUT.cols);
      const col = i % LAYOUT.cols;
      const inRow = Math.min(LAYOUT.cols, cards.length - row * LAYOUT.cols);
      const rowW = inRow * CARD_WIDTH * LAYOUT.cardScale + Math.max(0, inRow - 1) * LAYOUT.gapX;
      const x = -rowW / 2 + (CARD_WIDTH * LAYOUT.cardScale) / 2 + col * stepX;
      const yTop = LAYOUT.bandTop - 2 - row * stepY; // 该卡顶边（世界 y）
      const obj = new CardObject({
        uniqueID: CARD_ID(c.uniqueID), cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT,
        bakeFace: this._bakeFace,
      });
      obj.setCard(c.view ? { ...c.view, uniqueID: CARD_ID(c.uniqueID), defId: c.defId } : c.defId);
      obj.position.set(x, yTop - (CARD_HEIGHT * LAYOUT.cardScale) / 2, Z.CONTENT);
      obj.scale.set(LAYOUT.cardScale, LAYOUT.cardScale, 1);
      if (!c.enabled) obj.setVisualState('disabled');
      this.add(obj);
      this._entries.push({ ...c, id: CARD_ID(c.uniqueID), obj, x, yTop });
      this._picker?.addPickable(CARD_ID(c.uniqueID), obj, { kind: 'button', space: 'ui' });
    });

    // ---- 底部：返回 / 确认 ----
    this._addButton(BACK_ID, '返回', { x: -34, y: LAYOUT.footerY, width: 200, size: 'sub' }, { action: 'cancel' });
    this._addButton(CONFIRM_ID, confirmLabel, { x: 34, y: LAYOUT.footerY, width: 200, size: 'main' }, { action: 'confirm' });

    this._addScrollbar(bandH);
    this._applyScroll();
    return this;
  }

  /** 关闭并清理（幂等）。 */
  close() {
    if (!this._opened) { this.visible = false; return; }
    this._opened = false;
    this.visible = false;
    this._hideTooltip();
    for (const e of this._entries) {
      this._picker?.removePickable(e.id);
      this.remove(e.obj);
      e.obj.dispose();
    }
    this._entries = [];
    for (const [id, btn] of this._buttons) {
      this._picker?.removePickable(id);
      this.remove(btn);
      btn.dispose();
    }
    this._buttons.clear();
    this._buttonActions.clear();
    for (const n of this._nodes) {
      this.remove(n);
      n.geometry?.dispose?.();
      n.material?.map?.dispose?.();
      n.material?.dispose?.();
    }
    this._nodes = [];
    this._selected.clear();
    this._hovered = null;
    this._scrollY = 0;
    this._maxScroll = 0;
  }

  attachPicker(picker) {
    this._picker = picker ?? null;
    if (!picker) return;
    for (const e of this._entries) picker.addPickable(e.id, e.obj, { kind: 'button', space: 'ui' });
    for (const [id, btn] of this._buttons) picker.addPickable(id, btn, { kind: 'button', space: 'ui' });
  }

  /** 滚动（滚轮/拖拽都走这里）；返回是否真的移动了。 */
  scrollBy(dy) {
    if (!this._opened || this._maxScroll <= 0) return false;
    const next = Math.min(this._maxScroll, Math.max(0, this._scrollY + dy));
    if (next === this._scrollY) return false;
    this._scrollY = next;
    this._applyScroll();
    return true;
  }

  /** hover：抬亮 + 展示该卡的**升级版本**（tipDefId）整卡预览。 */
  onHover(hit, x = 0, y = 0) {
    if (!this._opened) return;
    const entry = hit?.kind === 'button' ? this._entries.find(e => e.id === hit.id) : null;
    if (!entry) { this._setHovered(null); return; }
    this._setHovered(entry);
    const tip = entry.tipDefId ?? entry.defId; // 无升级目标时预览自身，hover 不落空
    this._bus?.emit(EventNames.TOOLTIP_SHOW, { kind: 'card', payload: { cardId: tip }, x, y });
  }

  /** 点击：卡 = 选取（不可升级的忽略）；返回/确认走回调。 */
  onClick(hit) {
    if (!this._opened || hit?.kind !== 'button') return false;
    if (hit.id === BACK_ID) { this.close(); this._onCancel?.(); return true; }
    if (hit.id === CONFIRM_ID) {
      if (this._selected.size === 0) return false;
      const ids = this.selectedIds;
      this.close();
      this._onConfirm?.(ids);
      return true;
    }
    const entry = this._entries.find(e => e.id === hit.id);
    if (!entry || !entry.enabled) return false;
    if (this._multi) {
      if (this._selected.has(entry.uniqueID)) this._selected.delete(entry.uniqueID);
      else if (this._selected.size < this._picks) this._selected.add(entry.uniqueID);
    } else {
      this._selected.clear();
      this._selected.add(entry.uniqueID);
    }
    this._applySelection();
    return true;
  }

  /** 命中是否落在本界面内（宿主据此决定是否吞掉这次点击）。 */
  ownsHit(hit) {
    if (!this._opened || hit?.kind !== 'button') return false;
    return hit.id === BACK_ID || hit.id === CONFIRM_ID || this._entries.some(e => e.id === hit.id);
  }

  dispose() {
    this.close();
  }

  // ---- 内部 ----

  _applyScroll() {
    const bandTop = LAYOUT.bandTop;
    const bandBottom = LAYOUT.bandBottom;
    const h = CARD_HEIGHT * LAYOUT.cardScale;
    for (const e of this._entries) {
      const top = e.yTop + this._scrollY;
      const bottom = top - h;
      // 完全滚出可视带的卡：隐藏即可不可见也可命中（Picker 的 visibleUp 守卫）
      e.obj.visible = bottom < bandTop && top > bandBottom;
      e.obj.position.y = top - h / 2;
    }
    this._syncScrollbar();
  }

  _addScrollbar(bandH) {
    this._bar = {
      bandTop: LAYOUT.bandTop, bandH,
      track: this._addNode(new THREE.Mesh(
        new THREE.PlaneGeometry(LAYOUT.barW, bandH),
        // 空闲态淡化（不再是不透明的粗条）：滚动时才由 _syncScrollbar 提亮
        new THREE.MeshBasicMaterial({ color: 0x2b3552, transparent: true, opacity: 0.22 }),
      ), { x: LAYOUT.barX, y: (LAYOUT.bandTop + LAYOUT.bandBottom) / 2, z: Z.CONTENT }),
      thumb: null,
    };
    this._bar.thumb = this._addNode(new THREE.Mesh(
      new THREE.PlaneGeometry(LAYOUT.barW + 0.28, 6),
      new THREE.MeshBasicMaterial({ color: 0xffd75e, transparent: true, opacity: 0.45 }),
    ), { x: LAYOUT.barX, y: 0, z: Z.CONTENT + 0.1 });
    this._bar.thumbH = 6;
  }

  _syncScrollbar() {
    const bar = this._bar;
    if (!bar?.thumb) return;
    // 无需滚动：整条淡化到几乎不可见（而非原先的"直接隐藏"——淡化的轨道仍提示这里可滚）
    const idle = this._maxScroll <= 0;
    bar.track.visible = true;
    bar.thumb.visible = !idle;
    bar.track.material.opacity = idle ? 0.08 : 0.22;
    if (idle) return;
    bar.thumb.material.opacity = 0.45;
    const ratio = bar.bandH / (bar.bandH + this._maxScroll);
    bar.thumbH = Math.max(4, bar.bandH * ratio);
    bar.thumb.scale.set(1, bar.thumbH / 6, 1);
    const travel = bar.bandH - bar.thumbH;
    bar.thumb.position.y = bar.bandTop - bar.thumbH / 2 - (this._scrollY / this._maxScroll) * travel;
  }

  _applySelection() {
    for (const e of this._entries) {
      if (!e.enabled) { e.obj.setVisualState('disabled'); continue; }
      const picked = this._selected.has(e.uniqueID);
      e.obj.setVisualState(picked || this._hovered === e ? 'highlighted' : 'normal');
    }
    const confirm = this._buttons.get(CONFIRM_ID);
    if (confirm) {
      const ok = this._selected.size === (this._multi ? this._picks : 1);
      confirm.setData({ label: this._confirmLabel ?? '确认', enabled: ok, active: ok });
      this._buttonActions.set(CONFIRM_ID, { action: 'confirm', enabled: ok });
    }
  }

  _setHovered(entry) {
    if (this._hovered === entry) return;
    this._hovered = entry;
    if (!entry) this._hideTooltip();
    this._applySelection();
  }

  _hideTooltip() { this._bus?.emit(EventNames.TOOLTIP_HIDE, {}); }

  _addNode(mesh, { x = 0, y = 0, z = Z.CONTENT } = {}) {
    mesh.position.set(x, y, z);
    this.add(mesh);
    this._nodes.push(mesh);
    return mesh;
  }

  _addText(text, { y, fontPx = 16, tint = '#cdd6f4', center = false } = {}) {
    if (!text) return null;
    const t = new TextBlockObject({ bakeText: this._bakeText, fontPx, tint });
    t.setText(text, { maxWidth: HALF_UI_W * 2 - 12 });
    if (center) t.placeCenterTop(0, y);
    else t.placeLeftTop(-HALF_UI_W + 6, y);
    t.position.z = Z.CONTENT;
    this.add(t);
    this._nodes.push(t);
    return t;
  }

  _addButton(id, label, { x, y, width = 200, size = 'sub' } = {}, action = null) {
    const h = size === 'main' ? 40 : 30;
    const btn = new ButtonObject({ id, width, height: h, bakeButton: this._bakeButton, fontPx: 15 });
    btn.setData({ label, enabled: action?.action !== 'confirm' });
    btn.placeCenter(x, y);
    btn.position.z = Z.CONTENT;
    this.add(btn);
    this._buttons.set(id, btn);
    this._buttonActions.set(id, { action: action?.action ?? null, enabled: action?.action !== 'confirm' });
    this._picker?.addPickable(id, btn, { kind: 'button', space: 'ui' });
    if (action?.action === 'confirm') this._confirmLabel = label;
    return btn;
  }
}
