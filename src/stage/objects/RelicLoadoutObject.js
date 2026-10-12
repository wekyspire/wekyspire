// RelicLoadoutObject：战前准备面板的**背囊遗物栏**（纯背包——已装备的在顶部资源行，
// 面板内不再设「已装备」区与容量条；容量条上移成顶部槽位条 RelicSlotMeterObject）。
//
//   · 遗物显示 = 图标（有立绘 = 直出立绘无底无框；无立绘 = 方角厚描边底片 +
//     特征字 + 稀有度描边，烘焙缓存）——hover 出效果详情（token 热区走全局 tooltip，
//     与顶栏遗物同一契约），图标有抬升反馈；
//   · 装备 = **点击**（超容量不放行，给摇头+染红反馈）或**拖拽到顶部资源行**
//     （落点矩形由宿主经 bindStage 的 getDropRectLocal 实时供给，松手在外=弹回原位）；
//   · 卸下 = 顶部资源行点击/拖回本区（宿主 MapStage 侧实现，bagZoneRectWorld 供落点判定）；
//   · 恒生效（非槽位式）遗物行只读。
//
// 面板内布局（局部坐标，y 向上，原点在组中心；顶部 = +H/2）：
//   背囊区（drop target 反向上行用）→ 恒生效行（不占槽，只读）→ 操作提示行。
// 宿主契约（MapStage 侧接线，见 _bindLoadout）：
//   bindStage({ picker, screenToLocal, getDropRectLocal }) + 指针三事件 + update(dt)。
// 纯 node 退化：无 document → 图标回落色块、文本回落 TextBlockObject 占位烘焙。
import * as THREE from 'three';
import { TextBlockObject } from './TextBlockObject.js';
import { sharedRelicArtCache } from '../art/relicArt.js';
import { RARITY_COLORS } from './RelicScrollPickerObject.js';
import { UI_FONT } from '../richtext/uiFont.js';

// ---- 观感常量（世界单位；面板内宽 ≈ 22.6wu，行 4 枚图标）----
const ICON = 3.9;            // 图标边长
const PITCH = 4.55;          // 图标间距（列/行同距）
const PAD = 0.7;             // 区内边距
const LABEL_H = 1.7;         // 区标题行高
const HINT_H = 1.7;          // 底部操作提示行高
const NS_ICON = 2.9;         // 恒生效行小图标
const NS_PITCH = 3.4;
const Z = { content: 1, zone: 0.5, ghost: 40 };
const DRAG_THRESHOLD = 6;    // px：超过即判拖拽（否则算点击）
const C = {
  zoneGlow: 0xcfcfcf,       // 拖拽悬停亮边
  zoneBad: 0xe85a5a,        // 放不下/不可装备（语义红）
  empty: 0x232323,
};

const rarityColor = (r) => RARITY_COLORS[r] ?? RARITY_COLORS.C;

