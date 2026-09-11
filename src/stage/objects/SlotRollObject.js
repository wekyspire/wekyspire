// SlotRollObject：老虎机「转轮」演出（占位版：一个摇摆的 🎰 字牌）。
//
// 它存在的意义不只是好看——**它是结果揭示的闸门**：旧实现在 RoomPanel.vue 里用 CSS
// 关键帧 + DOM `@animationend` 当完成信号，面板一迁走这个信号就没了。现在完成信号
// 由本对象自己给出（update 推进到时长即回执），宿主据此调 runController 的
// reportSlotAnimDone 开闸，保持「roll 落定才揭示结果」的渐进揭示语义。
//
// 用 dt 驱动而不是 gsap/rAF：①与舞台 tick 同一时钟（MapStage.onEnter 已订 tick）；
// ②headless 里可直接 update(dt) 推演到完成，不必依赖 rAF（契约测试前提）。

import * as THREE from 'three';
import { TextBlockObject } from './TextBlockObject.js';

const DEFAULT_MS = 1100; // 与旧 CSS 关键帧时长一致（slot-roll 1.1s）

export class SlotRollObject extends THREE.Group {
  /**
   * @param {object} options
   *   durationMs: 转动时长（到点即回执）
   *   bakeText:   文本烘焙（注入；node 退化为占位）
   *   glyph:      转轮字牌（占位素材；到位后可换成真转轮网格）
   */
  constructor({ durationMs = DEFAULT_MS, bakeText = null, glyph = '🎰' } = {}) {
    super();
    this._duration = durationMs;
    this._t = 0;
    this._running = false;
    this._onDone = null;
    this._art = new TextBlockObject({ bakeText, fontPx: 40, tint: '#ffd75e' });
    this._art.setText(glyph);
    this.add(this._art);
    this.visible = false;
  }

  get running() { return this._running; }
  get art() { return this._art; }

  /** 开始一次转动；到点调 onDone（宿主负责回执）。 */
  play(onDone = null) {
    this._onDone = onDone;
    this._t = 0;
    this._running = true;
    this.visible = true;
  }

  /** 帧驱动：返回 true 表示本次转动刚刚结束（本帧完成）。 */
  update(dtMs) {
    if (!this._running) return false;
    this._t += dtMs;
    const k = Math.min(1, this._t / this._duration);
    // 摇摆包络：幅度随进度衰减（收束感），与旧 CSS 的 -16°→12°→-8°→0 同气质
    const decay = 1 - k;
    const wob = Math.sin(k * Math.PI * 4.5);
    this._art.position.y = Math.sin(k * Math.PI * 3) * 1.4 * decay;
    this._art.rotation.z = wob * 0.28 * decay;
    if (k < 1) return false;
    this._running = false;
    this._art.position.y = 0;
    this._art.rotation.z = 0;
    const cb = this._onDone;
    this._onDone = null;
    cb?.();
    return true;
  }

  /** 收起（结果揭示后由宿主调用；下一次 spin 会重新 play）。 */
  reset() {
    this._running = false;
    this._onDone = null;
    this._t = 0;
    this._art.position.y = 0;
    this._art.rotation.z = 0;
    this.visible = false;
  }

  dispose() {
    this.remove(this._art);
    this._art.dispose();
  }
}
