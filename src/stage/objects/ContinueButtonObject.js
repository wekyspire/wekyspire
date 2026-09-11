// ContinueButtonObject：休息房右下角的**「继续前进」大按钮**（用户定 2026-09-11）。
//
// 场景式休息房没有"自动离开"这一步——玩家看完/玩完房间后，主动点这个箭头离开休息室、
// 回到塔楼层。美术 `assets/ui/continue_arrow.webp`（红箭头 + 白字「继续」）自带文案，
// 所以本对象只负责：贴图 + 悬停/按下的手感 + 一点点呼吸吸引注意 + 拾取登记。
//
// 与其它 UI 原语一致：只做"长什么样 + 被点了就报"，点完干什么由宿主（RoomStage → 意图）决定。

import * as THREE from 'three';
import { sharedUiArtCache, CONTINUE_ART } from '../art/bubbleArt.js';

// 素材是 512×512 的正方形，箭头实占 x[78,474] y[129,357]（居中偏右下一点）——
// 于是"视觉箭头宽度"≈ 平面宽度的 0.773，高度≈ 0.445。按箭头宽度给尺寸更好理解。
const ARROW_FRACTION = { w: 396 / 512, h: 228 / 512, cx: 276 / 512 - 0.5, cy: 0.5 - 243 / 512 };

export class ContinueButtonObject extends THREE.Group {
  /**
   * @param {object} options
   *   arrowWidth: 箭头的**视觉宽度**（UI 世界单位；平面尺寸按素材比例反推）
   *   art: 美术缓存（缺省共享 UI 单例；测试可注入 { getTexture } 桩）
   *   pickId: 拾取 id（宿主路由用）
   */
  constructor({ arrowWidth = 24, art = sharedUiArtCache, pickId = 'room:continue' } = {}) {
    super();
    this.pickId = pickId;
    this._arrowWidth = arrowWidth;
    this._art = art;
    this._hover = 0;      // 0..1 平滑
    this._pressed = false;
    this._t = 0;
    this._enabled = true;
    this._ready = false;
    this._plate = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }),
    );
    this.add(this._plate);
    this._layOut();
    this._applyArt();     // 预载命中就立即贴上（否则 update 逐帧重试）
  }

  get enabled() { return this._enabled; }
  setEnabled(on) { this._enabled = !!on; this._plate.visible = !!on; return this; }
  setHovered(on) { this._hoverTarget = on ? 1 : 0; return this; }
  setPressed(on) { this._pressed = !!on; return this; }

  update(dt) {
    this._t += dt;
    if (!this._ready) this._applyArt();
    this._hover += ((this._hoverTarget ?? 0) - this._hover) * Math.min(1, dt * 10);
    // 呼吸 + 悬停放大 + 按下回缩：一眼看出"这个能点、点了就走"
    const breathe = 1 + 0.022 * Math.sin(this._t * 2.4);
    const k = breathe * (1 + 0.07 * this._hover) * (this._pressed ? 0.94 : 1);
    this.scale.setScalar(k);
    this._plate.material.color.setScalar(1 + 0.22 * this._hover);
    return true;
  }

  dispose() {
    this._plate.geometry.dispose();
    // 贴的是共享 UI 纹理（进程级单例）——只丢材质，不 dispose 纹理
    this._plate.material.dispose();
  }

  // ---- 内部 ----
  _layOut() {
    const w = this._arrowWidth / ARROW_FRACTION.w;         // 平面宽度（正方形素材）
    this._plate.scale.set(w, w, 1);
    this._planeW = w;
    // 箭头在素材里不是正中：把箭头的**视觉中心**挪到 group 原点
    this._plate.position.set(-ARROW_FRACTION.cx * w, -ARROW_FRACTION.cy * w, 0);
  }

  _applyArt() {
    const tex = this._art?.getTexture?.(CONTINUE_ART);
    if (!tex) return false;
    this._plate.material.map = tex;
    this._plate.material.needsUpdate = true;
    this._ready = true;
    return true;
  }
}
