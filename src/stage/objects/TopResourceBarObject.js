// TopResourceBarObject：页面顶端的窄菜单栏（地图/战斗/房间三舞台共享语言）。
// 内容：金币数值（"金币 N" 文本）+ 装备中的遗物槽位 + 卡组入口小按钮（右端槽位），
// 整体内容水平居中、外裹一条低矮的窄条背板（按钮语言：深底 + 淡蓝细描边圆角条）。
// 从左下角玩家状态栏拆出（状态栏不再显示金币/遗物）——金币与遗物是 run 级全程
// 关注的信息，顶端居中让视线不必落回角落。数值经 setMoney/setRelics 注入，
// 两者都签名驱动（不变不重烘/不重建），任一变化后整行重新居中。
// 卡组按钮（DeckChipObject）由宿主舞台创建并持有、挂 uiScene（z 铁律 180 不变），
// 本栏经 attachDeckChip 只负责**摆位**：布局随金币/遗物变化自动跟随重排。
// 结构：Group（摆放于 uiScene 顶部）
//   ├─ strip:    窄条背板 plane（bakeStrip 烘焙，随内容宽度重烘）
//   ├─ moneyLabel: 金币文本 plane（bakeLabel 烘焙）
//   ├─ relicRow:   遗物槽 Group（bakeRelicSlot 烘焙，槽位可数）
//   └─ （deckChip 槽位只占宽，本体不在本 Group 内）

import * as THREE from 'three';
import { WORLD_HEIGHT, UI_CAMERA_LOOK_AT_Y } from '../StageManager.js';
import { sharedRelicArtCache } from '../art/relicArt.js';
import { DECK_VIEW_Z } from './DeckChipObject.js';

const SLOT = 4.0;   // 单个遗物槽边长（世界单位）
const GAP = 0.9;    // 槽间距
const MONEY_GAP = 2.4; // 金币文本与首个遗物槽的间距
const DECK_GAP = 1.4;  // 遗物行与卡组按钮的间距
const TOP_PAD = 1.0;   // 距 UI 视界顶缘的留白
const STRIP_PAD = { x: 1.2, y: 0.55 }; // 窄条背板在内容四周的余量

const UI_TOP = UI_CAMERA_LOOK_AT_Y + WORLD_HEIGHT / 2;

export class TopResourceBarObject extends THREE.Group {
  /**
   * @param {object} options
   *   bakeLabel: (text) => { texture, width, height }   文本烘焙（缺省 1x1 占位）
   */
  constructor({ bakeLabel = null, picker = null } = {}) {
    super();
    this.name = 'topResourceBar';
    this._picker = picker; // 拾取器（遗物槽 hover → tooltip；可不传=纯展示）
    this._slotPickIds = [];
    this._bake = bakeLabel || defaultBake;
    this._ppw = 10; // 烘焙像素 → 世界单位（顶端栏独立于状态栏缩放）
    this._relics = [];
    this._relicArtPending = false;
    this._deckChip = null;   // 卡组按钮（attachDeckChip 注入，只摆位不持有）
    // 立绘晚到补烘（PropArtCache 契约）：setRelics 是签名去重的——冷加载首拍若赶在
    // 立绘解码前，特征字占位会被签名挡住永不重烘（prep 顶栏「黑」字徽章固化的病根，
    // 夜测 r3路3）。订阅任意加载完成，占位行就绪后整行重建。
    this._unsubArt = sharedRelicArtCache.addOnLoad(() => {
      if (!this._relicArtPending) return;
      const relics = this._relics;
      this._relicSig = null;   // 作废签名强制重建
      this.setRelics(relics);
    });

    this._stripMaterial = new THREE.MeshBasicMaterial({ transparent: true });
    this._strip = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this._stripMaterial);
    this._strip.name = 'strip';
    this.add(this._strip);

