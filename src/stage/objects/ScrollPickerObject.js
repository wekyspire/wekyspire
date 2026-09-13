// ScrollPickerObject：全屏「滚动 + 滚动条 + 返回/确认」选择界面的**共用骨架**。
//
// 派生：
//   · CardScrollPickerObject —— 卡牌（营地/训练场升级、银行焚毁、Boss/古尔帕斯删卡、粉碎）
//   · RelicScrollPickerObject —— 遗物（粉碎物品入口首次需要；此前遗物只在面板里以按钮列出）
// 子类只回答一件事：**一件候选长什么样**（open 时传 `buildItem`），其余（背板/标题/提示/
// 滚动带/滚动条/选中态/确认可用性/返回/整卡与遗物 tooltip/指针拾取登记）全在这里。
//
// 为什么不用裁剪遮罩：界面是**全屏**的，边界就是屏幕边界——滚出可视带的候选直接置
// invisible（Three 视野外自然不显示，且 Picker 的 visibleUp 守卫使其**不可命中**），
// 因此不需要 scissor/stencil。这正是用户指出「实现会相对简单」的原因。

import * as THREE from 'three';
import { TextBlockObject } from './TextBlockObject.js';
import { ButtonObject } from './ButtonObject.js';
import { OVERLAY_Z } from './PanelObject.js';
import { EventNames } from '../../bridge/events.js';
import { WORLD_HEIGHT, UI_CAMERA_LOOK_AT_Y } from '../StageManager.js';

export const HALF_UI_W = ((WORLD_HEIGHT * 16) / 9) / 2;
export const UI_TOP = UI_CAMERA_LOOK_AT_Y + WORLD_HEIGHT / 2;

// 全屏模态覆盖层：高于休息面板（其内容在世界 z = PANEL+CONTENT），**也高于舞台的常驻按钮**
// （「继续前进」在 PANEL_ABOVE_Z + 2）——否则那枚按钮会画在遮罩之上，看起来还能点。见 OVERLAY_Z。
export const PICKER_Z = { BACKDROP: OVERLAY_Z, CONTENT: OVERLAY_Z + 2 };

// 布局（世界单位）：标题带 / 滚动区带 / 底部按钮带。两个子类共用同一套带位，
// 只有"单件尺寸与列数"不同（由 open 参数给）。
export const PICKER_LAYOUT = {
  titleY: UI_TOP - 3.4,
  hintY: UI_TOP - 7.2,
  bandTop: UI_TOP - 10.5,
  bandBottom: UI_CAMERA_LOOK_AT_Y - 31,
  footerY: UI_CAMERA_LOOK_AT_Y - 42,
  barX: HALF_UI_W - 2.0,   // 滚动条靠右
  barW: 0.42,              // 更细（用户 2026-09-11）；thumb 略宽于轨道便于抓握
};
const LAYOUT = PICKER_LAYOUT;
const Z = PICKER_Z;
const BACK_ID = 'picker:back';
const CONFIRM_ID = 'picker:confirm';

export class ScrollPickerObject extends THREE.Group {
  /**
   * @param {object} options
   *   bakeText / bakeButton: 文本与按钮烘焙
   *   bus: 事件总线（tooltip 出口；缺省不发 tooltip）
   *   onConfirm(selectedKeys) / onCancel(): 宿主回调
   */
  constructor({ bakeText = null, bakeButton = null, bus = null, onConfirm = null, onCancel = null } = {}) {
    super();
    this._bakeText = bakeText;
    this._bakeButton = bakeButton;
    this._bus = bus;
    this._onConfirm = onConfirm;
    this._onCancel = onCancel;
    this._picker = null;
    this._opened = false;
    this._scrollY = 0;
    this._maxScroll = 0;
    this._entries = [];   // { key, id, item, obj, setState, tip, enabled, x, yTop }
    this._selected = new Set();
    this._hovered = null;
    this._multi = false;
    this._picks = 1;
    this._itemH = 1;
    this._nodes = [];     // 需释放的非子件面片（背板、标题、轨道…）
    this._buttons = new Map();
    this._buttonActions = new Map();
    this.visible = false;
  }

