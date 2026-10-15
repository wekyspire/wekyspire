// TowerRulerObject：本章楼层刻度条（塔左缘、楼层牌右侧，Three.js uiScene）。
// 只列**本章** 11 层（含 Boss 层）：楼层 1 在下、章节末 Boss 在上；刻度长短表楼层语义：
//   普通层 = 短刻度（白灰）；每 5 层 = 中档；精英层 = 橙；Boss 层 = 最长 + 敌人红（语义色）；
//   当前层 = 最长 HDR 白刻度（起辉）。
// 房型 = 线头符号通道（房间表开局按种子定死，见 runFlow.buildRoomTable）：房层刻度左尖端
//   挂小符号（◆老虎机 / ?事件 / ▲营地&训练场 / ■商店 / ★古尔帕斯），随线尖缩放/滚动跟随；
//   hover 冒泡报真实房型。
// 滚动形式：条带窗口半高 WIN_H，滚轮/换层驱动 scroll（楼层单位的平滑游标）——
//   换层自动回中当前层；滚轮在本章内浏览。刻度随 |距窗口中心| 边缘渐隐。
// 交互：指针靠近标尺竖带 → 本章全部刻度弱显示（一览全章格局）；带内指针附近刻度
//   按距离 smooth-zoomin；hover 单根 → 强化 + 左侧冒泡框（Three 层烘焙件）报该层房型。
// 跨层亮浪（同章内 arriveFloor 同拍）保留：亮头骑 scroll 游标，爬升 tween 途经即亮。
import * as THREE from 'three';
import gsap from 'gsap';
import { isBossFloor, isPreBossFloor, isTrainingFloor, FLOORS_PER_CHAPTER } from '../../core/run/runFlow.js';
import { isEliteFloor } from '../../core/run/floorEnemyGenerator.js';
import { isShopFloor } from '../../core/run/rooms/shop.js';
import { GURPAS_FLOOR } from '../../core/run/rooms/gurpas.js';
import { UI_FONT, UI_FONT_BODY } from '../richtext/uiFont.js';
import { lerp } from 'three/src/math/MathUtils.js';

const LEN = { normal: 2.0, mid: 3.2, boss: 4.6, current: 6.2 };   // 刻度长（wu）
const COL = { normal: 0xc4c4c4, mid: 0xdcdcdc, boss: 0xe85a5a, elite: 0xeda24e, current: 0xf2f2f2 };
// 当前层 HDR 基色（分量略过 bloom 阈值 1.45 起辉——uiScene 终段过 bloom 链；无辉光档退化为纯白）
const COL_CURRENT_HDR = [1.62, 1.78, 2.24];
const TICK_H = 0.4;              // 刻度线粗（wu；雪地背景上再细就消失）
const TICK_PLANE_H = TICK_H * 4;  // 刻度面片高（纹理上方是线、下方挂软阴影）
const OPACITY = { idle: 0.72, hover: 0.95, current: 0.98 };
const SPACING = 3.3;              // 刻度纵向间距（wu）
const WIN_H = 11;                 // 条带窗口半高（wu）：|局部 y| 超出即隐，边缘带渐隐
const EDGE_FADE = 2.4;            // 窗口边缘的渐隐带宽
// 指针临近：横向上只在刻度列附近生效（局部 x），纵向上 radius 内按距离平滑推放大
const PROX = { radius: 4.5, xIn: -16, xOut: 6, len: 0.55, speed: 12 };
// 总览（指针靠近标尺竖带）：本章全部刻度弱显示。竖带半高覆盖本章最大伸展（10 层 × 3.3wu），
//  hovered 根强化走既有 hov 通道；glyph 给独立下限（符号是总览的信息主体，线体可以比它弱）
const OVERVIEW = { v: 0.5, glyph: 0.62, yIn: 35, speed: 5 };
const UI_PX_PER_WU = 7.2;         // uiScene 100wu = 720p 视口高（烘焙 px → wu 换算）

