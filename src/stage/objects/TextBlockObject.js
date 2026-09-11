// TextBlockObject：一行/一块文本的 Three 面片（UI pass 空间）。
// 烘焙器注入（与 MapStage 的 bakeLabel 同一契约：text → {texture,width,height}），
// node 无 document 时退化为 1x1 占位——面板对象因此可在 headless 下构造（契约测试前提）。
//
// 坐标：纹理 width/height 是**逻辑像素**，按全局 10px/世界单位 约定换算（textBakers 同律）。
// 锚点：默认左对齐到 (x, y)（面板的行流布局用左锚最省心）。

import * as THREE from 'three';
import { bakeBoldText } from './textBakers.js';

const PX_PER_WU = 10;

export class TextBlockObject extends THREE.Mesh {
  /**
   * @param {object} options
   *   bakeText: (text, {fontPx, tint, maxWidth}) => {texture,width,height}
   *   fontPx / tint: 缺省样式
   */
  constructor({ bakeText = null, fontPx = 16, tint = '#cdd6f4' } = {}) {
    super(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ transparent: true }),
    );
    this._bakeText = bakeText || defaultBakeText;
    this._fontPx = fontPx;
    this._tint = tint;
    this._sig = null;
    this.text = '';
  }

  /**
   * 设置文本（同签名不重烘——面板每次 notify 都会重推快照）。
   * @param {string} text
   * @param {object} opts fontPx / tint / maxWidth
   */
  setText(text, { fontPx, tint, maxWidth } = {}) {
    const value = text ?? '';
    const px = fontPx ?? this._fontPx;
    const color = tint ?? this._tint;
    const sig = `${value}|${px}|${color}|${maxWidth ?? 0}`;
    if (sig === this._sig) return;
    this._sig = sig;
    this.text = value;
    this.material.map?.dispose?.();
    const baked = this._bakeText(value, { fontPx: px, tint: color, maxWidth });
    this.material.map = baked.texture;
    this.material.needsUpdate = true;
    const w = Math.max(1, baked.width) / PX_PER_WU;
    const h = Math.max(1, baked.height) / PX_PER_WU;
    this.scale.set(w, h, 1);
  }

  /** 左锚：把面片左上角放到 (x, y)（几何原点在中心，故按半尺寸回退）。 */
  placeLeftTop(x, y) {
    this.position.set(x + this.scale.x / 2, y - this.scale.y / 2, this.position.z);
  }

  /** 上边中点锚：把面片顶边中点放到 (x, y)（模态面板的居中行用）。 */
  placeCenterTop(x, y) {
    this.position.set(x, y - this.scale.y / 2, this.position.z);
  }

  dispose() {
    this.geometry.dispose();
    this.material.map?.dispose?.();
    this.material.dispose();
  }
}

// 缺省烘焙：浏览器走 bakeBoldText；node 无 document 退化为纯尺寸占位（不产 canvas）。
function defaultBakeText(text, { fontPx = 16, tint = '#ffffff' } = {}) {
  if (typeof document === 'undefined') {
    const texture = new THREE.Texture();
    texture.needsUpdate = true;
    // 占位尺寸按字符数粗估，保证 headless 下布局有合理非零值
    return { texture, width: Math.max(1, fontPx * 0.7 * String(text).length), height: fontPx * 1.4 };
  }
  return bakeBoldText(text, { fontPx, tint });
}
