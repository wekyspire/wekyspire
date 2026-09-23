// RelicLoadoutObject：战前准备面板的**遗物装卸区**（2026-09-24 用户定的交互升级）。
//
// 取代旧的「文字行 + 装备/卸下按钮」：
//   · 遗物显示 = 图标（圆角方块 + 立绘/特征字 + 稀有度描边，烘焙缓存）——hover 出
//     效果详情（token 热区走全局 tooltip，与顶栏遗物同一契约），图标有抬升反馈；
//   · 装备/卸下 = **拖拽**：从背囊拖到「已装备」区=装备；从装备区拖回「背囊」=卸下；
//     拖拽中目标区亮边提示、容量条给出预览填充（放不下变红）；松手在区外=弹回原位；
//   · 可用遗物（canUse）**点击**即使用（拖拽与点击按 6px 位移阈值区分）；
//   · 槽容量 = point bar：按槽位总数分段的横条，Σcost 填充动画（缓动 + 到位脉冲），
//     拖拽预览时以更亮的填充展示「将要占用」，超出上限的部分染红。
//
// 面板内布局（局部坐标，y 向上，原点在组中心；顶部 = +H/2）：
//   容量条（条 + N/M 读数）→ 已装备区（drop target）→ 背囊区（drop target）
//   → 恒生效行（不占槽，只读）→ 操作提示行。
// 宿主契约（MapStage 侧接线，见 _bindLoadout）：
//   bindStage({ picker, screenToLocal }) + 指针三事件（onDown/onMove/onUp）+ update(dt)。
// 纯 node 退化：无 document → 图标回落色块、文本回落 TextBlockObject 占位烘焙。
import * as THREE from 'three';
import { TextBlockObject } from './TextBlockObject.js';
import { sharedRelicArtCache } from '../art/relicArt.js';
import { RARITY_COLORS } from './RelicScrollPickerObject.js';

// ---- 观感常量（世界单位；面板内宽 ≈ 22.6wu，行 4 枚图标）----
const ICON = 3.9;            // 图标边长
const PITCH = 4.55;          // 图标间距（列/行同距）
const PAD = 0.7;             // 区内边距
const BAR = { h: 2.1, labelW: 4.6, gap: 0.9 };   // 容量条 + 读数
const LABEL_H = 1.7;         // 区标题行高
const HINT_H = 1.7;          // 底部操作提示行高
const NS_ICON = 2.9;         // 恒生效行小图标
const NS_PITCH = 3.4;
const Z = { content: 1, zone: 0.5, ghost: 40 };
const DRAG_THRESHOLD = 6;    // px：超过即判拖拽（否则算点击）
const C = {
  barTrack: 0x141a2b,       // 容量条底
  barFill: 0x6f9fd8,        // 容量条填充（淡蓝——金色只留给金钱）
  barPreview: 0x9cc4ef,     // 拖拽预览填充（更亮一档）
  barOver: 0xe85a5a,        // 超上限（红）
  zoneBorder: 0x39445e,     // 区边框常态
  zoneGlow: 0x7fb1e8,       // 拖拽悬停亮边
  zoneBad: 0xe85a5a,        // 放不下
  empty: 0x232b41,
};

const rarityColor = (r) => RARITY_COLORS[r] ?? RARITY_COLORS.C;

