// CardGalleryObject：区域查看器（牌库卡列表的全屏画廊）。
// 「查看 = 战斗同一套卡牌栈」：渲染复用 CardObject（同烘焙管线同卡面），
// 交互复用 Picker——卡注册为 kind:'card' 并携带 cardObject 引用，
// 富文本 token 热区 → tooltip:*、整卡 → CARD_HOVER/LEAVE，与手牌完全同协议。
// 本类只补画廊特有的模式层：模态背板 / 标题行 / 自适应网格 / 悬浮抬升；
// 关闭判定（点非卡区域）由宿主 BattleStage 做，本类提供 ownsHit 查询。

import * as THREE from 'three';
import { CardObject } from './CardObject.js';
import { bakeBoldText } from './textBakers.js';
import { WORLD_HEIGHT, UI_CAMERA_LOOK_AT_Y } from '../StageManager.js';

const HALF_UI_W = ((WORLD_HEIGHT * 16) / 9) / 2; // UI pass 固定 16:9 取景（与 PlayerStatusObject 同推导）
const UI_TOP = UI_CAMERA_LOOK_AT_Y + WORLD_HEIGHT / 2;
const UI_BOTTOM = UI_CAMERA_LOOK_AT_Y - WORLD_HEIGHT / 2;

const BG_Z = 80;   // 模态层深度：高于手牌扇（静息 z≤15）、图标（z=5）、状态栏（z=6）
const CARD_Z = BG_Z + 1;

// 网格安全带：上让标题行、下让提示行；列数穷举取"能放的最大卡"
const GRID = { top: 29, bottom: -47, gapX: 2, gapY: 2.5, scaleMax: 0.72, marginX: 8 };
// 悬浮抬升：正交相机下 z 不放大只压层，视觉放大全靠 scale；liftY 让邻卡错开一点
const HOVER = { scale: 1.25, liftY: 2, liftZ: 5, rate: 10 };

const CARD_ID = (uniqueID) => `viewer:${uniqueID}`;
const BG_ID = 'viewer:bg';

export class CardGalleryObject extends THREE.Group {
  /**
   * @param {object} options
   *   cardWidth/cardHeight: 卡面世界尺寸（与战场同参传入）
   *   bakeFace: 卡面烘焙（与战场同一函数，卡面/热区所见即所得）
   *   picker:   拾取器（卡/背板注册进同一拾取协议；可不传=纯展示）
   *   bakeText: 标题烘焙 (text, {fontPx, tint}) => {texture,width,height}，缺省 bakeBoldText
   */
  constructor({ cardWidth, cardHeight, bakeFace, picker = null, bakeText = null } = {}) {
    super();
    this._cardWidth = cardWidth;
    this._cardHeight = cardHeight;
    this._bakeFace = bakeFace;
    this._picker = picker;
    this._bakeText = bakeText || defaultBakeText;
    this._entries = [];      // { id, obj, x, y, baseScale, hovered, t }
    this._texts = [];        // 标题/副标题/提示面片
    this._bg = null;
    this._opened = false;
    this.zone = null;
  }

  get opened() { return this._opened; }
  get count() { return this._entries.length; }
  get cards() { return [...this._entries]; }

