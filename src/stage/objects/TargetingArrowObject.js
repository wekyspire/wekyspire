// TargetingArrowObject：杀戮尖塔式选目标箭头。
// 卡牌留手牌不动，一条圆点曲线（二次贝塞尔）从卡牌延伸到指针处，末端带箭头；
// 锁定存活敌人时变色（暖金 → 青绿），配合单位高亮表达"目标已指定"。
//
// 纯 UI 空间物件（挂 uiScene，z 由调用方定）：每帧由指针移动驱动 update(from, to)，
// 不进动画队列、不进 animator 注册表——fire-and-forget 的指针追随物。

import * as THREE from 'three';

const DOT_COUNT = 14;         // 曲线上的圆点数（不含箭头）
const DOT_SIZE = 1.5;         // 圆点基准边长（世界单位）
const HEAD_SIZE = 2.2;        // 箭头基准尺寸
const BEND_RATIO = 0.16;      // 弧线弯度 = 两端距离 × 此系数
const BEND_MAX = 14;          // 弯度上限（防远距离弧线过于夸张）

export const ARROW_COLOR_FREE = 0xffcf6e; // 未锁定目标：暖金
export const ARROW_COLOR_LOCK = 0x8dff7a; // 已锁定存活敌人：青绿

export class TargetingArrowObject extends THREE.Group {
  constructor({ dotCount = DOT_COUNT } = {}) {
    super();
    this._dotCount = dotCount;
    this._material = new THREE.MeshBasicMaterial({
      color: ARROW_COLOR_FREE,
      transparent: true,
      opacity: 0.95,
      depthTest: false,   // UI 覆盖物：不参与深度竞争（viewer 打开时 aiming 不可达，无冲突）
      depthWrite: false,
      map: makeDotTexture(), // 浏览器：canvas 圆点贴图；node 单测：null（方块占位）
    });
    const dotGeo = new THREE.PlaneGeometry(DOT_SIZE, DOT_SIZE);
    this._dots = [];
    for (let i = 0; i < dotCount; i++) {
      const dot = new THREE.Mesh(dotGeo, this._material);
      dot.renderOrder = 5;
      this.add(dot);
      this._dots.push(dot);
    }
    // 箭头：三角形，尖端朝 +Y（update 里按末端切线旋转对齐）
    const shape = new THREE.Shape();
    shape.moveTo(0, HEAD_SIZE);
    shape.lineTo(HEAD_SIZE * 0.62, -HEAD_SIZE * 0.5);
    shape.lineTo(-HEAD_SIZE * 0.62, -HEAD_SIZE * 0.5);
    shape.closePath();
    this._head = new THREE.Mesh(new THREE.ShapeGeometry(shape), this._material);
    this._head.renderOrder = 5;
    this.add(this._head);

    this._dotGeo = dotGeo;
    this._from = new THREE.Vector3();
    this._to = new THREE.Vector3();
    this._ctrl = new THREE.Vector3();
    this.visible = false;
  }

  /** 开始瞄准：定起点（卡牌位置）并显示。 */
  show(from) {
    this._from.copy(from);
    this._to.copy(from);
    this.visible = true;
    this._layout();
  }

  /** 指针移动：刷新起点（卡牌可能随跟踪补间微移）与终点，重排圆点。 */
  update(from, to) {
    if (from) this._from.copy(from);
    this._to.copy(to);
    if (this.visible) this._layout();
  }

  hide() { this.visible = false; }

  /** 目标锁定状态：true = 指针下是存活敌人（变青绿）。 */
  setTargetValid(valid) {
    this._material.color.set(valid ? ARROW_COLOR_LOCK : ARROW_COLOR_FREE);
  }

  get targetValid() { return this._material.color.getHex() === ARROW_COLOR_LOCK; }

  // 二次贝塞尔：控制点取中点 + 向上凸的法向偏移（弧线永远向上鼓，瞄准手感一致）
  _layout() {
    const { _from: a, _to: b, _ctrl: c } = this;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    let px = 0;
    let py = 1;
    if (dist > 1e-4) { px = -dy / dist; py = dx / dist; }
    if (py < 0) { px = -px; py = -py; } // 凸向取上
    const bend = Math.min(dist * BEND_RATIO, BEND_MAX);
    c.set((a.x + b.x) / 2 + px * bend, (a.y + b.y) / 2 + py * bend, 0);

    const n = this._dots.length;
    for (let i = 0; i < n; i++) {
      const t = 0.06 + (i / Math.max(1, n - 1)) * 0.84; // 两端留空：尾部不遮牌、头部让位箭头
      const p = quadPoint(a, c, b, t);
      const dot = this._dots[i];
      dot.position.set(p.x, p.y, 0);
      const s = 0.5 + t * 0.9; // 尾小头大，指向性
      dot.scale.set(s, s, 1);
    }
    this._head.position.set(b.x, b.y, 0);
    if (dist > 1e-4) {
      const tx = b.x - c.x;
      const ty = b.y - c.y;
      this._head.rotation.z = Math.atan2(ty, tx) - Math.PI / 2;
    }
  }

  dispose() {
    this._dotGeo.dispose();
    this._head.geometry.dispose();
    this._material.map?.dispose?.();
    this._material.dispose();
  }
}

// 二次贝塞尔取点：(1-t)²a + 2(1-t)t·c + t²b
function quadPoint(a, c, b, t) {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * c.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * c.y + t * t * b.y,
  };
}

// 圆点贴图（浏览器 canvas）；node 单测无 document → null（纯色方块占位即可）
function makeDotTexture() {
  if (typeof document === 'undefined') return null;
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}