const _smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 刻度纹理（共享烘焙）：白线 + 线下软阴影——白刻度在雪地上靠这团影衬出
let _tickTex = null;
function tickTexture() {
  if (_tickTex || typeof document === 'undefined') return _tickTex;
  const c = document.createElement('canvas');
  c.width = 32; c.height = 24;
  const g = c.getContext('2d');
  g.shadowColor = 'rgba(6,8,14,0.9)';
  g.shadowBlur = 5;
  g.shadowOffsetY = 2.5;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 7, 32, 6);
  _tickTex = new THREE.CanvasTexture(c);
  _tickTex.colorSpace = THREE.SRGBColorSpace;
  return _tickTex;
}

// —— 房型线头装饰（房间表开局定死后，自由层房型对玩家可见 = 路径级战略信息）——
// 房层刻度左尖端挂一个小符号（线体保持素线）：小尺寸下**几何形**最易分辨，
// 五形谱 = ◆老虎机（牌花色）/ ?事件 / ▲营地&训练场（帐篷）/ ■商店（货箱）/ ★古尔帕斯。
// 与颜色通道正交（Boss 红/精英橙/当前层 HDR 照旧），透明底共享烘焙、随刻度色同步。
const GLYPH_GAP = 0.35;         // 符号与线尖的间隙（wu）
const GLYPH_DEF = {             // wu = 符号面片边长（按视觉重量配平；刻度间距 3.3wu 内不打架）
  slot: { draw: 'diamond', wu: 2.15 },
  event: { draw: 'question', wu: 2.25 },
  campTraining: { draw: 'triangle', wu: 2.15 },
  shop: { draw: 'square', wu: 2.05 },
  gurpas: { draw: 'star', wu: 2.30 },
};
const _glyphTexCache = new Map();
function glyphTexture(kind) {
  if (_glyphTexCache.has(kind)) return _glyphTexCache.get(kind);
  const S = 64, c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  g.shadowColor = 'rgba(6,8,14,0.9)';
  g.shadowBlur = 6;
  g.shadowOffsetY = 2.5;
  g.fillStyle = '#ffffff';
  const m = S / 2, r = S * 0.30;
  switch (GLYPH_DEF[kind]?.draw) {
    case 'diamond':
      g.beginPath();
      g.moveTo(m, m - r); g.lineTo(m + r * 0.78, m); g.lineTo(m, m + r); g.lineTo(m - r * 0.78, m);
      g.closePath(); g.fill(); break;
    case 'triangle':
      g.beginPath();
      g.moveTo(m, m - r * 0.9); g.lineTo(m + r, m + r * 0.62); g.lineTo(m - r, m + r * 0.62);
      g.closePath(); g.fill(); break;
    case 'square':
      g.beginPath(); g.roundRect(m - r * 0.82, m - r * 0.82, r * 1.64, r * 1.64, 3); g.fill(); break;
    case 'star': {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
        g[i ? 'lineTo' : 'moveTo'](m + Math.cos(a) * rr, m + Math.sin(a) * rr);
      }
      g.closePath(); g.fill(); break;
    }
    case 'question':
      g.font = `700 ${Math.round(S * 0.62)}px ${UI_FONT}`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('?', m, m + S * 0.03); break;
    default: break;
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  _glyphTexCache.set(kind, tex);
  return tex;
}

export class TowerRulerObject extends THREE.Group {
  constructor({ picker = null } = {}) {
    super();
    this.name = 'towerRuler';
    this._picker = picker;
    this._pickIds = [];
    this._floor = 1;
    this._total = 44;
    this._chapter = -1;           // 当前章（0 起；变章重建刻度）
    this._ticks = [];             // { mesh, hit, floor, baseLen, len, zoom, bright, brightT, op }
    this._sweep = null;           // { from, to, head } 跨层亮浪（head 骑 scroll 游标）
    this._hoverFloor = null;
    this._pointer = null;         // 指针的 UI 世界坐标（null = 不在图上/被模态吞掉）
    this._overview = 0;           // 总览包络（0..1 平滑）：指针在标尺竖带内 → 全章弱显示
    this._scroll = 1;             // 窗口中心（楼层单位，平滑）
    this._scrollT = 1;            // 窗口中心目标（换层回中 / 滚轮浏览）
    this._anchorT = null;         // 条带锚点目标（UI 世界坐标，宿主每帧喂）
    this._roomTable = null;       // 塔楼房间表（run.roomTable，宿主推入）：房型花纹 + 冒泡房型的数据源
    // 冒泡框（hover 层房型）：右缘中心为原点——pop 时从刻度尖向左长出
    this._bubbleGeo = new THREE.PlaneGeometry(1, 1);
    this._bubbleGeo.translate(-0.5, 0, 0);
    this._bubbleMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
    this._bubble = new THREE.Mesh(this._bubbleGeo, this._bubbleMat);
    this._bubble.visible = false;
    this._bubble.position.z = 1.2;
    this._bubbleFx = { k: 0 };    // pop 包络（gsap）
    this._bubbleKey = null;
    this._bubbleSize = { w: 1, h: 1, tail: 1 };
    this.add(this._bubble);
    this._geo = new THREE.PlaneGeometry(1, 1);   // 共享几何（长度走 scale.x）
    this.position.z = 6;
  }