// ---- 图标烘焙（模块级缓存：同一遗物跨面板重建不重烘；node 无 document 回落 null）----
const _iconCache = new Map();
function iconTexture(relic) {
  if (typeof document === 'undefined') return null;
  const key = `${relic.id}|${relic.usesLeft ?? ''}|${relic.canUse ? 1 : 0}`;
  if (_iconCache.has(key)) return _iconCache.get(key);
  const S = 3, W = 160;
  const c = document.createElement('canvas');
  c.width = c.height = W * S; // 逻辑 160px，3x 超采样
  const g = c.getContext('2d');
  g.scale(S, S);
  const col = rarityColor(relic.rarity);
  const r = 26;
  g.beginPath();
  g.roundRect(2, 2, W - 4, W - 4, r);
  g.fillStyle = 'rgba(24, 29, 46, 0.95)';
  g.fill();
  g.lineWidth = 3.5;
  g.strokeStyle = col;
  g.globalAlpha = 0.9;
  g.stroke();
  g.globalAlpha = 1;
  const art = sharedRelicArtCache.get(relic.name ?? '');
  if (art?.width) {
    const pad = 10;
    const box = W - pad * 2;
    const k = Math.min(box / art.width, box / art.height);
    const w = art.width * k, h = art.height * k;
    g.drawImage(art, (W - w) / 2, (W - h) / 2, w, h);
  } else {
    // 无立绘：特征字（def.icon 优先，回落名称首字）
    const ch = relic.icon ?? (relic.name ?? '?')[0];
    g.font = `bold 76px "Microsoft YaHei", "PingFang SC", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = col;
    g.fillText(ch, W / 2, W / 2 + 4);
  }
  // 可用遗物：金色小角标（点击使用——提示行说明）
  if (relic.canUse) {
    g.beginPath();
    g.arc(W - 20, 20, 7, 0, Math.PI * 2);
    g.fillStyle = '#ffd75e';
    g.fill();
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.stroke();
    if (relic.usesLeft != null) {
      g.font = 'bold 13px sans-serif';
      g.fillStyle = '#ffd75e';
      g.textAlign = 'right';
      g.fillText(`×${relic.usesLeft}`, W - 32, 24);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _iconCache.set(key, tex);
  return tex;
}

/**
 * 面板 builder 用：按遗物清单算出区段高度（px，PanelObject custom widget 的 height 口径）。
 * 与 RelicLoadoutObject 内部布局同源（同一套常量推导），不会漂。
 */
export function relicLoadoutSpec(relics, slots, widthWu = 22.6) {
  const perRow = Math.max(1, Math.floor((widthWu - PAD * 2) / PITCH));
  const eq = (relics ?? []).filter(r => !r.nonSlot && r.equipped).length;
  const bag = (relics ?? []).filter(r => !r.nonSlot && !r.equipped).length;
  const ns = (relics ?? []).filter(r => r.nonSlot).length;
  const hasLoadout = eq + bag > 0;
  const eqRows = Math.max(1, Math.ceil(eq / perRow));
  const bagRows = Math.max(1, Math.ceil(bag / perRow));
  const nsRows = Math.max(1, Math.ceil(ns / Math.max(1, Math.floor((widthWu - PAD * 2) / NS_PITCH))));
  let h = BAR.h + 1.0;                                        // 容量条 + 上下留白
  if (hasLoadout) {
    h += LABEL_H + PAD + eqRows * PITCH + PAD;                 // 已装备区
    h += 0.8 + LABEL_H + PAD + bagRows * PITCH + PAD;          // 背囊区
  }
  if (ns) h += 0.8 + LABEL_H + nsRows * NS_PITCH;
  h += 0.6 + HINT_H;
  return { height: Math.round(h * 10) };
}

let _seq = 0;

// 容量条底板烘焙（按 宽×段数 缓存——面板重建不重烘；node 无 document 回落 null）
const _barTexCache = new Map();
function barTrackTexture(barW, segs) {
  if (typeof document === 'undefined') return null;
  const key = `${Math.round(barW * 10)}|${segs}`;
  if (_barTexCache.has(key)) return _barTexCache.get(key);
  const S = 3, Wpx = Math.round(barW * 20), Hpx = 10;
  const c = document.createElement('canvas');
  c.width = Wpx * S; c.height = Hpx * S;
  const g2 = c.getContext('2d');
  g2.scale(S, S);
  g2.beginPath(); g2.roundRect(1, 1, Wpx - 2, Hpx - 2, 4);
  g2.fillStyle = '#141a2b'; g2.fill();
  g2.lineWidth = 1.5; g2.strokeStyle = 'rgba(120,132,164,0.55)'; g2.stroke();
  for (let i = 1; i < segs; i++) {
    const x = (Wpx * i) / segs;
    g2.strokeStyle = 'rgba(10,13,22,0.9)';
    g2.lineWidth = 2;
    g2.beginPath(); g2.moveTo(x, 2); g2.lineTo(x, Hpx - 2); g2.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _barTexCache.set(key, tex);
  return tex;
}

// drop-target 区的「描边」烘焙（中间全透明、只有圆角边线——拖拽悬停的亮边是描边
// 不是整区色块，贴合面板扁平细描边风格；颜色由材质运行时调）
const _edgeTexCache = new Map();
function zoneEdgeTexture(w, h) {
  if (typeof document === 'undefined') return null;
  const key = `${Math.round(w * 10)}x${Math.round(h * 10)}`;
  if (_edgeTexCache.has(key)) return _edgeTexCache.get(key);
  const S = 3, Wpx = Math.round(w * 20), Hpx = Math.round(h * 20);
  const c = document.createElement('canvas');
  c.width = Wpx * S; c.height = Hpx * S;
  const g2 = c.getContext('2d');
  g2.scale(S, S);
  const lw = 2.5;
  g2.beginPath();
  g2.roundRect(lw / 2 + 0.5, lw / 2 + 0.5, Wpx - lw - 1, Hpx - lw - 1, 9);
  g2.lineWidth = lw;
  g2.strokeStyle = '#ffffff';   // 白线（材质 color 上色）
  g2.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  _edgeTexCache.set(key, tex);
  return tex;
}

export class RelicLoadoutObject extends THREE.Group {
  /**
   * @param {object} opts
   *   relics / slots（{used,total}）：prep 快照原样
   *   fireIntent(action)：上行意图（equip/unequip/useRelic——与旧按钮同一条链）
   *   bakeText：文本烘焙（面板注入；缺省 TextBlockObject 自带）
   *   widthWu：区内宽（anchored 面板内宽 22.6）
   */
  constructor({ relics = [], slots = { used: 0, total: 0 }, fireIntent = null, bakeText = null, widthWu = 22.6 } = {}) {
    super();
    this.name = 'relicLoadout';
    this._uid = ++_seq;
    this._fireIntent = fireIntent;
    this._bakeText = bakeText;
    this._widthWu = widthWu;
    this._picker = null;
    this._screenToLocal = null;
    this._pickIds = [];
    this._icons = new Map();     // pickId -> { relic, zone, group, mat, lift, liftT }
    this._zones = [];            // { id, x0, x1, y0, y1, border, glow, glowT, glowCol }
    this._drag = null;           // 拖拽态（见 onMove）
    this._press = null;          // 按下候选（阈值内 = 点击）
    this._spring = null;         // 弹回动画
    this._fill = 0;              // 容量条当前填充（0..1 视觉值）
    this._fillTarget = 0;
    this._preview = 0;           // 拖拽预览填充（0..1）
    this._previewTarget = 0;
    this._previewBad = false;
    this._pop = 0;               // 到位脉冲计时
    this._buildStatic(relics, slots);
  }

  get dragging() { return !!this._drag; }
  /** 指针事件是否应由本对象接管（拖拽中或按下候选未决）。 */
  wantsPointer() { return !!(this._drag || this._press); }

  /** 宿主接线（MapStage._bindLoadout）：拾取器 + 屏幕→局部坐标换算。 */
  bindStage({ picker = null, screenToLocal = null } = {}) {
    this._picker = picker ?? null;
    this._screenToLocal = screenToLocal ?? null;
    this._registerPickables();
    return this;
  }

  // ================= 布局 =================

  _buildStatic(relics, slots) {
    this._slots = slots;
    for (const child of [...this.children]) this._disposeChild(child);
    this._icons.clear();
    this._pickIds = [];
    this._zones = [];

    const W = this._widthWu;
    const perRow = Math.max(1, Math.floor((W - PAD * 2) / PITCH));
    const eq = (relics ?? []).filter(r => !r.nonSlot && r.equipped);
    const bag = (relics ?? []).filter(r => !r.nonSlot && !r.equipped);
    const ns = (relics ?? []).filter(r => r.nonSlot);
    const hasLoadout = eq.length + bag.length > 0;

    // 总高（与 relicLoadoutSpec 同式）
    const eqRows = Math.max(1, Math.ceil(eq.length / perRow));
    const bagRows = Math.max(1, Math.ceil(bag.length / perRow));
    const nsRows = Math.max(1, Math.ceil(ns.length / Math.max(1, Math.floor((W - PAD * 2) / NS_PITCH))));
    let h = BAR.h + 1.0;
    if (hasLoadout) h += LABEL_H + PAD + eqRows * PITCH + PAD + 0.8 + LABEL_H + PAD + bagRows * PITCH + PAD;
    if (ns.length) h += 0.8 + LABEL_H + nsRows * NS_PITCH;
    h += 0.6 + HINT_H;
    const H = h;
    this._H = H;

    // —— 容量条（顶）——
    const barW = W - BAR.labelW - BAR.gap;
    this._bar = this._makeBar(barW, slots);
    this._bar.group.position.set(-W / 2 + barW / 2, H / 2 - 0.5 - BAR.h / 2, Z.content);
    this.add(this._bar.group);
    this._barLabel = new TextBlockObject({ bakeText: this._bakeText, fontPx: 13, tint: '#c3cee0' });
    this._barLabel.setText(`${slots.used ?? 0}/${slots.total ?? 0}`, { maxWidth: BAR.labelW * 10 });
    this._barLabel.position.set(W / 2 - BAR.labelW / 2 + 0.4, H / 2 - 0.5 - BAR.h / 2, Z.content);
    this.add(this._barLabel);
    this._fillTarget = slots.total > 0 ? (slots.used ?? 0) / slots.total : 0;
    this._fill = this._fillTarget;   // 首帧直接到位（重开面板不播填充）

    let y = H / 2 - 0.5 - BAR.h - 0.5;

    // —— 已装备区 / 背囊区（drop target）——
    if (hasLoadout) {
      y = this._buildZone('eq', '已装备 · 拖回背囊卸下', y, eq, perRow, eqRows, W);
      y -= 0.8;
      y = this._buildZone('bag', '背囊 · 拖到上方装备', y, bag, perRow, bagRows, W);
    }

    // —— 恒生效行（不占槽，只读）——
    if (ns.length) {
      y -= 0.8;
      const label = this._label('恒生效（不占槽）', '#a8c6a0');
      label.position.set(0, y - LABEL_H / 2, Z.content);
      this.add(label);
      y -= LABEL_H;
      const nsPer = Math.max(1, Math.floor((W - PAD * 2) / NS_PITCH));
      ns.forEach((r, i) => {
        const g = this._makeIcon(r, 'ns', NS_ICON);
        const col = i % nsPer, row = Math.floor(i / nsPer);
        g.position.set(-W / 2 + PAD + NS_ICON / 2 + col * NS_PITCH, y - NS_ICON / 2 - row * NS_PITCH, Z.content);
        this.add(g);
      });
      y -= nsRows * NS_PITCH;
    }

    // —— 操作提示行 ——
    y -= 0.6;
    const hint = this._label(hasLoadout ? '拖拽图标装卸 ｜ 金点遗物点击使用' : '', '#6f7a92');
    hint.position.set(0, y - HINT_H / 2, Z.content);
    this.add(hint);
  }

  /** 一个 drop-target 区：边框 + 标题 + 图标网格。返回区底 y。 */
  _buildZone(id, title, topY, items, perRow, rows, W) {
    const zoneH = LABEL_H + PAD + rows * PITCH + PAD;
    const label = this._label(title, '#8a93b2');
    label.position.set(0, topY - LABEL_H / 2, Z.content);
    this.add(label);
    const zTop = topY - LABEL_H;
    // 区描边（悬停亮边；圆角白线烘焙 × 材质上色，中间透明）
    const edgeTex = zoneEdgeTexture(W - 0.15, zoneH - LABEL_H - 0.15);
    const border = new THREE.Mesh(
      new THREE.PlaneGeometry(W - 0.15, zoneH - LABEL_H - 0.15),
      new THREE.MeshBasicMaterial({
        color: C.zoneGlow, transparent: true, opacity: 0.0,
        ...(edgeTex ? { map: edgeTex } : {}),
      }),
    );
    border.position.set(0, zTop - (zoneH - LABEL_H) / 2, Z.zone);
    this.add(border);
    this._zones.push({
      id, x0: -W / 2, x1: W / 2, y0: zTop - (zoneH - LABEL_H), y1: zTop,
      border, glow: 0, glowT: 0, glowCol: new THREE.Color(C.zoneGlow),
    });
    // 空区提示字（有 drop target 但没图标时读得出这是个「可放」的地方）
    if (!items.length) {
      const empty = this._label('（空）', '#5a6379');
      empty.position.set(0, zTop - (zoneH - LABEL_H) / 2, Z.content);
      this.add(empty);
    }
    items.forEach((r, i) => {
      const g = this._makeIcon(r, id, ICON);
      const col = i % perRow, row = Math.floor(i / perRow);
      const rowW = Math.min(items.length - row * perRow, perRow);
      const x0 = -((rowW - 1) * PITCH) / 2;    // 每行居中（末行不满时也居中）
      g.position.set(x0 + col * PITCH, zTop - PAD - ICON / 2 - row * PITCH, Z.content);
      this.add(g);
    });
    return zTop - (zoneH - LABEL_H);
  }

  _label(text, tint) {
    const t = new TextBlockObject({ bakeText: this._bakeText, fontPx: 12, tint });
    t.setText(text, { maxWidth: this._widthWu * 10 });
    return t;   // TextBlockObject 几何原点在中心：position 直接按中心摆
  }

  _makeIcon(relic, zone, size) {
    const g = new THREE.Group();
    const tex = iconTexture(relic);
    const mat = new THREE.MeshBasicMaterial({ transparent: true });
    if (tex) { mat.map = tex; } else { mat.color.set(C.empty); mat.opacity = 0.95; }
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), mat);
    mesh.name = 'tile';
    g.add(mesh);
    const pid = `prepRelic:${zone}:${this._uid}:${relic.id}`;
    g.userData.token = { type: 'relic', payload: { relicId: relic.id } };  // hover → 全局 tooltip
    g.userData.relicLoadout = { relic, zone, size, baseY: null };
    const entry = { relic, zone, group: g, mat, mesh, lift: 0, liftT: 0, pid };
    this._icons.set(pid, entry);
    this._pickIds.push(pid);
    return g;
  }

  /** 容量条：底板（分段刻度烘焙，缓存）+ 实填充 + 预览填充。 */
  _makeBar(barW, slots) {
    const group = new THREE.Group();
    const segs = Math.max(1, slots.total ?? 1);
    const track = new THREE.Mesh(
      new THREE.PlaneGeometry(barW, BAR.h),
      new THREE.MeshBasicMaterial({ transparent: true, color: C.barTrack, opacity: 0.95 }),
    );
    group.add(track);
    const tex = barTrackTexture(barW, segs);
    if (tex) {
      track.material.map = tex;
      track.material.color.set(0xffffff);
      track.material.needsUpdate = true;
    }
    // 实填充（宽度随 fill 缩放；锚左）
    const mkFill = (color, opacity) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(barW - 0.24, BAR.h - 0.3),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity }),
      );
      m.position.z = 0.1;
      m.scale.x = 0.001;
      group.add(m);
      return m;
    };
    return { group, track, w: barW - 0.24, fill: mkFill(C.barFill, 0.95), preview: mkFill(C.barPreview, 0.55) };
  }

  // ================= 拾取 =================

  _registerPickables() {
    if (!this._picker) return;
    for (const [pid, entry] of this._icons) {
      this._picker.addPickable(pid, entry.group, { kind: 'row', space: 'ui' });
    }
  }

  // ================= 指针（MapStage 路由进来）=================

  onDown(hit, x, y) {
    const entry = hit?.id ? this._icons.get(hit.id) : null;
    if (!entry) { this._press = null; return false; }
    this._press = { entry, id: hit.id, x, y };
    return true;
  }

  onMove(x, y) {
    const press = this._press;
    if (!press) return;
    if (!this._drag) {
      const d = Math.hypot(x - press.x, y - press.y);
      if (d < DRAG_THRESHOLD) return;
      this._beginDrag(press, x, y);
    }
    this._dragMove(x, y);
  }

  onUp(x, y) {
    const press = this._press;
    this._press = null;
    if (this._drag) { this._endDrag(x, y); return true; }
    if (!press) return false;
    // 点击（无拖拽且位移仍小）：可用遗物点击使用；其余给一个轻微抬升回应
    if (Math.hypot(x - press.x, y - press.y) > DRAG_THRESHOLD * 2.5) return true;
    const { entry } = press;
    if (entry.relic.canUse) {
      this._fireIntent?.({ action: 'useRelic', relicId: entry.relic.id });
    } else {
      entry.liftT = 0.35;   // 小弹一下（无功能的图标也有「摸到了」的反馈）
    }
    return true;
  }

  /** hover 抬升（MapStage 的 hover 尾部喂进来；拖拽中不会到这）。 */
  onHoverHit(hit) {
    const entry = hit?.id ? this._icons.get(hit.id) : null;
    for (const [, e] of this._icons) e.liftT = (e === entry) ? 1 : 0;
  }

  // ---- 拖拽实现 ----

  _beginDrag(press, x, y) {
    const { entry } = press;
    const ghost = new THREE.Mesh(
      new THREE.PlaneGeometry(entry.group.userData.relicLoadout.size * 1.16, entry.group.userData.relicLoadout.size * 1.16),
      entry.mat.clone(),
    );
    ghost.position.z = Z.ghost;
    this.add(ghost);
    this._drag = {
      entry, ghost, from: entry.zone,
      origin: entry.group.position.clone(),
      overZone: null, valid: false,
    };
    entry.mat.opacity = 0.35;    // 原位退亮（占位）
    this._dragMove(x, y);
  }

  _dragMove(x, y) {
    const drag = this._drag;
    if (!drag || !this._screenToLocal) return;
    const p = this._screenToLocal(x, y, Z.ghost);
    drag.ghost.position.x = p.x;
    drag.ghost.position.y = p.y;
    // 落点判定（局部坐标 vs 区框）
    let over = null;
    for (const z of this._zones) {
      if (p.x >= z.x0 && p.x <= z.x1 && p.y >= z.y0 && p.y <= z.y1) { over = z; break; }
    }
    drag.overZone = over;
    // 拖的是背囊件 → 目标必须是装备区；拖的是装备件 → 目标必须是背囊
    const wantZone = drag.from === 'bag' ? 'eq' : 'bag';
    const valid = !!over && over.id === wantZone
      && (drag.from === 'eq' || drag.entry.relic.canEquip);   // 装备方向要过槽位判定
    drag.valid = valid;
    // 容量条预览：装备方向给「将要占用」，放不下整段染红
    if (drag.from === 'bag' && over?.id === 'eq') {
      const total = Math.max(1, this._slotsTotal);
      this._previewTarget = Math.min(1, (this._slotsUsed + drag.entry.relic.cost) / total);
      this._previewBad = !drag.entry.relic.canEquip;
    } else {
      this._previewTarget = 0;
      this._previewBad = false;
    }
  }

  _endDrag(x, y) {
    const drag = this._drag;
    this._drag = null;
    this._previewTarget = 0;
    this._previewBad = false;
    if (!drag) return;
    drag.entry.mat.opacity = 1;
    if (drag.valid) {
      this.remove(drag.ghost);
      drag.ghost.geometry.dispose();
      const action = drag.from === 'bag'
        ? { action: 'equip', relicId: drag.entry.relic.id }
        : { action: 'unequip', relicId: drag.entry.relic.id };
      this._pop = 0.32;   // 容量条到位脉冲（意图上行 → 快照回来 → fill 追目标）
      this._fireIntent?.(action);
      return;
    }
    // 无效落点：弹回原位（180ms 缓动，update 里推进）
    const p = this._screenToLocal?.(x, y, Z.ghost) ?? drag.ghost.position;
    this._spring = { ghost: drag.ghost, from: p.clone(), to: drag.origin.clone(), t: 0 };
  }

  cancelDrag() {
    if (!this._drag) return;
    const drag = this._drag;
    this._drag = null;
    drag.entry.mat.opacity = 1;
    this.remove(drag.ghost);
    drag.ghost.geometry.dispose();
    this._previewTarget = 0;
    this._press = null;
  }

  // ================= 帧驱动 =================

  update(dt) {
    // 容量条：填充缓动 + 预览 + 到位脉冲（y 方向一记小弹）
    const k = Math.min(1, dt * 9);
    this._fill += (this._fillTarget - this._fill) * k;
    this._preview += (this._previewTarget - this._preview) * Math.min(1, dt * 14);
    this._bar.fill.scale.x = Math.max(0.001, this._fill);
    this._bar.preview.scale.x = Math.max(0.001, this._preview);
    this._bar.preview.material.color.set(this._previewBad ? C.barOver : C.barPreview);
    // 填充锚左：缩放后平移半宽 ×(1-scale)/…——用 position.x 修正（几何中心缩放会向两侧收）
    const w = this._bar.w;
    this._bar.fill.position.x = (-w + w * this._bar.fill.scale.x) / 2;
    this._bar.preview.position.x = (-w + w * this._bar.preview.scale.x) / 2;
    if (this._pop > 0) {
      this._pop = Math.max(0, this._pop - dt);
      const s = 1 + 0.5 * Math.sin((this._pop / 0.32) * Math.PI) * 0.28;
      this._bar.group.scale.set(1, s, 1);
    } else if (this._bar.group.scale.y !== 1) {
      this._bar.group.scale.y = 1;
    }
    // 图标抬升（hover/点击回应）：y 偏移 + 微放大
    for (const [, e] of this._icons) {
      e.lift += (e.liftT - e.lift) * Math.min(1, dt * 12);
      const base = e.group.userData.relicLoadout.baseY ??= e.group.position.y;
      if (e.lift > 0.002 || e.lift < -0.002) {
        e.group.position.y = base + e.lift * 0.5;
        e.mesh.scale.setScalar(1 + e.lift * 0.09);
        e.mesh.position.y = e.lift * 0.25;
      }
    }
    // 区亮边
    for (const z of this._zones) {
      const want = this._drag && this._drag.overZone === z
        ? (this._drag.valid ? 1 : 0.8) : 0;
      z.glow += (want - z.glow) * Math.min(1, dt * 14);
      z.border.material.opacity = z.glow * 0.9;
      z.border.material.color.copy(z.glowCol);
      if (this._drag && this._drag.overZone === z && !this._drag.valid) z.border.material.color.set(C.zoneBad);
      z.border.scale.set(1 + z.glow * 0.012, 1 + z.glow * 0.03, 1);
    }
    // 弹回动画
    if (this._spring) {
      const sp = this._spring;
      sp.t = Math.min(1, sp.t + dt / 0.18);
      const e = 1 - (1 - sp.t) * (1 - sp.t);   // easeOut
      sp.ghost.position.lerpVectors(sp.from, sp.to, e);
      sp.ghost.position.z = Z.ghost * (1 - e * 0.75);
      sp.ghost.scale.setScalar(1.16 * (1 - e * 0.14));
      if (sp.t >= 1) {
        this.remove(sp.ghost);
        sp.ghost.geometry.dispose();
        this._spring = null;
      }
    }
  }

  dispose() {
    this.cancelDrag();
    if (this._spring) {
      this.remove(this._spring.ghost);
      this._spring.ghost.geometry.dispose();
      this._spring = null;
    }
    for (const id of this._pickIds) this._picker?.removePickable(id);
    this._pickIds = [];
    for (const child of [...this.children]) this._disposeChild(child);
    this._icons.clear();
  }

  _disposeChild(child) {
    // 几何与材质随清场释放；贴图（图标/条底）归模块级缓存跨面板复用，不随实例销毁
    child.traverse?.((o) => {
      o.geometry?.dispose();
      if (o !== child) o.material?.dispose?.();
    });
    if (child.material && child.isMesh) child.material.dispose?.();
    child.dispose?.();   // TextBlockObject 等自带完整释放
    child.parent?.remove(child);
  }

  // 快照值（容量预览用；buildStatic 时记录）
  get _slotsUsed() { return this._slots?.used ?? 0; }
  get _slotsTotal() { return this._slots?.total ?? 0; }
}
