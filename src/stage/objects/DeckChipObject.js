// DeckChipObject：卡组 build 画廊的入口小按钮（顶栏右端槽位，TopResourceBarObject
// 的 attachDeckChip 负责摆位；z 仍由本类常量统领）。
// UI 语言：**icon 类按钮无底无框**——纯以带 alpha 的图标表示（assets/ui/deck_chip，
// 千问生成、白底扣像），右下小方片张数角标；无文字 label（hover tooltip 承担命名）。
// 图标未就绪回落程序化叠卡 glyph（同样无底框）。与牌库堆图标（ZonePileObject 单卡背 +
// 斜纹）刻意区分形态：叠卡 =「全部收藏」语义——牌库堆看的是战斗剩余牌，chip 进的是
// build 画廊（run 牌组全量）。本类只管视觉与拾取注册（宿主以 isDeckChipHit 命中路由
// 点击 → 开卡组画廊），不含游戏逻辑。
//
// z 铁律：chip 必须压过一切可交互模态层——面板模态 140/141、全屏选卡与获得特写
// 159~165（OVERLAY_Z 族）、卡组画廊背板 170。「任何时候都能按」的 meta 入口
// （非 cutscene 期间恒可用；cutscene 是 DOM 层盖住 canvas，天然挡住）。画廊开着时
// chip 仍在最上层 → 再点一次 = 关闭（toggle 出口永远可达）。

import * as THREE from 'three';
import { sharedUiArtCache } from '../art/bubbleArt.js';

export const DECK_VIEW_Z = Object.freeze({
  GALLERY_BG: 170,   // 卡组画廊背板（stagePickerKit 的 CardGalleryObject bgZ）
  CHIP: 180,         // 本按钮：高于画廊（含卡片 hover 抬升 171~176）
});

/** 图标素材 key（assets/ui/deck_chip.{webp,png}）。 */
export const DECK_ICON_ART = 'deck_chip';

/** chip 命中判定：pickable 直发 kind，或挂 token 热区后以 {kind:'token', id} 出现。 */
export function isDeckChipHit(hit) {
  return !!hit && (hit.kind === 'deckChip' || (hit.kind === 'token' && hit.id === 'deckChip'));
}

// icon 画布（40px/wu 高密度烘焙：小按钮近看仍清晰）
const ICON_LAYOUT = { width: 128, height: 156 };
const PALETTE = {
  normal: { card: '#3a3a3a', cardEdge: '#e0e0e0', count: '#f2f2f2', badgeBg: '#141414', badgeBorder: '#e0e0e0' },
  hover:  { card: '#4a4a4a', cardEdge: '#e8e8e8', count: '#ffffff', badgeBg: '#1c1c1c', badgeBorder: '#e8e8e8' },
};
const HOVER_SCALE = 1.1;
const HOVER_RATE = 12;

export class DeckChipObject extends THREE.Group {
  /**
   * @param {object} options
   *   width/height: 世界尺寸（缺省 3.2×3.9——初版右下角大 chip 的 1/3）
   *   bakeIcon: (count, hovered, iconImg|null) => { texture }   缺省浏览器 canvas 实现
   */
  constructor({ width = 3.2, height = 3.9, bakeIcon = null } = {}) {
    super();
    this._bakeIcon = bakeIcon || defaultBakeIcon;
    this._count = null;
    this._hovered = false;
    this._t = 0;   // hover scale 包络（0..1，软收敛）
    this._iconImg = null;   // 图标素材（update 惰性取用，到货即重烘）

    this._material = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false });
    this._mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this._material);
    this.add(this._mesh);
    this.setCount(0);
  }

  /** 张数更新：变化才重烘（保留当前 hover 主题）；tooltip 文案随张数走。 */
  setCount(n) {
    const v = n ?? 0;
    if (v === this._count) return false;
    this._count = v;
    // token 热区 = hover tooltip（小按钮无 label，命名靠这里；Picker 对任意 pickable 生效）
    this.userData.token = { type: 'item', payload: { title: '卡组', body: `查看完整卡组（共 ${v} 张）` } };
    this._rebake();
    return true;
  }

  get count() { return this._count ?? 0; }

  /** 世界尺寸（顶栏排布预留槽位用）。 */
  get size() {
    const p = this._mesh.geometry.parameters;
    return { w: p.width, h: p.height };
  }

  /** hover 交互特效：scale 抬升包络（update 软收敛）——无底框后无铬件可烘，纯缩放。 */
  setHovered(on) {
    this._hovered = !!on;
  }

  update(dt) {
    const k = 1 - Math.exp(-HOVER_RATE * dt);
    this._t += ((this._hovered ? 1 : 0) - this._t) * k;
    if (!this._hovered && this._t < 1e-3) this._t = 0;
    const s = 1 + (HOVER_SCALE - 1) * this._t;
    this.scale.set(s, s, 1);
    // 图标惰性到货（预载通常已 warm；未命中发起加载，下一帧再试——同道具图约定）
    if (!this._iconImg) {
      const img = sharedUiArtCache.get(DECK_ICON_ART);
      if (img) { this._iconImg = img; this._rebake(); }
    }
  }

  dispose() {
    this._mesh.geometry.dispose();
    this._material.map?.dispose?.();
    this._material.dispose();
  }

  _rebake() {
    const old = this._material.map;
    this._material.map = this._bakeIcon(this._count ?? 0, this._hovered, this._iconImg).texture;
    this._material.needsUpdate = true;
    old?.dispose?.();
  }
}

// 缺省 icon 烘焙：纯图标（无底无框）+ 右下方片张数角标；素材缺席回落叠卡 glyph
function defaultBakeIcon(count, hovered, iconImg = null) {
  if (typeof document === 'undefined') {
    const texture = new THREE.Texture({ width: 1, height: 1 });
    texture.needsUpdate = true;
    return { texture };
  }
  const P = hovered ? PALETTE.hover : PALETTE.normal;
  const scale = 3;
  const { width: W, height: H } = ICON_LAYOUT;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 主体图标区（角徽留出右下角）
  const box = { x: 8, y: 6, w: W - 16, h: H - 14 };
  if (iconImg?.width) {
    const k = Math.min(box.w / iconImg.width, box.h / iconImg.height);
    const w = iconImg.width * k;
    const h = iconImg.height * k;
    ctx.drawImage(iconImg, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, w, h);
  } else {
    // 回落 glyph：三张错位卡（后两张只描边、前一张实底 + 亮缘）
    const cw = 32, ch = 42;
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const cardAt = (x, y, filled) => {
      ctx.beginPath();
      ctx.rect(x, y, cw, ch);
      if (filled) {
        ctx.fillStyle = P.card;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = P.cardEdge;
        ctx.stroke();
      } else {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = P.cardEdge;
        ctx.stroke();
      }
    };
    cardAt(cx - 31, cy - 7, false);
    cardAt(cx - 20, cy - 16, false);
    cardAt(cx - 9, cy - 25, true);
  }

  // 张数角标（右下方片 + 白字；UI 语言：方角厚描边）
  const bw = 48, bh = 32;
  const bx = W - bw - 2, by = H - bh - 2;
  ctx.beginPath();
  ctx.rect(bx, by, bw, bh);
  ctx.fillStyle = P.badgeBg;
  ctx.fill();
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = P.badgeBorder;
  ctx.stroke();
  ctx.fillStyle = P.count;
  ctx.font = 'bold 23px sans-serif';
  ctx.fillText(String(count ?? 0), bx + bw / 2, by + bh / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return { texture };
}