  /** 本章楼层区间 [lo, hi]（末章可能不满一章）。 */
  _chapterRange() {
    const lo = this._chapter * FLOORS_PER_CHAPTER + 1;
    return [lo, Math.min(lo + FLOORS_PER_CHAPTER - 1, this._total)];
  }

  /** 换/脱拾取器（舞台 attachInput/detachInput 时注入；重登记当前刻度）。 */
  attachPicker(picker) {
    for (const id of this._pickIds) this._picker?.removePickable(id);
    this._pickIds = [];
    this._picker = picker ?? null;
    if (this._picker) {
      for (const t of this._ticks) this._register(t);
    }
    return this;
  }

  _register(t) {
    const pid = `ruler:${t.floor}`;
    t.hit.userData.rulerFloor = t.floor;
    this._picker.addPickable(pid, t.hit, { kind: 'row', space: 'ui' });
    this._pickIds.push(pid);
  }

  /** 刻度局部 y（条带窗口中心为 0）：scroll 以楼层单位滑动。 */
  _yOf(f) { return (f - this._scroll) * SPACING; }

  _baseLenOf(f) { return isBossFloor(f) ? LEN.boss : (f % 5 === 0 ? LEN.mid : LEN.normal); }
  // 精英层（章内 6/9）橙色——与每 5 层中档/Boss 层无交集（isEliteFloor 口径），次序随便
  _colOf(f) { return isBossFloor(f) ? COL.boss : (isEliteFloor(f) ? COL.elite : (f % 5 === 0 ? COL.mid : COL.normal)); }

  /**
   * 房间表推入（宿主编排器喂；表变即重建刻度换花纹——表静态，一局只推一两次）。
   * 冒泡的房型文案也读表，置空 key 强制下次 hover 重烘。
   */
  setRoomTable(table) {
    this._roomTable = table ?? null;
    this._bubbleKey = null;
    if (this._ticks.length) this._build();
  }

  /** 本章刻度全量重建（变章/首建/总数变/房间表变）。 */
  _build() {
    for (const t of this._ticks) {
      this.remove(t.mesh, t.hit);
      t.mesh.material.dispose();
      t.hit.material.dispose();
      if (t.glyph) { this.remove(t.glyph); t.glyph.material.dispose(); } // 符号纹理是共享烘焙，只弃材质
    }
    this._ticks = [];
    for (const id of this._pickIds) this._picker?.removePickable(id);
    this._pickIds = [];
    const [lo, hi] = this._chapterRange();
    for (let f = lo; f <= hi; f++) {
      const room = this._roomTable?.[f] ?? null;
      const mat = new THREE.MeshBasicMaterial({
        map: tickTexture(), color: this._colOf(f), transparent: true, opacity: 0, depthWrite: false,
      });
      const mesh = new THREE.Mesh(this._geo, mat);
      const len = this._baseLenOf(f);
      // 刻度向右缘对齐（漂浮短线从右缘往左伸出）；面片中心上移一点让**线**（纹理上部）对准层位
      mesh.scale.set(len, TICK_PLANE_H, 1);
      mesh.position.set(-len / 2, this._yOf(f) + TICK_PLANE_H * (1 / 12), 0);
      this.add(mesh);
      // 加高加宽的隐形拾取带：可见线只有 ~2px 高，直接 pick 它太抠手
      const hit = new THREE.Mesh(
        this._geo,
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      );
      const hitW = LEN.current + 2.4;
      hit.scale.set(hitW, SPACING * 0.72, 1);
      hit.position.set(-hitW / 2 + 0.9, this._yOf(f), -0.5);
      this.add(hit);
      // 房层线头符号：独立小面片挂线尖（位置/明度逐帧随刻度同步，见 update）
      let glyph = null;
      if (room && GLYPH_DEF[room]) {
        glyph = new THREE.Mesh(
          this._geo,
          new THREE.MeshBasicMaterial({
            map: glyphTexture(room), color: this._colOf(f),
            transparent: true, opacity: 0, depthWrite: false,
          }),
        );
        const s = GLYPH_DEF[room].wu;
        glyph.scale.set(s, s, 1);
        glyph.position.set(-len - GLYPH_GAP - s / 2, mesh.position.y, 0.1);
        glyph.visible = false;
        this.add(glyph);
      }
      const entry = { mesh, hit, glyph, floor: f, baseLen: len, len, zoom: 0, bright: 0, brightT: 0, op: 0 };
      this._ticks.push(entry);
      if (this._picker) this._register(entry);
    }
  }

