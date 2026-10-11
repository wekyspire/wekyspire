// DeckChipObject：右下角「卡组」入口按钮（小 icon + 张数 + hover 交互特效）。
// 与牌库堆图标（ZonePileObject 单卡背 + 斜纹）刻意区分形态：叠卡 glyph =「全部收藏」
// 语义——牌库堆看的是战斗剩余牌，chip 进的是 build 画廊（run 牌组全量）。
// 本类只管视觉与拾取注册（宿主以 kind:'deckChip' 路由点击 → 开卡组画廊），
// 与 ZonePileObject/ButtonObject 同律：不含游戏逻辑。
//
// z 铁律：chip 必须压过一切可交互模态层——面板模态 140/141、全屏选卡与获得特写
// 159~165（OVERLAY_Z 族）、卡组画廊背板 170。「任何时候都能按」的 meta 入口
// （非 cutscene 期间恒可用；cutscene 是 DOM 层盖住 canvas，天然挡住）。画廊开着时
// chip 仍在最上层 → 再点一次 = 关闭（toggle 出口永远可达）。

import * as THREE from 'three';

export const DECK_VIEW_Z = Object.freeze({
  GALLERY_BG: 170,   // 卡组画廊背板（stagePickerKit 的 CardGalleryObject bgZ）
  CHIP: 180,         // 本按钮：高于画廊（含卡片 hover 抬升 171~176）
});

// icon 画布（逻辑像素，10px/wu）：「卡组」小标 + 叠卡 glyph + 张数
const ICON_LAYOUT = { width: 96, height: 116 };
const PALETTE = {
  normal: { bg: '#1c2233', border: '#3f5f8c', card: '#31405e', cardEdge: '#8fb6dd', label: '#9aa3b8', count: '#f2f4fa' },
  hover:  { bg: '#26304a', border: '#8fb6dd', card: '#3d5078', cardEdge: '#c3d9f2', label: '#c3cee0', count: '#ffffff' },
};
const HOVER_SCALE = 1.1;
const HOVER_RATE = 12;

export class DeckChipObject extends THREE.Group {
  /**
   * @param {object} options
   *   width/height: 世界尺寸（10px/wu；缺省略小于牌库堆图标 10×12）
   *   bakeIcon: (count, hovered) => { texture }   缺省浏览器 canvas 实现
   */
  constructor({ width = 9.6, height = 11.6, bakeIcon = null } = {}) {
    super();
    this._bakeIcon = bakeIcon || defaultBakeIcon;
    this._count = null;
    this._hovered = false;
    this._t = 0;   // hover scale 包络（0..1，软收敛）

    this._material = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false });
    this._mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this._material);
    this.add(this._mesh);
    this.setCount(0);
  }

  /** 张数更新：变化才重烘（保留当前 hover 主题）。 */
  setCount(n) {
    const v = n ?? 0;
    if (v === this._count) return false;
    this._count = v;
    this._rebake();
    return true;
  }

  get count() { return this._count ?? 0; }

  /** hover 交互特效：重烘亮色主题 + scale 抬升包络（update 软收敛）。 */
  setHovered(on) {
    const next = !!on;
    if (next === this._hovered) return;
    this._hovered = next;
    this._rebake();
  }

  update(dt) {
    const k = 1 - Math.exp(-HOVER_RATE * dt);
    this._t += ((this._hovered ? 1 : 0) - this._t) * k;
    if (!this._hovered && this._t < 1e-3) this._t = 0;
    const s = 1 + (HOVER_SCALE - 1) * this._t;
    this.scale.set(s, s, 1);
  }

  dispose() {
    this._mesh.geometry.dispose();
    this._material.map?.dispose?.();
    this._material.dispose();
  }

  _rebake() {
    const old = this._material.map;
    this._material.map = this._bakeIcon(this._count ?? 0, this._hovered);
    this._material.needsUpdate = true;
    old?.dispose?.();
  }
}

// 缺省 icon 烘焙：深底淡蓝描边圆角片 + 叠卡 glyph（后两张描边、前一张实底）+ 张数
function defaultBakeIcon(count, hovered) {
  if (typeof document === 'undefined') {
    const texture = new THREE.Texture({ width: 1, height: 1 });
    texture.needsUpdate = true;
    return { texture };
  }
  const P = hovered ? PALETTE.hover : PALETTE.normal;
  const scale = 2;
  const { width: W, height: H } = ICON_LAYOUT;
  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  const roundRect = (x, y, w, h, r) => {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  // 底片（按钮语言：深底 + 淡蓝细描边，hover 抬亮）
  roundRect(0, 0, W, H, 10);
  ctx.fillStyle = P.bg;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = P.border;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = P.label;
  ctx.font = '15px sans-serif';
  ctx.fillText('卡组', W / 2, 18);

  // 叠卡 glyph：三张错位卡（后两张只描边、前一张实底 + 亮缘）
  const cw = 34, ch = 44;
  const cardAt = (x, y, filled) => {
    roundRect(x, y, cw, ch, 5);
    if (filled) {
      ctx.fillStyle = P.card;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = P.cardEdge;
      ctx.stroke();
    } else {
      ctx.lineWidth = 2;
      ctx.strokeStyle = P.border;
      ctx.stroke();
    }
  };
  cardAt(25, 66, false);
  cardAt(31, 60, false);
  cardAt(37, 54, true);

  // 张数（前卡中心）
  ctx.fillStyle = P.count;
  ctx.font = 'bold 25px sans-serif';
  ctx.fillText(String(count ?? 0), 37 + cw / 2, 54 + ch / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return { texture };
}