    this._moneyMaterial = new THREE.MeshBasicMaterial({ transparent: true });
    this._moneyLabel = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this._moneyMaterial);
    this._moneyLabel.name = 'moneyLabel';
    this.add(this._moneyLabel);

    this._relicRow = new THREE.Group();
    this._relicRow.name = 'relicRow';
    this.add(this._relicRow);

    this._moneySig = null;
    this._relicSig = null;
    this._moneyWidth = 0;

    this._layout();
  }

  get relicRow() { return this._relicRow; }

  /**
   * 卡组按钮入列（右端槽位）：本体由宿主舞台挂 uiScene（z=DECK_VIEW_Z.CHIP 压过
   * 一切模态层的铁律不变），本栏只在每次布局时下发 x/y 摆位、并按其尺寸预留槽宽。
   */
  attachDeckChip(chip) {
    this._deckChip = chip ?? null;
    this._layout();
  }

  /** 行纵向摆位：窄条上缘贴 UI 视界顶（留 TOP_PAD），x=0 由 _layout 居中。 */
  _layout() {
    const slotCount = this._relicRow.children.length;
    const chipSize = this._deckChip?.size ?? null;
    const rowH = Math.max(SLOT, this._moneyLabel.geometry.parameters.height, chipSize?.h ?? 0);
    this.position.set(0, UI_TOP - TOP_PAD - STRIP_PAD.y - rowH / 2, 8);
    // 整行内容（金币 + 间距 + 槽位串 + 间距 + 卡组槽）绕 x=0 居中，从左往右摆
    const chipW = chipSize?.w ?? 0;
    const relicsW = slotCount > 0 ? slotCount * SLOT + (slotCount - 1) * GAP : 0;
    const lead = this._moneyWidth > 0 && (relicsW > 0 || chipW > 0) ? MONEY_GAP : 0;
    const deckLead = chipW > 0 && (this._moneyWidth > 0 || relicsW > 0) ? DECK_GAP : 0;
    const total = this._moneyWidth + lead + relicsW + deckLead + chipW;
    let x = -total / 2;
    if (this._moneyWidth > 0) {
      this._moneyLabel.position.x = x + this._moneyWidth / 2;
      x += this._moneyWidth + lead;
    } else {
      this._moneyLabel.position.x = 0;
    }
    this._relicRow.children.forEach((slot, i) => {
      slot.position.x = x + SLOT / 2 + i * (SLOT + GAP);
    });
    x += relicsW + deckLead;
    // 卡组按钮槽：只发坐标（chip 的 y 与行中心对齐、z 保持自身铁律）
    if (this._deckChip) {
      this._deckChip.position.set(x + chipW / 2, this.position.y, DECK_VIEW_Z.CHIP);
    }
    this._resizeStrip(total + STRIP_PAD.x * 2, rowH + STRIP_PAD.y * 2);
  }

  /** 窄条背板随内容尺寸重建（布局拍调用；烘焙廉价且低频）。 */
  _resizeStrip(w, h) {
    this._strip.geometry.dispose();
    this._strip.geometry = new THREE.PlaneGeometry(w, h);
    this._strip.position.set(0, 0, -0.4);   // 内容plane（z=0）之后绘制
    const old = this._stripMaterial.map;
    const baked = typeof document !== 'undefined' ? bakeStrip(w, h, this._ppw) : null;
    if (baked) {
      this._stripMaterial.map = baked;
      this._stripMaterial.color.set(0xffffff);
      this._stripMaterial.needsUpdate = true;
      old?.dispose?.();
    } else {
      this._stripMaterial.color.set(0x111111);
      this._stripMaterial.opacity = 0.9;
    }
  }

  /** 金币数值：签名不变不重烘。 */
  setMoney(amount) {
    const sig = `money:${amount}`;
    if (sig === this._moneySig) return;
    this._moneySig = sig;
    const { texture, width, height } = this._bake(`金币 ${amount}`);
    const old = this._moneyMaterial.map;
    this._moneyMaterial.map = texture;
    this._moneyMaterial.color.set(0xffffff);
    this._moneyMaterial.needsUpdate = true;
    old?.dispose?.();
    this._moneyWidth = width / this._ppw;
    this._moneyLabel.geometry.dispose();
    this._moneyLabel.geometry = new THREE.PlaneGeometry(this._moneyWidth, height / this._ppw);
    this._layout();
  }

  /**
   * 遗物槽行：list = [{ id, name, icon?, usesLeft? }]（Shell 压平后注入）。
   * 签名不变不重建。
   */
  setRelics(list) {
    const items = list ?? [];
    const sig = JSON.stringify(items.map(r => [r.id, r.icon, r.usesLeft ?? null]));
    if (sig === this._relicSig) return;
    this._relicSig = sig;
    this._relics = items;
    for (const id of this._slotPickIds) this._picker?.removePickable(id);
    this._slotPickIds = [];
    for (const child of [...this._relicRow.children]) disposeSubtree(child);
    items.forEach((r, i) => {
      const slot = makeRelicSlot(r);
      if (!slot.userData.tileMap?.map?.userData?.usedArt) this._relicArtPending = true;
      this._relicRow.add(slot);
      // 槽位可 hover：token 挂在槽（Group）上，Picker 从 pickable 根对象取 token
      if (this._picker) {
        const pid = `topbar:relic:${i}:${r.id}`;
        slot.userData.token = { type: 'relic', payload: { relicId: r.id } };
        this._picker.addPickable(pid, slot, { kind: 'row', space: 'ui' });
        this._slotPickIds.push(pid);
      }
    });
    this._layout();
  }

  /** 换/脱拾取器（舞台在 attachInput 时注入；随后重建当前槽位以完成登记）。 */
  attachPicker(picker) {
    for (const id of this._slotPickIds) this._picker?.removePickable(id);
    this._slotPickIds = [];
    this._picker = picker ?? null;
    if (this._picker && this._relicRow.children.length) {
      this._relicRow.children.forEach((slot, i) => {
        const id = slot.name?.replace(/^relic:/, '') ?? `${i}`;
        const pid = `topbar:relic:${i}:${id}`;
        slot.userData.token = { type: 'relic', payload: { relicId: id } };
        this._picker.addPickable(pid, slot, { kind: 'row', space: 'ui' });
        this._slotPickIds.push(pid);
      });
    }
    return this;
  }

  dispose() {
    this._unsubArt?.();   // 退订加载监听（防幽灵顶栏）
    for (const id of this._slotPickIds) this._picker?.removePickable(id);
    this._slotPickIds = [];
    this._strip.geometry.dispose();
    this._stripMaterial.map?.dispose?.();
    this._stripMaterial.dispose();
    this._moneyLabel.geometry.dispose();
    this._moneyMaterial.map?.dispose?.();
    this._moneyMaterial.dispose();
    for (const child of [...this._relicRow.children]) disposeSubtree(child);
  }
}