  /**
   * 楼层推进：同章 animate=true 时从旧层扫亮浪到新层（arriveFloor 爬升同拍）；
   * 变章重建刻度并直落滚动位（跨章不播亮浪）。换层一律回中当前层（滚轮浏览态让位）。
   * defer = 爬升待播（战后换台先把塔摆到新层、相机还在旧层）：呈现按兵不动，
   *   当前层/亮浪/回中全留给 arriveFloor 的 animate 拍——静默预推进会吃掉亮浪
   *   （floor 已等 → animate 拍早退），且预收敛的 scroll 撞上爬升 tween 的绝对
   *   驱动 = 全条带瞬移跳变。变章重建不受 defer 约束（内容换了
   *   必须重排），但 scroll/当前层同样留给 animate 拍。
   */
  setFloor(floor, totalFloors, { animate = false, defer = false } = {}) {
    floor = Math.max(1, floor ?? 1);
    if (totalFloors && totalFloors !== this._total) this._total = totalFloors;
    const ch = Math.floor((floor - 1) / FLOORS_PER_CHAPTER);
    if (ch !== this._chapter || !this._ticks.length) {
      this._chapter = ch;
      this._build();
      if (!defer) {
        this._scroll = this._scrollT = floor;
        this._sweep = null;
        this._floor = floor;
      }
      return;
    }
    if (floor === this._floor) return;
    if (defer) return;
    if (animate) {
      this._sweep = { from: this._floor, to: floor, head: this._floor };
      this._floor = floor;
      this._scrollT = floor;   // scroll 由爬升 tween 逐帧直写（无 tween 兜底路径靠 dt·8 收敛）
    } else {
      // 直落（调试跳层/读档，走 snapCameraToFloor 核销）：无过渡
      this._floor = floor;
      this._scroll = this._scrollT = floor;
    }
  }

  /** hover 命中（MapStage 转发；null = 离开）。 */
  setHover(floor) {
    if (floor === this._hoverFloor) return;
    this._hoverFloor = floor;
    if (floor == null) this._hideBubble();
    else this._showBubble(floor);
  }

  /** 指针位置（UI 世界坐标；null = 移出/被模态吞掉）——附近刻度 smooth-zoomin 的驱动源。 */
  setPointer(pt) {
    this._pointer = pt ? { x: pt.x, y: pt.y } : null;
  }

  /** 滚轮浏览（宿主转发；指针悬在条带竖带内才生效）：本章区间内步进一页游标。 */
  addWheel(deltaY) {
    const [lo, hi] = this._chapterRange();
    this._scrollT = Math.min(hi, Math.max(lo, this._scrollT + Math.sign(deltaY)));
  }

  /** 滚动游标直写（爬升补间逐帧喂——当前值与目标同写，帧内平滑 lerp 自然空转）。 */
  setScrollFloat(v) {
    this._scroll = this._scrollT = v;
  }

  /** 指针（UI 世界坐标）是否落在条带竖带内（滚轮门控用）。 */
  containsPoint(pt) {
    const lx = pt.x - this.position.x, ly = pt.y - this.position.y;
    return lx > PROX.xIn && lx < PROX.xOut + 2 && Math.abs(ly) < WIN_H + 2;
  }

