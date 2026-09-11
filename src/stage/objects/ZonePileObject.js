// ZonePileObject：牌库等区域图标（卡背样式 + 计数）。
// 点击交互由 BattleStage 处理（kind:'pile' → 打开区域查看器），本类只管视觉与计数重烘。

import * as THREE from 'three';

const ICON_LAYOUT = { width: 100, height: 120 }; // 10x12 世界单位 × 10px（icon 型小图标）

export class ZonePileObject extends THREE.Group {
  /**
   * @param {object} options
   *   zoneKey: 'deck'|'burnt'
   *   label: 显示名（牌库/焚毁）
   *   color: 边框/主题色
   *   bakeIcon: (label, count, color) => { texture, width, height }   缺省浏览器 canvas 实现
   */
  constructor({ zoneKey, label, color = '#5aa2e8', bakeIcon = null, width = 10, height = 12 }) {
    super();
    this.zoneKey = zoneKey;
    this.label = label;
    this._bakeIcon = bakeIcon || defaultBakeIcon;
    this._color = color;

    this._material = new THREE.MeshBasicMaterial({ transparent: true });
    this._mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), this._material);
    this.add(this._mesh);

    this._count = null;
  }

  /** 计数更新：变化才重烘。返回是否有变化（供脉冲判断）。 */
  setCount(n) {
    if (n === this._count) return false;
    this._count = n;
    const { texture } = this._bakeIcon(this.label, n, this._color);
    const old = this._material.map;
    this._material.map = texture;
    this._material.needsUpdate = true;
    old?.dispose?.();
    return true;
  }

  get count() { return this._count; }

  dispose() {
    this._mesh.geometry.dispose();
    this._material.map?.dispose?.();
    this._material.dispose();
  }
}

// 默认图标烘焙：卡背 + 区域名 + 大计数
function defaultBakeIcon(label, count, color) {
  if (typeof document === 'undefined') {
    const texture = new THREE.Texture({ width: 1, height: 1 });
    texture.needsUpdate = true;
    return { texture, width: 1, height: 1 };
  }
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = ICON_LAYOUT.width * scale;
  canvas.height = ICON_LAYOUT.height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  const { width: W, height: H } = ICON_LAYOUT;

  // 卡背
  ctx.beginPath();
  const r = 10;
  ctx.moveTo(r, 0);
  ctx.arcTo(W, 0, W, H, r);
  ctx.arcTo(W, H, 0, H, r);
  ctx.arcTo(0, H, 0, 0, r);
  ctx.arcTo(0, 0, W, 0, r);
  ctx.closePath();
  ctx.fillStyle = '#232634';
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = color;
  ctx.stroke();
  // 斜纹
  ctx.save();
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 4;
  for (let i = -H; i < W + H; i += 12) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + H, H);
    ctx.stroke();
  }
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#aab';
  ctx.font = '14px sans-serif';
  ctx.fillText(label, W / 2, 20);
  ctx.fillStyle = '#f2f4fa';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText(String(count), W / 2, H / 2 + 16);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return { texture, width: W, height: H };
}