// 窄条背板烘焙：低矮圆角长条（深底半透明 + 淡蓝细描边，按钮/面板同语言；
// 圆角小、压住四角——大圆角与面板纪律不符）。node 无 document 走纯色回落。
function bakeStrip(w, h, ppw) {
  const S = 3;   // 超采样
  const W = Math.max(2, Math.round(w * ppw));
  const H = Math.max(2, Math.round(h * ppw));
  const canvas = document.createElement('canvas');
  canvas.width = W * S;
  canvas.height = H * S;
  const ctx = canvas.getContext('2d');
  const r = 0;   // UI 语言：方角
  ctx.beginPath();
  ctx.roundRect(S, S, W * S - 2 * S, H * S - 2 * S, r);
  ctx.fillStyle = 'rgba(16, 16, 16, 0.88)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(150, 150, 150, 0.8)';
  ctx.lineWidth = 3 * S;   // 厚描边（≈0.3 世界单位）
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// 子树释放（几何/材质/贴图；遗物槽是 Group→tile Mesh 两级）
function disposeSubtree(root) {
  root.traverse((o) => {
    o.geometry?.dispose?.();
    o.material?.map?.dispose?.();
    o.material?.dispose?.();
  });
  root.parent?.remove(root);
}

// 遗物槽烘焙：**遗物立绘直出**（`assets/relics/<遗物名>`，预载已 warm，首拍同步命中；
// 有素材 = 无底无框纯立绘 + 剩余次数金色角标）；素材缺席（headless / 新遗物美术未到）
// 回落方角厚描边底片 + def.icon 或名称首字的特征字（node 无 document 退化为纯色块）。
function makeRelicSlot(relic) {
  const slot = new THREE.Group();
  slot.name = `relic:${relic.id}`;
  const material = new THREE.MeshBasicMaterial({ transparent: true });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SLOT, SLOT), material);
  mesh.name = 'tile';
  slot.userData.tileMap = material;   // 供占位判定（材质即 map 载体）
  const baked = typeof document !== 'undefined'
    ? bakeRelicSlot(relic, Math.ceil(SLOT * 10))
    : null;
  if (baked) {
    material.map = baked;
    material.needsUpdate = true;
  } else {
    material.color.set(0x1c1c1c);
    material.opacity = 0.92;
  }
  slot.add(mesh);
  return slot;
}

function bakeRelicSlot(relic, sizePx) {
  const S = 3;
  const canvas = document.createElement('canvas');
  canvas.width = sizePx * S;
  canvas.height = sizePx * S;
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  // 遗物立绘直出（UI 语言：有素材的遗物展示无底无框）；没有素材才回落
  // 方角厚描边底片 + 特征字（def.icon 优先，再回落名称首字）
  const art = sharedRelicArtCache.get(relic.name ?? '');
  if (art?.width) {
    const pad = W * 0.04;
    const box = W - pad * 2;
    const k = Math.min(box / art.width, box / art.height);
    const w = art.width * k;
    const h = art.height * k;
    ctx.drawImage(art, (W - w) / 2, (W - h) / 2, w, h);
  } else {
    ctx.beginPath();
    ctx.roundRect(1.5 * S, 1.5 * S, W - 3 * S, W - 3 * S, 0);
    ctx.fillStyle = 'rgba(26, 26, 26, 0.92)';
    ctx.fill();
    ctx.strokeStyle = relic.tint ?? 'rgba(170, 170, 170, 0.75)';
    ctx.lineWidth = 3 * S;   // 厚描边
    ctx.stroke();
    const glyph = relic.icon || (relic.name ?? '?').slice(0, 1);
    ctx.fillStyle = '#e0e0e0';
    ctx.font = `bold ${W * 0.42}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, W / 2, W * 0.46);
  }
  // 剩余次数角标（右下）
  if (relic.usesLeft != null) {
    ctx.fillStyle = '#ffd75e';
    ctx.font = `bold ${W * 0.2}px sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${relic.usesLeft}`, W * 0.92, W * 0.95);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.userData.usedArt = !!art?.width;   // 立绘晚到补烘判据（见构造订阅）
  return texture;
}

function defaultBake() {
  const texture = new THREE.Texture({ width: 1, height: 1 });
  texture.needsUpdate = true;
  return { texture, width: 1, height: 1 };
}