  get opened() { return this._opened; }
  get selectedKeys() { return [...this._selected]; }
  get itemCount() { return this._entries.length; }
  get scrollY() { return this._scrollY; }
  get maxScroll() { return this._maxScroll; }

  /**
   * 打开界面（幂等：先清场）。
   * @param {object} data
   *   title / hint: 文案
   *   items: 候选数组（原样交给 buildItem）
   *   buildItem(item, i, { x, yTop }): { obj, key, id?, enabled?, tip?, setState? }
   *     · obj     已定位到 (x, yTop - itemH/2, CONTENT) 的显示对象
   *     · key     选中用的键（单选/多选集合里存它）
   *     · id      指针拾取 id（缺省用 key）
   *     · tip     `{ type, payload }` → hover 时发 TOOLTIP_SHOW（kind=type）
   *     · setState(state) 视觉态（'disabled' | 'highlighted' | 'normal'）
   *   cols / itemW / itemH / gapX / gapY: 网格布局（行优先）
   *   multi / picks: 多选与目标件数（缺省单选 1 件）
   *   confirmLabel: 确认键文案
   */
  open({
    title = '选择', hint = '', items = [], buildItem = null,
    cols = 6, itemW = 2, itemH = 2, gapX = 2, gapY = 2.4,
    multi = false, picks = 1, confirmLabel = '确认',
  } = {}) {
    this.close();
    if (!buildItem || !items.length) return this;
    this._opened = true;
    this._multi = multi;
    this._picks = Math.max(1, picks);
    this._itemH = itemH;
    this.confirmHook = null;   // 得卡演出钩子（一次一设；见 onClick 的 CONFIRM 分支）
    this.visible = true;

    this._addNode(new THREE.Mesh(
      new THREE.PlaneGeometry(HALF_UI_W * 2, WORLD_HEIGHT),
      new THREE.MeshBasicMaterial({ color: 0x0a0b10, transparent: true, opacity: 0.9 }),
    ), { y: UI_CAMERA_LOOK_AT_Y, z: Z.BACKDROP });

    this._addText(title, { y: LAYOUT.titleY, fontPx: 22, tint: '#e8eefb', center: true });
    if (hint) this._addText(hint, { y: LAYOUT.hintY, fontPx: 13, tint: '#9aa3b8', center: true });

    // ---- 候选网格（先排位，再按滚动位置摆） ----
    const stepX = itemW + gapX;
    const stepY = itemH + gapY;
    const rows = Math.max(1, Math.ceil(items.length / cols));
    const contentH = rows * itemH + (rows - 1) * gapY;
    const bandH = LAYOUT.bandTop - LAYOUT.bandBottom;
    this._maxScroll = Math.max(0, contentH + 4 - bandH);
    this._scrollY = 0;

    items.forEach((item, i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      const inRow = Math.min(cols, items.length - row * cols);
      const rowW = inRow * itemW + Math.max(0, inRow - 1) * gapX;
      const x = -rowW / 2 + itemW / 2 + col * stepX;
      const yTop = LAYOUT.bandTop - 2 - row * stepY;      // 该件顶边（世界 y）
      const built = buildItem(item, i, { x, yTop });
      if (!built?.obj) return;
      built.obj.position.set(x, yTop - itemH / 2, Z.CONTENT);
      const key = built.key ?? `item:${i}`;
      const entry = {
        key, id: built.id ?? key, item, obj: built.obj, enabled: built.enabled !== false,
        tip: built.tip ?? null, setState: built.setState ?? ((s) => built.obj.setVisualState?.(s)),
        x, yTop,
        // meta：子类想让调用方/测试按原样读到的字段（如选卡的 uniqueID/defId/view）——
        // 基类不解释它，只是摊平进 entry（保持选卡界面既有的 entry 形状）
        ...(built.meta ?? {}),
      };
      this.add(built.obj);
      this._entries.push(entry);
      this._picker?.addPickable(entry.id, built.obj, { kind: 'button', space: 'ui' });
    });

    // ---- 底部：返回 / 确认 ----
    this._addButton(BACK_ID, '返回', { x: -34, y: LAYOUT.footerY, width: 200, size: 'sub' }, { action: 'cancel' });
    this._addButton(CONFIRM_ID, confirmLabel, { x: 34, y: LAYOUT.footerY, width: 200, size: 'main' }, { action: 'confirm' });

    this._addScrollbar(bandH);
    this._applySelection();
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
      e.obj.dispose?.();
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

  /**
   * 摘下一枚候选（得卡演出用）：从簿记/拾取/场景摘除但**不释放**，返回 entry | null。
   * 调用方负责后续处置——随后的 close()/dispose 不再认得它（二次释放防护靠摘表）。
   */
  takeEntry(key) {
    const i = this._entries.findIndex(e => e.key === key);
    if (i < 0) return null;
    const [entry] = this._entries.splice(i, 1);
    this._picker?.removePickable(entry.id);
    this.remove(entry.obj);
    return entry;
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

  /** hover：抬亮 + 弹该候选的 tooltip（内容由 buildItem 给的 tip 决定）。 */
  onHover(hit, x = 0, y = 0) {
    if (!this._opened) return;
    const entry = hit?.kind === 'button' ? this._entries.find(e => e.id === hit.id) : null;
    if (!entry) { this._setHovered(null); return; }
    this._setHovered(entry);
    if (entry.tip) this._bus?.emit(EventNames.TOOLTIP_SHOW, { kind: entry.tip.type, payload: entry.tip.payload, x, y });
  }

  /** 点击：候选 = 选取（禁用的忽略）；返回/确认走回调。 */
  onClick(hit) {
    if (!this._opened || hit?.kind !== 'button') return false;
    if (hit.id === BACK_ID) { this.close(); this._onCancel?.(); return true; }
    if (hit.id === CONFIRM_ID) {
      if (this._selected.size === 0) return false;
      const keys = this.selectedKeys;
      // 得卡演出钩子（商店卡包）：钩子接管关闭与确认时机（先播「飞入牌库」再上行）。
      // 一次性：取出即清，防重入（open() 也会重置）
      if (this.confirmHook) {
        const hook = this.confirmHook;
        this.confirmHook = null;
        hook(keys);
        return true;
      }
      this.close();
      this._onConfirm?.(keys);
      return true;
    }
    const entry = this._entries.find(e => e.id === hit.id);
    if (!entry || !entry.enabled) return false;
    if (this._multi) {
      if (this._selected.has(entry.key)) this._selected.delete(entry.key);
      else if (this._selected.size < this._picks) this._selected.add(entry.key);
    } else {
      this._selected.clear();
      this._selected.add(entry.key);
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
    const h = this._itemH;
    for (const e of this._entries) {
      const top = e.yTop + this._scrollY;
      const bottom = top - h;
      // 完全滚出可视带的候选：隐藏即可不可见也可命中（Picker 的 visibleUp 守卫）
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
      new THREE.MeshBasicMaterial({ color: 0x7fa9d4, transparent: true, opacity: 0.5 }),
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
      if (!e.enabled) { e.setState('disabled'); continue; }
      const picked = this._selected.has(e.key);
      e.setState(picked || this._hovered === e ? 'highlighted' : 'normal');
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
    // ⚠ maxWidth 的单位是**逻辑像素**（10px/世界单位），不是世界单位——曾经按世界单位传，
    // 标题/提示被当成 ~16 字符宽就折行（一行提示折成三行，还压到候选区头上）。
    t.setText(text, { maxWidth: (HALF_UI_W * 2 - 12) * 10 });
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
