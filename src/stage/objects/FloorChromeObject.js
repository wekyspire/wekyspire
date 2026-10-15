// FloorChromeObject：塔左缘的**常驻逐层楼层牌**管理器（世界空间，每层一枚 billboard 小组）。
//   每枚 = 塔钉（菱形）→ 短横 → 层号（悬空数字，描边 + 软投影）；Boss 层数字/钉/横吃敌人红。
//   显隐与缩放不排期：每帧按「相机取景高度离该层锚点几个层距」驱动——靠近 fade-in 并微微
//   zoom-in，远去 fade-out 并微微 zoom-out；一次跨多层的上楼下楼动画无需任何专门编排。
//   未登陆层（floor > 历史最高到层）经逐牌资格标量压 0（maxOpacity mask——爬升途经不提前亮相）。
//   敌人预告走单独轨道：**每层独立实例**，内容按 prep 快照的 floor 落到该层那枚牌上
//   （层牌未登陆被资格标量压着 → 新层预告落定前必不亮相——没有换父，就没有
//   「新敌人闪现旧层牌」的时序窗）。
import * as THREE from 'three';
import gsap from 'gsap';
import { isBossFloor } from '../../core/run/runFlow.js';
import { UI_FONT } from '../richtext/uiFont.js';
import { deferDisposeTexture } from '../deferredDispose.js';
import { EnemyPreviewObject } from './EnemyPreviewObject.js';
import { playFloorClearRow } from '../fx/floorClearFx.js';

const PX_PER_WU = 61;        // 塔深处屏幕换算（1280×720 下 ≈61px/wu；烘焙逻辑像素按它折世界尺寸）
const PREVIEW_SCALE = 0.078; // 敌人预告内部单位（立牌高 17）→ 本件局部单位的基准换算（行宽超预算时自适应再缩）
const TICK = { gap: 0.12, len: 0.5, thick: 0.05 };    // 塔钉 → 层号的短横
const DOT_R = 0.11;
const GAP_V = 0.30;          // 层号顶 → 预告行底（名签带下缘）的竖向间隔
// 预告行总宽预算（局部 wu）：塔左缘 → 左屏缘（1280×720 ≈ 567px）。px/wu 只随视口高度变，
// 预算按 720p 定，更高分辨率同比放大自然成立；横向更窄的窗口不在适配目标内。
const WIDTH_BUDGET = 9.3;
// 邻近可见性（单位 = 层距）：≤ full 全显，到 gone 淡出殆尽；scale 同步轻收（远去 zoom-out）
const NEAR = { full: 0.18, gone: 0.9, zoom: 0.1 };

const _smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 两端渐隐的横线（共享烘焙）
let _lineTex = null;
function lineTexture() {
  if (_lineTex || typeof document === 'undefined') return _lineTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 8;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 128, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.14, 'rgba(255,255,255,1)');
  grad.addColorStop(0.86, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 8);
  _lineTex = new THREE.CanvasTexture(c);
  _lineTex.colorSpace = THREE.SRGBColorSpace;
  return _lineTex;
}

export class FloorChromeObject extends THREE.Group {
  constructor({ unitArt = null } = {}) {
    super();
    this.name = 'floorChrome';
    this._floor = 1;           // 当前层（敌人预告挂点 + 必建锚）
    this._landed = 0;          // 登陆水位线：floor > _landed 的楼层牌整体压 0
    this._total = 44;
    this._markers = new Map(); // floor -> { group, mats..., elig, op, digitsCX, digitsTop }
    this._focusY = null;       // 相机取景高度（世界 y；宿主每帧喂）
    this._anchorFor = null;    // (floor) => {x,y,z} 世界位（宿主注入：塔局部 → 世界）
    this._gap = 7;
    this._baseY = 0;
    this._fade = { prep: 1 };  // 敌人预告通道（gsap 推标量）
    this._prepWanted = false;
    this._geoPin = new THREE.PlaneGeometry(DOT_R * 2.2, DOT_R * 2.2);
    this._geoUnit = new THREE.PlaneGeometry(1, 1);
    this._unitArt = unitArt;
    this._clearFx = null;    // 在途「楼层通过」残影演出（playClear 建；done/dispose 收）
    // 敌人预告：每层独立实例（floor → EnemyPreviewObject），内容按快照 floor 寻址；
    // 任意时刻只有内容所属层的实例有 entries（其它层清空），拾取 id 因此不撞
    this._previews = new Map();
    this._picker = null;     // 拾取器（宿主注入；转发现存/未来实例）
    // 外部转发口（MapStage 的拾取/hover 转发）：本体是多实例，这里是稳定门面
    this.preview = {
      attachPicker: (p) => this._attachPicker(p),
      setHover: (i) => { for (const [, pv] of this._previews) pv.setHover(i); },
    };
  }

