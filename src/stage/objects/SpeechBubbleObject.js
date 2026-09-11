// SpeechBubbleObject：角色头顶的**对话泡泡 / 思索泡泡**（用户定 2026-09-11）。
//
// 用途（异步"说话/思索"）：骑士在手牌满时冒一句"我无法掌控更多手牌了！"、商店老板偶尔
// 搭话、某些敌人冒两句、瑞米插话…… 因此接口刻意做成**通用四元组**：
//     位置 + 文本 + 持续时间 + 类型（'speech' 说话 / 'thought' 思索）
// 时序自带：放缩冒出（带回弹）→ 停留 duration 秒 → 放缩淡出，不需要调用方管生命周期；
// 宿主只需每帧 `update(dt)` 并在锚点移动时 `setAnchor(x, y)`。
//
// 渲染（用户要求 ThreeJS）：一个 Group（原点 = **泡泡尾巴尖**，因此"冒出/消失"天然是从
// 尾巴尖向外放缩，像从角色头顶长出来）。坐标按 **UI 空间**设计——放进舞台的 `uiScene`
// （正交相机、清深度后渲染）→ 恒定屏幕尺寸、文字清晰、永远压在 3D 场景之上；
// 若放进 3D 世界场景，给 update 传 camera 即可正对相机（billboard）。
//
// 美术：`assets/ui/bubble_speech|bubble_thought.webp`（椭圆 + 尾巴），两张图的主椭圆几何一致。
// 图版与文本各自一个 plane：图版贴共享纹理（按说话者染色，描边是近黑所以染色后仍是描边），
// 文本用**自烘 canvas**（纯文本，不做富文本）——按主椭圆内接矩形贪心折行 + 自动缩字号。
// 美术未就绪（或 headless 无 document）时退化为一块深色底板 + 文本，不影响模块可用。

import * as THREE from 'three';
import { sharedBubbleArtCache, BUBBLE_ART } from '../art/bubbleArt.js';

// 两张图共用同一主椭圆（实测自 512×512 素材）：中心/半轴（归一化到图宽）
const ELLIPSE = { cx: 0.506, cy: 0.462, rx: 0.365, ry: 0.187 };
// 内接矩形取半轴的 0.70 倍（(0.7)²+(0.7)² = 0.98 ≤ 1，最大面积内接矩形的近似）
const BOX = { w: ELLIPSE.rx * 2 * 0.70, h: ELLIPSE.ry * 2 * 0.70 };
// 尾巴尖（归一化）：说话=尖角尖端；思索=末一颗小圆。图版中心相对尾巴尖的偏移由它推出。
const TIP = { speech: [0.109, 0.699], thought: [0.168, 0.695] };
// 文本中心相对图版中心的偏移（椭圆中心 - 图中心；图 y 向下 → 世界 y 向上取反）
const TEXT_OFF = { x: ELLIPSE.cx - 0.5, y: 0.5 - ELLIPSE.cy };

const IN_MS = 0.26;    // 冒出（放缩 + 回弹）
const OUT_MS = 0.22;   // 消失（放缩 + 淡出）

// 标准 back-out 系数（约 10% 过冲）：冒泡的“弹跳感”来自这里
const easeOutBack = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
const easeInQuad = (t) => t * t;

// ---- 纯文本烘焙（不做富文本）：贪心折行 + 自动缩字号，烘成固定盒尺寸的一张图 ----
/** 按显示宽度贪心断行：CJK 逐字断；西文优先在空格处回退（避免把单词劈开）。 */
function wrapPlain(text, measure, maxWidth) {
  const lines = [];
  let line = '';
  for (const ch of String(text)) {
    if (ch === '\n') { lines.push(line); line = ''; continue; }
    const test = line + ch;
    if (line && measure(test) > maxWidth) {
      const sp = line.lastIndexOf(' ');
      if (sp > 0 && /[A-Za-z0-9)]/.test(ch)) {
        lines.push(line.slice(0, sp));
        line = `${line.slice(sp + 1)}${ch}`;
      } else {
        lines.push(line);
        line = ch;
      }
    } else {
      line = test;
    }
  }
  lines.push(line);
  return lines;
}

/**
 * 把文本烘到固定盒（逻辑像素，10px/世界单位）。字号从大往小找第一档装得下的。
 * @returns {{ texture: THREE.CanvasTexture|null, width: number, height: number }}
 */