// ---- 图标烘焙（模块级缓存：同一遗物跨面板重建不重烘；node 无 document 回落 null）----
const _iconCache = new Map();
function iconTexture(relic) {
  if (typeof document === 'undefined') return null;
  const key = `${relic.id}|${relic.canUse ? 1 : 0}`;
  if (_iconCache.has(key)) return _iconCache.get(key);
  const S = 3, W = 160;
  const c = document.createElement('canvas');
  c.width = c.height = W * S; // 逻辑 160px，3x 超采样
  const g = c.getContext('2d');
  g.scale(S, S);
  const col = rarityColor(relic.rarity);
  const art = sharedRelicArtCache.get(relic.name ?? '');
  if (art?.width) {
    // 有立绘：直出（UI 语言：有素材的遗物展示无底无框）
    const pad = 6;
    const box = W - pad * 2;
    const k = Math.min(box / art.width, box / art.height);
    const w = art.width * k, h = art.height * k;
    g.drawImage(art, (W - w) / 2, (W - h) / 2, w, h);
  } else {
    // 无立绘：方角厚描边底片 + 特征字（def.icon 优先，回落名称首字）
    g.beginPath();
    g.roundRect(2, 2, W - 4, W - 4, 0);
    g.fillStyle = 'rgba(24, 24, 24, 0.95)';
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = col;
    g.globalAlpha = 0.9;
    g.stroke();
    g.globalAlpha = 1;
    const ch = relic.icon ?? (relic.name ?? '?')[0];
    g.font = `76px ${UI_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = col;
    g.fillText(ch, W / 2, W / 2 + 4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.userData.usedArt = !!art?.width;   // 立绘晚到补烘的判据（见 _refreshArtIcons）
  _iconCache.set(key, tex);
  return tex;
}

/**
 * 面板 builder 用：按遗物清单算出区段高度（px，PanelObject custom widget 的 height 口径）。
 * 与 RelicLoadoutObject 内部布局同源（同一套常量推导），不会漂。
 */
export function relicLoadoutSpec(relics, _slots, widthWu = 22.6) {
  const perRow = Math.max(1, Math.floor((widthWu - PAD * 2) / PITCH));
  const bag = (relics ?? []).filter(r => !r.nonSlot && !r.equipped).length;
  const ns = (relics ?? []).filter(r => r.nonSlot).length;
  const bagRows = Math.max(1, Math.ceil(bag / perRow));
  const nsRows = Math.max(1, Math.ceil(ns / Math.max(1, Math.floor((widthWu - PAD * 2) / NS_PITCH))));
  let h = LABEL_H + PAD + bagRows * PITCH + PAD;                 // 背囊区
  if (ns) h += 0.8 + LABEL_H + nsRows * NS_PITCH;
  h += 0.6 + HINT_H;
  return { height: Math.round(h * 10) };
}

let _seq = 0;

// drop-target 区的「描边」烘焙（中间全透明、只有方角厚边线；颜色由材质运行时调）
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
  const lw = 3.5;
  g2.beginPath();
  g2.roundRect(lw / 2 + 0.5, lw / 2 + 0.5, Wpx - lw - 1, Hpx - lw - 1, 0);
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
   *   relics（prep 快照原样——本对象只取其中「背囊 = 槽位式且未装备」与「恒生效」两组）/
   *   fireIntent(action)：上行意图（equip——与旧按钮同一条链）
   *   bakeText：文本烘焙（面板注入；缺省 TextBlockObject 自带）
   *   widthWu：区内宽（anchored 面板内宽 22.6）
   */
  constructor({ relics = [], fireIntent = null, bakeText = null, widthWu = 22.6 } = {}) {
    super();
    this.name = 'relicLoadout';
    this._uid = ++_seq;
    this._fireIntent = fireIntent;
    this._bakeText = bakeText;
    this._widthWu = widthWu;
    this._picker = null;
    this._screenToLocal = null;
    this._getDropRectLocal = null;
    this._pickIds = [];
    this._icons = new Map();     // pickId -> { relic, zone, group, mat, mesh, lift, liftT, denyT, pid }
    this._zone = null;           // 背囊区 { x0,x1,y0,y1, border, glow, glowT }
    this._drag = null;           // 拖拽态（见 onMove）
    this._press = null;          // 按下候选（阈值内 = 点击）
    this._spring = null;         // 弹回动画
    this._buildStatic(relics);
    // 立绘晚到补烘（PropArtCache 契约）：图标首烘若赶上立绘未解码，特征字占位会被
    // 模块缓存固化——订阅任意加载完成事件，复查占位图标，就绪即作废缓存重烘。
    this._unsubArt = sharedRelicArtCache.addOnLoad(() => this._refreshArtIcons());
  }

  /** 立绘解码完成回调：把还在用特征字占位的图标换成真立绘（缓存作废 + 材质重挂）。 */
  _refreshArtIcons() {
    for (const [, e] of this._icons) {
      if (e.mat.map?.userData?.usedArt) continue;
      if (!sharedRelicArtCache.get(e.relic.name ?? '')?.width) continue;
      for (const [k, t] of _iconCache) {
        if (k.startsWith(`${e.relic.id}|`)) { _iconCache.delete(k); t.dispose(); }
      }
      const fresh = iconTexture(e.relic);
      if (fresh) {
        e.mat.map = fresh;
        e.mat.color.set(0xffffff);
        e.mat.opacity = 1;
        e.mat.needsUpdate = true;
      }
    }
  }

  get dragging() { return !!this._drag; }
  /** 指针事件是否应由本对象接管（拖拽中或按下候选未决）。 */
  wantsPointer() { return !!(this._drag || this._press); }

  /** 宿主接线（MapStage._bindLoadout）：拾取器 + 屏幕→局部坐标换算 +
   *  装备落点矩形（顶部资源行遗物区，返回本对象局部坐标 {x0,x1,y0,y1} 或 null）+
   *  演出钩子：onEquipFx（装备飞行起点）/ setDropFrame（顶栏落点框状态，null=收起）。 */
  bindStage({ picker = null, screenToLocal = null, getDropRectLocal = null, onEquipFx = null, setDropFrame = null } = {}) {
    this._picker = picker ?? null;
    this._screenToLocal = screenToLocal ?? null;
    this._getDropRectLocal = getDropRectLocal ?? null;
    this._onEquipFx = onEquipFx ?? null;
    this._setDropFrame = setDropFrame ?? null;
    this._registerPickables();
    return this;
  }

  /** 背囊区矩形（uiScene 世界坐标 {x0,x1,y0,y1}）——顶栏拖回「卸下」的落点判定用。 */
  bagZoneRectWorld() {
    const z = this._zone;
    if (!z) return null;
    this.updateWorldMatrix(true, false);
    const a = this.localToWorld(new THREE.Vector3(z.x0, z.y0, 0));
    const b = this.localToWorld(new THREE.Vector3(z.x1, z.y1, 0));
    return {
      x0: Math.min(a.x, b.x), x1: Math.max(a.x, b.x),
      y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y),
    };
  }

  // ================= 布局 =================

  _buildStatic(relics) {
    for (const child of [...this.children]) this._disposeChild(child);
    this._icons.clear();
    this._pickIds = [];
    this._zone = null;

    const W = this._widthWu;
    const perRow = Math.max(1, Math.floor((W - PAD * 2) / PITCH));
    const bag = (relics ?? []).filter(r => !r.nonSlot && !r.equipped);
    const ns = (relics ?? []).filter(r => r.nonSlot);

    // 总高（与 relicLoadoutSpec 同式）
    const bagRows = Math.max(1, Math.ceil(bag.length / perRow));
    const nsRows = Math.max(1, Math.ceil(ns.length / Math.max(1, Math.floor((W - PAD * 2) / NS_PITCH))));
    let h = LABEL_H + PAD + bagRows * PITCH + PAD;
    if (ns.length) h += 0.8 + LABEL_H + nsRows * NS_PITCH;
    h += 0.6 + HINT_H;
    const H = h;
    this._H = H;

    let y = H / 2;

    // —— 背囊区（装备源；卸下方向的 drop target）——
    y = this._buildBagZone(y, bag, perRow, bagRows, W);

    // —— 无需装备的遗物行（只读）——
    if (ns.length) {
      y -= 0.8;
      const label = this._label('无需装备的遗物', '#a8a8a8');
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
    const hint = this._label('点击装备，或拖到顶部遗物行', '#787878');
    hint.position.set(0, y - HINT_H / 2, Z.content);
    this.add(hint);
  }

  /** 背囊区：边框（卸下落点亮边）+ 标题 + 图标网格。返回区底 y。 */
  _buildBagZone(topY, items, perRow, rows, W) {
    const zoneH = LABEL_H + PAD + rows * PITCH + PAD;
    const label = this._label('背包', '#8f8f8f');
    label.position.set(0, topY - LABEL_H / 2, Z.content);
    this.add(label);
    const zTop = topY - LABEL_H;
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
    this._zone = {
      x0: -W / 2, x1: W / 2, y0: zTop - (zoneH - LABEL_H), y1: zTop,
      border, glow: 0, glowT: 0,
    };
    // 空区提示字（读得出这是个「可放回来」的地方）
    if (!items.length) {
      const empty = this._label('（空）', '#646464');
      empty.position.set(0, zTop - (zoneH - LABEL_H) / 2, Z.content);
      this.add(empty);
    }
    items.forEach((r, i) => {
      const g = this._makeIcon(r, 'bag', ICON);
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
    const entry = { relic, zone, group: g, mat, mesh, lift: 0, liftT: 0, denyT: 0, pid };
    this._icons.set(pid, entry);
    this._pickIds.push(pid);
    return g;
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
    if (entry.zone !== 'bag') { this._press = null; return false; }  // 恒生效行只读（hover tooltip 仍走 picker）
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
    // 点击（无拖拽且位移仍小）：背囊件点击 = 快捷装备；超容量不放行（core 会抛错）给摇头反馈
    if (Math.hypot(x - press.x, y - press.y) > DRAG_THRESHOLD * 2.5) return true;
    const { entry } = press;
    if (entry.relic.canEquip) {
      this._onEquipFx?.({   // 装备飞行起点（宿主 MapStage 播 icon 飞向顶栏槽位）
        relic: entry.relic,
        fromLocal: entry.group.position.clone(),
        size: entry.group.userData.relicLoadout.size,
        map: entry.mat.map ?? null,
      });
      this._fireIntent?.({ action: 'equip', relicId: entry.relic.id });
    } else {
      entry.denyT = 0.4;   // 摇头 + 染红（update 里推进）
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
      entry, ghost,
      origin: entry.group.position.clone(),
      overTarget: false, valid: false,
    };
    entry.mat.opacity = 0.35;    // 原位退亮（占位）
    this._setDropFrame?.({ over: false, valid: !!entry.relic.canEquip });   // 顶栏落点框亮起
    this._dragMove(x, y);
  }

  _dragMove(x, y) {
    const drag = this._drag;
    if (!drag || !this._screenToLocal) return;
    const p = this._screenToLocal(x, y, Z.ghost);
    drag.ghost.position.x = p.x;
    drag.ghost.position.y = p.y;
    // 落点判定：宿主供的装备落点矩形（顶部资源行遗物区，本对象局部坐标）
    const rect = this._getDropRectLocal?.() ?? null;
    const over = !!rect && p.x >= rect.x0 && p.x <= rect.x1 && p.y >= rect.y0 && p.y <= rect.y1;
    drag.overTarget = over;
    drag.valid = over && !!drag.entry.relic.canEquip;
    // 拖到落点上但放不下：ghost 染红预告（落点框同步吃红）
    drag.ghost.material.color.set(over && !drag.entry.relic.canEquip ? 0xe85a5a : 0xffffff);
    this._setDropFrame?.({ over, valid: !!drag.entry.relic.canEquip });
  }

  _endDrag(x, y) {
    const drag = this._drag;
    this._drag = null;
    if (!drag) return;
    this._setDropFrame?.(null);   // 落点框收起（落定闪由宿主在 onEquipFx 里播）
    drag.entry.mat.opacity = 1;
    if (drag.valid) {
      // 拖拽 ghost 直接移交宿主接力飞行（不原地弃置+新建——否则落点上多一次「诞生弹跳」）
      if (this._onEquipFx) {
        this._onEquipFx({
          relic: drag.entry.relic,
          fromLocal: drag.ghost.position.clone(),
          size: drag.entry.group.userData.relicLoadout.size,
          map: drag.entry.mat.map ?? null,
          ghost: drag.ghost,
        });
      } else {
        this.remove(drag.ghost);
        drag.ghost.geometry.dispose();
        drag.ghost.material.dispose();
      }
      this._fireIntent?.({ action: 'equip', relicId: drag.entry.relic.id });
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
    this._setDropFrame?.(null);
    drag.entry.mat.opacity = 1;
    this.remove(drag.ghost);
    drag.ghost.geometry.dispose();
    drag.ghost.material.dispose();
  }

  // ================= 帧驱动 =================

  update(dt) {
    // 图标抬升（hover 反馈）：y 偏移 + 微放大
    for (const [, e] of this._icons) {
      e.lift += (e.liftT - e.lift) * Math.min(1, dt * 12);
      const base = e.group.userData.relicLoadout.baseY ??= e.group.position.y;
      if (e.lift > 0.002 || e.lift < -0.002) {
        e.group.position.y = base + e.lift * 0.5;
        e.mesh.scale.setScalar(1 + e.lift * 0.09);
        e.mesh.position.y = e.lift * 0.25;
      }
      // 拒绝反馈（超容量点击）：左右摇头 + 染红渐退
      if (e.denyT > 0) {
        e.denyT = Math.max(0, e.denyT - dt);
        const k = e.denyT / 0.4;
        const baseX = e.group.userData.relicLoadout.baseX ??= e.group.position.x;
        e.group.position.x = baseX + Math.sin(e.denyT * 40) * 0.09 * k;
        e.mat.color.setRGB(1, 1 - 0.55 * k, 1 - 0.55 * k);
        if (e.denyT === 0) {
          e.mat.color.setRGB(1, 1, 1);
          e.group.position.x = e.group.userData.relicLoadout.baseX;
        }
      }
    }
    // 背囊区亮边（顶栏拖回时宿主经 setBagGlow 推目标）
    if (this._zone) {
      const z = this._zone;
      z.glow += (z.glowT - z.glow) * Math.min(1, dt * 14);
      z.border.material.opacity = z.glow * 0.9;
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
        sp.ghost.material.dispose();
        this._spring = null;
      }
    }
  }

  /** 宿主侧顶栏拖拽悬停本区时的亮边目标值（0/1）。 */
  setBagGlow(on) { if (this._zone) this._zone.glowT = on ? 1 : 0; }

  dispose() {
    this._unsubArt?.();   // 退订加载监听（防幽灵面板）
    this.cancelDrag();
    if (this._spring) {
      this.remove(this._spring.ghost);
      this._spring.ghost.geometry.dispose();
      this._spring.ghost.material.dispose();
      this._spring = null;
    }
    for (const id of this._pickIds) this._picker?.removePickable(id);
    this._pickIds = [];
    for (const child of [...this.children]) this._disposeChild(child);
    this._icons.clear();
  }

  _disposeChild(child) {
    // 几何与材质随清场释放；贴图（图标/区边）归模块级缓存跨面板复用，不随实例销毁
    child.traverse?.((o) => {
      o.geometry?.dispose();
      if (o !== child) o.material?.dispose?.();
    });
    if (child.material && child.isMesh) child.material.dispose?.();
    child.dispose?.();   // TextBlockObject 等自带完整释放
    child.parent?.remove(child);
  }
}