  /** 宿主注入定位语境（构造后即刻；塔静态，闭包内 localToWorld 每帧安全）。 */
  configure({ anchorFor, gap, baseY, total } = {}) {
    this._anchorFor = anchorFor ?? this._anchorFor;
    if (gap) this._gap = gap;
    if (baseY != null) this._baseY = baseY;
    if (total) this._total = total;
    return this;
  }

  // ================= 楼层牌（逐层常驻）=================

  /** 懒建某层的牌（锚点世界位 + 层号烘焙；可见性交给 update 的帧驱动）。 */
  _ensureMarker(floor) {
    const had = this._markers.get(floor);
    if (had) return had;
    const boss = isBossFloor(floor);
    const mkMat = (opts) => new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false, fog: false, opacity: 0, ...opts,
    });
    const g = new THREE.Group();
    g.name = `floorMark:${floor}`;
    const pinMat = mkMat({ color: boss ? 0xe85a5a : 0xf2f2f2 });
    const pin = new THREE.Mesh(this._geoPin, pinMat);
    pin.rotation.z = Math.PI / 4;
    const tickMat = mkMat({ map: lineTexture(), color: boss ? 0xf0a0a0 : 0xffffff });
    const tick = new THREE.Mesh(this._geoUnit, tickMat);
    tick.scale.set(TICK.len, TICK.thick, 1);
    tick.position.set(-(TICK.gap + TICK.len / 2), 0, 0);
    const digitsMat = mkMat({});
    const digits = new THREE.Mesh(this._geoUnit, digitsMat);
    g.add(pin, tick, digits);
    this.add(g);
    const m = { floor, group: g, pinMat, tickMat, digitsMat, digits, elig: 0, op: 0, digitsCX: 0, digitsTop: 0 };
    this._bakeDigits(m);
    this._markers.set(floor, m);
    return m;
  }

  /** 层号烘焙：悬空「N层」横排锁（大数字 + 小「层」贴基线右）——无底板，描边 + 软投影分离空气。 */
  _bakeDigits(m) {
    // chrome 全部件不吃指数雾（塔身处雾因子 ~0.7，白字会被洗灰）——UI 语义，不做大气衰减
    const floor = m.floor;
    const boss = isBossFloor(floor);
    const S = 3, numPx = 82, unitPx = 26, pad = 22, gap = 8;
    const numeral = `${floor}`;
    let wD = 1.6, digitsH = 1.2, digitsY = 0;
    if (typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      const g = c.getContext('2d');
      g.font = `${numPx}px ${UI_FONT}`;
      const numW = g.measureText(numeral).width;
      g.font = `${unitPx}px ${UI_FONT}`;
      const unitW = g.measureText('层').width;
      const W = Math.ceil(numW + gap * 2 + unitW * 2 + pad * 2);
      const H = Math.ceil(numPx * 1.15 + pad * 2);
      c.width = W * S; c.height = H * S;
      g.scale(S, S);
      g.textBaseline = 'alphabetic';
      g.lineJoin = 'round';
      const baseline = pad + numPx * 0.82;
      const ink = boss ? '#e85a5a' : '#f2f2f2';
      const unitInk = boss ? 'rgba(232,90,90,0.85)' : 'rgba(198,205,216,0.85)';
      const outline = 'rgba(10,10,16,0.92)';
      const pass = (fill) => {
        g.font = `${unitPx}px ${UI_FONT}`;
        if (fill) g.fillStyle = unitInk; else { g.strokeStyle = outline; g.lineWidth = 5; }
        fill ? g.fillText('第', pad, baseline) : g.strokeText('层', pad , baseline);
        g.font = `${numPx}px ${UI_FONT}`;
        if (fill) g.fillStyle = ink; else { g.strokeStyle = outline; g.lineWidth = 7; }
        fill ? g.fillText(numeral, pad + unitW + gap, baseline) : g.strokeText(numeral, pad + unitW + gap, baseline);
        g.font = `${unitPx}px ${UI_FONT}`;
        if (fill) g.fillStyle = unitInk; else { g.strokeStyle = outline; g.lineWidth = 5; }
        fill ? g.fillText('层', pad + unitW + gap + numW + gap, baseline) : g.strokeText('层', pad + unitW + gap + numW + gap, baseline);
      };
      g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = 10; g.shadowOffsetY = 3;
      pass(false);
      g.shadowColor = 'rgba(0,0,0,0)'; g.shadowBlur = 0; g.shadowOffsetY = 0;
      pass(true);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      deferDisposeTexture(m.digitsMat.map);
      m.digitsMat.map = tex;
      m.digitsMat.needsUpdate = true;
      wD = W / PX_PER_WU;
      digitsH = H / PX_PER_WU;
      // 数字躯干（cap height）中心对上连线高度：cap 中心距画布顶 ≈ baseline - 0.30×字号
      digitsY = (H / 2 - (baseline - numPx * 0.30)) / PX_PER_WU;
    }
    const dRight = -(TICK.gap + TICK.len + 0.30);
    m.digits.scale.set(wD, digitsH, 1);
    m.digits.position.set(dRight - wD / 2, digitsY, 0);
    m.digitsCX = dRight - wD / 2;
    m.digitsTop = digitsY + digitsH / 2;
  }

  // ================= 对外 API =================

  /** 当前层指针（预告挂点的语义已随每层独立实例消失——这里只保必建锚）。
   *  不动登陆水位线——爬升开始即调，途经层不许提前亮相。 */
  setFloor(floor, totalFloors = null) {
    floor = Math.max(1, floor ?? 1);
    if (totalFloors && totalFloors !== this._total) this._total = totalFloors;
    this._floor = floor;
    this._ensureMarker(floor);
  }

  /** 登陆核销：水位线推进 + 该层牌必建（arriveFloor 回执 / 开机落位 / 直落路径调用）。 */
  markLanded(floor) {
    floor = Math.max(1, floor ?? 1);
    this._landed = Math.max(this._landed, floor);
    this._ensureMarker(floor);
  }

  /** prep 快照的敌人编成：按 opts.floor（快照楼层字段）落到**该层**的实例上——
   *  其它层的实例清空（旧层敌人滞留 = 闪现病灶）；层牌未建顺带必建。 */
  setEncounter(list, opts = {}) {
    const floor = Math.max(1, opts.floor ?? this._floor);
    for (const [f, pv] of this._previews) if (f !== floor) pv.setEncounter([]);
    const pv = this._previewFor(floor);
    pv.setEncounter(list, opts);
    pv.scale.setScalar(this.previewScaleFor(pv.layoutHalfWidth * 2));
    this._placePreviewInstance(floor, pv);
  }

  /** 拾取器转发（舞台 attachInput/detachInput 时注入；现存与未来实例都吃）。 */
  _attachPicker(picker) {
    this._picker = picker ?? null;
    for (const [, pv] of this._previews) pv.attachPicker(picker);
  }

  /** 某层的预告实例（懒建：内容到达才建）。 */
  _previewFor(floor) {
    let pv = this._previews.get(floor);
    if (!pv) {
      pv = new EnemyPreviewObject({ bakeText: null, unitArt: this._unitArt });
      if (this._picker) pv.attachPicker(this._picker);
      this._previews.set(floor, pv);
    }
    return pv;
  }

  /** 预告实例就位：挂到所属层的层牌下（局部偏移 = 层号正上方居中）。 */
  _placePreviewInstance(floor, pv) {
    const m = this._markers.get(floor) ?? this._ensureMarker(floor);
    if (pv.parent !== m.group) m.group.add(pv);
    const a = this.previewAnchorLocal(m, pv.scale.x);
    pv.position.set(a.x, a.y, a.z);
  }

  /** prep 段（敌人预告）显隐——淡出/淡入标量驱动（通关即收，与楼层牌显隐无耦）。 */
  setPrepVisible(on) {
    on = !!on;
    if (on === this._prepWanted) return;
    this._prepWanted = on;
    gsap.to(this._fade, { prep: on ? 1 : 0, duration: on ? 0.45 : 0.25, ease: 'power2.out', overwrite: 'auto' });
  }

  /** 预告/残影行的层牌局部锚点（层号正上方，行底让出 GAP_V）。rowScale = 行组缩放。 */
  previewAnchorLocal(m, rowScale) {
    return { x: m.digitsCX, y: m.digitsTop + GAP_V + 11.2 * rowScale, z: 0 };
  }

  /** 行宽（预告内部单位）→ 行组缩放（与 setEncounter 的预算自适应同式）。 */
  previewScaleFor(rowInternal) {
    return Math.min(PREVIEW_SCALE, (WIDTH_BUDGET - 0.5) / Math.max(rowInternal, 1));
  }

  /**
   * 楼层通过演出：刚清掉那层的敌人残影在层牌上方逐个 开裂→灰暗→崩解成灰。
   * 幂等口径：同刻只许一场（新一场顶掉旧的）。pool = 世界 GPU 池（可空 = 只演面片）。
   */
  playClear(floor, encounter, { boss = false, pool = null } = {}) {
    this.cancelClear();
    if (!encounter?.length) return null;
    const m = this._ensureMarker(floor);
    this._clearFx = playFloorClearRow({
      chrome: this, marker: m, encounter, boss, unitArt: this._unitArt, pool,
    });
    return this._clearFx;
  }

  /** 在途楼层通过演出即刻收尾（舞台退场/新一场顶入）。 */
  cancelClear() {
    this._clearFx?.dispose();
    this._clearFx = null;
  }

  /** 相机取景高度（世界 y）——邻近显隐的唯一驱动源，宿主每帧喂。 */
  setFocusY(y) { this._focusY = y; }

  update(dt, camera = null) {
    if (this._focusY != null) {
      // 可见带内的已登陆层牌必建（±1 层覆盖淡入过渡段）
      const f0 = Math.min(this._total, Math.max(1, Math.round((this._focusY - this._baseY) / this._gap + 0.5)));
      for (const f of [f0 - 1, f0, f0 + 1]) if (f >= 1 && f <= this._landed) this._ensureMarker(f);
    }
    for (const [, m] of this._markers) {
      if (this._anchorFor) {
        const a = this._anchorFor(m.floor);
        m.group.position.set(a.x, a.y, a.z);
      }
      const d = this._focusY != null ? Math.abs(this._focusY - m.group.position.y) / this._gap : 0;
      const prox = 1 - _smooth(NEAR.full, NEAR.gone, d);
      const eligT = m.floor <= this._landed ? 1 : 0;
      m.elig += (eligT - m.elig) * Math.min(1, dt * 5);   // 登陆那刻的资格淡入
      const opT = prox * m.elig;
      m.op += (opT - m.op) * Math.min(1, dt * 9);
      const vis = m.op > 0.003;
      m.group.visible = vis;
      if (!vis) continue;
      m.pinMat.opacity = m.op * 0.95;
      m.tickMat.opacity = m.op * 0.9;
      m.digitsMat.opacity = m.op;
      m.group.scale.setScalar(1 - NEAR.zoom * _smooth(0, 1, Math.min(1, d)));
      if (camera) m.group.quaternion.copy(camera.quaternion);
    }
    // 敌人预告（每层独立实例）：prep 通道整体淡出 × 所在层牌的显隐（父组不可见即整体隐去——
    // 未登陆层牌的资格标量压着 → 新层预告落定前必不亮相）
    const pe = this._fade.prep;
    for (const [, pv] of this._previews) {
      pv.visible = this._prepWanted && pe > 0.003 && pv.hasContent;
      pv.setFade(pe);
      pv.update(dt);
    }
    // 楼层通过残影（tick 容错：演出件异常就地摘除，不炸宿主帧循环）
    if (this._clearFx) {
      try {
        this._clearFx.update(dt, camera);
        if (this._clearFx.done) { this._clearFx.dispose(); this._clearFx = null; }
      } catch (e) {
        console.error('[floorChrome] 楼层通过演出异常摘除', e);
        this.cancelClear();
      }
    }
  }

  dispose() {
    gsap.killTweensOf(this._fade);
    this.cancelClear();
    for (const [, pv] of this._previews) { pv.removeFromParent(); pv.dispose(); }
    this._previews.clear();
    for (const [, m] of this._markers) {
      m.pinMat.dispose();
      m.tickMat.dispose();   // 线纹理是模块级共享烘焙，不销
      deferDisposeTexture(m.digitsMat.map);
      m.digitsMat.dispose();
      m.group.removeFromParent();
    }
    this._markers.clear();
    this._geoPin.dispose();
    this._geoUnit.dispose();
    this.removeFromParent();
  }
}