function bakeBoxedText(text, { boxW, boxH, color = '#141821', stroke = null }) {
  if (typeof document === 'undefined' || !text) return { texture: null, width: boxW, height: boxH };
  const S = 3;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(boxW * S));
  canvas.height = Math.max(1, Math.round(boxH * S));
  const ctx = canvas.getContext('2d');
  ctx.scale(S, S);
  const fontOf = (px) => `bold ${px}px sans-serif`;
  const meas = document.createElement('canvas').getContext('2d');
  let fontPx = Math.min(30, Math.max(12, Math.round(boxH * 0.52)));
  let lines = [text];
  for (;;) {
    meas.font = fontOf(fontPx);
    lines = wrapPlain(text, (s) => meas.measureText(s).width, boxW - 3);
    const lh = fontPx * 1.22;
    const widest = lines.reduce((m, l) => Math.max(m, meas.measureText(l).width), 0);
    if (fontPx <= 11 || (lines.length * lh <= boxH - 2 && widest <= boxW - 3)) break;
    fontPx -= 1;
  }
  const lh = fontPx * 1.22;
  ctx.font = fontOf(fontPx);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  if (stroke) { ctx.lineWidth = Math.max(2, fontPx * 0.18); ctx.strokeStyle = stroke; }
  const y0 = boxH / 2 - ((lines.length - 1) * lh) / 2;
  lines.forEach((line, i) => {
    if (stroke) ctx.strokeText(line, boxW / 2, y0 + i * lh);
    ctx.fillStyle = color;
    ctx.fillText(line, boxW / 2, y0 + i * lh);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, width: boxW, height: boxH };
}

