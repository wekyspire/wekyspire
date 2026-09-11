// ButtonObject：可点击按钮（UI pass 空间）——烘焙按钮面 + 三态 + Picker 注册。
// 与战斗侧按钮同语言（bakeButtonFace 三态：enabled 蓝钢金边 / active 翠绿 / disabled 深灰），
// 但抽成独立对象：战斗侧那颗按钮的接线锁在 BattleStage 内部，休息阶段面板需要可复用形态。
//
// 交互模型：本对象只负责**视觉与拾取注册**，点击语义由宿主面板按 pickableId 路由
// （Stage 不持有游戏逻辑——见 quest_prompts/THREE_UI_MIGRATION.md §4.2-2）。

import * as THREE from 'three';
import { bakeButtonFace } from '../richtext/buttonFace.js';

const PX_PER_WU = 10;

export class ButtonObject extends THREE.Mesh {
  /**
   * @param {object} options
   *   id:       拾取 id（宿主用它路由点击）
   *   width/height: 逻辑像素尺寸（10px/wu）
   *   bakeButton: 注入烘焙（缺省 bakeButtonFace；node 无 document 退化占位）
   *   fontPx:   标签字号
   */
  constructor({ id, width = 150, height = 60, bakeButton = null, fontPx = 16 } = {}) {
    super(
      new THREE.PlaneGeometry(width / PX_PER_WU, height / PX_PER_WU),
      new THREE.MeshBasicMaterial({ transparent: true }),
    );
    this.pickId = id;
    this.data = { label: '', sublabel: null, enabled: true, active: false };
    this.hovered = false;
    this._width = width;
    this._height = height;
    this._fontPx = fontPx;
    this._bakeButton = bakeButton || defaultBakeButton;
    this._sig = null;
  }

  /** 设置按钮数据（同签名不重烘）；返回是否发生了重烘。 */
  setData({ label, sublabel = null, enabled = true, active = false } = {}) {
    const sig = `${label}|${sublabel ?? ''}|${enabled}|${active}|${this.hovered}`;
    this.data = { label, sublabel, enabled, active };
    if (sig === this._sig) return false;
    this._sig = sig;
    this._rebake();
    return true;
  }

  setHovered(hovered) {
    const next = !!hovered;
    if (next === this.hovered) return;
    this.hovered = next;
    // disabled/active 的主题与 hover 无关 → 不重烘（省一次 canvas 烘焙）
    if (!this.data.enabled || this.data.active) return;
    this._rebake();
  }

  /** 中心锚放置（面板行流用左锚时由宿主换算）。 */
  placeCenter(x, y) {
    this.position.set(x, y, this.position.z);
  }

  dispose() {
    this.geometry.dispose();
    this.material.map?.dispose?.();
    this.material.dispose();
  }

  _rebake() {
    this.material.map?.dispose?.();
    // 悬停抬亮：与 enabled 主题叠加（disabled 不抬亮，视觉与语义一致）
    const active = this.data.active || (this.hovered && this.data.enabled);
    const baked = this._bakeButton({
      label: this.data.label ?? '',
      sublabel: this.data.sublabel,
      enabled: this.data.enabled,
      active,
    }, { width: this._width, height: this._height, fontPx: this._fontPx });
    this.material.map = baked.texture;
    this.material.needsUpdate = true;
  }
}

// 缺省烘焙：bakeButtonFace 仅浏览器可用（需真实 canvas）；node 退化占位纹理。
function defaultBakeButton(data, { width = 150, height = 60 } = {}) {
  if (typeof document === 'undefined') {
    const texture = new THREE.Texture();
    texture.needsUpdate = true;
    return { texture, hitRegions: [], width, height };
  }
  return bakeButtonFace(data, { width, height });
}