  /** 条带锚点（UI 世界坐标：塔左缘投影位，宿主每帧喂）——平滑跟随，首帧直落。 */
  setAnchor(x, y) {
    if (!this._anchorT) {
      this._anchorT = { x, y };
      this.position.set(x, y, this.position.z);
      return;
    }
    this._anchorT.x = x;
    this._anchorT.y = y;
  }

  /** 命中id → 楼层（Picker 的 pickId 是 `ruler:<f>`）。 */
  static floorOfPickId(id) {
    const m = /^ruler:(\d+)$/.exec(id ?? '');
    return m ? Number(m[1]) : null;
  }

  /** 该层房型的一句话描述（冒泡框第二行）。战斗语义优先（Boss/精英配色归它们）；
   *  其余层报房间表的真实房型（开局定死）；无表（旧档/直建舞台）退回到层随机推断口径。 */
  _descOf(f) {
    if (isBossFloor(f)) return { text: 'Boss', tint: '#e86a6a' };
    if (isEliteFloor(f)) return { text: '精英战斗', tint: '#eda24e' };
    const room = this._roomTable?.[f];
    if (room === 'campTraining') return { text: '营地 & 训练场', tint: '#a8c6e8' };
    if (room === 'gurpas') return { text: '古尔帕斯之店', tint: '#a8c6e8' };
    if (room === 'shop') return { text: '商店', tint: '#a8c6e8' };
    if (room === 'slot') return { text: '老虎机', tint: '#e8c86a' };
    if (room === 'event') return { text: '事件', tint: '#a8c6e8' };
    if (isPreBossFloor(f) || isTrainingFloor(f)) return { text: '营地 & 训练场', tint: '#a8c6e8' };
    if (f === GURPAS_FLOOR) return { text: '古尔帕斯之店', tint: '#a8c6e8' };
    if (isShopFloor(f)) return { text: '商店', tint: '#a8c6e8' };
    return { text: '事件 或 老虎机', tint: '#8f9bb0' };
  }

  /** 冒泡框烘焙：深底扁平框 + 右侧小尾巴 + 两行（层号 / 房型）。整框一张纹理。 */
  _bakeBubble(f) {
    const key = `${f}:${f === this._floor ? 1 : 0}`;
    if (key === this._bubbleKey) return;
    this._bubbleKey = key;
    const S = 3, pad = 9, gap = 4, tailW = 7, tailH = 11;
    const l1 = `第 ${f} 层`;
    const { text: l2, tint } = this._descOf(f);
    const c = document.createElement('canvas');
    const g = c.getContext('2d');
    const f1 = `${14}px ${UI_FONT}`, f2 = `${11.5}px ${UI_FONT_BODY}`;
    g.font = f1; const w1 = g.measureText(l1).width;
    g.font = f2; const w2 = g.measureText(l2).width;
    const W = Math.ceil(Math.max(w1, w2)) + pad * 2 + tailW;
    const H = Math.ceil(pad * 2 + 14 + gap + 11.5);
    c.width = W * S; c.height = H * S;
    g.scale(S, S);
    const bw = W - tailW;
    g.beginPath();
    g.roundRect(0.5, 0.5, bw - 1, H - 1, 3);
    g.moveTo(bw - 1, H / 2 - tailH / 2);
    g.lineTo(W - 0.5, H / 2);
    g.lineTo(bw - 1, H / 2 + tailH / 2);
    g.closePath();
    g.fillStyle = 'rgba(9,13,20,0.85)';
    g.fill();
    g.strokeStyle = 'rgba(168,198,255,0.4)';
    g.lineWidth = 1;
    g.stroke();
    g.textBaseline = 'alphabetic';
    g.font = f1;
    g.fillStyle = '#f2f2f2';
    g.fillText(l1, pad, pad + 14 * 0.82);
    g.font = f2;
    g.fillStyle = tint;
    g.fillText(l2, pad, pad + 14 + gap + 11.5 * 0.82);
    const old = this._bubbleMat.map;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this._bubbleMat.map = tex;
    this._bubbleMat.needsUpdate = true;
    old?.dispose?.();
    this._bubbleSize = { w: W / UI_PX_PER_WU, h: H / UI_PX_PER_WU, tail: tailW / UI_PX_PER_WU };
  }

  _showBubble(f) {
    this._bakeBubble(f);
    this._bubble.visible = true;
    this._placeBubble();
    gsap.to(this._bubbleFx, { k: 1, duration: 0.3, ease: 'back.out(1.8)', overwrite: 'auto' });
  }