export class SpeechBubbleObject extends THREE.Group {
  /**
   * @param {object} options
   *   width: 默认气泡宽度（UI 世界单位，图版是正方形；文本盒按主椭圆内接矩形派生）
   *   art:   美术缓存（缺省共享单例；测试可注入 { getTexture } 桩）
   */
  constructor({ width = 28, art = sharedBubbleArtCache } = {}) {
    super();
    this._art = art;
    this._width = width;
    this._kind = 'speech';
    this._tint = null;
    this._duration = 2.6;
    this._phase = 'idle';
    this._t = 0;
    this._artKey = null;     // 已贴上的美术 key（贴成后不再重试）
    this._body = new THREE.Group();   // 放缩/上飘都作用在它身上（原点 = 尾巴尖）
    this.add(this._body);
    // 图版单独一层：**只有它参与水平镜像**（尾巴换边朝向说话者）——文本镜像会变成反字
    this._artGroup = new THREE.Group();
    this._body.add(this._artGroup);
    const plane = () => new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }),
    );
    this._plate = plane();
    this._plate.visible = false;
    this._artGroup.add(this._plate);
    this._fallback = plane();                 // 美术未就绪时的兜底底板（深色）
    this._fallback.visible = false;
    this._artGroup.add(this._fallback);
    this._text = plane();
    this._text.visible = false;
    this._body.add(this._text);
    this.visible = false;
  }

  get busy() { return this._phase !== 'idle'; }
  get phase() { return this._phase; }

  /**
   * 冒一个泡泡（覆盖当前内容并重新计时）。
   * @param {object} data
   *   text:     文本（纯文本，自动折行；可为空 = 只有泡泡）
   *   kind:     'speech'（说话）| 'thought'（思索）
   *   duration: 停留时长（秒，缺省 2.6）
   *   tint:     说话者颜色（乘在图版上；描边近黑，染色后仍是描边）
   *   width:    本次的宽度覆盖（缺省构造时的 width）
   *   flip:     水平镜像（尾巴改朝右下）。缺省 null = **自动**：锚点在屏幕右半边就镜像，
   *             让泡泡朝屏幕中间长（否则靠右角色的泡泡尾巴会指着背离角色的方向）
   */
  show({ text = '', kind = 'speech', duration = 2.6, tint = null, width = null, flip = null } = {}) {
    this._kind = kind === 'thought' ? 'thought' : 'speech';
    this._duration = Math.max(0.4, duration ?? 2.6);
    this._tint = tint;
    this._flip = flip == null ? (this.position.x > 0 ? -1 : 1) : (flip ? -1 : 1);
    this._t = 0;
    this._phase = 'in';
    this.visible = true;
    this._layOut(width ?? this._width);   // 镜像（_flip）在布局里落到图版层上
    this._bakeText(text);
    if (!this._applyArt()) this._applyFallback();
    this._applyTransform(0.001);
    return true;
  }

  /** 锚点（UI 空间坐标；宿主每帧按角色位置调用即可让它跟着角色）。 */
  setAnchor(x, y) { this.position.set(x, y, this.position.z); }

  /** 立刻收掉（不等时序，读取档/离场用）。 */
  hide() {
    this._phase = 'idle';
    this._t = 0;
    this.visible = false;
    return this;
  }

  /**
   * 逐帧推进时序。返回是否仍在播（false = 已自然消失，宿主可回收）。
   * @param dt 秒
   * @param camera 可选：放进 3D 世界场景时正对相机（UI 空间不需要）
   */
  update(dt, camera = null) {
    if (this._phase === 'idle') return false;
    if (!this._artKey) this._applyArt();      // 美术晚到：逐帧重试（贴成即止）
    if (camera) this.quaternion.copy(camera.quaternion);
    this._t += dt;
    let scale = 1;
    let alpha = 1;
    let rise = 0;
    if (this._phase === 'in') {
      const k = Math.min(1, this._t / IN_MS);
      scale = Math.max(0.001, easeOutBack(k));
      alpha = Math.min(1, k * 2);
      if (k >= 1) { this._phase = 'hold'; this._t = 0; }
    } else if (this._phase === 'hold') {
      if (this._t >= this._duration) { this._phase = 'out'; this._t = 0; }
    } else {
      const k = Math.min(1, this._t / OUT_MS);
      scale = Math.max(0.001, 1 - easeInQuad(k));
      alpha = 1 - k;
      rise = 1.4 * k;                          // 消失时轻微上飘（"想完了"的收束感）
      if (k >= 1) {
        this._phase = 'idle';
        this.visible = false;
        return false;
      }
    }
    this._applyTransform(scale, rise);
    this._setOpacity(alpha);
    return true;
  }

  dispose() {
    this.hide();
    for (const mesh of [this._plate, this._fallback, this._text]) {
      mesh.geometry.dispose();
      // ⚠ 图版贴的是**共享**美术纹理（进程级单例）——只丢自烘的文本图，绝不能 dispose 共享纹理
      if (mesh === this._text) mesh.material.map?.dispose?.();
      mesh.material.dispose();
    }
  }

  // ---- 内部 ----

  _layOut(w) {
    this._w = w;
    const [tipX, tipY] = TIP[this._kind] ?? TIP.speech;
    const offX = (0.5 - tipX) * w;             // 图版中心相对尾巴尖
    const offY = (tipY - 0.5) * w;
    // 图版层整体镜像（flip = -1 时尾巴改朝右下）；文本跟随位置但**不镜像**（否则是反字）
    this._artGroup.scale.x = this._flip ?? 1;
    this._plate.position.set(offX, offY, 0);
    this._plate.scale.set(w, w, 1);
    this._fallback.position.set(offX, offY, -0.02);
    this._fallback.scale.set(w * BOX.w, w * BOX.h, 1);   // 与文本盒同尺寸的底板
    this._text.position.set((this._flip ?? 1) * (offX + TEXT_OFF.x * w), offY + TEXT_OFF.y * w, 0.02);
    this._text.scale.set(BOX.w * w, BOX.h * w, 1);
  }

  _bakeText(text) {
    this._text.material.map?.dispose?.();
    this._text.material.map = null;
    this._text.visible = false;
    if (!text) return;
    const w = this._w ?? this._width;
    // 文字色按气泡底色明暗取反：气泡被染深色时用亮字，否则用墨色
    const lum = this._tint ? new THREE.Color(this._tint).getHSL({}).l : 0.62;
    const light = lum < 0.45;
    const baked = bakeBoxedText(text, {
      boxW: BOX.w * w * 10, boxH: BOX.h * w * 10,
      color: light ? '#f4f7ff' : '#12161f',
      stroke: light ? 'rgba(8,10,16,0.55)' : null,
    });
    if (!baked.texture) return;
    this._text.material.map = baked.texture;
    this._text.material.needsUpdate = true;
    this._text.visible = true;
  }

  /** 贴共享美术纹理（未就绪返回 false，由 update 逐帧重试）。 */
  _applyArt() {
    const key = BUBBLE_ART[this._kind] ?? BUBBLE_ART.speech;
    const tex = this._art?.getTexture?.(key);
    if (!tex) return false;
    if (this._artKey !== key) {
      this._plate.material.map = tex;
      this._plate.material.needsUpdate = true;
      this._artKey = key;
    }
    this._plate.material.color.set(this._tint ?? 0xffffff);
    this._plate.visible = true;
    this._fallback.visible = false;
    return true;
  }

  /** 美术未就绪（含 headless）：一块深色底板兜底，保证文本可读。 */
  _applyFallback() {
    if (this._artKey) return;
    this._fallback.material.color.set(this._tint ?? 0x2a3040);
    this._fallback.visible = true;
  }

  _applyTransform(scale, rise = 0) {
    this._body.scale.setScalar(scale);   // 冒出/消失的放缩（原点 = 尾巴尖）
    this._body.position.y = rise;
  }

  _setOpacity(a) {
    this._plate.material.opacity = a;
    this._fallback.material.opacity = a * 0.94;
    this._text.material.opacity = a;
  }
}