  /**
   * 打开画廊（幂等：先清场）。
   * @param {Array} cards 卡牌投影列表（顺序即展示顺序：行优先、行内居中）
   * @param {object} opts  zone: 归属区域名（宿主语义透传） / title / subtitle / hint
   */
  open(cards, { zone = null, title = '', subtitle = '', hint = '点击空白处关闭' } = {}) {
    this.close();
    this._opened = true;
    this.zone = zone;

    // 模态背板：盖满整条取景带（含底部手牌区——旧版只盖 -50~50，手牌扇从背板下露出）
    this._bg = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF_UI_W * 2, WORLD_HEIGHT),
      new THREE.MeshBasicMaterial({ color: 0x0a0b10, transparent: true, opacity: 0.86 }),
    );
    this._bg.position.set(0, UI_CAMERA_LOOK_AT_Y, BG_Z);
    this.add(this._bg);
    this._picker?.addPickable(BG_ID, this._bg, { kind: 'viewer', space: 'ui' });

    if (title) {
      this._addText(title, { fontPx: 26, tint: '#f2f4fa', y: 31.5 });
      this._addText(subtitle, { fontPx: 14, tint: '#9aa3b8', y: 27.5 });
    }
    this._addText(hint, { fontPx: 13, tint: '#77809a', y: UI_BOTTOM + 2.6 });

    const list = cards ?? [];
    if (!list.length) return;
    const { cols, scale } = this._layoutGrid(list.length);
    const stepX = this._cardWidth * scale + GRID.gapX;
    const stepY = this._cardHeight * scale + GRID.gapY;
    const rows = Math.ceil(list.length / cols);
    const gridH = rows * this._cardHeight * scale + (rows - 1) * GRID.gapY;
    const centerY = (GRID.top + GRID.bottom) / 2;
    list.forEach((cardProj, i) => {
      const row = Math.floor(i / cols);
      const rowCount = Math.min(cols, list.length - row * cols); // 行内居中（末行短行）
      const x = (i % cols - (rowCount - 1) / 2) * stepX;
      const y = centerY + gridH / 2 - this._cardHeight * scale / 2 - row * stepY;
      const obj = new CardObject({
        uniqueID: CARD_ID(cardProj.uniqueID),
        cardWidth: this._cardWidth, cardHeight: this._cardHeight,
        bakeFace: this._bakeFace,
      });
      obj.setCard(cardProj);
      const entry = { id: CARD_ID(cardProj.uniqueID), obj, x, y, baseScale: scale, hovered: false, t: 0 };
      obj.position.set(x, y, CARD_Z);
      obj.scale.set(scale, scale, 1);
      this.add(obj);
      this._entries.push(entry);
      // 与手牌同协议：kind 'card' + cardObject 引用 → token 热区 tooltip / 整卡 hover
      this._picker?.addPickable(entry.id, obj, { kind: 'card', cardObject: obj, space: 'ui' });
    });
  }

  /** 关闭并清理全部子对象与 pickable（幂等）。 */
  close() {
    if (!this._opened) return;
    this._opened = false;
    this.zone = null;
    this._picker?.removePickable(BG_ID);
    for (const e of this._entries) {
      this._picker?.removePickable(e.id);
      this.remove(e.obj);
      e.obj.dispose();
    }
    this._entries = [];
    for (const t of this._texts) {
      this.remove(t);
      t.geometry.dispose();
      t.material.map?.dispose?.();
      t.material.dispose();
    }
    this._texts = [];
    this.remove(this._bg);
    this._bg.geometry.dispose();
    this._bg.material.dispose();
    this._bg = null;
  }

  /** 帧驱动：悬浮抬升包络（进入/离开平滑衔接，两端速度为零）。 */
  update(dt) {
    if (!this._opened) return;
    const k = 1 - Math.exp(-HOVER.rate * dt);
    for (const e of this._entries) {
      e.t += ((e.hovered ? 1 : 0) - e.t) * k;
      if (!e.hovered && e.t < 1e-3) e.t = 0;
      const s = e.baseScale * (1 + (HOVER.scale - 1) * e.t);
      e.obj.scale.set(s, s, 1);
      e.obj.position.set(e.x, e.y + HOVER.liftY * e.t, CARD_Z + HOVER.liftZ * e.t);
    }
  }

  /** 悬浮路由（宿主以 picker 命中结果驱动）：null = 无卡悬浮。 */
  setHovered(id) {
    for (const e of this._entries) {
      e.hovered = e.id === id;
      e.obj.setVisualState(e.hovered ? 'highlighted' : 'normal');
    }
  }

  hasCard(id) { return this._opened && this._entries.some(e => e.id === id); }

  /** 按拾取 id 取卡对象（宿主 Shift 详情切换的目标查询用）。 */
  cardObj(id) {
    const e = this._entries.find(en => en.id === id);
    return e ? e.obj : null;
  }

  /** 拾取命中是否落在画廊卡上（整卡或卡面 token）——宿主据此决定"点卡不关闭"。 */
  ownsHit(hit) {
    return this._opened && (hit?.kind === 'card' || hit?.kind === 'token')
      && this._entries.some(e => e.id === hit?.id);
  }

  /** 卡图异步到图后重烘（与战场 _rebakeCardFaces 同触发）。 */
  rebake() {
    if (!this._opened) return;
    for (const e of this._entries) {
      if (e.obj.cardData) e.obj.setCard(e.obj.cardData);
    }
  }

  /** 列数穷举：1..N 各算一个受宽高约束的最大卡，取能放最大者（并列取更早=更少列）。 */
  _layoutGrid(n) {
    const usableW = HALF_UI_W * 2 - GRID.marginX * 2;
    const usableH = GRID.top - GRID.bottom;
    let best = null;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const sW = (usableW - (cols - 1) * GRID.gapX) / (cols * this._cardWidth);
      const sH = (usableH - (rows - 1) * GRID.gapY) / (rows * this._cardHeight);
      const s = Math.min(GRID.scaleMax, sW, sH);
      if (!best || s > best.scale + 1e-4) best = { cols, scale: s };
    }
    return best ?? { cols: 1, scale: GRID.scaleMax };
  }

  _addText(text, opts) {
    if (!text) return;
    const { texture, width, height } = this._bakeText(text, { fontPx: opts.fontPx, tint: opts.tint });
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width / 10, height / 10),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true }),
    );
    mesh.position.set(0, opts.y, BG_Z + 0.5);
    this.add(mesh);
    this._texts.push(mesh);
  }
}

// 标题烘焙缺省：粗体白字+深描边（textBakers 同语言）；node 无 document 走占位尺寸
function defaultBakeText(text, { fontPx = 20, tint = '#ffffff' } = {}) {
  if (typeof document === 'undefined') {
    const texture = new THREE.Texture();
    texture.needsUpdate = true;
    return { texture, width: Math.max(1, fontPx * text.length * 0.7), height: fontPx * 1.4 };
  }
  return bakeBoldText(text, { fontPx, tint });
}
