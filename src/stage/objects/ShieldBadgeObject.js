// ShieldBadgeObject：盾形护盾徽章（概念图：头像右下角悬挂的蓝盾 + 白色盾值数字）。
// 护盾无上限由徽章数值直接表达。美术资源到位后盾面整体换贴图。
// 层级：徽章悬挂处与血环/盾环重叠——宿主把徽章组 z 抬到环类之上（盾徽必须盖住
// 环），数字面片在组内再 z+0.5 盖住盾面（状态层法则：z painter 序即层级，
// 见 PlayerStatusObject.statusifyPanel）。
// 结构：Group
//   ├─ shield: 盾形 plane（浏览器程序化烘焙：纹章盾形 + 蓝渐变 + 内亮描边；
//   │          node 单测退化为圆角蓝方块色块）
//   └─ num:    盾值数字 plane（bakeBoldText 粗体烘焙，签名不变不重烘）
// 0 盾淡出隐藏，>0 淡入；淡入淡出由宿主逐帧 update(dt) 驱动。

import * as THREE from 'three';
import { bakeBoldText } from './textBakers.js';

const RATE = 8;          // 出现/消失透明度趋近速率（/s）
const SNAP_EPS = 0.01;
const BLUE = 0x4a8ed8;   // node 退化色（与烘焙渐变基色一致）
// 盾值字号随盾高（≈盾高七成的大号粗体数字；盾面尺寸由宿主按面板缩放传入）
const NUM_FONT_PER_H = 5;
const _numColor = new THREE.Color(0xffffff);

export class ShieldBadgeObject extends THREE.Group {
  /**
   * @param {object} options
   *   bakeLabel: (text) => { texture, width, height }   node 单测注入的数字烘焙兜底
   *   width/height: 盾牌世界尺寸
   */
  constructor({ bakeLabel = null, width = 3.2, height = 3.7 } = {}) {
    super();
    this._bakeLabel = bakeLabel || defaultBake;
    this._width = width;
    this._height = height;

    const baked = typeof document !== 'undefined' ? bakeShieldFace(width * 10, height * 10) : null;
    this._shieldMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
    this._shield = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this._shieldMaterial);
    this._shield.name = 'shield';
    if (baked) {
      this._shieldMaterial.map = baked;
      this._shieldMaterial.color.set(0xffffff);
    } else {
      this._shieldMaterial.color.set(BLUE); // node 退化：蓝盾色块
    }
    this._shieldMaterial.needsUpdate = true;
    this.add(this._shield);

    this._numMaterial = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 });
    this._num = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this._numMaterial);
    this._num.name = 'num';
    this._num.position.set(0, height * 0.05, 0.5); // z+0.5：数字盖住盾面
    this.add(this._num);

    this._value = 0;
    this._sig = null;
    this._appear = 0;      // 当前透明度（0 隐藏 → 1 全显）
    this._targetAppear = 0;
    this.visible = false;  // 初始隐藏（update 首帧起按 appear 接管可见性）
  }

  /** 盾值更新：0 隐藏，>0 显示并重烘数字。 */
  setValue(n) {
    this._value = Math.max(0, n | 0);
    this._targetAppear = this._value > 0 ? 1 : 0;
    const sig = `${this._value}`;
    if (sig === this._sig) return false;
    this._sig = sig;
    // 概念图大号粗体盾值（白字+深描边，按烘焙实尺寸铺面片）；node 走注入 baker 兜底
    const { texture, width, height } = typeof document !== 'undefined'
      ? bakeBoldText(sig, { fontPx: Math.round(this._height * NUM_FONT_PER_H) })
      : this._bakeLabel(sig);
    const old = this._numMaterial.map;
    this._numMaterial.map = texture;
    this._numMaterial.color.copy(_numColor);
    this._numMaterial.needsUpdate = true;
    old?.dispose?.();
    this._num.geometry.dispose();
    this._num.geometry = new THREE.PlaneGeometry(width / 10, height / 10);
    return true;
  }

  get value() { return this._value; }
  get appear() { return this._appear; }

  /** 帧推进：整徽淡入淡出（两面同步透明度）。 */
  update(dt) {
    const k = Math.min(1, dt * RATE);
    this._appear += (this._targetAppear - this._appear) * k;
    if (Math.abs(this._targetAppear - this._appear) < SNAP_EPS) this._appear = this._targetAppear;
    this.visible = this._appear > 0.01;
    this._shieldMaterial.opacity = this._appear;
    this._numMaterial.opacity = this._appear;
  }

  dispose() {
    this._shield.geometry.dispose();
    this._shieldMaterial.map?.dispose?.();
    this._shieldMaterial.dispose();
    this._num.geometry.dispose();
    this._numMaterial.map?.dispose?.();
    this._numMaterial.dispose();
  }
}

// 盾面烘焙：纹章盾形（平顶、两侧内收、底尖）+ 蓝渐变 + 亮内描边 + 顶部高光。
// 美术资源到位后整体换贴图，此绘制即占位符。
function bakeShieldFace(wPx, hPx) {
  const S = 3; // 超采样（面板放大后盾面在 1080p 已近百像素宽，S=2 会糊）
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(wPx * S);
  canvas.height = Math.ceil(hPx * S);
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  // 盾形路径：顶部微弧 → 两侧向内收 → 底部尖
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(W * 0.1, H * 0.1);
    ctx.quadraticCurveTo(W * 0.5, H * 0.16, W * 0.9, H * 0.1); // 顶边微下弧
    ctx.quadraticCurveTo(W * 0.94, H * 0.55, W * 0.5, H * 0.96); // 右侧内收到底尖
    ctx.quadraticCurveTo(W * 0.06, H * 0.55, W * 0.1, H * 0.1); // 左侧回收
    ctx.closePath();
  };
  path();
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#6fb0e8');
  grad.addColorStop(0.6, '#4a8ed8');
  grad.addColorStop(1, '#2f6cb4');
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(10, 26, 48, 0.85)';
  ctx.lineWidth = 2.5 * S;
  ctx.stroke();
  // 内亮描边
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(224, 242, 255, 0.75)';
  ctx.lineWidth = 1.6 * S;
  ctx.stroke();
  // 顶部高光带
  const hl = ctx.createLinearGradient(0, 0, 0, H * 0.4);
  hl.addColorStop(0, 'rgba(255, 255, 255, 0.35)');
  hl.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = hl;
  ctx.fillRect(0, 0, W, H * 0.4);
  ctx.restore();

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