  _hideBubble() {
    gsap.to(this._bubbleFx, {
      k: 0, duration: 0.14, ease: 'power1.in', overwrite: 'auto',
      onComplete: () => { if (this._bubbleFx.k === 0) this._bubble.visible = false; },
    });
  }

  /** 冒泡框位置：尾巴尖贴上 hover 刻度的**当前**（动画中的）线尖。 */
  _placeBubble() {
    const t = this._ticks.find(tk => tk.floor === this._hoverFloor);
    if (!t) return;
    this._bubble.position.set(-t.len - this._bubbleSize.tail - 0.45, this._yOf(this._hoverFloor), 1.2);
  }

  update(dt) {
    // 锚点平滑（塔左缘投影随相机/视差微动）
    if (this._anchorT) {
      this.position.x += (this._anchorT.x - this.position.x) * Math.min(1, dt * 10);
      this.position.y += (this._anchorT.y - this.position.y) * Math.min(1, dt * 10);
    }
    // 滚动游标平滑
    this._scroll += (this._scrollT - this._scroll) * Math.min(1, dt * 8);
    // 亮浪：head 骑 scroll 游标（爬升 tween 逐帧直写）——途经层随相机点亮，落定那拍
    // 目标层触发抵达闪光（head 若按固定速度自跑会与相机脱节：单层爬升开场即闪完）
    var currFloorSoft = this._floor;
    if (this._sweep) {
      const s = this._sweep;
      const dir = Math.sign(s.to - s.from) || 1;
      const lo = Math.min(s.from, s.to), hi = Math.max(s.from, s.to);
      s.head = Math.max(lo, Math.min(hi, this._scroll));
      // currFloorSoft：随相机推进的浮点楼层数，负责柔和的攀升动画
      currFloorSoft = s.head;
      const arrived = dir > 0 ? s.head >= s.to - 0.02 : s.head <= s.to + 0.02;
      // 落定帧目标层视同已过（arrived 的 epsilon 比「head 爬到 to」早两帧，不补吃不到脉冲）
      const headEff = arrived ? s.to : s.head;
      for (const t of this._ticks) {
        const passed = dir > 0
          ? (t.floor > s.from && t.floor <= Math.min(headEff, s.to))
          : (t.floor < s.from && t.floor >= Math.max(headEff, s.to));
        if (passed && t.brightT < 1) t.brightT = Math.max(t.brightT, 1);
      }
      if (arrived) this._sweep = null;
    }
    // 指针临近放大：只在刻度列横向邻域内生效，纵向按距离平滑衰减
    const p = this._pointer;
    const near = !!p
      && p.x - this.position.x > PROX.xIn && p.x - this.position.x < PROX.xOut
      && Math.abs(p.y - this.position.y) < WIN_H + 3;
    // 总览包络：同一横向竖带、纵向放宽到全章伸展范围——带内即弱显示本章全部刻度
    const ovT = (p && p.x - this.position.x > PROX.xIn && p.x - this.position.x < PROX.xOut
      && Math.abs(p.y - this.position.y) < OVERVIEW.yIn) ? 1 : 0;
    this._overview += (ovT - this._overview) * Math.min(1, dt * OVERVIEW.speed);
    for (const t of this._ticks) {
      const ty = this._yOf(t.floor);
      let zoomT = 0;
      if (near) {
        const k = Math.max(0, 1 - Math.abs(p.y - this.position.y - ty) / PROX.radius);
        zoomT = k * k * (3 - 2 * k);
      }
      t.zoom += (zoomT - t.zoom) * Math.min(1, dt * PROX.speed);
      const curT0 = Math.min(Math.abs(currFloorSoft - t.floor), 1.0);
      const curT = curT0 * curT0 * (3 - 2 * curT0);
      const hov = t.floor === this._hoverFloor;
      const grown = t.baseLen * (1 + PROX.len * t.zoom + (hov ? 0.45 : 0));
      const curLenTMin = lerp(LEN.current, t.baseLen, curT);
      const lenT = Math.max(curLenTMin, grown);
      t.len += (lenT - t.len) * Math.min(1, dt * 10);
      if (Math.abs(t.len - t.mesh.scale.x) > 0.005) {
        t.mesh.scale.x = t.len;
        t.mesh.position.x = -t.len / 2;
      }
      // 位置随滚动游标（每帧——滚动是连续量）
      const y = ty + TICK_PLANE_H * (1 / 12);
      if (Math.abs(y - t.mesh.position.y) > 0.001) t.mesh.position.y = y;
      if (Math.abs(ty - t.hit.position.y) > 0.001) t.hit.position.y = ty;
      // 明度合成：窗口边缘渐隐是基础包络；总览包络把全章刻度抬到弱显示下限；
      // 指针临近局部抬起；当前层保底可读（浏览态仍认得自己在哪）；hover 单根最强
      const edge = 1 - _smooth(WIN_H - EDGE_FADE, WIN_H, Math.abs(ty));
      let v = Math.max(edge, t.zoom * edge, this._overview * OVERVIEW.v);
      v = Math.max(v, lerp(0.6, 0, curT));  // 当前层的明度包络（越接近当前层下限越亮）
      if (hov) v = Math.max(v, 0.95);
      const curMinOpacity = lerp(OPACITY.current, OPACITY.idle, curT);
      const opT = Math.min(1, v) * Math.max(curMinOpacity, hov ? OPACITY.hover : OPACITY.idle);
      if (Math.abs(opT - t.op) > 0.002) {
        t.op += (opT - t.op) * Math.min(1, dt * 12);
        t.mesh.material.opacity = t.op;
      }
      t.mesh.visible = t.op > 0.003;
      // 亮度脉冲（亮浪途经）
      if (t.brightT > 0) {
        t.bright += (1 - t.bright) * Math.min(1, dt * 18);
        t.brightT = Math.max(0, t.brightT - dt * 1.4);
      } else if (t.bright > 0) {
        t.bright = Math.max(0, t.bright - dt * 2.2);
      }
      const cur = curT < 0.5;
      if (cur) {
        // 当前层：HDR 白（略过 bloom 阈值起辉）；亮浪途经再按 bright 加亮
        const c = t.mesh.material.color;
        c.setRGB(COL_CURRENT_HDR[0], COL_CURRENT_HDR[1], COL_CURRENT_HDR[2]);
        if (t.bright > 0.003) c.multiplyScalar(1 + t.bright * 0.9);
      } else if (t.bright > 0.003) {
        const base = new THREE.Color(this._colOf(t.floor));
        const white = new THREE.Color(0xffffff);
        t.mesh.material.color.copy(base).lerp(white, t.bright * 0.85);
      } else {
        t.mesh.material.color.set(this._colOf(t.floor));
      }
      // 线头符号逐帧跟随：线尖位置 + 明度 + 色（HDR/亮浪与线体同源）；
      // 总览下符号给独立下限——房型符号是总览的信息主体，线体可以比它弱
      if (t.glyph) {
        t.glyph.position.x = -t.len - GLYPH_GAP - t.glyph.scale.x / 2;
        t.glyph.position.y = t.mesh.position.y + TICK_PLANE_H / 12; // 对齐线体（纹理上部）
        t.glyph.material.opacity = Math.max(t.op, this._overview * OVERVIEW.glyph);
        t.glyph.material.color.copy(t.mesh.material.color);
        t.glyph.visible = t.mesh.visible;
      }
    }
    // 冒泡框：pop 包络 → 缩放/透明度；跟随 hover 刻度线尖
    if (this._bubble.visible) {
      const k = this._bubbleFx.k;
      const s = 0.85 + 0.15 * k;
      this._bubble.scale.set(this._bubbleSize.w * s, this._bubbleSize.h * s, 1);
      this._bubbleMat.opacity = k;
      this._placeBubble();
    }
  }

  dispose() {
    for (const id of this._pickIds) this._picker?.removePickable(id);
    this._pickIds = [];
    gsap.killTweensOf(this._bubbleFx);
    for (const t of this._ticks) {
      this.remove(t.mesh, t.hit);
      t.mesh.material.dispose();
      t.hit.material.dispose();
      if (t.glyph) { this.remove(t.glyph); t.glyph.material.dispose(); }
    }
    this._ticks = [];
    this._geo.dispose();
    this._bubbleGeo.dispose();
    this._bubbleMat.map?.dispose?.();
    this._bubbleMat.dispose();
  }
}
