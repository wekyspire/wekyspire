// BubbleLayer：一批**按锚点归位**的对话/思索泡泡（用户定 2026-09-11）。
//
// 一个角色同一时刻只该有一个泡泡：以 `key`（单位 uniqueID / 角色名）为槽，重复 say 同一个 key
// 就是"改台词并重新计时"（不会叠出两个泡泡）。泡泡自己走完时序即自然消失，宿主只要：
//     layer.say(unitId, { text, kind, duration, x, y });   // 冒一个
//     layer.moveTo(unitId, x, y);                          // 角色动了（每帧）
//     layer.update(dt);                                    // 逐帧推进（在舞台 onTick 里）
// 位置用 **UI 空间坐标**（放进舞台的 uiScene）——恒定屏幕尺寸、清晰、永远在最前；
// 具体世界坐标 → UI 空间由舞台侧换算（`StageManager.worldToUI`）。
//
// 生命周期：泡泡播完即从层里摘除并 dispose（纹理自烘的都会释放；共享美术纹理不会）。

import * as THREE from 'three';
import { SpeechBubbleObject } from './SpeechBubbleObject.js';

export class BubbleLayer extends THREE.Group {
  /**
   * @param {object} options
   *   width: 默认气泡宽度（UI 世界单位）
   *   art:   美术缓存（缺省共享单例）
   *   z:     层内物体 z（uiScene 里给一点前推余量，避免与同层 UI 共面）
   */
  constructor({ width = 28, art = null, z = 0 } = {}) {
    super();
    this._width = width;
    this._art = art;
    this._z = z;
    this._bubbles = new Map();   // key -> SpeechBubbleObject
    this.visible = true;
  }

  /** 当前在播的泡泡数（测试/调试）。 */
  get count() { return this._bubbles.size; }
  /** 在播泡泡的锚点 key 列表（宿主据此逐帧跟随锚点）。 */
  get keys() { return [...this._bubbles.keys()]; }
  has(key) { return this._bubbles.has(key); }

  /**
   * 让某个角色冒一个泡泡（同 key 覆盖并重新计时）。
   * @param key 锚点标识（单位 uniqueID / 'remi' / 'shopkeeper' …）
   * @param data { x, y }（UI 空间锚点） + SpeechBubbleObject.show 的其余字段
   *             （text / kind / duration / tint / width）
   */
  say(key, { x = 0, y = 0, ...data } = {}) {
    if (key == null) return null;
    let b = this._bubbles.get(key);
    if (!b) {
      b = new SpeechBubbleObject({ width: this._width, art: this._art ?? undefined });
      b.position.z = this._z;
      this.add(b);
      this._bubbles.set(key, b);
    }
    b.setAnchor(x, y);
    b.show(data);
    return b;
  }

  /** 锚点跟随（角色移动/浮动时每帧调用）。不存在的 key 静默忽略。 */
  moveTo(key, x, y) {
    const b = this._bubbles.get(key);
    if (b) b.setAnchor(x, y);
    return !!b;
  }

  /** 立刻收掉某个（或全部）泡泡。 */
  hide(key = null) {
    if (key == null) {
      for (const b of this._bubbles.values()) b.hide();
      return;
    }
    this._bubbles.get(key)?.hide();
  }

  /**
   * 逐帧推进所有泡泡；播完的自动摘除并释放。
   * @param camera 可选（层放进 3D 世界场景时正对相机）
   */
  update(dt, camera = null) {
    for (const [key, b] of [...this._bubbles]) {
      if (b.update(dt, camera)) continue;
      this.remove(b);
      b.dispose();
      this._bubbles.delete(key);
    }
  }

  /** 清空并释放（舞台 dispose）。 */
  dispose() {
    for (const b of this._bubbles.values()) {
      this.remove(b);
      b.dispose();
    }
    this._bubbles.clear();
  }
}
