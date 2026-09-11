// TopResourceBarObject：页面顶端居中的单行资源栏（地图/战斗两舞台共享语言）。
// 内容：金币数值（"金币 N" 文本）+ 装备中的遗物槽位，从左到右排一行、整行水平居中。
// 从左下角玩家状态栏拆出（状态栏不再显示金币/遗物）——金币与遗物是 run 级全程
// 关注的信息，顶端居中让视线不必落回角落。数值经 setMoney/setRelics 注入，
// 两者都签名驱动（不变不重烘/不重建），任一变化后整行重新居中。
// 结构：Group（摆放于 uiScene 顶部）
//   ├─ moneyLabel: 金币文本 plane（bakeLabel 烘焙）
//   └─ relicRow:   遗物槽 Group（bakeRelicSlot 烘焙，槽位可数）

import * as THREE from 'three';
import { WORLD_HEIGHT, UI_CAMERA_LOOK_AT_Y } from '../StageManager.js';

const SLOT = 4.0;   // 单个遗物槽边长（世界单位）
const GAP = 0.9;    // 槽间距
const MONEY_GAP = 2.4; // 金币文本与首个遗物槽的间距
const TOP_PAD = 1.2;   // 距 UI 视界顶缘的留白

const UI_TOP = UI_CAMERA_LOOK_AT_Y + WORLD_HEIGHT / 2;

export class TopResourceBarObject extends THREE.Group {
  /**
   * @param {object} options
   *   bakeLabel: (text) => { texture, width, height }   文本烘焙（缺省 1x1 占位）
   */
  constructor({ bakeLabel = null } = {}) {
    super();
    this.name = 'topResourceBar';
    this._bake = bakeLabel || defaultBake;
    this._ppw = 10; // 烘焙像素 → 世界单位（顶端栏独立于状态栏缩放）

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

  /** 行纵向摆位：整行上缘贴 UI 视界顶（留 TOP_PAD），x=0 由 _layout 居中。 */
  _layout() {
    const slotCount = this._relicRow.children.length;
    const rowH = Math.max(SLOT, this._moneyLabel.geometry.parameters.height);
    this.position.set(0, UI_TOP - TOP_PAD - rowH / 2, 8);
    // 整行内容（金币 + 间距 + 槽位串）绕 x=0 居中，从左往右摆
    const relicsW = slotCount > 0 ? slotCount * SLOT + (slotCount - 1) * GAP : 0;
    const lead = this._moneyWidth > 0 && relicsW > 0 ? MONEY_GAP : 0;
    const total = this._moneyWidth + lead + relicsW;
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
    for (const child of [...this._relicRow.children]) disposeSubtree(child);
    items.forEach((r) => this._relicRow.add(makeRelicSlot(r)));
    this._layout();
  }

  dispose() {
    this._moneyLabel.geometry.dispose();
    this._moneyMaterial.map?.dispose?.();
    this._moneyMaterial.dispose();
    for (const child of [...this._relicRow.children]) disposeSubtree(child);
  }
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

// 遗物槽烘焙：圆角方块 + 特征字居中 + 剩余次数金色角标（node 无 document 退化为纯色块）
function makeRelicSlot(relic) {
  const slot = new THREE.Group();
  slot.name = `relic:${relic.id}`;
  const material = new THREE.MeshBasicMaterial({ transparent: true });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(SLOT, SLOT), material);
  mesh.name = 'tile';
  const baked = typeof document !== 'undefined'
    ? bakeRelicSlot(relic, Math.ceil(SLOT * 10))
    : null;
  if (baked) {
    material.map = baked;
    material.needsUpdate = true;
  } else {
    material.color.set(0x1c2334);
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
  const r = W * 0.18;
  ctx.beginPath();
  ctx.roundRect(1.5 * S, 1.5 * S, W - 3 * S, W - 3 * S, r);
  ctx.fillStyle = 'rgba(26, 31, 48, 0.92)';
  ctx.fill();
  ctx.strokeStyle = relic.tint ?? 'rgba(138, 148, 184, 0.75)';
  ctx.lineWidth = 2 * S;
  ctx.stroke();
  // 图形字（def.icon 优先，回落名称首字）；美术图到位后改为贴图
  const glyph = relic.icon || (relic.name ?? '?').slice(0, 1);
  ctx.fillStyle = '#dde3f5';
  ctx.font = `bold ${W * 0.42}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, W / 2, W * 0.46);
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
  return texture;
}

function defaultBake() {
  const texture = new THREE.Texture({ width: 1, height: 1 });
  texture.needsUpdate = true;
  return { texture, width: 1, height: 1 };
}
